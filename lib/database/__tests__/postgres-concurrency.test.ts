/**
 * REAL PostgreSQL 17 (separate backends per connection) running the actual
 * schema and every migration: true lock contention, SKIP LOCKED leases,
 * advisory locks, unique-index races, RLS/grants and rollback.
 *
 * This is not a Supabase project (no PostgREST, GoTrue, Storage API); those
 * still need the staging checks in HOSTINGER_DEPLOYMENT.md.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startPostgres, type PostgresServer, type RoleClient } from "@/lib/testing/postgres-server";
import { IDS, USERS, callCheckoutRpc, count, orderPayload, seedCheckoutFixtures, type SqlDatabase } from "@/lib/testing/checkout-fixtures";

const A = USERS.customerA;
const B = USERS.customerB;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function refused(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

describe("real PostgreSQL: concurrency, leases and isolation", () => {
  let server: PostgresServer;
  let service: RoleClient;
  let t: SqlDatabase;

  beforeAll(async () => {
    server = await startPostgres();
    service = await server.connect();
    await service.as("service_role");
    t = { db: server.owner, asService: (work) => work(service) };
    await seedCheckoutFixtures(t);
  }, 240_000);
  // Stopping embedded PostgreSQL on Windows retries its folder removal for up to
  // 10 s — the default hook timeout — so a busy machine failed the teardown.
  afterAll(async () => server?.stop(), 120_000);

  /** A service-role connection of its own (a separate backend). */
  const worker = async () => {
    const client = await server.connect();
    await client.as("service_role");
    return client;
  };
  const payloadJson = (payload: { order: unknown; items: unknown; snapshots: unknown; guards: unknown }) =>
    [JSON.stringify(payload.order), JSON.stringify(payload.items), JSON.stringify(payload.snapshots), JSON.stringify(payload.guards)];

  it("ten simultaneous preparation leases for one customer: exactly one is acquired", async () => {
    const clients = await Promise.all(Array.from({ length: 10 }, () => worker()));
    const results = await Promise.all(
      clients.map((client, index) =>
        client.query<{ r: { status: string } }>("select public.acquire_checkout_preparation($1::uuid,$2,$3,$4,300) as r", [USERS.customerC.id, `lease-race-${index}-0000000000`, "a".repeat(64), `order-lease-race-${index}`]),
      ),
    );
    const statuses = results.map((result) => result.rows[0].r.status);
    expect(statuses.filter((status) => status === "acquired")).toHaveLength(1);
    expect(statuses.filter((status) => status === "busy")).toHaveLength(9);
    expect(await count(t, "select 1 from public.checkout_preparations where customer_id=$1 and status='preparing'", [USERS.customerC.id])).toBe(1);
    await server.owner.query("update public.checkout_preparations set status='failed' where customer_id=$1 and status='preparing'", [USERS.customerC.id]);
  });

  it("a committing checkout holds its lease: expiry skips it, a new attempt waits, and the commit wins", async () => {
    const payload = await orderPayload(t, { customizationId: null });
    const lease = (await service.query<{ r: { id: string } }>("select public.acquire_checkout_preparation($1::uuid,$2,$3,$4,300) as r", [A.id, payload.order.checkout_submission_id, "b".repeat(64), payload.order.id])).rows[0].r;
    // The lease runs out 1.5 s from now — after the commit has started.
    await server.owner.query("update public.checkout_preparations set lease_expires_at=clock_timestamp()+interval '1.5 seconds' where id=$1", [lease.id]);
    const committer = await worker();
    await committer.query("begin");
    await committer.query("select public.create_checkout_order($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb)", payloadJson(payload));
    await pause(2_000); // the lease is now past its expiry while the commit is still in flight
    const reaper = await worker();
    const expired = await reaper.query<{ n: number }>("select public.expire_checkout_preparations(10) as n");
    expect(expired.rows[0].n).toBe(0); // SKIP LOCKED: never blocks, never steals
    const nextAttempt = worker().then((client) =>
      client.query<{ r: { status: string } }>("select public.acquire_checkout_preparation($1::uuid,'next-attempt-000000001',$2,'order-next-attempt-1',300) as r", [A.id, "c".repeat(64)]),
    );
    await pause(300);
    await committer.query("commit");
    const next = (await nextAttempt).rows[0].r;
    expect(next.status).toBe("acquired"); // the committed lease is no longer 'preparing'
    expect((await server.owner.query("select status from public.checkout_preparations where id=$1", [lease.id])).rows[0].status).toBe("committed");
    expect((await server.owner.query("select checkout_state from public.orders where id=$1", [payload.order.id])).rows[0].checkout_state).toBe("finalized");
    await server.owner.query("update public.checkout_preparations set status='failed' where order_id='order-next-attempt-1'");
  }, 60_000);

  it("once the reaper abandoned a lease, the late transaction is refused and nothing is ordered", async () => {
    const payload = await orderPayload(t, { customizationId: null });
    await service.query("select public.acquire_checkout_preparation($1::uuid,$2,$3,$4,300)", [A.id, payload.order.checkout_submission_id, "d".repeat(64), payload.order.id]);
    await server.owner.query("update public.checkout_preparations set lease_expires_at=now()-interval '1 second' where order_id=$1", [payload.order.id]);
    const reaper = await worker();
    expect((await reaper.query<{ n: number }>("select public.expire_checkout_preparations(10) as n")).rows[0].n).toBe(1);
    const late = await worker();
    expect(await refused(late.query("select public.create_checkout_order($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb)", payloadJson(payload)))).toMatch(/CHECKOUT_PREPARATION_EXPIRED/);
    expect(await count(t, "select 1 from public.orders where id=$1", [payload.order.id])).toBe(0);
    expect(await count(t, "select 1 from public.cart_items where id=$1", [payload.cartItemId])).toBe(1);
  }, 60_000);

  it("defence in depth: without leases, two transactions consuming the same cart line yield exactly one order", async () => {
    const first = await orderPayload(t, { customizationId: null });
    const second = { ...first, order: { ...first.order, id: `${first.order.id}-twin`, checkout_submission_id: `${first.order.checkout_submission_id}-twin`, request_hash: "twin-hash" } };
    await server.owner.query("alter table public.orders disable trigger verify_consume_checkout_preparation");
    try {
      const [left, right] = [await worker(), await worker()];
      const results = await Promise.allSettled([
        left.query("select public.create_checkout_order($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb) as r", payloadJson(first)),
        right.query("select public.create_checkout_order($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb) as r", payloadJson(second)),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const failure = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
      expect(String(failure.reason?.message)).toMatch(/CHECKOUT_CART_ALREADY_ORDERED|CHECKOUT_CART_ITEM_NOT_FOUND/);
      expect(await count(t, "select 1 from public.checkout_cart_claims where cart_item_id=$1", [first.cartItemId])).toBe(1);
      expect(await count(t, "select 1 from public.orders where id in ($1,$2)", [first.order.id, second.order.id])).toBe(1);
    } finally {
      await server.owner.query("alter table public.orders enable trigger verify_consume_checkout_preparation");
    }
  }, 60_000);

  it("the same submission raced from five backends: one order, the rest replay (advisory lock)", async () => {
    const payload = await orderPayload(t, { submissionId: "pg-parallel-submission-01", requestHash: "pg-hash", customizationId: null });
    await server.owner.query("alter table public.orders disable trigger verify_consume_checkout_preparation");
    try {
      const clients = await Promise.all(Array.from({ length: 5 }, () => worker()));
      const results = await Promise.all(clients.map((client, index) =>
        client.query<{ r: { status: string; order_id: string } }>("select public.create_checkout_order($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb) as r", payloadJson({ ...payload, order: { ...payload.order, id: `order-pg-parallel-${index}` } })),
      ));
      const statuses = results.map((result) => result.rows[0].r.status);
      expect(statuses.filter((status) => status === "created")).toHaveLength(1);
      expect(statuses.filter((status) => status === "replayed")).toHaveLength(4);
      expect(new Set(results.map((result) => result.rows[0].r.order_id)).size).toBe(1);
    } finally {
      await server.owner.query("alter table public.orders enable trigger verify_consume_checkout_preparation");
    }
  }, 60_000);

  it("reconciliation raced from two backends creates ONE recovery task; render enqueue raced creates ONE job", async () => {
    const payload = await orderPayload(t, { customizationId: randomUUIDCustomization(await freshDesign()) });
    const created = await callCheckoutRpc(t, payload);
    const snapshot = (await server.owner.query("select id from public.order_design_snapshots where order_id=$1", [created.order_id])).rows[0];
    await server.owner.query("delete from public.production_tasks where snapshot_id=$1", [snapshot.id]);
    await server.owner.query("update public.order_design_snapshots set created_at=now()-interval '1 hour' where id=$1", [snapshot.id]).catch(() => undefined);
    const [left, right] = [await worker(), await worker()];
    await Promise.all([left.query("select public.reconcile_production(0)"), right.query("select public.reconcile_production(0)")]);
    expect(await count(t, "select 1 from public.production_tasks where snapshot_id=$1", [snapshot.id])).toBe(1);

    const enqueue = (client: RoleClient) => client.query("select public.enqueue_snapshot_render_job($1::uuid,'print_png','race-hash')", [snapshot.id]);
    const clients = await Promise.all(Array.from({ length: 4 }, () => worker()));
    await Promise.all(clients.map(enqueue));
    expect(await count(t, "select 1 from public.customizer_render_jobs where snapshot_id=$1", [snapshot.id])).toBe(1);
  }, 60_000);

  it("two workers claiming production, notification and cleanup work at once never share an item", async () => {
    for (let index = 0; index < 6; index++) {
      const payload = await orderPayload(t, { customizationId: randomUUIDCustomization(await freshDesign()) });
      await callCheckoutRpc(t, payload);
    }
    for (let index = 0; index < 6; index++) {
      await server.owner.query("insert into storage.objects(bucket_id,name,created_at) values('order-production',$1,now()-interval '3 days')", [`orders/order-orphan-${randomUUID()}/assets/${"e".repeat(64)}`]);
    }
    const disjoint = async (sql: string) => {
      const [left, right] = [await worker(), await worker()];
      await left.query("begin");
      await right.query("begin");
      const [a, b] = await Promise.all([left.query<{ id: string }>(sql), right.query<{ id: string }>(sql)]);
      await left.query("commit");
      await right.query("commit");
      const ids = [...a.rows, ...b.rows].map((row) => row.id);
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
      return ids.length;
    };
    expect(await disjoint("select id from public.claim_production_tasks(3, 300, null)")).toBeGreaterThanOrEqual(3);
    expect(await disjoint("select id from public.claim_notification_tasks(3, 120, null)")).toBeGreaterThanOrEqual(3);
    expect(await disjoint("select id from public.claim_storage_cleanup_items(3, 300, 8, 200)")).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it("outbox retry: failure backs off without losing the task; success completes it once", async () => {
    const payload = await orderPayload(t, { customizationId: randomUUIDCustomization(await freshDesign()) });
    const created = await callCheckoutRpc(t, payload);
    const claimer = await worker();
    const claimed = (await claimer.query<{ id: string; lock_token: string }>("select id, lock_token from public.claim_production_tasks(10, 300, $1)", [created.order_id])).rows[0];
    expect((await claimer.query<{ s: string }>("select public.finish_production_task($1,$2,'render service down') as s", [claimed.id, claimed.lock_token])).rows[0].s).toBe("pending");
    const row = (await server.owner.query("select status, next_attempt_at > now() as later, last_error from public.production_tasks where id=$1", [claimed.id])).rows[0];
    expect(row).toMatchObject({ status: "pending", later: true, last_error: "render service down" });
    // Not claimable until due; a stale lease token can never finish it.
    expect((await claimer.query("select id from public.claim_production_tasks(10, 300, $1)", [created.order_id])).rows).toHaveLength(0);
    expect((await claimer.query<{ s: string | null }>("select public.finish_production_task($1,$2,null) as s", [claimed.id, claimed.lock_token])).rows[0].s).toBeNull();
  }, 60_000);

  it("a failure at the last write rolls the whole checkout back, leaving the lease re-usable", async () => {
    const payload = await orderPayload(t, { customizationId: randomUUIDCustomization(await freshDesign()) });
    await server.owner.query("create or replace function public.pg_test_fail() returns trigger language plpgsql as $$ begin raise exception 'INJECTED_FAILURE'; end $$");
    await server.owner.query("create trigger pg_test_fail before insert on public.notification_tasks for each row execute function public.pg_test_fail()");
    try {
      expect(await refused(callCheckoutRpc(t, payload))).toMatch(/INJECTED_FAILURE/);
    } finally {
      await server.owner.query("drop trigger pg_test_fail on public.notification_tasks");
    }
    for (const table of ["orders", "order_items", "order_design_snapshots", "production_tasks", "notification_tasks", "checkout_cart_claims"]) {
      expect(await count(t, `select 1 from public.${table} where ${table === "orders" ? "id" : "order_id"}=$1`, [payload.order.id])).toBe(0);
    }
    expect(await count(t, "select 1 from public.cart_items where id=$1", [payload.cartItemId])).toBe(1);
    expect((await server.owner.query("select status from public.checkout_preparations where order_id=$1", [payload.order.id])).rows[0].status).toBe("failed");
  }, 60_000);

  it("customers cannot read other customers' data, drive the worker, forge leases or mutate history (RLS + grants)", async () => {
    const payload = await orderPayload(t, { customizationId: randomUUIDCustomization(await freshDesign()) });
    const created = await callCheckoutRpc(t, payload);
    const customerB = await server.connect();
    await customerB.as("authenticated", { sub: B.id, email: B.email });
    for (const table of ["orders", "order_items", "order_design_snapshots", "order_production_assets", "checkout_preparations", "production_storage_cleanup_items", "worker_subsystem_runs", "production_tasks", "notification_tasks", "checkout_cart_claims"]) {
      const rows = await customerB.query(`select * from public.${table} where ${table === "orders" ? "id" : table === "checkout_preparations" || table === "checkout_cart_claims" ? "customer_id::text" : table === "production_storage_cleanup_items" || table === "worker_subsystem_runs" ? "'x'" : "order_id"} = $1`, [table === "checkout_preparations" || table === "checkout_cart_claims" ? A.id : created.order_id]).catch((error: Error) => ({ rows: [], error }));
      expect(rows.rows, table).toHaveLength(0);
    }
    const customerA = await server.connect();
    await customerA.as("authenticated", { sub: A.id, email: A.email });
    expect((await customerA.query("select id from public.orders where id=$1", [created.order_id])).rows).toHaveLength(1);
    for (const sql of [
      "select public.acquire_checkout_preparation($1::uuid,'forged-submission-0001','" + "f".repeat(64) + "','order-forged',300)",
      "select public.release_checkout_preparation(gen_random_uuid(), gen_random_uuid(), 'x')",
      "select public.expire_checkout_preparations(10)",
      "select * from public.claim_storage_cleanup_items(10,300,8,200)",
      "select public.review_storage_cleanup_item(gen_random_uuid(), $1::uuid, 'retry', 'I am not an admin at all')",
      "select public.record_worker_subsystems('render','[]')",
      "select public.server_clock()",
      "select public.production_health()",
      "select public.reconcile_production(0)",
    ]) {
      expect(await refused(customerA.query(sql, sql.includes("$1") ? [A.id] : [])), sql).toMatch(/permission denied/);
    }
    expect(await refused(customerA.query("select public.create_checkout_order($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb)", payloadJson(payload)))).toMatch(/permission denied/);
    expect(await refused(customerA.query("insert into public.checkout_preparations(customer_id,submission_id,cart_fingerprint,order_id,lease_expires_at) values($1,'x','" + "a".repeat(64) + "','order-x',now()+interval '1 hour')", [A.id]))).toMatch(/permission denied/);
    expect(await refused(customerA.query("insert into public.production_tasks(order_id,snapshot_id) select order_id,id from public.order_design_snapshots limit 1"))).toMatch(/permission denied/);
    const paid = await customerA.query("update public.orders set payment_status='paid', total=1 where id=$1", [created.order_id]).catch((error: Error) => ({ rowCount: 0, error }));
    expect(paid.rowCount).toBe(0);
    expect(await refused(customerA.query("insert into storage.objects(bucket_id,name) values('order-production','orders/forged/assets/x')"))).toMatch(/row-level security|permission denied/);
    const anon = await server.connect();
    await anon.as("anon");
    expect((await anon.query("select id from public.orders").catch(() => ({ rows: [] }))).rows).toHaveLength(0);
    expect(await refused(anon.query("select * from public.checkout_preparations"))).toMatch(/permission denied/);
  }, 60_000);

  it("finalized history is retained: deletes are refused, snapshots stay linked, identity is immutable", async () => {
    const payload = await orderPayload(t, { customizationId: randomUUIDCustomization(await freshDesign()) });
    const created = await callCheckoutRpc(t, payload);
    const ownerService = await worker();
    expect(await refused(ownerService.query("delete from public.orders where id=$1", [created.order_id]))).toMatch(/FINALIZED_FULFILLMENT_HISTORY_MUST_BE_RETAINED/);
    expect(await refused(ownerService.query("delete from public.order_design_snapshots where order_id=$1", [created.order_id]))).toMatch(/FINALIZED_FULFILLMENT_HISTORY_MUST_BE_RETAINED/);
    expect(await refused(ownerService.query("update public.order_design_snapshots set order_item_id=null where order_id=$1", [created.order_id]))).not.toBe("");
    expect(await refused(ownerService.query("insert into public.customizer_render_jobs(snapshot_id,order_id,order_item_id,job_type,status,input_hash) select id,order_id,order_item_id,'print_png','queued','x' from public.order_design_snapshots where order_id=$1 union all select id,order_id,order_item_id,'print_png','queued','x' from public.order_design_snapshots where order_id=$1", [created.order_id]))).toMatch(/duplicate key|snapshot_render_job_identity/);
    expect((await server.owner.query("select checkout_state from public.orders where id=$1", [created.order_id])).rows[0].checkout_state).toBe("finalized");
    // A non-finalized attempt is NOT history and staff may delete it.
    await server.owner.query("insert into public.orders(id,customer_id,customer_name,customer_email,checkout_submission_id,checkout_state,request_hash) values('order-failed-attempt',$1,'A',$2,'failed-attempt-submission-1','failed','h')", [A.id, A.email]);
    expect((await ownerService.query("delete from public.orders where id='order-failed-attempt'")).rowCount).toBe(1);
  }, 60_000);

  it("the HOSTINGER_DEPLOYMENT.md §3 verification query returns true for every row, and RLS is on for every public table", async () => {
    const doc = readFileSync(join(process.cwd(), "docs", "HOSTINGER_DEPLOYMENT.md"), "utf8").replace(/\r\n/g, "\n");
    const query = doc.match(/```sql\n(select \* from \(values[\s\S]*?\) as checks\(migration, applied\);)\n```/)?.[1];
    expect(query, "verification query in HOSTINGER_DEPLOYMENT.md").toBeTruthy();
    const rows = (await server.owner.query<{ migration: string; applied: boolean }>(query!)).rows;
    expect(rows.length).toBeGreaterThan(30);
    expect(rows.filter((row) => !row.applied).map((row) => row.migration)).toEqual([]);
    expect((await server.owner.query("select tablename from pg_tables where schemaname='public' and not rowsecurity")).rows).toEqual([]);
  }, 60_000);

  /* helpers */
  async function freshDesign(): Promise<string> {
    const id = randomUUID();
    await server.owner.query(
      "insert into public.product_customizations (id, user_id, product_id, template_id, template_version, status, selected_options) values ($1,$2,'product-active',$3,1,'draft','{}'::jsonb)",
      [id, A.id, IDS.templateActive],
    );
    return id;
  }
  function randomUUIDCustomization(id: string) {
    return id;
  }
});
