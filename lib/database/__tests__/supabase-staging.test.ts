/**
 * REAL Supabase staging verification: PostgreSQL behind PostgREST, Supabase
 * Auth (real users and JWTs), Supabase Storage (real policies and signed
 * URLs), RLS, grants and RPCs — against a DEDICATED, DISPOSABLE staging project
 * configured in .env.staging (scripts/staging/staging-env.mjs refuses any
 * production project).
 *
 *   npm run test:staging      (requires .env.staging; FAILS when it is missing)
 *
 * In the default `npm test` run, this suite is SKIPPED with the blocking
 * reason when no staging project is configured — it is never reported as
 * passed without running.
 *
 * Prerequisite: `npm run staging:migrate` applied every migration.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadStagingEnv } from "../../../scripts/staging/staging-env.mjs";
import { IDS, PRODUCT_DATA, VERSION_DOCUMENT, BASIC_OPTIONS, orderPayload, count, type SqlDatabase } from "@/lib/testing/checkout-fixtures";

let staging: { env: Record<string, string>; ref: string } | null = null;
let blocked = "";
try {
  staging = loadStagingEnv();
} catch (error) {
  blocked = error instanceof Error ? error.message : String(error);
}
if (blocked && process.env.STAGING_REQUIRED === "1") throw new Error(blocked);

type Payload = Awaited<ReturnType<typeof orderPayload>>;

describe.skipIf(!staging)(`real staging Supabase (${staging?.ref || `SKIPPED — ${blocked}`})`, () => {
  const env = staging?.env || {};
  const runId = randomUUID().slice(0, 8);
  const password = `Stg-${randomUUID()}`;
  let sql: pg.Client;
  let t: SqlDatabase;
  let service: SupabaseClient;
  const users: Record<"a" | "b" | "admin", { id: string; email: string; client: SupabaseClient }> = {} as never;
  const anon = () => createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const rpcPayload = (payload: Payload) => ({ p_order: payload.order, p_items: payload.items, p_snapshots: payload.snapshots, p_guards: payload.guards });

  async function user(key: "a" | "b" | "admin") {
    const email = `husnalogy-stg-${runId}+${key}@example.test`;
    const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Staging ${key}` } });
    if (error) throw error;
    const client = anon();
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw signedIn.error;
    users[key] = { id: data.user.id, email, client };
  }
  async function design(userId: string) {
    const id = randomUUID();
    await sql.query(
      "insert into public.product_customizations (id, user_id, product_id, template_id, template_version, status, selected_options, values) values ($1,$2,'product-active',$3,1,'draft',$4::jsonb,'{\"names\":\"Staging\"}'::jsonb)",
      [id, userId, IDS.templateActive, JSON.stringify({ ...BASIC_OPTIONS, paper: "Premium" })],
    );
    return id;
  }
  /** A finalized order through REAL PostgREST, under a preparation lease. */
  async function placeOrder(customer: { id: string; email: string }) {
    const payload = await orderPayload(t, { customer, customizationId: await design(customer.id) });
    const lease = await service.rpc("acquire_checkout_preparation", { p_customer_id: customer.id, p_submission_id: payload.order.checkout_submission_id, p_cart_fingerprint: "c".repeat(64), p_order_id: payload.order.id, p_lease_seconds: 300 });
    expect(lease.error).toBeNull();
    expect(lease.data.status).toBe("acquired");
    const created = await service.rpc("create_checkout_order", rpcPayload(payload));
    expect(created.error).toBeNull();
    expect(created.data).toMatchObject({ status: "created", order_id: payload.order.id });
    return payload;
  }

  beforeAll(async () => {
    sql = new pg.Client({ connectionString: env.STAGING_DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await sql.connect();
    t = { db: sql, asService: (work) => work(sql) };
    service = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    for (const key of ["a", "b", "admin"] as const) await user(key);
    await sql.query("update public.profiles set role='admin' where id=$1", [users.admin.id]);
    await sql.query(
      "insert into public.products (id, slug, title, status, visibility, price, sale_price, data) values ('product-active','pearl-invitation','Pearl Invitation','active','public',120,100,$1::jsonb) on conflict (id) do nothing",
      [JSON.stringify(PRODUCT_DATA)],
    );
    await sql.query("insert into public.product_customizer_templates (id, product_id, enabled) values ($1,'product-active',true) on conflict do nothing", [IDS.templateActive]);
    await sql.query("insert into public.customizer_template_versions (id, template_id, product_id, version, document) values ($1,$2,'product-active',1,$3::jsonb) on conflict do nothing", [IDS.versionActive, IDS.templateActive, JSON.stringify(VERSION_DOCUMENT)]);
  }, 180_000);
  afterAll(async () => {
    for (const key of ["a", "b", "admin"] as const) if (users[key]) await service.auth.admin.deleteUser(users[key].id).catch(() => undefined);
    await sql?.end();
  });

  /* ---------------------------------------------------------- migrations -- */

  it("every migration is applied; the runbook check, RLS on every table and private buckets hold on the real project", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const doc = readFileSync(join(process.cwd(), "HOSTINGER_DEPLOYMENT.md"), "utf8").replace(/\r\n/g, "\n");
    const query = doc.match(/```sql\n(select \* from \(values[\s\S]*?\) as checks\(migration, applied\);)\n```/)![1];
    const rows = (await sql.query<{ migration: string; applied: boolean }>(query)).rows;
    expect(rows.filter((row) => !row.applied).map((row) => row.migration)).toEqual([]);
    expect((await sql.query("select tablename from pg_tables where schemaname='public' and not rowsecurity")).rows).toEqual([]);
    const buckets = Object.fromEntries((await sql.query<{ id: string; public: boolean }>("select id, public from storage.buckets")).rows.map((row) => [row.id, row.public]));
    for (const bucket of ["customer-uploads", "customizer-renders", "order-production", "admin-assets"]) expect(buckets[bucket], bucket).toBe(false);
    const { migrationPlan } = await import("../../../scripts/staging/apply-migrations.mjs");
    const applied = (await sql.query<{ name: string }>("select name from husnalogy_ops.applied_migrations")).rows.map((row) => row.name);
    expect(applied.sort()).toEqual(migrationPlan().map((entry: { name: string }) => entry.name).sort());
  });

  /* ----------------------------------------------- isolation (PostgREST) -- */

  it("Customer A cannot read Customer B's orders, items, designs, cart, snapshots, assets, profile or address", async () => {
    const order = await placeOrder(users.b);
    const cartLine = randomUUID();
    await sql.query("insert into public.cart_items (id, user_id, product_id, product_title, quantity, unit_price) values ($1,$2,'product-active','B line',1,0.01)", [cartLine, users.b.id]);
    const a = users.a.client;
    for (const [table, column, value] of [
      ["orders", "id", order.order.id],
      ["order_items", "order_id", order.order.id],
      ["order_design_snapshots", "order_id", order.order.id],
      ["order_production_assets", "order_id", order.order.id],
      ["product_customizations", "user_id", users.b.id],
      ["cart_items", "id", cartLine],
      ["profiles", "id", users.b.id],
      ["checkout_cart_claims", "customer_id", users.b.id],
    ] as const) {
      const { data, error } = await a.from(table).select("*").eq(column, value);
      expect(error ? [] : data, `${table} visible to Customer A`).toEqual([]);
    }
    // B sees B's own order (and its address); A never does.
    expect((await users.b.client.from("orders").select("id,address").eq("id", order.order.id)).data).toHaveLength(1);
  });

  it("anonymous callers read no private data", async () => {
    const client = anon();
    for (const table of ["orders", "order_items", "product_customizations", "cart_items", "profiles", "order_design_snapshots", "checkout_preparations", "production_tasks", "notification_tasks", "customer_asset_library", "site_settings"]) {
      const { data, error } = await client.from(table).select("*").limit(5);
      expect(error ? [] : data, table).toEqual([]);
    }
  });

  it("customers cannot execute privileged RPCs", async () => {
    const a = users.a.client;
    const attempts = [
      a.rpc("create_checkout_order", { p_order: {}, p_items: [], p_snapshots: [], p_guards: {} }),
      a.rpc("acquire_checkout_preparation", { p_customer_id: users.a.id, p_submission_id: "forged-0000000001", p_cart_fingerprint: "a".repeat(64), p_order_id: "order-forged", p_lease_seconds: 300 }),
      a.rpc("claim_production_tasks", { p_limit: 10, p_lease_seconds: 300, p_order_id: null }),
      a.rpc("claim_notification_tasks", { p_limit: 10, p_lease_seconds: 120, p_order_id: null }),
      a.rpc("claim_storage_cleanup_items", { p_limit: 10 }),
      a.rpc("retry_production_work", { p_kind: "snapshot", p_id: randomUUID(), p_actor_id: users.admin.id, p_reason: "forged retry" }),
      a.rpc("production_health"),
      a.rpc("reconcile_production", { p_older_than_seconds: 0 }),
      a.rpc("record_worker_subsystems", { p_worker: "render", p_subsystems: [] }),
    ];
    for (const result of await Promise.all(attempts)) expect(result.error, JSON.stringify(result.data)).toBeTruthy();
  });

  it("customers cannot mutate protected design fields or finalized order identity directly", async () => {
    const order = await placeOrder(users.a);
    const a = users.a.client;
    const designId = String(order.items[0].customization_id);
    const designUpdate = await a.from("product_customizations").update({ status: "draft", order_id: null, user_id: users.b.id }).eq("id", designId).select("id");
    expect(designUpdate.error || (designUpdate.data || []).length === 0).toBeTruthy();
    const orderUpdate = await a.from("orders").update({ customer_id: users.b.id, total: 1, payment_status: "paid", status: "delivered" }).eq("id", order.order.id).select("id");
    expect(orderUpdate.error || (orderUpdate.data || []).length === 0).toBeTruthy();
    const row = (await sql.query("select customer_id, total::text as total, payment_status, status from public.orders where id=$1", [order.order.id])).rows[0];
    expect(row).toMatchObject({ customer_id: users.a.id, payment_status: "unpaid", status: "pending" });
    // Even the service role cannot rewrite finalized identity (immutability trigger).
    expect((await service.from("orders").update({ customer_id: users.b.id }).eq("id", order.order.id)).error).toBeTruthy();
  });

  /* ------------------------------------------------------------- storage -- */

  it("private uploads: owner-only access, signed URLs work, the bare object URL and other customers do not", async () => {
    const path = `${users.a.id}/staging/${runId}.png`;
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
    expect((await service.storage.from("customer-uploads").upload(path, png, { contentType: "image/png", upsert: true })).error).toBeNull();
    expect((await users.b.client.storage.from("customer-uploads").download(path)).error).toBeTruthy();
    expect((await users.b.client.storage.from("customer-uploads").createSignedUrl(path, 60)).error).toBeTruthy();
    expect((await anon().storage.from("customer-uploads").download(path)).error).toBeTruthy();
    const signed = await service.storage.from("customer-uploads").createSignedUrl(path, 60);
    expect(signed.error).toBeNull();
    expect((await fetch(signed.data!.signedUrl)).status).toBe(200);
    expect((await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/customer-uploads/${path}`)).status).toBeGreaterThanOrEqual(400);
    // Customers can never write into production storage.
    expect((await users.a.client.storage.from("order-production").upload(`orders/forged/assets/${runId}`, png)).error).toBeTruthy();
  });

  it("committed production originals cannot be deleted through the Storage API; abandoned ones are cleaned with retry bookkeeping", async () => {
    const order = await placeOrder(users.a);
    const committedPath = `orders/${order.order.id}/assets/${"d".repeat(64)}`;
    await sql.query("insert into public.order_production_assets(snapshot_id,order_id,asset_key,bucket,path,checksum,size_bytes,mime_type,kind) select id,order_id,$2,'order-production',$3,$2,4,'image/png','image' from public.order_design_snapshots where order_id=$1", [order.order.id, "d".repeat(64), committedPath]);
    await service.storage.from("order-production").upload(committedPath, Buffer.from("keep"), { upsert: false });
    await service.storage.from("order-production").remove([committedPath]);
    expect((await sql.query("select 1 from storage.objects where bucket_id='order-production' and name=$1", [committedPath])).rows).toHaveLength(1);

    const abandonedId = `order-stg-abandoned-${runId}`;
    const lease = await service.rpc("acquire_checkout_preparation", { p_customer_id: users.b.id, p_submission_id: `stg-abandoned-${runId}`, p_cart_fingerprint: "e".repeat(64), p_order_id: abandonedId, p_lease_seconds: 300 });
    const abandonedPath = `orders/${abandonedId}/assets/${"f".repeat(64)}`;
    expect((await service.storage.from("order-production").upload(abandonedPath, Buffer.from("drop"))).error).toBeNull();
    await service.rpc("release_checkout_preparation", { p_id: lease.data.id, p_lease_token: lease.data.leaseToken, p_failure_code: "STAGING_TEST" });
    const claimed = await service.rpc("claim_storage_cleanup_items", { p_limit: 25 });
    expect(claimed.error).toBeNull();
    const item = (claimed.data as Array<{ id: string; path: string; attempt_count: number }>).find((entry) => entry.path === abandonedPath)!;
    expect(item).toMatchObject({ attempt_count: 1 });
    expect((await service.storage.from("order-production").remove([abandonedPath])).error).toBeNull();
    expect((await service.rpc("record_storage_cleanup_result", { p_id: item.id, p_error: null })).data).toBe("deleted");
  });

  /* ------------------------------------------------------ transactions -- */

  it("concurrent checkouts through PostgREST: same submission → one order; different submissions, same cart → one order", async () => {
    await sql.query("alter table public.orders disable trigger verify_consume_checkout_preparation");
    try {
      const same = await orderPayload(t, { customer: users.a, customizationId: null });
      const sameResults = await Promise.all(Array.from({ length: 4 }, (_, index) => service.rpc("create_checkout_order", rpcPayload({ ...same, order: { ...same.order, id: `${same.order.id}-${index}` } }))));
      expect(sameResults.map((result) => result.data?.status).filter((status) => status === "created")).toHaveLength(1);
      expect(sameResults.every((result) => ["created", "replayed"].includes(result.data?.status))).toBe(true);

      const cart = await orderPayload(t, { customer: users.a, customizationId: null });
      const twin = { ...cart, order: { ...cart.order, id: `${cart.order.id}-twin`, checkout_submission_id: `${cart.order.checkout_submission_id}-twin`, request_hash: "twin" } };
      const [left, right] = await Promise.all([service.rpc("create_checkout_order", rpcPayload(cart)), service.rpc("create_checkout_order", rpcPayload(twin))]);
      expect([left, right].filter((result) => result.data?.status === "created")).toHaveLength(1);
      expect(String((left.error || right.error)?.message)).toMatch(/CHECKOUT_CART_ALREADY_ORDERED|CHECKOUT_CART_ITEM_NOT_FOUND/);
      expect(await count(t, "select 1 from public.checkout_cart_claims where cart_item_id=$1", [cart.cartItemId])).toBe(1);
    } finally {
      await sql.query("alter table public.orders enable trigger verify_consume_checkout_preparation");
    }
  });

  it("preparation leases are single-flight through PostgREST", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => service.rpc("acquire_checkout_preparation", { p_customer_id: users.b.id, p_submission_id: `stg-lease-${runId}-${index}`, p_cart_fingerprint: "a".repeat(64), p_order_id: `order-stg-lease-${runId}-${index}`, p_lease_seconds: 300 })));
    expect(results.filter((result) => result.data?.status === "acquired")).toHaveLength(1);
    await sql.query("update public.checkout_preparations set status='failed' where customer_id=$1 and status='preparing'", [users.b.id]);
  });

  it("a failure at a critical insert rolls the whole checkout back", async () => {
    const payload = await orderPayload(t, { customer: users.a, customizationId: await design(users.a.id) });
    await service.rpc("acquire_checkout_preparation", { p_customer_id: users.a.id, p_submission_id: payload.order.checkout_submission_id, p_cart_fingerprint: "b".repeat(64), p_order_id: payload.order.id, p_lease_seconds: 300 });
    await sql.query("create or replace function public.stg_fail() returns trigger language plpgsql as $$ begin raise exception 'STAGING_INJECTED_FAILURE'; end $$");
    await sql.query("create trigger stg_fail before insert on public.notification_tasks for each row execute function public.stg_fail()");
    try {
      const result = await service.rpc("create_checkout_order", rpcPayload(payload));
      expect(String(result.error?.message)).toMatch(/STAGING_INJECTED_FAILURE/);
    } finally {
      await sql.query("drop trigger stg_fail on public.notification_tasks; drop function public.stg_fail()");
      await sql.query("update public.checkout_preparations set status='failed' where order_id=$1", [payload.order.id]);
    }
    for (const table of ["orders", "order_items", "order_design_snapshots", "production_tasks", "notification_tasks", "checkout_cart_claims"]) {
      expect(await count(t, `select 1 from public.${table} where ${table === "orders" ? "id" : "order_id"}=$1`, [payload.order.id]), table).toBe(0);
    }
    expect(await count(t, "select 1 from public.cart_items where id=$1", [payload.cartItemId])).toBe(1);
  });

  it("uniqueness and relationship constraints hold: cart claims, production/notification tasks, snapshot linkage", async () => {
    const order = await placeOrder(users.a);
    const reject = async (query: string, values: unknown[]) => { await expect(sql.query(query, values)).rejects.toThrow(); };
    await reject("insert into public.checkout_cart_claims (cart_item_id, customer_id, order_id, line_number) select cart_item_id, customer_id, order_id, line_number from public.checkout_cart_claims where order_id=$1", [order.order.id]);
    await reject("insert into public.production_tasks (order_id, order_item_id, snapshot_id) select order_id, order_item_id, snapshot_id from public.production_tasks where order_id=$1", [order.order.id]);
    await reject("insert into public.notification_tasks (order_id, kind) values ($1, 'order_confirmation_customer')", [order.order.id]);
    await reject("insert into public.order_design_snapshots (order_id, product_id, product_title, quantity, snapshot, integrity_hash) values ($1, 'product-active', 'x', 1, '{}', 'x')", [order.order.id]);
  });

  /* ------------------------------------------------------------- worker -- */

  it("worker leases: concurrent claims never share a task; an expired lease is reclaimed; admin retry is audited and admin-only", async () => {
    for (let index = 0; index < 4; index++) await placeOrder(users.b);
    const [left, right] = await Promise.all([service.rpc("claim_production_tasks", { p_limit: 3, p_lease_seconds: 300, p_order_id: null }), service.rpc("claim_production_tasks", { p_limit: 3, p_lease_seconds: 300, p_order_id: null })]);
    const ids = [...(left.data || []), ...(right.data || [])].map((task: { id: string }) => task.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    const leased = (left.data || right.data)[0] as { id: string; order_id: string };
    await sql.query("update public.production_tasks set locked_until=now()-interval '1 second' where id=$1", [leased.id]);
    const reclaimed = await service.rpc("claim_production_tasks", { p_limit: 10, p_lease_seconds: 300, p_order_id: leased.order_id });
    expect((reclaimed.data || []).map((task: { id: string }) => task.id)).toContain(leased.id);

    await sql.query("update public.production_tasks set status='failed', attempt_count=8, lock_token=null, locked_until=null, last_error='staging forced' where id=$1", [leased.id]);
    expect((await service.rpc("retry_production_work", { p_kind: "production", p_id: leased.id, p_actor_id: users.a.id, p_reason: "not an admin" })).error).toBeTruthy();
    expect((await service.rpc("retry_production_work", { p_kind: "production", p_id: leased.id, p_actor_id: users.admin.id, p_reason: "Staging verification retry" })).error).toBeNull();
    expect(await count(t, "select 1 from public.production_recovery_audit where target_id=$1", [leased.id])).toBe(1);
    expect((await sql.query("select status from public.production_tasks where id=$1", [leased.id])).rows[0].status).toBe("pending");
  });

  it("reconciliation raced from two PostgREST calls creates one recovery task", async () => {
    const order = await placeOrder(users.a);
    const snapshot = (await sql.query("select id from public.order_design_snapshots where order_id=$1", [order.order.id])).rows[0].id;
    await sql.query("delete from public.production_tasks where snapshot_id=$1", [snapshot]);
    await Promise.all([service.rpc("reconcile_production", { p_older_than_seconds: 0 }), service.rpc("reconcile_production", { p_older_than_seconds: 0 })]);
    expect(await count(t, "select 1 from public.production_tasks where snapshot_id=$1", [snapshot])).toBe(1);
  });
});
