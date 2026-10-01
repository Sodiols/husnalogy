/**
 * The production worker's fault isolation, against the REAL SQL (PGlite with
 * every migration), the REAL subsystem wiring (productionWorkerSubsystems),
 * the real renderer and a storage stand-in with fault injection.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { createTestDatabase, type TestDatabase } from "@/lib/testing/pglite-supabase";
import { count, seedCheckoutFixtures, USERS } from "@/lib/testing/checkout-fixtures";
import { createProductionTestClient } from "@/lib/testing/pglite-production-client";
import { loadOrderView } from "@/lib/testing/pglite-checkout-deps";
import { placeAutomaticOrder } from "@/lib/testing/production-orders";
import { productionWorkerSubsystems } from "@/lib/outbox/supabase-tasks";
import { runProductionTask, type ProductionTaskRow } from "@/lib/customizer/order-snapshots";
import { runWorkerPass, type WorkerPassReport } from "@/lib/worker/production-worker";
import type { EmailTransport } from "@/lib/notifications/email-provider";

vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => { throw new Error("Worker test requires its injected SQL client"); } }));

function recordingTransport(fail: () => boolean = () => false) {
  const sent: Array<{ to: string; key: string }> = [];
  const transport: EmailTransport = {
    async send(message, key) {
      if (fail()) throw new Error("provider 503");
      sent.push({ to: message.to, key });
      return { id: `msg-${sent.length}` };
    },
  };
  return { transport, sent };
}

describe("worker subsystems are isolated from each other", () => {
  let t: TestDatabase;
  let storage: ReturnType<typeof createProductionTestClient>;
  const query = async (sql: string, values: unknown[] = []) => (await t.db.query<Record<string, any>>(sql, values)).rows;

  beforeAll(async () => {
    t = await createTestDatabase();
    await seedCheckoutFixtures(t);
    storage = createProductionTestClient(t);
  }, 120_000);
  afterAll(() => t?.close());
  beforeEach(() => {
    storage.faults.remove = undefined;
    storage.faults.download = undefined;
    storage.faults.rpc = undefined;
  });

  const pass = (transport: EmailTransport | null = recordingTransport().transport): Promise<WorkerPassReport> =>
    runWorkerPass(
      productionWorkerSubsystems({
        renderLimit: 10,
        supabase: storage.client,
        notifications: { transport, adminRecipient: "orders@husnalogy.test", loadOrder: (id) => loadOrderView(t, id) },
      }),
      { totalBudgetMs: 240_000 },
    );
  const subsystem = (report: WorkerPassReport, name: string) => report.subsystems.find((entry) => entry.name === name)!;

  /** An abandoned checkout's stored copy: a cleanup candidate right away. */
  async function abandonedCandidate() {
    const orderId = `order-abandoned-${randomUUID()}`;
    const lease = (await query("select public.acquire_checkout_preparation($1::uuid,$2,$3,$4,300) as r", [USERS.customerC.id, `s-${orderId}`, "a".repeat(64), orderId]))[0].r;
    expect(lease.status).toBe("acquired");
    const bytes = Buffer.from(`abandoned ${orderId}`);
    const path = `orders/${orderId}/assets/${createHash("sha256").update(bytes).digest("hex")}`;
    await storage.client.storage.from("order-production").upload(path, bytes, { upsert: false });
    await t.asService((db) => db.query("select public.release_checkout_preparation($1::uuid,$2::uuid,'TEST_FAILED',1,$3)", [lease.id, lease.leaseToken, bytes.length]));
    return { orderId, path };
  }

  it("MANDATORY: cleanup candidate A fails; production task B, render job C and notification D still process; the pass is degraded", async () => {
    // B: a finalized order whose production task is pending; D: its emails.
    const b = await placeAutomaticOrder(t, storage);
    // C: another order already dispatched, its render job queued.
    const c = await placeAutomaticOrder(t, storage, { color: "#1c40b2" });
    const task = (await query("select * from public.production_tasks where snapshot_id=$1", [c.snapshot.id]))[0];
    const dispatched = await runProductionTask(task as ProductionTaskRow, storage.client);
    await t.db.query("update public.production_tasks set status='completed',completed_at=now() where id=$1", [task.id]);
    expect(dispatched.jobs).toHaveLength(1);
    // A: a candidate whose deletion fails (storage error).
    const a = await abandonedCandidate();
    storage.faults.remove = (bucket, path) => bucket === "order-production" && path === a.path;

    const { transport, sent } = recordingTransport();
    const report = await pass(transport);

    expect(report.status).toBe("degraded");
    expect(subsystem(report, "storage_cleanup")).toMatchObject({ status: "degraded" });
    expect(subsystem(report, "storage_cleanup").result).toMatchObject({ failed: 1 });
    for (const name of ["production_tasks", "render_jobs", "notifications", "reconciliation"]) expect(subsystem(report, name).status).toBe("ok");
    // A: the failure is recorded against the object, with a backoff.
    const item = (await query("select * from public.production_storage_cleanup_items where path=$1", [a.path]))[0];
    expect(item).toMatchObject({ status: "pending", attempt_count: 1, reason: "abandoned_checkout" });
    expect(item.last_error).toMatch(/Injected storage failure/);
    expect(new Date(item.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    expect(await count(t, "select 1 from storage.objects where bucket_id='order-production' and name=$1", [a.path])).toBe(1);
    // B: dispatched into a render job (and rendered in the same pass).
    expect((await query("select status from public.production_tasks where snapshot_id=$1", [b.snapshot.id]))[0].status).toBe("completed");
    expect((await query("select status from public.customizer_render_jobs where snapshot_id=$1", [b.snapshot.id]))[0].status).toBe("completed");
    // C: rendered with verified output.
    expect((await query("select status from public.customizer_render_jobs where id=$1", [dispatched.jobs[0]]))[0].status).toBe("completed");
    expect(await count(t, "select 1 from public.customizer_render_outputs where snapshot_id=$1 and status='ready'", [c.snapshot.id])).toBe(1);
    // D: both of B's emails were sent exactly once.
    expect((await query("select status from public.notification_tasks where order_id=$1 order by kind", [b.orderId])).map((row) => row.status)).toEqual(["sent", "sent"]);
    expect(sent.filter((entry) => entry.key.includes("husnalogy-notification-"))).toHaveLength(4);
  }, 180_000);

  it("MANDATORY: storage verification failing temporarily never stops new-order production or email", async () => {
    // Make every existing ready output due for verification, then break reads of them.
    const existing = await query("select bucket,path from public.customizer_render_outputs where status='ready'");
    expect(existing.length).toBeGreaterThan(0);
    await t.db.query("update public.customizer_render_outputs set verified_at='2000-01-01' where status='ready'");
    const unreadable = new Set(existing.map((row) => `${row.bucket}/${row.path}`));
    storage.faults.download = (bucket, path) => unreadable.has(`${bucket}/${path}`);
    const fresh = await placeAutomaticOrder(t, storage, { color: "#2cb21c" });

    const report = await pass();
    expect(report.status).toBe("degraded");
    expect(subsystem(report, "output_verification")).toMatchObject({ status: "degraded" });
    expect(subsystem(report, "output_verification").result).toMatchObject({ invalid: 0 });
    expect(Number(subsystem(report, "output_verification").result.errors)).toBeGreaterThan(0);
    for (const name of ["production_tasks", "render_jobs", "notifications"]) expect(subsystem(report, name).status).toBe("ok");
    expect((await query("select status from public.customizer_render_jobs where snapshot_id=$1", [fresh.snapshot.id]))[0].status).toBe("completed");
    expect((await query("select status from public.notification_tasks where order_id=$1", [fresh.orderId])).every((row) => row.status === "sent")).toBe(true);
    // A transient read error never invalidates good output.
    expect(await count(t, "select 1 from public.customizer_render_outputs where status='invalid'")).toBe(0);
  }, 180_000);

  it("a maintenance subsystem that throws entirely (cleanup RPC down) is contained; everything else runs", async () => {
    storage.faults.rpc = (name) => name === "claim_storage_cleanup_items";
    const fresh = await placeAutomaticOrder(t, storage, { color: "#b2a21c" });
    const report = await pass();
    expect(report.status).toBe("degraded");
    expect(subsystem(report, "storage_cleanup")).toMatchObject({ status: "failed", error: expect.stringMatching(/Injected failure/) });
    expect(subsystem(report, "production_tasks").status).toBe("ok");
    expect((await query("select status from public.notification_tasks where order_id=$1", [fresh.orderId])).every((row) => row.status === "sent")).toBe(true);
  }, 180_000);

  it("a production outage never stops emails, and an email outage never stops production", async () => {
    const first = await placeAutomaticOrder(t, storage, { color: "#101010" });
    storage.faults.rpc = (name) => name === "claim_production_tasks";
    const productionDown = await pass();
    expect(productionDown.status).toBe("error");
    expect(subsystem(productionDown, "production_tasks").status).toBe("failed");
    expect(subsystem(productionDown, "notifications").status).toBe("ok");
    expect((await query("select status from public.notification_tasks where order_id=$1", [first.orderId])).every((row) => row.status === "sent")).toBe(true);
    expect((await query("select status from public.production_tasks where snapshot_id=$1", [first.snapshot.id]))[0].status).toBe("pending");

    storage.faults.rpc = undefined;
    const second = await placeAutomaticOrder(t, storage, { color: "#202020" });
    const emailDown = await pass(recordingTransport(() => true).transport);
    expect(emailDown.status).toBe("degraded");
    expect(subsystem(emailDown, "notifications").status).toBe("degraded");
    expect(subsystem(emailDown, "production_tasks").status).toBe("ok");
    for (const order of [first, second]) {
      expect((await query("select status from public.production_tasks where snapshot_id=$1", [order.snapshot.id]))[0].status).toBe("completed");
    }
    // The failed emails wait with backoff; production state is untouched by them.
    const notification = await query("select status,attempt_count,last_error from public.notification_tasks where order_id=$1", [second.orderId]);
    expect(notification.every((row) => row.status === "pending" && row.attempt_count === 1 && /provider 503/.test(row.last_error))).toBe(true);
    expect((await query("select render_status from public.order_design_snapshots where id=$1", [second.snapshot.id]))[0].render_status).toBe("completed");
  }, 180_000);

  it("a render failure of one order never prevents other orders from rendering", async () => {
    const broken = await placeAutomaticOrder(t, storage, { color: "#303030" });
    const healthy = await placeAutomaticOrder(t, storage, { color: "#404040" });
    // The broken order's pinned image disappears (storage outage for that object).
    const asset = broken.snapshot.snapshot.production.assets.find((entry: { kind: string }) => entry.kind === "image");
    storage.faults.download = (bucket, path) => bucket === asset.bucket && path === asset.path;
    const report = await pass();
    expect(subsystem(report, "render_jobs").status).toBe("degraded");
    expect((await query("select status from public.customizer_render_jobs where snapshot_id=$1", [broken.snapshot.id]))[0].status).toBe("retrying");
    expect((await query("select status from public.customizer_render_jobs where snapshot_id=$1", [healthy.snapshot.id]))[0].status).toBe("completed");
    expect(subsystem(report, "notifications").status).toBe("ok");
  }, 180_000);

  it("email accepted by the provider but not recorded (crash) is retried with the SAME idempotency key: no duplicate email", async () => {
    // A provider that deduplicates on the Idempotency-Key, like Resend.
    const deliveries = new Map<string, string>();
    const keysSeen: string[] = [];
    const provider: EmailTransport = {
      async send(_message, key) {
        keysSeen.push(key);
        if (!deliveries.has(key)) deliveries.set(key, `provider-${deliveries.size + 1}`);
        return { id: deliveries.get(key)! };
      },
    };
    const order = await placeAutomaticOrder(t, storage, { color: "#505050" });
    await t.db.query("update public.notification_tasks set status='sent' where order_id<>$1 and status<>'sent'", [order.orderId]);
    // Crash after the provider accepted: the local acknowledgement never lands.
    storage.faults.rpc = (name) => name === "record_notification_delivery";
    const crashed = await pass(provider);
    expect(subsystem(crashed, "notifications").status).toBe("degraded");
    expect(deliveries.size).toBe(2);
    expect((await query("select status from public.notification_tasks where order_id=$1", [order.orderId])).every((row) => row.status === "pending")).toBe(true);

    storage.faults.rpc = undefined;
    await t.db.query("update public.notification_tasks set next_attempt_at=now() where order_id=$1", [order.orderId]);
    const retried = await pass(provider);
    expect(subsystem(retried, "notifications").status).toBe("ok");
    const tasks = await query("select id,status,provider_message_id from public.notification_tasks where order_id=$1 order by kind", [order.orderId]);
    expect(tasks.every((row) => row.status === "sent")).toBe(true);
    // Four send calls, two distinct keys, two deliveries: the retry reused each key.
    expect(keysSeen).toHaveLength(4);
    expect(new Set(keysSeen).size).toBe(2);
    expect(deliveries.size).toBe(2);
    for (const task of tasks) expect(keysSeen.filter((key) => key === `husnalogy-notification-${task.id}`)).toHaveLength(2);
  }, 180_000);

  it("records per-subsystem health that production_health() exposes (admin/service only)", async () => {
    const report = await pass();
    const recorded = await storage.client.rpc("record_worker_subsystems", {
      p_worker: "render",
      p_subsystems: report.subsystems.map((entry) => ({ name: entry.name, status: entry.status, startedAt: entry.startedAt, durationMs: entry.durationMs, error: entry.error ?? null, result: entry.result })),
    });
    expect(recorded.error).toBeNull();
    const failing = await storage.client.rpc("record_worker_subsystems", { p_worker: "render", p_subsystems: [{ name: "storage_cleanup", status: "degraded", durationMs: 5, error: "1 object(s) could not be removed", result: { failed: 1 } }] });
    expect(failing.error).toBeNull();
    const health = (await storage.client.rpc("production_health")).data;
    expect(Object.keys(health.subsystems)).toEqual(expect.arrayContaining(["lease_recovery", "production_tasks", "render_jobs", "notifications", "reconciliation", "output_verification", "storage_cleanup"]));
    expect(health.subsystems.storage_cleanup).toMatchObject({ last_status: "degraded", last_error: "1 object(s) could not be removed" });
    expect(health.subsystems.storage_cleanup.consecutive_failures).toBeGreaterThanOrEqual(1);
    expect(health.subsystems.production_tasks.last_status).toBe("ok");
    expect(health).toHaveProperty("storageCleanup.deadLettered");
    expect(health).toHaveProperty("outputs.unverified");
    expect(health).toHaveProperty("checkoutPreparations.active");
    expect(Number.isFinite(Number(subsystem(report, "lease_recovery").result.clock && (subsystem(report, "lease_recovery").result.clock as { offsetMs: number }).offsetMs))).toBe(true);
    // Customers and anonymous callers can neither read nor write worker health.
    await expect(t.asUser(USERS.customerA.id, USERS.customerA.email, (db) => db.query("select public.production_health()"))).rejects.toThrow(/permission denied/);
    await expect(t.asUser(USERS.customerA.id, USERS.customerA.email, (db) => db.query("select public.record_worker_subsystems('render','[]')"))).rejects.toThrow(/permission denied/);
    expect((await t.asUser(USERS.customerA.id, USERS.customerA.email, (db) => db.query("select * from public.worker_subsystem_runs"))).rows).toHaveLength(0);
    await expect(t.asAnon((db) => db.query("select * from public.worker_subsystem_runs"))).rejects.toThrow(/permission denied/);
  }, 180_000);
});

