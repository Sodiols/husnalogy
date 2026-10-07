/**
 * AUTHORIZATION MATRIX at the database layer (Phases 20–21), against the REAL
 * schema + every migration (PGlite). Each attempt runs as the PostgREST role a
 * real request would use: `anon` (guest), `authenticated` with the caller's
 * auth.uid() (customer B, a designer, an admin), with customer A as the owner
 * of every private resource.
 *
 * Every unauthorized read returns no rows; every unauthorized write changes
 * nothing (or is refused outright).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/testing/pglite-supabase";
import { IDS, USERS, callCheckoutRpc, orderPayload, seedCheckoutFixtures } from "@/lib/testing/checkout-fixtures";

const A = USERS.customerA;
const B = USERS.customerB;
const DESIGNER = USERS.designer;
const ADMIN = USERS.admin;

let t: TestDatabase;
let orderId = "";
const ids: Record<string, string> = {};

type Actor = "anon" | "B" | "designer" | "admin" | "A";
const as = <T>(actor: Actor, work: (db: TestDatabase["db"]) => Promise<T>) => {
  if (actor === "anon") return t.asAnon(work);
  const user = { A, B, designer: DESIGNER, admin: ADMIN }[actor];
  return t.asUser(user.id, user.email, work);
};

/** Rows the actor can see, or null when the database refuses the read outright. */
async function visible(actor: Actor, sql: string, params: unknown[] = []): Promise<number | null> {
  try {
    return (await as(actor, (db) => db.query(sql, params))).rows.length;
  } catch {
    return null;
  }
}

/** Rows a write affected (0 when RLS hides the row), or "refused" when the database errors. */
async function wrote(actor: Actor, sql: string, params: unknown[] = []): Promise<number | "refused"> {
  try {
    const result = await as(actor, (db) => db.query(sql, params));
    return (result as any).affectedRows ?? result.rows.length;
  } catch {
    return "refused";
  }
}

beforeAll(async () => {
  t = await createTestDatabase();
  await seedCheckoutFixtures(t);
  const payload = await orderPayload(t);
  const placed = await callCheckoutRpc(t, payload);
  orderId = String(placed.order_id || payload.order.id);
  const one = async (sql: string, params: unknown[]) => String((await t.db.query<any>(sql, params)).rows[0].id);
  await t.db.query("update public.profiles set phone = '+8801711000001', full_name = 'Ayesha Rahman' where id = $1", [A.id]);
  ids.address = await one("insert into public.customer_addresses (user_id, full_name, phone, address_line1, city, is_default) values ($1, 'Ayesha', '+8801711000001', 'House 7', 'Dhaka', true) returning id", [A.id]);
  ids.wishlist = await one("insert into public.wishlist_items (user_id, product_id, product_title) values ($1, 'product-active', 'Pearl') returning id", [A.id]);
  ids.library = await one(
    "insert into public.customer_asset_library (user_id, bucket, path, editor_path, thumbnail_path, file_name, mime_type, size_bytes, width, height, status) values ($1, 'customer-uploads', $2, $3, $4, 'me.jpg', 'image/jpeg', 100, 10, 10, 'ready') returning id",
    [A.id, `${A.id}/c/original.jpg`, `${A.id}/c/editor.webp`, `${A.id}/c/thumb.webp`],
  );
  ids.upload = await one("insert into public.customer_uploads (user_id, bucket, path, file_name, mime_type, size_bytes) values ($1, 'customer-uploads', $2, 'me.jpg', 'image/jpeg', 100) returning id", [A.id, `${A.id}/c/original.jpg`]);
  ids.job = await one("insert into public.customizer_render_jobs (customization_id, job_type, status, input_hash) values ($1, 'preview', 'queued', 'hash-a') returning id", [IDS.customizationA2]);
  ids.review = await one("insert into public.reviews (product_id, customer_id, rating, title, body, status) values ('product-active', $1, 5, 'Lovely', 'Private draft review', 'pending') returning id", [A.id]);
  await t.db.query("insert into storage.objects (bucket_id, name, owner) values ('customer-uploads', $1, $2), ('customer-avatars', $3, $2)", [`${A.id}/c/original.jpg`, A.id, `${A.id}/me.webp`]);
}, 180_000);
afterAll(() => t?.close());

