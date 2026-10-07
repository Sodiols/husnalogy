/**
 * customer_addresses — RLS and integrity against the REAL schema + every
 * migration (PGlite). Each request runs as the PostgREST role it would in
 * production: `authenticated` with the caller's auth.uid(), or `anon`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/testing/pglite-supabase";
import { USERS } from "@/lib/testing/checkout-fixtures";

const A = USERS.customerA;
const B = USERS.customerB;
const ADMIN = USERS.admin;
const DESIGNER = USERS.designer;

let t: TestDatabase;

async function refused(work: Promise<unknown>, pattern: RegExp = /./) {
  let caught: unknown = null;
  try {
    await work;
  } catch (error) {
    caught = error;
  }
  expect(caught, "expected the database to refuse").toBeTruthy();
  expect(String((caught as Error)?.message || caught)).toMatch(pattern);
}

const insertAs = (user: { id: string; email: string }, values: Record<string, unknown>) =>
  t.asUser(user.id, user.email, (db) =>
    db.query<any>(
      `insert into public.customer_addresses (user_id, full_name, phone, address_line1, city, is_default) values ($1, $2, $3, $4, $5, $6) returning *`,
      [values.user_id ?? user.id, values.full_name ?? "Ayesha Rahman", values.phone ?? "+8801711000000", values.address_line1 ?? "House 12, Road 5", values.city ?? "Dhaka", values.is_default ?? false],
    ),
  );

describe("customer_addresses (real schema)", () => {
  let aAddress = "";

  beforeAll(async () => {
    t = await createTestDatabase();
    for (const user of Object.values(USERS)) {
      await t.db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [user.id, user.email]);
    }
    await t.db.query("update public.profiles set role = 'admin' where id = $1", [ADMIN.id]);
    await t.db.query("update public.profiles set role = 'designer' where id = $1", [DESIGNER.id]);
    aAddress = (await insertAs(A, { is_default: true })).rows[0].id;
  }, 120_000);
  afterAll(() => t?.close());

  it("the owner reads, updates and sees their own address", async () => {
    const rows = await t.asUser(A.id, A.email, (db) => db.query<any>("select * from public.customer_addresses"));
    expect(rows.rows.map((row) => row.id)).toEqual([aAddress]);
    const updated = await t.asUser(A.id, A.email, (db) => db.query<any>("update public.customer_addresses set city = 'Chattogram' where id = $1 returning city", [aAddress]));
    expect(updated.rows).toEqual([{ city: "Chattogram" }]);
  });

  it("customer B can neither read, change nor delete customer A's address", async () => {
    const read = await t.asUser(B.id, B.email, (db) => db.query<any>("select * from public.customer_addresses where id = $1", [aAddress]));
    expect(read.rows).toEqual([]);
    const update = await t.asUser(B.id, B.email, (db) => db.query<any>("update public.customer_addresses set phone = '00000' where id = $1 returning id", [aAddress]));
    expect(update.rows).toEqual([]);
    const removal = await t.asUser(B.id, B.email, (db) => db.query<any>("delete from public.customer_addresses where id = $1 returning id", [aAddress]));
    expect(removal.rows).toEqual([]);
    const still = await t.db.query<any>("select phone from public.customer_addresses where id = $1", [aAddress]);
    expect(still.rows[0].phone).toBe("+8801711000000");
  });

  it("nobody can create an address in another account", async () => {
    await refused(insertAs(B, { user_id: A.id }), /row-level security/);
  });

  it("an address cannot be moved to another account, even by its owner", async () => {
    await refused(t.asUser(A.id, A.email, (db) => db.query("update public.customer_addresses set user_id = $1 where id = $2", [B.id, aAddress])));
  });

  it("anonymous visitors have no access at all", async () => {
    await refused(t.asAnon((db) => db.query("select * from public.customer_addresses")), /permission denied/);
    await refused(t.asAnon((db) => db.query("insert into public.customer_addresses (user_id, full_name, phone, address_line1, city) values ($1, 'x', '12345', 'y', 'z')", [A.id])), /permission denied/);
  });

  it("administrators and designers do not read customers' address books", async () => {
    for (const staff of [ADMIN, DESIGNER]) {
      const rows = await t.asUser(staff.id, staff.email, (db) => db.query<any>("select * from public.customer_addresses"));
      expect(rows.rows, staff.email).toEqual([]);
    }
  });

  it("one default address per account", async () => {
    await refused(insertAs(A, { is_default: true }), /customer_addresses_one_default|duplicate key/);
    const second = await insertAs(A, { is_default: false });
    expect(second.rows[0].is_default).toBe(false);
  });

  it("at most 10 addresses per account, and invalid values are refused", async () => {
    const existing = Number((await t.db.query<any>("select count(*)::int as n from public.customer_addresses where user_id = $1", [A.id])).rows[0].n);
    for (let index = existing; index < 10; index += 1) await insertAs(A, {});
    await refused(insertAs(A, {}), /at most 10/);
    await refused(insertAs(B, { full_name: " " }), /check constraint/);
    await refused(insertAs(B, { city: "x".repeat(81) }), /check constraint/);
  });

  it("deleting the account removes its addresses", async () => {
    const c = USERS.customerC;
    await insertAs(c, {});
    await t.db.query("delete from auth.users where id = $1", [c.id]);
    expect((await t.db.query<any>("select count(*)::int as n from public.customer_addresses where user_id = $1", [c.id])).rows[0].n).toBe(0);
  });
});