describe("poison cleanup objects have a bounded, visible lifecycle", () => {
  let t: TestDatabase;
  let storage: ReturnType<typeof createProductionTestClient>;
  const query = async (sql: string, values: unknown[] = []) => (await t.db.query<Record<string, any>>(sql, values)).rows;
  beforeAll(async () => {
    t = await createTestDatabase();
    await seedCheckoutFixtures(t);
    storage = createProductionTestClient(t);
  }, 120_000);
  afterAll(() => t?.close());

  const cleanupOnly = () => runWorkerPass(productionWorkerSubsystems({ renderLimit: 1, supabase: storage.client, notifications: { transport: null } }).filter((entry) => entry.name === "storage_cleanup"));

  it("backs off, dead-letters after the ceiling, needs an admin to retry, and never loops tightly", async () => {
    const orderId = `order-poison-${randomUUID()}`;
    const lease = (await query("select public.acquire_checkout_preparation($1::uuid,$2,$3,$4,300) as r", [USERS.customerB.id, `s-${orderId}`, "b".repeat(64), orderId]))[0].r;
    const path = `orders/${orderId}/assets/${"c".repeat(64)}`;
    await storage.client.storage.from("order-production").upload(path, Buffer.from("poison"), { upsert: false });
    await t.asService((db) => db.query("select public.release_checkout_preparation($1::uuid,$2::uuid,'TEST_FAILED')", [lease.id, lease.leaseToken]));
    storage.faults.remove = (_bucket, candidate) => candidate === path;

    const first = await cleanupOnly();
    expect(first.subsystems[0].status).toBe("degraded");
    // Not due again immediately: a second pass right away does not touch it.
    const second = await cleanupOnly();
    expect(second.subsystems[0].result).toMatchObject({ claimed: 0 });
    expect((await query("select attempt_count from public.production_storage_cleanup_items where path=$1", [path]))[0].attempt_count).toBe(1);

    for (let attempt = 2; attempt <= 8; attempt++) {
      await t.db.query("update public.production_storage_cleanup_items set next_attempt_at=now() where path=$1", [path]);
      await cleanupOnly();
    }
    const dead = (await query("select * from public.production_storage_cleanup_items where path=$1", [path]))[0];
    expect(dead).toMatchObject({ status: "dead_letter", attempt_count: 8, manual_review_required: true });
    expect(dead.dead_lettered_at).toBeTruthy();
    await t.db.query("update public.production_storage_cleanup_items set next_attempt_at=now() where path=$1", [path]);
    expect((await cleanupOnly()).subsystems[0].result).toMatchObject({ claimed: 0 });
    const health = (await storage.client.rpc("production_health")).data;
    expect(health.storageCleanup).toMatchObject({ deadLettered: 1, manualReviewRequired: 1 });
    expect((await query("select cleanup_status from public.checkout_preparations where order_id=$1", [orderId]))[0].cleanup_status).toBe("pending");

    // Only an admin may retry, with a reason; the action is audited.
    const refused = await storage.client.rpc("review_storage_cleanup_item", { p_id: dead.id, p_actor_id: USERS.customerB.id, p_action: "retry", p_reason: "Storage permissions fixed by ops" });
    expect(refused.error).toBeTruthy();
    await expect(t.asUser(USERS.customerB.id, USERS.customerB.email, (db) => db.query("select public.review_storage_cleanup_item($1,$2,'retry','Storage permissions fixed by ops')", [dead.id, USERS.admin.id]))).rejects.toThrow(/permission denied/);
    const retried = await storage.client.rpc("review_storage_cleanup_item", { p_id: dead.id, p_actor_id: USERS.admin.id, p_action: "retry", p_reason: "Storage permissions fixed by ops" });
    expect(retried.error).toBeNull();
    expect(await count(t, "select 1 from public.production_recovery_audit where target_id=$1 and target_type='storage_cleanup_retry'", [dead.id])).toBe(1);

    storage.faults.remove = undefined;
    const fixed = await cleanupOnly();
    expect(fixed.subsystems[0]).toMatchObject({ status: "ok" });
    expect((await query("select status from public.production_storage_cleanup_items where path=$1", [path]))[0].status).toBe("deleted");
    expect(await count(t, "select 1 from storage.objects where name=$1", [path])).toBe(0);
    expect((await query("select cleanup_status from public.checkout_preparations where order_id=$1", [orderId]))[0].cleanup_status).toBe("done");
  }, 120_000);

  it("a worker that crashes after claiming still spends the attempt, so a crashing object cannot loop forever", async () => {
    const path = `orders/order-crash-${randomUUID()}/assets/${"d".repeat(64)}`;
    await t.db.query("insert into storage.objects(bucket_id,name,created_at) values('order-production',$1,now()-interval '3 days')", [path]);
    for (let attempt = 1; attempt <= 8; attempt++) {
      // Claim, then "crash" (never record an outcome); the lease elapses.
      const claimed = (await storage.client.rpc("claim_storage_cleanup_items", { p_limit: 25 })).data as Array<{ path: string }>;
      expect(claimed.map((entry) => entry.path)).toContain(path);
      await t.db.query("update public.production_storage_cleanup_items set next_attempt_at=now() where path=$1", [path]);
    }
    const claimedAgain = (await storage.client.rpc("claim_storage_cleanup_items", { p_limit: 25 })).data as Array<{ path: string }>;
    expect(claimedAgain.map((entry) => entry.path)).not.toContain(path);
    expect((await query("select status,manual_review_required from public.production_storage_cleanup_items where path=$1", [path]))[0]).toEqual({ status: "dead_letter", manual_review_required: true });
  }, 120_000);

  it("an admin may dismiss an object that must be kept; it is never retried", async () => {
    const path = `orders/order-keep-${randomUUID()}/assets/${"e".repeat(64)}`;
    await t.db.query("insert into storage.objects(bucket_id,name,created_at) values('order-production',$1,now()-interval '3 days')", [path]);
    storage.faults.remove = (_bucket, candidate) => candidate === path;
    await cleanupOnly();
    const item = (await query("select id from public.production_storage_cleanup_items where path=$1", [path]))[0];
    expect((await storage.client.rpc("review_storage_cleanup_item", { p_id: item.id, p_actor_id: USERS.admin.id, p_action: "dismiss", p_reason: "Kept for a legal hold on this order" })).error).toBeNull();
    await t.db.query("update public.production_storage_cleanup_items set next_attempt_at=now() where path=$1", [path]);
    expect((await cleanupOnly()).subsystems[0].result).toMatchObject({ claimed: 0 });
    expect(await count(t, "select 1 from storage.objects where name=$1", [path])).toBe(1);
    storage.faults.remove = undefined;
  }, 120_000);
});