const PRIVATE_READS: Array<[string, string, () => unknown[]]> = [
  ["profile (phone, name)", "select * from public.profiles where id = $1", () => [A.id]],
  ["saved address", "select * from public.customer_addresses where id = $1", () => [ids.address]],
  ["cart", "select * from public.cart_items where user_id = $1", () => [A.id]],
  ["wishlist", "select * from public.wishlist_items where id = $1", () => [ids.wishlist]],
  ["customization", "select * from public.product_customizations where id = $1", () => [IDS.customizationA2]],
  ["order", "select * from public.orders where id = $1", () => [orderId]],
  ["order items", "select * from public.order_items where order_id = $1", () => [orderId]],
  ["design snapshot", "select * from public.order_design_snapshots where order_id = $1", () => [orderId]],
  ["photo library", "select * from public.customer_asset_library where id = $1", () => [ids.library]],
  ["upload record", "select * from public.customer_uploads where id = $1", () => [ids.upload]],
  ["render job", "select * from public.customizer_render_jobs where id = $1", () => [ids.job]],
  ["unpublished review", "select * from public.reviews where id = $1", () => [ids.review]],
  ["private upload object", "select * from storage.objects where bucket_id = 'customer-uploads' and name like $1", () => [`${A.id}/%`]],
  ["avatar object", "select * from storage.objects where bucket_id = 'customer-avatars'", () => []],
];

describe("customer A's private data", () => {
  it("is visible to A", async () => {
    for (const [label, sql, params] of PRIVATE_READS) {
      if (label === "design snapshot" || label === "avatar object") continue; // admin/server only
      expect(await visible("A", sql, params()), label).toBeGreaterThan(0);
    }
  });

  for (const actor of ["anon", "B", "designer"] as const) {
    it(`is invisible to ${actor === "anon" ? "a guest" : actor === "B" ? "customer B" : "a designer"}`, async () => {
      for (const [label, sql, params] of PRIVATE_READS) {
        expect((await visible(actor, sql, params())) ?? 0, `${actor} reading A's ${label}`).toBe(0);
      }
    });
  }

  it("administrators see orders and designs for fulfilment, but NOT the address book or avatars", async () => {
    expect(await visible("admin", "select * from public.orders where id = $1", [orderId])).toBe(1);
    expect(await visible("admin", "select * from public.product_customizations where id = $1", [IDS.customizationA2])).toBe(1);
    expect(await visible("admin", "select * from public.customer_addresses where id = $1", [ids.address])).toBe(0);
    expect(await visible("admin", "select * from storage.objects where bucket_id = 'customer-avatars'")).toBe(0);
  });
});

describe("nobody but the owner changes customer A's data", () => {
  const WRITES: Array<[string, string, () => unknown[]]> = [
    ["profile phone", "update public.profiles set phone = '000000' where id = $1", () => [A.id]],
    ["address", "update public.customer_addresses set city = 'X' where id = $1", () => [ids.address]],
    ["address delete", "delete from public.customer_addresses where id = $1", () => [ids.address]],
    ["cart quantity", "update public.cart_items set quantity = 99 where user_id = $1", () => [A.id]],
    ["cart delete", "delete from public.cart_items where user_id = $1", () => [A.id]],
    ["wishlist delete", "delete from public.wishlist_items where id = $1", () => [ids.wishlist]],
    ["design values", "update public.product_customizations set values = '{}'::jsonb where id = $1", () => [IDS.customizationA2]],
    ["design delete", "delete from public.product_customizations where id = $1", () => [IDS.customizationA2]],
    ["order total", "update public.orders set total = 1 where id = $1", () => [orderId]],
    ["order status", "update public.orders set status = 'cancelled' where id = $1", () => [orderId]],
    ["render job", "update public.customizer_render_jobs set status = 'cancelled' where id = $1", () => [ids.job]],
    ["photo library", "update public.customer_asset_library set path = 'x' where id = $1", () => [ids.library]],
  ];
  for (const actor of ["anon", "B", "designer"] as const) {
    it(`${actor} changes nothing`, async () => {
      for (const [label, sql, params] of WRITES) {
        const result = await wrote(actor, sql, params());
        expect(result === 0 || result === "refused", `${actor} → ${label}: ${result}`).toBe(true);
      }
      const order = (await t.db.query<any>("select total, status from public.orders where id = $1", [orderId])).rows[0];
      expect(order.status).toBe("pending");
      expect(Number(order.total)).toBeGreaterThan(1);
      expect((await t.db.query<any>("select phone from public.profiles where id = $1", [A.id])).rows[0].phone).toBe("+8801711000001");
      expect((await t.db.query<any>("select count(*)::int as n from public.cart_items where user_id = $1", [A.id])).rows[0].n).toBeGreaterThan(0);
    });
  }

  it("even A cannot rewrite a placed order's money or move another customer's rows to themselves", async () => {
    expect(await wrote("A", "update public.orders set total = 1 where id = $1", [orderId])).not.toBe(1);
    expect([0, "refused"]).toContain(await wrote("A", "update public.cart_items set user_id = $1 where user_id = $2", [A.id, B.id]));
  });
});

