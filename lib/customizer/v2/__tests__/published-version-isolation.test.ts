// PUBLISHED VERSION ISOLATION — the launch blocker this pass exists to close.
//
// Husnalogy keeps two customizer documents per product:
//
//   product_customizer_templates      the WORKING DRAFT the design builder
//                                     autosaves into on every keystroke
//   customizer_template_versions      IMMUTABLE published snapshots
//
// The save validator (`getTrustedTemplateForCustomization`) and the print
// renderer both resolve the snapshot. The public /personalize page did NOT — it
// handed the customer `product.customizerTemplate`, the draft, straight from
// the catalog join.
//
// That single mismatch caused two separate failures at once:
//   1. Unreviewed work went live the instant a designer typed.
//   2. The customer designed against one document and was SOLD another: their
//      overrides were validated and printed against the published snapshot.
//
// These tests pin the rule that closes it: a public session runs on a published
// snapshot, on the pinned one when the customer already started, and on nothing
// at all when nothing has been published.

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const rows: { versions: any[]; draft: any } = { versions: [], draft: null };

  /** A minimal stand-in for the PostgREST builder chain the module uses. */
  function makeQuery(table: string) {
    const state: Record<string, any> = { filters: {} };
    const builder: any = {
      select: () => builder,
      eq: (column: string, value: any) => {
        state.filters[column] = value;
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => {
        if (table !== "customizer_template_versions") return { data: null, error: null };
        const matches = rows.versions
          .filter((row) => Object.entries(state.filters).every(([key, value]) => row[key] === value))
          .sort((a, b) => Number(b.version) - Number(a.version));
        return { data: matches[0] || null, error: null };
      },
    };
    return builder;
  }

  return {
    rows,
    createServiceRoleClient: vi.fn(() => ({ from: (table: string) => makeQuery(table) })),
    getCustomizerTemplateByProductId: vi.fn(async () => rows.draft),
    hydrateAdminAssetUrls: vi.fn(async (document: any) => document),
  };
});

const rows = mocks.rows;

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: mocks.createServiceRoleClient,
}));
vi.mock("@/lib/customizer/store", () => ({
  getCustomizerTemplateByProductId: mocks.getCustomizerTemplateByProductId,
}));
vi.mock("@/lib/customizer/server/admin-assets", () => ({
  hydrateAdminAssetUrls: mocks.hydrateAdminAssetUrls,
  stripAdminAssetUrls: (value: any) => value,
}));

import {
  getLatestPublishedVersion,
  getPublicCustomizerTemplate,
  templateFromVersionSnapshot,
} from "@/lib/customizer/versions";

function versionRow(version: number, title: string) {
  return {
    id: `v${version}`,
    template_id: "tpl-1",
    product_id: "prod-1",
    version,
    major_version: 2,
    minor_revision: version,
    schema_version: 4,
    engine_version: "husnalogy-2.2.0",
    published_by: "admin-1",
    notes: "",
    created_at: `2026-01-0${version}T00:00:00Z`,
    font_dependencies: [],
    document: {
      canvas: { widthPx: 1500, heightPx: 2100, widthIn: 5, heightIn: 7, dpi: 300, orientation: "portrait" },
      pages: [{ id: "front", name: "Front", enabled: true, safeArea: {}, bleed: {} }],
      fields: [],
      layers: [{ id: "t1", type: "text", pageId: "front", text: title }],
      settings: {},
      assets: {},
    },
  };
}

beforeEach(() => {
  rows.versions = [];
  rows.draft = { id: "tpl-1", enabled: true, version: 2, layers: [{ id: "t1", type: "text", text: "DRAFT — not reviewed" }] };
  vi.clearAllMocks();
});

describe("a public customizer session runs on a published snapshot", () => {
  it("serves the latest published version, never the working draft", async () => {
    rows.versions = [versionRow(1, "Published V1"), versionRow(2, "Published V2")];

    const result = await getPublicCustomizerTemplate("prod-1");
    expect(result).not.toBeNull();
    expect(result!.snapshot.version).toBe(2);
    expect(result!.template.layers[0].text).toBe("Published V2");
    // The draft's text must never appear in a public template.
    expect(JSON.stringify(result!.template)).not.toContain("DRAFT — not reviewed");
  });

  it("returns nothing when the product has never been published", async () => {
    // An enabled draft is NOT a publishable state. The page redirects on null,
    // which is what stops unreviewed work from reaching a customer at all.
    rows.versions = [];
    expect(await getPublicCustomizerTemplate("prod-1")).toBeNull();
  });

  it("keeps an in-progress customization pinned to the version it started on", async () => {
    rows.versions = [versionRow(1, "Published V1"), versionRow(2, "Published V2")];

    const pinned = await getPublicCustomizerTemplate("prod-1", 1);
    expect(pinned!.snapshot.version).toBe(1);
    expect(pinned!.template.layers[0].text).toBe("Published V1");
  });

  it("falls back to the latest version when the pin no longer exists", async () => {
    rows.versions = [versionRow(2, "Published V2")];
    const result = await getPublicCustomizerTemplate("prod-1", 99);
    expect(result!.snapshot.version).toBe(2);
  });

  it("carries the snapshot version the save validator will resolve", async () => {
    // The number the client sends back as `templateVersion` has to address the
    // same immutable row, or the customer is validated against a document they
    // never saw.
    rows.versions = [versionRow(1, "Published V1"), versionRow(2, "Published V2")];
    const result = await getPublicCustomizerTemplate("prod-1");
    expect(result!.template.version).toBe(result!.snapshot.version);
  });
});

