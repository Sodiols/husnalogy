/**
 * PATCH /api/customizations/[id] — save ordering and the compact unload body.
 *
 * Runs the real route handler. Only the edges are replaced: the auth/session
 * client, a small in-memory `product_customizations` table with PostgREST
 * filter semantics, and the template validator (its own suite covers it; here
 * it passes the body through so the persistence behaviour is what is tested).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const DESIGN_ID = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, any>;
const table = new Map<string, Row>();
let clock = 0;
/** Lets a test run code between the route's read and its write. */
let beforeUpdate: (() => void) | null = null;

function stamp() {
  clock += 1;
  return `2026-10-05T10:00:00.${String(clock).padStart(6, "0")}+00:00`;
}

function query(tableName: string) {
  const filters: Array<(row: Row) => boolean> = [];
  let patch: Row | null = null;
  const builder: any = {
    select: () => builder,
    update: (values: Row) => {
      patch = values;
      return builder;
    },
    eq: (column: string, value: unknown) => {
      filters.push((row) => String(row[column]) === String(value));
      return builder;
    },
    neq: (column: string, value: unknown) => {
      filters.push((row) => row[column] !== value);
      return builder;
    },
    is: (column: string, value: unknown) => {
      filters.push((row) => (value === null ? row[column] === null || row[column] === undefined : row[column] === value));
      return builder;
    },
    maybeSingle: async () => {
      if (tableName !== "product_customizations") return { data: null, error: null };
      const match = [...table.values()].find((row) => filters.every((filter) => filter(row)));
      if (!patch) return { data: match ? structuredClone(match) : null, error: null };
      if (beforeUpdate) {
        const hook = beforeUpdate;
        beforeUpdate = null;
        hook();
        // The hook may have changed the row: re-evaluate the WHERE clause.
        const still = [...table.values()].find((row) => filters.every((filter) => filter(row)));
        if (!still) return { data: null, error: null };
      }
      const current = [...table.values()].find((row) => filters.every((filter) => filter(row)));
      if (!current) return { data: null, error: null };
      // The database trigger owns updated_at.
      const next = { ...current, ...patch, updated_at: stamp() };
      table.set(current.id, next);
      return { data: structuredClone(next), error: null };
    },
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) } }),
  createServiceRoleClient: () => ({ from: (name: string) => query(name) }),
}));
vi.mock("@/lib/customizer/save-validation", () => ({
  validateCustomizationSave: async (_userId: string, body: Record<string, any>) => ({ ok: true, body: { ...body }, warnings: [] }),
}));
vi.mock("@/lib/customizer/server/private-assets", () => ({ resolvePrivateAssetsForDelivery: async (value: unknown) => value }));
vi.mock("@/lib/customizer/audit", () => ({ writeCustomizerAudit: async () => undefined }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimit: () => null }));
vi.mock("@/lib/security/same-origin", () => ({ rejectCrossSiteRequest: () => null }));

const { PATCH } = await import("@/app/api/customizations/[id]/route");

function seed(renderData: Row = {}) {
  table.clear();
  table.set(DESIGN_ID, {
    id: DESIGN_ID,
    user_id: USER_ID,
    product_id: "product-1",
    template_id: "template-1",
    template_version: 3,
    status: "draft",
    order_id: null,
    cart_item_id: null,
    values: { title: "original" },
    render_data: { editorState: { userLayers: [] }, layers: [{ id: "summary" }], activePage: "front", ...renderData },
    updated_at: stamp(),
  });
}

async function patch(body: Record<string, any>) {
  const response = await PATCH(
    new Request(`http://localhost/api/customizations/${DESIGN_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: DESIGN_ID }) },
  );
  return { status: response.status, data: await response.json() };
}

const fullBody = (revision: number, title: string) => ({
  values: { title },
  renderData: { editorState: { userLayers: [{ id: "u1", text: title }] }, layers: [{ id: "summary" }], activePage: "front" },
  clientRevision: revision,
});

describe("PATCH /api/customizations/[id] — ordered design writes", () => {
  beforeEach(() => {
    beforeUpdate = null;
    seed({ clientRevision: 4 });
  });

  it("stores the revision with the design", async () => {
    const { status } = await patch(fullBody(5, "five"));
    expect(status).toBe(200);
    const row = table.get(DESIGN_ID)!;
    expect(row.render_data.clientRevision).toBe(5);
    expect(row.values).toEqual({ title: "five" });
  });

  it("refuses an older body arriving after a newer one, leaving the newer design in place", async () => {
    expect((await patch(fullBody(9, "nine"))).status).toBe(200);
    const stale = await patch(fullBody(6, "six"));
    expect(stale.status).toBe(409);
    expect(stale.data).toMatchObject({ ok: false, code: "stale-revision", serverRevision: 9 });
    expect(table.get(DESIGN_ID)!.values).toEqual({ title: "nine" });
  });

  it("refuses a body that a newer write overtook between the revision check and the update", async () => {
    beforeUpdate = () => {
      const row = table.get(DESIGN_ID)!;
      table.set(DESIGN_ID, { ...row, values: { title: "racer" }, render_data: { ...row.render_data, clientRevision: 12 }, updated_at: stamp() });
    };
    const result = await patch(fullBody(7, "seven"));
    expect(result.status).toBe(409);
    expect(result.data.serverRevision).toBe(12);
    expect(table.get(DESIGN_ID)!.values).toEqual({ title: "racer" });
  });

  it("merges the compact unload body into the stored render data instead of wiping it", async () => {
    const result = await patch({
      values: { title: "unload" },
      editorState: { userLayers: [{ id: "u2", text: "typed before refresh" }] },
      selectedOptions: { quantity: 30 },
      activePage: "back",
      clientRevision: 8,
    });
    expect(result.status).toBe(200);
    const stored = table.get(DESIGN_ID)!.render_data;
    expect(stored.editorState).toEqual({ userLayers: [{ id: "u2", text: "typed before refresh" }] });
    expect(stored.activePage).toBe("back");
    expect(stored.clientRevision).toBe(8);
    // Everything else the full save stored is kept.
    expect(stored.layers).toEqual([{ id: "summary" }]);
    // An unload write never moves the design in or out of the cart.
    expect(table.get(DESIGN_ID)!.status).toBe("draft");
  });

  it("keeps bookkeeping writes (cart link) working without a revision", async () => {
    const result = await patch({ status: "in_cart" });
    expect(result.status).toBe(200);
    const row = table.get(DESIGN_ID)!;
    expect(row.status).toBe("in_cart");
    expect(row.render_data.clientRevision).toBe(4);
  });

  it("accepts the first revision on a design saved before revisions existed", async () => {
    seed({});
    expect((await patch(fullBody(1, "first"))).status).toBe(200);
    expect(table.get(DESIGN_ID)!.render_data.clientRevision).toBe(1);
  });

  it("still locks ordered designs", async () => {
    table.set(DESIGN_ID, { ...table.get(DESIGN_ID)!, status: "ordered", order_id: "order-1" });
    const result = await patch(fullBody(50, "late"));
    expect(result.status).toBe(409);
    expect(result.data.code).toBeUndefined();
  });

  it("rejects a malformed revision", async () => {
    const result = await patch({ ...fullBody(5, "x"), clientRevision: -3 });
    expect(result.status).toBe(400);
  });
});
