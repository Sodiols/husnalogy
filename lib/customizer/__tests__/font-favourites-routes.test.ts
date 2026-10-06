/**
 * Favourite Fonts routes: public read, administrator-only write.
 *
 * Runs the real route handlers and the real store module over an in-memory
 * `customizer_font_favourites` table.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  actor: null as null | { id: string; role: string },
  rows: new Map<string, { family: string }>(),
  missingTable: false,
};

function table() {
  const missing = () => ({ data: null, error: { code: "42P01", message: "relation does not exist" } });
  return {
    select: () => ({
      order: async () => (state.missingTable ? missing() : { data: [...state.rows.values()].sort((a, b) => a.family.localeCompare(b.family)), error: null }),
    }),
    upsert: async (row: { family: string }) => {
      if (state.missingTable) return missing();
      if (!state.rows.has(row.family)) state.rows.set(row.family, { family: row.family });
      return { data: null, error: null };
    },
    delete: () => ({
      eq: async (_column: string, family: string) => {
        if (state.missingTable) return missing();
        state.rows.delete(family);
        return { data: null, error: null };
      },
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ from: () => table() }) }));
vi.mock("@/lib/auth/roles", async () => {
  const actual = await vi.importActual<any>("@/lib/auth/roles");
  return {
    ...actual,
    getCurrentActor: async () => state.actor,
    requireCapability: async (capability: (actor: any) => boolean, message = "Forbidden") => {
      if (!state.actor) return { ok: false, response: Response.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
      if (!capability(state.actor)) return { ok: false, response: Response.json({ ok: false, error: message }, { status: 403 }) };
      return { ok: true, actor: state.actor };
    },
  };
});
vi.mock("@/lib/security/same-origin", () => ({ rejectCrossSiteRequest: () => null }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimit: () => null }));
vi.mock("@/lib/customizer/v2/server/google-fonts-catalog", () => ({
  getFontCatalogSafe: async () => [
    { family: "Great Vibes", category: "handwriting" },
    { family: "Inter", category: "sans-serif" },
  ],
}));

const { GET } = await import("@/app/api/customizer/fonts/favourites/route");
const { PUT } = await import("@/app/api/admin/customizer/fonts/favourites/route");
const { clearFontFavouritesCache } = await import("@/lib/customizer/v2/server/font-favourites");

const put = (body: unknown) =>
  PUT(new Request("http://localhost/api/admin/customizer/fonts/favourites", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));

describe("Favourite Fonts routes", () => {
  beforeEach(() => {
    state.actor = { id: "admin-1", role: "admin" };
    state.rows.clear();
    state.missingTable = false;
    clearFontFavouritesCache();
  });

  it("an administrator marks and unmarks a favourite, stored under the catalog's spelling", async () => {
    const marked = await put({ family: "great vibes", favourite: true });
    expect(marked.status).toBe(200);
    expect((await marked.json()).favourites).toEqual(["Great Vibes"]);
    const unmarked = await put({ family: "Great Vibes", favourite: false });
    expect((await unmarked.json()).favourites).toEqual([]);
  });

  it("marking twice keeps one favourite", async () => {
    await put({ family: "Inter", favourite: true });
    const again = await put({ family: "Inter", favourite: true });
    expect((await again.json()).favourites).toEqual(["Inter"]);
  });

  it("refuses designers and customers", async () => {
    state.actor = { id: "designer-1", role: "designer" };
    expect((await put({ family: "Inter", favourite: true })).status).toBe(403);
    state.actor = { id: "customer-1", role: "customer" };
    expect((await put({ family: "Inter", favourite: true })).status).toBe(403);
    expect(state.rows.size).toBe(0);
  });

  it("refuses a family that is not in the trusted catalog, and a malformed body", async () => {
    expect((await put({ family: "Totally Made Up", favourite: true })).status).toBe(404);
    expect((await put({ family: "Inter" })).status).toBe(400);
    expect((await put({ family: "", favourite: true })).status).toBe(400);
  });

  it("the public read returns the favourites and whether the viewer may change them", async () => {
    await put({ family: "Inter", favourite: true });
    const asAdmin = await (await GET(new Request("http://localhost/api/customizer/fonts/favourites"))).json();
    expect(asAdmin).toEqual({ ok: true, favourites: ["Inter"], canManage: true });
    state.actor = null;
    const asGuest = await (await GET(new Request("http://localhost/api/customizer/fonts/favourites"))).json();
    expect(asGuest).toEqual({ ok: true, favourites: ["Inter"], canManage: false });
  });

  it("before the migration is applied, reads degrade to no favourites and writes explain why", async () => {
    state.missingTable = true;
    const read = await (await GET(new Request("http://localhost/api/customizer/fonts/favourites"))).json();
    expect(read.favourites).toEqual([]);
    const write = await put({ family: "Inter", favourite: true });
    expect(write.status).toBe(503);
    expect((await write.json()).error).toMatch(/migration/);
  });
});
