/**
 * The FIRST production worker run, rehearsed on the real schema with a
 * backlog shaped like production's (read-only queue summary of 2026-10-10):
 * a checkout lease that expired days ago but is still "preparing", failed
 * checkouts whose files await cleanup, and a finalized order whose
 * production task and e-mails were never processed.
 *
 *   - the read-only queue summary predicts exactly what the run will do;
 *   - one pass expires the lease, removes only UNPINNED abandoned files,
 *     produces and renders the order, and sends each e-mail once;
 *   - repeated passes do nothing more (no duplicate e-mail, job or output);
 *   - a transient database failure in one pass is recovered by the next,
 *     still exactly once.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { createTestDatabase, type TestDatabase } from "@/lib/testing/pglite-supabase";
import { count, seedCheckoutFixtures, USERS } from "@/lib/testing/checkout-fixtures";
import { createProductionTestClient } from "@/lib/testing/pglite-production-client";
import { loadOrderView } from "@/lib/testing/pglite-checkout-deps";
import { placeAutomaticOrder } from "@/lib/testing/production-orders";
import { productionWorkerSubsystems } from "@/lib/outbox/supabase-tasks";
import { runWorkerPass, type WorkerPassReport } from "@/lib/worker/production-worker";
import type { EmailTransport } from "@/lib/notifications/email-provider";
import { queueSummary, QUEUE_COLUMNS } from "../../../scripts/worker/queue-summary.mjs";

vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => { throw new Error("Worker test requires its injected SQL client"); } }));

describe("first production worker run (rehearsal on the real schema)", () => {
  let t: TestDatabase;
  let storage: ReturnType<typeof createProductionTestClient>;
  const sent: Array<{ to: string; key: string }> = [];
  const transport: EmailTransport = {
    async send(message, key) {
      sent.push({ to: message.to, key });
      return { id: `msg-${sent.length}` };
    },
  };
  const query = async (sql: string, values: unknown[] = []) => (await t.db.query<Record<string, any>>(sql, values)).rows;
  const pass = (): Promise<WorkerPassReport> =>
    runWorkerPass(
      productionWorkerSubsystems({ renderLimit: 10, supabase: storage.client, notifications: { transport, adminRecipient: "orders@husnalogy.test", loadOrder: (id) => loadOrderView(t, id) } }),
      { totalBudgetMs: 240_000 },
    );
  const summary = () => queueSummary(async (table: string, columns: string) => query(`select ${columns} from public.${table}`));
  const objectsUnder = (orderId: string) => count(t, "select 1 from storage.objects where bucket_id = 'order-production' and name like $1", [`orders/${orderId}/%`]);

  async function preparationWithFile(orderId: string, customer: { id: string } = USERS.customerC) {
    const lease = (await query("select public.acquire_checkout_preparation($1::uuid,$2,$3,$4,300) as r", [customer.id, `s-${orderId}`, "a".repeat(64), orderId]))[0].r;
    expect(lease.status).toBe("acquired");
    const bytes = Buffer.from(`pinned-before-checkout ${orderId}`);
    await storage.client.storage.from("order-production").upload(`orders/${orderId}/assets/${createHash("sha256").update(bytes).digest("hex")}`, bytes, { upsert: false });
    return { lease, bytes };
  }

  let stuck = "";
  const failed: string[] = [];
  let order: Awaited<ReturnType<typeof placeAutomaticOrder>>;

  beforeAll(async () => {
    t = await createTestDatabase();
    await seedCheckoutFixtures(t);
    storage = createProductionTestClient(t);
    // A lease that expired two days ago but was never reaped (no worker ran;
    // that customer never checked out again, which would also have reaped it).
    stuck = `order-stuck-${randomUUID()}`;
    await preparationWithFile(stuck, USERS.customerB);
    await t.db.query("update public.checkout_preparations set lease_expires_at = now() - interval '2 days', started_at = now() - interval '2 days' where order_id = $1", [stuck]);
    // Two failed checkouts whose files wait for cleanup.
    for (let index = 0; index < 2; index += 1) {
      const orderId = `order-failed-${randomUUID()}`;
      const { lease, bytes } = await preparationWithFile(orderId);
      await t.asService((db) => db.query("select public.release_checkout_preparation($1::uuid,$2::uuid,'TEST_FAILED',1,$3)", [lease.id, lease.leaseToken, bytes.length]));
      failed.push(orderId);
    }
    // A finalized order nobody processed: production task + customer and admin e-mails.
    order = await placeAutomaticOrder(t, storage);
  }, 180_000);
  afterAll(() => t?.close());

  it("the read-only summary shows what the first run would do — before it does anything", async () => {
    const before = await summary();
    expect(before.workerHasRun).toBe(false);
    expect(before.wouldNow).toMatchObject({ sendEmails: 2, runProductionTasks: 1, expireCheckoutLeases: 1, cleanUpAbandonedCheckouts: 2 });
    expect(JSON.stringify(before)).not.toMatch(/@|orders\//); // no recipients, no paths
    expect(Object.values(QUEUE_COLUMNS).join(",")).not.toMatch(/recipient|email|path|payload/);
  });

  it("one pass: expires the stale lease, removes only unpinned abandoned files, produces and renders the order, sends each e-mail once", async () => {
    const report = await pass();
    expect(report.subsystems.find((entry) => entry.name === "production_tasks")?.status).toBe("ok");
    expect(report.subsystems.find((entry) => entry.name === "notifications")?.status).toBe("ok");
    expect((await query("select status from public.checkout_preparations where order_id = $1", [stuck]))[0].status).not.toBe("preparing");
    expect((await query("select status from public.production_tasks where snapshot_id = $1", [order.snapshot.id]))[0].status).toBe("completed");
    expect((await query("select status from public.customizer_render_jobs where snapshot_id = $1", [order.snapshot.id]))[0].status).toBe("completed");
    expect(await count(t, "select 1 from public.customizer_render_outputs where snapshot_id = $1 and status = 'ready'", [order.snapshot.id])).toBeGreaterThan(0);
    expect((await query("select status from public.notification_tasks where order_id = $1", [order.orderId])).map((row) => row.status)).toEqual(["sent", "sent"]);
    expect(new Set(sent.map((entry) => entry.key)).size).toBe(sent.length);
    for (const orderId of failed) expect(await objectsUnder(orderId), orderId).toBe(0);
    // The real order's pinned production files are never cleanup candidates.
    expect(await objectsUnder(order.orderId)).toBeGreaterThan(0);
  }, 180_000);

  it("repeated passes do nothing more: no second e-mail, render job or output; the stale lease's files are cleaned", async () => {
    const emails = sent.length;
    const jobs = await count(t, "select 1 from public.customizer_render_jobs");
    const outputs = await count(t, "select 1 from public.customizer_render_outputs");
    await pass();
    await pass();
    expect(sent.length).toBe(emails);
    expect(await count(t, "select 1 from public.customizer_render_jobs")).toBe(jobs);
    expect(await count(t, "select 1 from public.customizer_render_outputs")).toBe(outputs);
    expect(await objectsUnder(stuck)).toBe(0);
    expect((await summary()).wouldNow).toMatchObject({ sendEmails: 0, runProductionTasks: 0, renderJobs: 0, expireCheckoutLeases: 0 });
  }, 180_000);

  it("a transient database failure in one pass is recovered by the next, still exactly once", async () => {
    const next = await placeAutomaticOrder(t, storage, { color: "#2255aa" });
    const emails = sent.length;
    storage.faults.rpc = (name) => name === "claim_notification_tasks";
    const broken = await pass();
    expect(broken.subsystems.find((entry) => entry.name === "notifications")?.status).toBe("failed");
    expect(broken.subsystems.find((entry) => entry.name === "production_tasks")?.status).toBe("ok");
    expect(sent.length).toBe(emails);
    storage.faults.rpc = undefined;
    await pass();
    await pass();
    expect((await query("select status from public.notification_tasks where order_id = $1", [next.orderId])).map((row) => row.status)).toEqual(["sent", "sent"]);
    expect(sent.length).toBe(emails + 2);
  }, 180_000);
});