describe("privilege escalation", () => {
  it("no customer or designer can change a role — their own or anyone's", async () => {
    for (const actor of ["A", "B", "designer"] as const) {
      const target = { A, B, designer: DESIGNER }[actor];
      const result = await wrote(actor, "update public.profiles set role = 'admin' where id = $1", [target.id]);
      expect(result === 0 || result === "refused", `${actor}: ${result}`).toBe(true);
    }
    const roles = (await t.db.query<any>("select id, role from public.profiles where id = any($1::uuid[])", [[A.id, B.id, DESIGNER.id]])).rows;
    expect(Object.fromEntries(roles.map((row) => [row.id, row.role]))).toEqual({ [A.id]: "customer", [B.id]: "customer", [DESIGNER.id]: "designer" });
  });

  it("a new profile cannot be created with a privileged role", async () => {
    expect(await wrote("anon", "insert into public.profiles (id, email, role) values (gen_random_uuid(), 'x@y.z', 'admin')")).toBe("refused");
  });

  it("customers cannot create orders directly (only the checkout transaction can)", async () => {
    expect(await wrote("A", "insert into public.orders (id, customer_id, total, status) values ('forged', $1, 1, 'pending')", [A.id])).toBe("refused");
    expect(await visible("A", "select 1 where has_function_privilege('authenticated', 'public.create_checkout_order(jsonb,jsonb,jsonb,jsonb)', 'execute')")).toBe(0);
  });

  it("customers and designers cannot touch catalogue or settings", async () => {
    for (const actor of ["anon", "A", "designer"] as const) {
      expect((await visible(actor, "select * from public.site_settings")) ?? 0).toBe(0);
      const priced = await wrote(actor, "update public.products set price = 1 where id = 'product-active'");
      expect(priced === 0 || priced === "refused", `${actor} repricing`).toBe(true);
    }
  });
});

describe("public surface (Phase 21 hardening)", () => {
  it("unreviewed customizer drafts are not readable with the public key — published versions are", async () => {
    for (const actor of ["anon", "A"] as const) {
      expect((await visible(actor, "select * from public.product_customizer_templates where product_id = 'product-active'")) ?? 0, actor).toBe(0);
      expect(await visible(actor, "select * from public.customizer_template_versions where product_id = 'product-active'"), actor).toBe(1);
    }
    // Versions of a draft product stay hidden.
    expect(await visible("anon", "select * from public.customizer_template_versions where product_id = 'product-draft'")).toBe(0);
  });

  it("contact messages and newsletter sign-ups cannot be written around the API's validation and rate limits", async () => {
    expect(await wrote("anon", "insert into public.contact_messages (name, email, message) values ('spam', 'a@b.c', 'spam')")).toBe("refused");
    expect(await wrote("A", "insert into public.contact_messages (name, email, message) values ('spam', 'a@b.c', 'spam')")).toBe("refused");
    expect(await wrote("anon", "insert into public.newsletter_subscribers (email) values ('spam@b.c')")).toBe("refused");
    // The server (service role) still records them.
    await t.asService((db) => db.query("insert into public.contact_messages (name, email, message) values ('Real', 'real@b.c', 'Hello')"));
    expect((await t.db.query<any>("select count(*)::int as n from public.contact_messages where email = 'real@b.c'")).rows[0].n).toBe(1);
  });
});