describe("the full publish / edit / republish sequence", () => {
  it("V1 customers keep V1 while the draft changes and after V2 ships", async () => {
    // Admin publishes V1.
    rows.versions = [versionRow(1, "Design A")];
    const customerA = await getPublicCustomizerTemplate("prod-1");
    expect(customerA!.snapshot.version).toBe(1);

    // Designer edits the working draft into Design B. Nothing is published.
    rows.draft = { id: "tpl-1", enabled: true, version: 1, layers: [{ id: "t1", type: "text", text: "Design B" }] };

    // Customer B starts now and must STILL receive V1.
    const customerB = await getPublicCustomizerTemplate("prod-1");
    expect(customerB!.snapshot.version).toBe(1);
    expect(customerB!.template.layers[0].text).toBe("Design A");

    // Admin publishes V2.
    rows.versions = [versionRow(1, "Design A"), versionRow(2, "Design B")];

    // Customer C receives V2...
    const customerC = await getPublicCustomizerTemplate("prod-1");
    expect(customerC!.snapshot.version).toBe(2);
    expect(customerC!.template.layers[0].text).toBe("Design B");

    // ...while Customer A, pinned to V1, still resumes on V1.
    const customerAResumed = await getPublicCustomizerTemplate("prod-1", 1);
    expect(customerAResumed!.snapshot.version).toBe(1);
    expect(customerAResumed!.template.layers[0].text).toBe("Design A");
  });

  it("getLatestPublishedVersion ignores other products' versions", async () => {
    rows.versions = [versionRow(1, "Mine"), { ...versionRow(9, "Theirs"), product_id: "prod-2" }];
    const latest = await getLatestPublishedVersion("prod-1");
    expect(latest!.version).toBe(1);
  });
});

describe("templateFromVersionSnapshot", () => {
  it("produces the flat shape the validators and renderers consume", () => {
    const template = templateFromVersionSnapshot({
      id: "v1",
      templateId: "tpl-1",
      productId: "prod-1",
      version: 3,
      majorVersion: 2,
      minorRevision: 1,
      displayVersion: "2.001",
      schemaVersion: 4,
      engineVersion: "husnalogy-2.2.0",
      document: versionRow(3, "Hello").document,
      fontDependencies: [],
      publishedBy: null,
      notes: "",
      createdAt: "",
    });
    expect(template.enabled).toBe(true);
    expect(template.version).toBe(3);
    expect(template.publicVersion).toBe("2.001");
    expect(template.canvasWidthPx).toBe(1500);
    // Layers expose `page` as well as `pageId` for the V1 consumers.
    expect(template.layers[0].page).toBe("front");
  });

  it("refuses an empty or missing snapshot rather than inventing a template", () => {
    expect(templateFromVersionSnapshot(null)).toBeNull();
    expect(templateFromVersionSnapshot({ document: {} } as any)).toBeNull();
  });
});

describe("the public page wiring", () => {
  const page = readFileSync(
    path.join(process.cwd(), "app/products/[slug]/personalize/page.tsx"),
    "utf8",
  );

  it("resolves a published version instead of the product's draft template", () => {
    expect(page).toContain("getPublicCustomizerTemplate");
    // The old leak: handing `product.customizerTemplate` to the client.
    expect(page).not.toContain("product?.customizerTemplate?.enabled");
    expect(page).not.toContain("return product.customizerTemplate");
  });

  it("strips the draft template off the product before it reaches the client", () => {
    expect(page).toContain("customizerTemplate: _draft");
    expect(page).toContain("<PersonalizeClient product={publicProduct}");
  });

  it("redirects when nothing has been published", () => {
    expect(page).toContain("if (!baseTemplate) redirect(");
  });

  it("only pins a customization that belongs to the signed-in customer", () => {
    expect(page).toContain("data.user_id !== userId");
    expect(page).toContain("data.product_id !== productId");
  });
});
