/**
 * Production wiring of the outbox (server only): Supabase-backed task stores,
 * the post-checkout fast path, and the scheduled worker pass.
 */

import { createServiceRoleClient } from "@/lib/supabase/server";
import { processTasks, type ProcessResult, type TaskStore } from "@/lib/outbox/processor";
import { runProductionTask, type ProductionTaskRow } from "@/lib/customizer/order-snapshots";
import { makeNotificationRunner, type NotificationTask } from "@/lib/notifications/notification-runner";
import { adminNotificationRecipient, getEmailTransport, type EmailTransport } from "@/lib/notifications/email-provider";
import { orderFromRow, type OrderView } from "@/lib/orders/order-view";
import { getSettings } from "@/lib/settings";
import { logEvent } from "@/lib/observability/logger";
import { verifyProductionOutputs } from "@/lib/customizer/server/production-output-verification";
import { cleanupProductionStorage } from "@/lib/customizer/server/production-storage-cleanup";
import type { WorkerSubsystem } from "@/lib/worker/production-worker";

type Supabase = ReturnType<typeof createServiceRoleClient>;

export function productionTaskStore(supabase: Supabase): TaskStore<ProductionTaskRow> {
  return {
    async claim(limit, orderId) {
      const { data, error } = await supabase.rpc("claim_production_tasks", { p_limit: limit, p_lease_seconds: 300, p_order_id: orderId ?? null });
      if (error) throw error;
      return (data || []) as ProductionTaskRow[];
    },
    async complete(task) {
      const { error } = await supabase.rpc("finish_production_task", { p_id: task.id, p_lock_token: task.lock_token, p_error: null });
      if (error) throw error;
    },
    async fail(task, message) {
      const { data, error } = await supabase.rpc("finish_production_task", { p_id: task.id, p_lock_token: task.lock_token, p_error: message });
      if (error) throw error;
      return (data as string) || null;
    },
  };
}

export function notificationTaskStore(supabase: Supabase): TaskStore<NotificationTask> {
  return {
    async claim(limit, orderId) {
      const { data, error } = await supabase.rpc("claim_notification_tasks", { p_limit: limit, p_lease_seconds: 120, p_order_id: orderId ?? null });
      if (error) throw error;
      return (data || []) as NotificationTask[];
    },
    async complete(task, reference) {
      const { error } = await supabase.rpc("finish_notification_task", { p_id: task.id, p_lock_token: task.lock_token, p_error: null, p_provider_message_id: reference ?? null });
      if (error) throw error;
    },
    async fail(task, message) {
      const { data, error } = await supabase.rpc("finish_notification_task", { p_id: task.id, p_lock_token: task.lock_token, p_error: message });
      if (error) throw error;
      return (data as string) || null;
    },
    async defer(task, reason) {
      const { error } = await supabase.rpc("defer_notification_task", { p_id: task.id, p_lock_token: task.lock_token, p_reason: reason });
      if (error) throw error;
    },
  };
}

/** Test seams for the notification runner (production uses the defaults). */
export type NotificationOverrides = { transport?: EmailTransport | null; adminRecipient?: string; loadOrder?: (orderId: string) => Promise<OrderView | null> };

async function notificationRunner(supabase: Supabase, overrides: NotificationOverrides = {}) {
  let storeEmail = "";
  try {
    storeEmail = (await getSettings())?.store?.email || "";
  } catch (error) {
    logEvent("warn", "notification.settings_unavailable", { error });
  }
  return makeNotificationRunner({
    transport: overrides.transport !== undefined ? overrides.transport : getEmailTransport(),
    adminRecipient: overrides.adminRecipient ?? adminNotificationRecipient(storeEmail),
    async prepareDelivery(task, message) {
      const { data, error } = await supabase.rpc("prepare_notification_delivery", { p_id: task.id, p_lock_token: task.lock_token, p_message: message });
      if (error || !data) throw error || new Error("notification-lease-lost");
      return { message: data.message, firstAttemptAt: data.firstAttemptAt };
    },
    async recordDelivery(task, providerId) {
      const { data, error } = await supabase.rpc("record_notification_delivery", { p_id: task.id, p_lock_token: task.lock_token, p_provider_id: providerId });
      if (error || !data) throw error || new Error("notification-lease-lost");
    },
    async loadOrder(orderId) {
      if (overrides.loadOrder) return overrides.loadOrder(orderId);
      const { data, error } = await supabase.from("orders").select("*,order_items(*)").eq("id", orderId).maybeSingle();
      if (error) throw error;
      return data ? orderFromRow(data) : null;
    },
  });
}

/**
 * Fast path right after checkout commits; the worker finishes anything left.
 * Production and email are independent: a failure to claim production work
 * never prevents the confirmation email, and vice versa.
 */
export async function runOrderFollowUps(orderId: string): Promise<void> {
  const supabase = createServiceRoleClient();
  try {
    await processTasks("production", productionTaskStore(supabase), (task) => runProductionTask(task, supabase).then(() => ({ kind: "done" as const })), {
      orderId,
      limit: 20,
      timeBudgetMs: 20_000,
    });
  } catch (error) {
    logEvent("error", "checkout.post_order_task_failed", { orderId, stage: "production_fast_path", error });
  }
  try {
    await processTasks("notification", notificationTaskStore(supabase), await notificationRunner(supabase), { orderId, limit: 5, timeBudgetMs: 15_000 });
  } catch (error) {
    logEvent("error", "checkout.post_order_task_failed", { orderId, stage: "notification_fast_path", error });
  }
}

function failureSummary(result: ProcessResult): string | undefined {
  if (!result.failed.length) return undefined;
  return `${result.failed.length} task(s) failed and will be retried: ${result.failed.slice(0, 3).map((entry) => entry.error).join(" | ")}`;
}

