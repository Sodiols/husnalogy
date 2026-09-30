/**
 * Production wiring of the outbox (server only): Supabase-backed task stores,
 * the post-checkout fast path, and the scheduled worker pass.
 */

import { createServiceRoleClient } from "@/lib/supabase/server";
import { processTasks, type ProcessResult, type TaskStore } from "@/lib/outbox/processor";
import { runProductionTask, type ProductionTaskRow } from "@/lib/customizer/order-snapshots";
import { makeNotificationRunner, type NotificationTask } from "@/lib/notifications/notification-runner";
import { adminNotificationRecipient, getEmailTransport } from "@/lib/notifications/email-provider";
import { orderFromRow } from "@/lib/orders/order-view";
import { getSettings } from "@/lib/settings";
import { logEvent } from "@/lib/observability/logger";

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

async function notificationRunner(supabase: Supabase) {
  let storeEmail = "";
  try {
    storeEmail = (await getSettings())?.store?.email || "";
  } catch (error) {
    logEvent("warn", "notification.settings_unavailable", { error });
  }
  return makeNotificationRunner({
    transport: getEmailTransport(),
    adminRecipient: adminNotificationRecipient(storeEmail),
    async loadOrder(orderId) {
      const { data, error } = await supabase.from("orders").select("*,order_items(*)").eq("id", orderId).maybeSingle();
      if (error) throw error;
      return data ? orderFromRow(data) : null;
    },
  });
}

/** Fast path right after checkout commits; the worker finishes anything left. */
export async function runOrderFollowUps(orderId: string): Promise<void> {
  const supabase = createServiceRoleClient();
  await processTasks("production", productionTaskStore(supabase), (task) => runProductionTask(task).then(() => ({ kind: "done" as const })), {
    orderId,
    limit: 20,
    timeBudgetMs: 20_000,
  });
  await processTasks("notification", notificationTaskStore(supabase), await notificationRunner(supabase), { orderId, limit: 5, timeBudgetMs: 15_000 });
}

export type OutboxPassResult = { recovered: number; production: ProcessResult; notifications: ProcessResult };

/** Scheduled worker pass: recover unscheduled snapshots, then drain due tasks. */
export async function runOutboxPass(options: { limit?: number; timeBudgetMs?: number } = {}): Promise<OutboxPassResult> {
  const supabase = createServiceRoleClient();
  const { data: recovered, error: recoveryError } = await supabase.rpc("enqueue_missing_production_tasks", { p_older_than_seconds: 600 });
  if (recoveryError) throw recoveryError;
  const production = await processTasks(
    "production",
    productionTaskStore(supabase),
    (task) => runProductionTask(task).then(() => ({ kind: "done" as const })),
    { limit: options.limit ?? 25, timeBudgetMs: options.timeBudgetMs ?? 60_000 },
  );
  const notifications = await processTasks("notification", notificationTaskStore(supabase), await notificationRunner(supabase), {
    limit: options.limit ?? 25,
    timeBudgetMs: 30_000,
  });
  return { recovered: Number(recovered) || 0, production, notifications };
}
