/**
 * Durable task processing (transactional outbox consumer).
 *
 * Tasks are written by the checkout transaction itself, so they exist if and
 * only if the order committed. This loop claims due tasks under a database
 * lease (`FOR UPDATE SKIP LOCKED`), runs them, and records the outcome:
 *
 *   success → completed/sent (never claimed again)
 *   error   → back to pending with exponential backoff, or failed after the
 *             attempt ceiling (visible in production_health())
 *   defer   → back to pending without spending an attempt (e.g. no email
 *             provider configured yet)
 *   crash   → the lease expires and the next run reclaims the task
 *
 * The same function serves the post-checkout fast path (scoped to one order)
 * and the scheduled worker (all due tasks). Running it twice, or in two
 * processes at once, cannot run one task twice concurrently, and each task
 * action is itself idempotent.
 */

import { logEvent } from "@/lib/observability/logger";

export type LeasedTask = { id: string; lock_token: string; attempt_count: number; order_id: string };

export type TaskOutcome = { kind: "done"; reference?: string } | { kind: "defer"; reason: string };

export interface TaskStore<T extends LeasedTask> {
  claim(limit: number, orderId?: string): Promise<T[]>;
  complete(task: T, reference?: string): Promise<void>;
  fail(task: T, error: string): Promise<string | null>;
  defer?(task: T, reason: string): Promise<void>;
}

export type ProcessResult = { claimed: number; completed: number; deferred: number; failed: Array<{ id: string; error: string; status: string | null }> };

export async function processTasks<T extends LeasedTask>(
  name: string,
  store: TaskStore<T>,
  run: (task: T) => Promise<TaskOutcome>,
  options: { limit?: number; orderId?: string; timeBudgetMs?: number } = {},
): Promise<ProcessResult> {
  const startedAt = Date.now();
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 25)));
  const budget = Math.max(1_000, options.timeBudgetMs ?? 60_000);
  const result: ProcessResult = { claimed: 0, completed: 0, deferred: 0, failed: [] };

  while (result.claimed < limit && Date.now() - startedAt < budget) {
    const tasks = await store.claim(Math.min(10, limit - result.claimed), options.orderId);
    if (!tasks.length) break;
    result.claimed += tasks.length;

    for (const task of tasks) {
      try {
        const outcome = await run(task);
        if (outcome.kind === "defer" && store.defer) {
          await store.defer(task, outcome.reason);
          result.deferred += 1;
        } else {
          await store.complete(task, outcome.kind === "done" ? outcome.reference : undefined);
          result.completed += 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        let status: string | null = null;
        try {
          status = await store.fail(task, message);
        } catch (recordError) {
          // The lease expires and the task is retried; nothing is lost.
          logEvent("error", `${name}.record_failure_failed`, { taskId: task.id, orderId: task.order_id, error: recordError });
        }
        result.failed.push({ id: task.id, error: message.slice(0, 300), status });
        logEvent(status === "failed" ? "error" : "warn", `${name}.task_failed`, {
          taskId: task.id,
          orderId: task.order_id,
          attempt: task.attempt_count,
          finalStatus: status,
          error: message,
        });
      }
    }
  }
  return result;
}
