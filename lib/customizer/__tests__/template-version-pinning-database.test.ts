/**
 * TEMPLATE VERSION INTEGRITY against the REAL schema (PGlite: supabase/schema.sql
 * + every migration + the real publish_customizer_template_version RPC).
 *
 *   publish Version 1 → a customer saves a design on it → publish Version 2
 *   with visibly different geometry → reopen the Version 1 design
 *
 * The design must open on Version 1. When Version 1 cannot be read, it must be
 * BLOCKED — never opened, validated or rendered on Version 2 or the draft.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ client: null as any }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => holder.client,
  createClient: async () => holder.client,
}));

import { createTestDatabase, type TestDatabase } from "@/lib/testing/pglite-supabase";
import { createCustomizerTestClient } from "@/lib/testing/pglite-customizer-client";
import { saveCustomizerTemplate } from "@/lib/customizer/store";
import { getTrustedTemplateForCustomization, publishTemplateVersion, resolveSessionTemplate } from "@/lib/customizer/versions";

const PRODUCT = "product-version-pin";
const CUSTOMER = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const DESIGN = "dddddddd-1111-4111-8111-dddddddddddd";

let t: TestDatabase;
let realClient: any;

function template(headline: { x: number; y: number; width: number; text: string }) {
  return {
    enabled: true,
    canvasWidthPx: 1500,
    canvasHeightPx: 2100,
    cardWidthIn: 5,
    cardHeightIn: 7,
    dpi: 300,
    pages: [{ id: "front", label: "Front", enabled: true, backgroundColor: "#ffffff" }],
    fields: [],
    layers: [{ id: "headline", name: "Headline", page: "front", type: "text", height: 140, zIndex: 1, textStyle: { fontFamily: "Inter", fontSize: 64, color: "#303839", textAlign: "center" }, ...headline }],
    safeArea: { top: 90, right: 90, bottom: 90, left: 90 },
    bleed: { top: 45, right: 45, bottom: 45, left: 45 },
    settings: {},
  };
}

async function publish(headline: Parameters<typeof template>[0]) {
  const saved = await saveCustomizerTemplate(PRODUCT, template(headline));
  const published = await publishTemplateVersion(PRODUCT, null, "test", "minor", saved.updatedAt);
  if (published.ok === false) throw new Error(`publish failed: ${published.errors.join("; ")}`);
  return { saved, published };
}

/** The real client, except that reads of `customizer_template_versions` fail (a controlled outage). */
function withVersionOutage(client: any) {
  return {
    ...client,
    from(table: string) {
      if (table !== "customizer_template_versions") return client.from(table);
      const failing: any = new Proxy({}, { get: (_target, key) => (key === "then" ? (resolve: any) => resolve({ data: null, error: { message: "simulated outage" } }) : () => failing) });
      return failing;
    },
  };
}

describe("a saved design stays on the exact version it was made on (real schema)", () => {
  let templateId = "";
  // The RPC numbers versions itself (max(existing, draft) + 1): read, never assume.
  let first = 0;
  let second = 0;
  const newestVersion = async () => Number((await t.db.query<any>(`select max(version) as v from public.customizer_template_versions where template_id = $1`, [templateId])).rows[0].v);

  beforeAll(async () => {
    t = await createTestDatabase();
    await t.db.query(`insert into public.products (id, slug, title, status, visibility, price, data) values ($1, 'pin-card', 'Pin Card', 'active', 'public', 10, '{}'::jsonb)`, [PRODUCT]);
    await t.db.query(`insert into auth.users (id, email) values ($1, 'a@example.test') on conflict do nothing`, [CUSTOMER]);
    await t.db.query(`insert into public.profiles (id, email, role) values ($1, 'a@example.test', 'customer') on conflict (id) do nothing`, [CUSTOMER]);
    realClient = createCustomizerTestClient(t).client;
    holder.client = realClient;

    const v1 = await publish({ x: 750, y: 300, width: 600, text: "Version one" });
    templateId = String(v1.saved.id);
    first = await newestVersion();
    // The customer starts and saves a design on the first published version.
    await t.db.query(
      `insert into public.product_customizations (id, user_id, product_id, template_id, template_version, status, values) values ($1, $2, $3, $4, $5, 'draft', '{"names":"Ayesha & Rahim"}'::jsonb)`,
      [DESIGN, CUSTOMER, PRODUCT, templateId, first],
    );
    // The next version moves and widens the headline.
    await publish({ x: 400, y: 1500, width: 1200, text: "Version two" });
    second = await newestVersion();
    expect(second).toBeGreaterThan(first);
  }, 120_000);

  afterAll(() => t?.close());

  it("Version 2 is what a new customer gets", async () => {
    const session = await resolveSessionTemplate({ productId: PRODUCT, customizationId: "", userId: CUSTOMER });
    expect(session.kind).toBe("latest");
    if (session.kind === "latest") {
      expect(session.template.version).toBe(second);
      expect(session.template.layers[0]).toMatchObject({ x: 400, y: 1500, width: 1200 });
    }
  });

  it("the Version 1 design opens on Version 1, with Version 1 geometry", async () => {
    const session = await resolveSessionTemplate({ productId: PRODUCT, customizationId: DESIGN, userId: CUSTOMER });
    expect(session.kind).toBe("pinned");
    if (session.kind === "pinned") {
      expect(session.template.version).toBe(first);
      expect(session.template.id).toBe(templateId);
      expect(session.template.layers[0]).toMatchObject({ x: 750, y: 300, width: 600 });
    }
    const trusted = await getTrustedTemplateForCustomization({ productId: PRODUCT, templateId, templateVersion: first });
    expect(trusted?.source).toBe("version");
    expect(trusted?.template.layers[0]).toMatchObject({ x: 750, width: 600 });
  });

  it("Version 1 unavailable: the design is blocked — not opened, validated or rendered on Version 2", async () => {
    holder.client = withVersionOutage(realClient);
    try {
      const session = await resolveSessionTemplate({ productId: PRODUCT, customizationId: DESIGN, userId: CUSTOMER });
      expect(session).toEqual({ kind: "unavailable", templateVersion: first });
    } finally {
      holder.client = realClient;
    }
    // The saved design itself is untouched.
    const { rows } = await t.db.query<any>(`select template_version, values from public.product_customizations where id = $1`, [DESIGN]);
    expect(rows[0]).toEqual({ template_version: first, values: { names: "Ayesha & Rahim" } });
  });

  it("the Version 1 snapshot is immutable and still holds Version 1", async () => {
    await expect(t.asService((db) => db.query(`update public.customizer_template_versions set document = '{}'::jsonb where template_id = $1 and version = $2`, [templateId, first]))).rejects.toThrow();
    const { rows } = await t.db.query<any>(`select document->'layers'->0->>'x' as x from public.customizer_template_versions where template_id = $1 and version = $2`, [templateId, first]);
    expect(Number(rows[0].x)).toBe(750);
  });
});
