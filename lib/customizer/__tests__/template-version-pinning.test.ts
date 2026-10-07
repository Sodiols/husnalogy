/**
 * TEMPLATE VERSION INTEGRITY — a saved customization made on Version N is
 * opened, validated and rendered on Version N, and on nothing else.
 *
 * If that exact immutable version cannot be loaded, the design is BLOCKED with
 * a recoverable error. It is never silently moved onto the latest version (or
 * the working draft), because the next autosave would then rewrite the
 * customer's saved design against artwork they never chose.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    versions: [] as any[],
    customizations: [] as any[],
    draft: null as any,
    failTables: new Set<string>(),
  };
  function query(table: string) {
    const filters: Record<string, unknown> = {};
    let single = false;
    let limited = Infinity;
    const run = () => {
      if (state.failTables.has(table)) return { data: null, error: { message: `simulated ${table} outage` } };
      const source = table === "customizer_template_versions" ? state.versions : table === "product_customizations" ? state.customizations : [];
      const rows = source
        .filter((row) => Object.entries(filters).every(([key, value]) => String(row[key]) === String(value)))
        .sort((a, b) => Number(b.version || 0) - Number(a.version || 0))
        .slice(0, limited);
      return { data: single ? rows[0] || null : rows, error: null };
    };
    const builder: any = {
      select: () => builder,
      eq: (key: string, value: unknown) => ((filters[key] = value), builder),
      order: () => builder,
      limit: (value: number) => ((limited = value), builder),
      maybeSingle: () => ((single = true), builder),
      then: (resolve: (value: any) => void) => resolve(run()),
    };
    return builder;
  }
  return {
    state,
    createServiceRoleClient: vi.fn(() => ({ from: (table: string) => query(table) })),
    getCustomizerTemplateByProductId: vi.fn(async () => state.draft),
  };
});

vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: mocks.createServiceRoleClient }));
vi.mock("@/lib/customizer/store", () => ({ getCustomizerTemplateByProductId: mocks.getCustomizerTemplateByProductId }));
vi.mock("@/lib/customizer/server/admin-assets", () => ({
  hydrateAdminAssetUrls: async (document: any) => document,
  stripAdminAssetUrls: (value: any) => value,
}));

import {
  getExactPublishedVersion,
  getPublicCustomizerTemplate,
  getTrustedTemplateForCustomization,
  resolveSessionTemplate,
} from "@/lib/customizer/versions";
import { EXACT_VERSION_UNAVAILABLE_MESSAGE, savedDesignMatchesTemplate } from "@/lib/customizer/version-pin";

const state = mocks.state;
const PRODUCT = "prod-1";
const TEMPLATE = "tpl-1";
const OWNER = "user-a";

/** Version N has visibly different geometry: the headline moves and grows. */
function version(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `ver-${n}`,
    template_id: TEMPLATE,
    product_id: PRODUCT,
    version: n,
    major_version: 1,
    minor_revision: n,
    schema_version: 4,
    engine_version: "husnalogy-2.2.0",
    published_by: "admin",
    notes: "",
    created_at: `2026-10-0${n}T00:00:00Z`,
    font_dependencies: [],
    document: {
      canvas: { widthPx: 1500, heightPx: 2100, widthIn: 5, heightIn: 7, dpi: 300, orientation: "portrait" },
      pages: [{ id: "front", name: "Front", enabled: true }],
      fields: [],
      layers: [{ id: "headline", type: "text", pageId: "front", text: `Version ${n}`, x: 100 * n, y: 200 * n, width: 400 + 300 * n, height: 120 }],
      settings: {},
      assets: {},
    },
    ...overrides,
  };
}

function customization(templateVersion: number, overrides: Record<string, unknown> = {}) {
  return { id: "cust-1", user_id: OWNER, product_id: PRODUCT, template_id: TEMPLATE, template_version: templateVersion, ...overrides };
}

beforeEach(() => {
  state.versions = [version(1), version(2)];
  state.customizations = [customization(1)];
  state.draft = { id: TEMPLATE, enabled: true, version: 2, layers: [{ id: "headline", type: "text", text: "UNREVIEWED DRAFT" }] };
  state.failTables = new Set();
});