function taskResult(result: ProcessResult) {
  return { claimed: result.claimed, completed: result.completed, deferred: result.deferred, failed: result.failed.length, permanentlyFailed: result.failed.filter((entry) => entry.status === "failed").length };
}

/** Database clock offset (local minus database), for lease/JWT/cron skew. */
export async function measureDatabaseClockOffset(supabase: Supabase): Promise<{ offsetMs: number; roundTripMs: number; databaseNow: string }> {
  const t0 = Date.now();
  const { data, error } = await supabase.rpc("server_clock");
  const t1 = Date.now();
  if (error) throw error;
  const databaseNow = String((data as { now?: unknown } | null)?.now || "");
  const database = Date.parse(databaseNow);
  if (!Number.isFinite(database)) throw new Error("server_clock returned no time");
  return { offsetMs: Math.round((t0 + t1) / 2 - database), roundTripMs: t1 - t0, databaseNow };
}

/**
 * The scheduled worker's subsystems, in execution order (see
 * lib/worker/production-worker.ts for isolation, budgets and health).
 */
export function productionWorkerSubsystems(options: { renderLimit: number; supabase?: Supabase; notifications?: NotificationOverrides }): WorkerSubsystem[] {
  const supabase = options.supabase || createServiceRoleClient();
  return [
    {
      name: "lease_recovery",
      critical: false,
      maxMs: 15_000,
      async run() {
        // Each recovery is independent; one failing never skips the other.
        const result: Record<string, unknown> = {};
        const errors: string[] = [];
        const step = async (key: string, work: () => Promise<unknown>) => {
          try { result[key] = await work(); }
          catch (error) { errors.push(`${key}: ${error instanceof Error ? error.message : String(error)}`); }
        };
        await step("renderLeasesRecovered", async () => {
          const { data, error } = await supabase.rpc("recover_abandoned_customizer_render_jobs");
          if (error) throw error;
          return Number(data) || 0;
        });
        await step("checkoutPreparationsExpired", async () => {
          const { data, error } = await supabase.rpc("expire_checkout_preparations", { p_limit: 200 });
          if (error) throw error;
          const expired = Number(data) || 0;
          if (expired) logEvent("info", "checkout.preparation_lease_expired", { count: expired });
          return expired;
        });
        await step("clock", () => measureDatabaseClockOffset(supabase));
        if (errors.length === 3) throw new Error(errors.join(" | "));
        return { status: errors.length ? "degraded" : "ok", result, ...(errors.length ? { error: errors.join(" | ") } : {}) };
      },
    },
    {
      name: "production_tasks",
      critical: true,
      maxMs: 40_000,
      minMs: 5_000,
      async run(budgetMs) {
        const result = await processTasks("production", productionTaskStore(supabase), (task) => runProductionTask(task, supabase).then(() => ({ kind: "done" as const })), {
          limit: 25,
          timeBudgetMs: budgetMs,
        });
        return { status: result.failed.length ? "degraded" : "ok", result: taskResult(result), error: failureSummary(result) };
      },
    },
    {
      name: "render_jobs",
      critical: true,
      maxMs: 200_000,
      minMs: 5_000,
      async run(budgetMs) {
        const { runRenderWorker } = await import("@/lib/customizer/render-jobs");
        const render = await runRenderWorker({ limit: options.renderLimit, timeBudgetMs: budgetMs, skipRecovery: true, supabase: options.supabase });
        const failedJobs = render.jobs.filter((job) => ["failed", "retrying", "cancelled"].includes(job.status));
        const degraded = render.failures.length > 0 || failedJobs.length > 0;
        return {
          status: degraded ? "degraded" : "ok",
          result: {
            processed: render.jobs.length,
            failed: render.failures.length + failedJobs.length,
            remaining: render.remaining,
            stoppedReason: render.stoppedReason,
            jobs: render.jobs.slice(0, 20).map((job) => ({ id: job.id, jobType: job.jobType, status: job.status, errorCode: job.errorCode })),
          },
          ...(degraded ? { error: `${render.failures.length + failedJobs.length} render job(s) failed and will be retried or reviewed.` } : {}),
        };
      },
    },
    {
      name: "notifications",
      critical: true,
      maxMs: 30_000,
      minMs: 5_000,
      async run(budgetMs) {
        const result = await processTasks("notification", notificationTaskStore(supabase), await notificationRunner(supabase, options.notifications), { limit: 25, timeBudgetMs: budgetMs });
        return { status: result.failed.length ? "degraded" : "ok", result: taskResult(result), error: failureSummary(result) };
      },
    },
    {
      name: "reconciliation",
      critical: false,
      maxMs: 15_000,
      async run() {
        const { data, error } = await supabase.rpc("reconcile_production", { p_older_than_seconds: 600 });
        if (error) throw error;
        return { result: { repaired: Number(data) || 0 } };
      },
    },
    {
      name: "output_verification",
      critical: false,
      maxMs: 20_000,
      async run(budgetMs) {
        const result = await verifyProductionOutputs(supabase, 10, budgetMs);
        return { status: result.errors ? "degraded" : "ok", result, ...(result.errors ? { error: `${result.errors} output(s) could not be verified: ${result.failures[0]?.error || ""}` } : {}) };
      },
    },
    {
      name: "storage_cleanup",
      critical: false,
      maxMs: 15_000,
      async run(budgetMs) {
        const result = await cleanupProductionStorage(supabase, { limit: 25, timeBudgetMs: budgetMs });
        return {
          status: result.failed ? "degraded" : "ok",
          result,
          ...(result.failed ? { error: `${result.failed} object(s) could not be removed (${result.deadLettered} dead-lettered): ${result.failures[0]?.error || ""}` } : {}),
        };
      },
    },
  ];
}

