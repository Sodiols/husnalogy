// POST /api/customizer/assets/sign — who may get which credential.
import { beforeEach, describe, expect, it, vi } from "vitest";

const PUBLISHED = "11111111-1111-4111-8111-111111111111";
const OFFERED = "22222222-2222-4222-8222-222222222222";
const PRIVATE = "33333333-3333-4333-8333-333333333333";

const state: { role: string | null } = { role: null };

vi.mock("@/lib/auth/roles", () => ({
  getCurrentActor: async () => (state.role ? { id: "u", email: "", name: "", role: state.role } : null),
  canAccessStudio: (actor: any) => actor?.role === "admin" || actor?.role === "designer",
}));

const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, bucket: "customizer-elements", path: `assets/${id}/original/o.jpg`, editor_path: `assets/${id}/editor/e.webp`, thumbnail_path: `assets/${id}/thumbnail/t.webp`, status: "ready", title: id, ...extra });
const ROWS = [row(PUBLISHED), row(OFFERED, { customer_available: true, active: true }), row(PRIVATE)];

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "customizer_template_versions") {
        const chain: any = { select: () => chain, eq: () => chain, order: () => chain, limit: () => chain, maybeSingle: async () => ({ data: { document: { layers: [{ id: "l", type: "image", assetId: PUBLISHED, editorPath: "x" }] } }, error: null }) };
        return chain;
      }
      const chain: any = { select: () => chain, in: (column: string, values: string[]) => (column === "id" ? ((chain.ids = values), chain) : Promise.resolve({ data: ROWS.filter((entry) => chain.ids.includes(entry.id)), error: null })) };
      return chain;
    },
    storage: { from: () => ({ createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed/${path}` }, error: null }) }) },
  }),
}));

const { POST } = await import("@/app/api/customizer/assets/sign/route");

const call = async (body: Record<string, unknown>) => {
  const response = await POST(new Request("http://localhost/api/customizer/assets/sign", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" }, body: JSON.stringify(body) }));
  return { status: response.status, data: await response.json() };
};

describe("asset signing authorization", () => {
  beforeEach(() => {
    state.role = null;
  });

  it("a customer gets editor URLs for assets the product's published design uses, or that are offered to customers", async () => {
    const { data } = await call({ productId: "prod-1", assets: [{ assetId: PUBLISHED, variant: "editor" }, { assetId: OFFERED, variant: "editor" }] });
    expect(data.assets.map((asset: any) => asset.url)).toEqual([`https://signed/assets/${PUBLISHED}/editor/e.webp`, `https://signed/assets/${OFFERED}/editor/e.webp`]);
  });

  it("a customer can never obtain an asset by guessing its id", async () => {
    const { data } = await call({ productId: "prod-1", assets: [{ assetId: PRIVATE, variant: "editor" }] });
    expect(data.assets).toEqual([]);
  });

  it("a customer asking for the proprietary original receives the editor variant instead", async () => {
    const { data } = await call({ productId: "prod-1", assets: [{ assetId: PUBLISHED, variant: "original" }] });
    expect(data.assets[0].url).toContain("/editor/e.webp");
    expect(data.assets[0].url).not.toContain("/original/");
  });

  it("the studio may sign any ready asset, original included", async () => {
    state.role = "designer";
    const { data } = await call({ assets: [{ assetId: PRIVATE, variant: "original" }, { assetId: PRIVATE, variant: "editor" }] });
    expect(data.assets.map((asset: any) => asset.url)).toEqual([`https://signed/assets/${PRIVATE}/original/o.jpg`, `https://signed/assets/${PRIVATE}/editor/e.webp`]);
    expect(data.assets.every((asset: any) => !asset.url.includes("thumbnail"))).toBe(true);
  });

  it("rejects requests without a valid asset id", async () => {
    expect((await call({ assets: [{ assetId: "../../etc", variant: "editor" }] })).status).toBe(400);
  });
});