describe("opening a saved customization (the personalize page)", () => {
  it("a Version 1 design opens on Version 1 after Version 2 is published", async () => {
    const session = await resolveSessionTemplate({ productId: PRODUCT, customizationId: "cust-1", userId: OWNER });
    expect(session.kind).toBe("pinned");
    if (session.kind !== "pinned") return;
    expect(session.template.version).toBe(1);
    expect(session.template.layers[0]).toMatchObject({ text: "Version 1", x: 100, width: 700 });
  });

  it("a new session (no saved design) gets the latest published version", async () => {
    const session = await resolveSessionTemplate({ productId: PRODUCT, customizationId: "", userId: OWNER });
    expect(session.kind).toBe("latest");
    if (session.kind === "latest") expect(session.template.version).toBe(2);
  });

  it("Version 1 temporarily unavailable: BLOCKED, never Version 2", async () => {
    state.versions = [version(2)];
    const session = await resolveSessionTemplate({ productId: PRODUCT, customizationId: "cust-1", userId: OWNER });
    expect(session).toEqual({ kind: "unavailable", templateVersion: 1 });
  });

  it("the version store failing to answer: BLOCKED, never a fallback", async () => {
    state.failTables.add("customizer_template_versions");
    const session = await resolveSessionTemplate({ productId: PRODUCT, customizationId: "cust-1", userId: OWNER });
    expect(session.kind).toBe("unavailable");
  });

  it("the saved design itself cannot be read: BLOCKED, never a fallback", async () => {
    state.failTables.add("product_customizations");
    const session = await resolveSessionTemplate({ productId: PRODUCT, customizationId: "cust-1", userId: OWNER });
    expect(session.kind).toBe("unavailable");
  });

  it("uses the design's OWN template id, not whatever template the product has now", async () => {
    state.customizations = [customization(1, { template_id: "tpl-old" })];
    state.versions = [version(1, { template_id: "tpl-old", document: { ...version(1).document, layers: [{ id: "h", type: "text", pageId: "front", text: "Old template V1" }] } }), version(2)];
    const session = await resolveSessionTemplate({ productId: PRODUCT, customizationId: "cust-1", userId: OWNER });
    expect(session.kind).toBe("pinned");
    if (session.kind === "pinned") expect(session.template.layers[0].text).toBe("Old template V1");
  });

  it("a version published for ANOTHER product is never accepted as the pin", async () => {
    state.versions = [version(1, { product_id: "prod-other" }), version(2)];
    const session = await resolveSessionTemplate({ productId: PRODUCT, customizationId: "cust-1", userId: OWNER });
    expect(session.kind).toBe("unavailable");
  });

  it("someone else's (or a guessed) customization id pins nothing and reveals nothing", async () => {
    for (const userId of ["user-b", ""]) {
      const session = await resolveSessionTemplate({ productId: PRODUCT, customizationId: "cust-1", userId });
      expect(session.kind).toBe("latest");
    }
    expect((await resolveSessionTemplate({ productId: PRODUCT, customizationId: "local_abc", userId: OWNER })).kind).toBe("latest");
    // A design of another product never pins this product's page (that product has nothing published).
    expect((await resolveSessionTemplate({ productId: "prod-other", customizationId: "cust-1", userId: OWNER })).kind).toBe("none");
  });

  it("never serves the working draft", async () => {
    for (const customizationId of ["cust-1", ""]) {
      const session = await resolveSessionTemplate({ productId: PRODUCT, customizationId, userId: OWNER });
      expect(JSON.stringify(session)).not.toContain("UNREVIEWED DRAFT");
    }
  });
});

describe("getExactPublishedVersion", () => {
  it("returns exactly the requested version", async () => {
    const result = await getExactPublishedVersion(PRODUCT, TEMPLATE, 1);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.snapshot.version).toBe(1);
  });

  it("reports a missing version instead of substituting another", async () => {
    expect(await getExactPublishedVersion(PRODUCT, TEMPLATE, 99)).toEqual({ status: "unavailable", reason: "missing" });
    expect(await getExactPublishedVersion(PRODUCT, TEMPLATE, 0)).toEqual({ status: "unavailable", reason: "missing" });
  });

  it("reports an unreadable store as unavailable rather than throwing into a fallback", async () => {
    state.failTables.add("customizer_template_versions");
    expect(await getExactPublishedVersion(PRODUCT, TEMPLATE, 1)).toEqual({ status: "unavailable", reason: "unreadable" });
  });
});

describe("getPublicCustomizerTemplate (new sessions only)", () => {
  it("serves the latest published version", async () => {
    expect((await getPublicCustomizerTemplate(PRODUCT))!.snapshot.version).toBe(2);
  });
});

describe("save validation and rendering resolve the exact version too", () => {
  it("validates/renders a Version 1 design against Version 1", async () => {
    const trusted = await getTrustedTemplateForCustomization({ productId: PRODUCT, templateId: TEMPLATE, templateVersion: 1 });
    expect(trusted?.source).toBe("version");
    expect(trusted?.template.layers[0].text).toBe("Version 1");
  });

  it("refuses — never the live draft — when the exact version is gone but the template has published versions", async () => {
    state.versions = [version(2)];
    expect(await getTrustedTemplateForCustomization({ productId: PRODUCT, templateId: TEMPLATE, templateVersion: 1 })).toBeNull();
  });

  it("still serves a legacy template that was never versioned", async () => {
    state.versions = [];
    const trusted = await getTrustedTemplateForCustomization({ productId: PRODUCT, templateId: TEMPLATE, templateVersion: 1 });
    expect(trusted?.source).toBe("live");
  });
});

describe("the editor's own check before opening a saved design", () => {
  const template = { id: TEMPLATE, version: 2 };

  it("opens a design only on the template and version it was saved on", () => {
    expect(savedDesignMatchesTemplate({ templateId: TEMPLATE, templateVersion: 2 }, template)).toBe(true);
    expect(savedDesignMatchesTemplate({ templateId: TEMPLATE, templateVersion: 1 }, template)).toBe(false);
    expect(savedDesignMatchesTemplate({ templateId: "tpl-other", templateVersion: 2 }, template)).toBe(false);
    expect(savedDesignMatchesTemplate({ renderData: { templateVersion: 1 } }, template)).toBe(false);
  });

  it("tells the customer their design is safe", () => {
    expect(EXACT_VERSION_UNAVAILABLE_MESSAGE).toBe("We could not load the exact version of your saved design. Your design has not been changed. Please retry.");
  });
});
