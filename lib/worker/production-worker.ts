/**
 * The production worker pass: independent subsystems, run in a fixed order,
 * each isolated from every other.
 *
 *   1. lease_recovery       expired render leases, abandoned checkout preparations
 *   2. production_tasks     outbox → render jobs / manual hand-off   (critical)
 *   3. render_jobs          render print files                     (critical)
 *   4. notifications        order emails                           (critical)
 *   5. reconciliation       repair missing chain links
 *   6. output_verification  stored bytes still match their checksums
 *   7. storage_cleanup      remove abandoned copies, one object at a time
 *
 * A subsystem that throws is recorded as `failed` (logged, reported to
 * monitoring, stored in worker health) and the pass continues with the next
 * one: a storage outage, a poison cleanup object or a verification error can
 * never stop production tasks, rendering or customer emails, and a failing
 * email provider can never stop production. Every subsystem is retry safe:
 * its work items are leased in the database and re-claimed by the next run.
 *
 * Time: the cron client gives up after 290 s, so the pass has a fixed budget
 * and later critical subsystems have time RESERVED for them — a slow render
 * queue cannot starve the notification queue.
 */

import { randomUUID } from "node:crypto";
import { logEvent } from "@/lib/observability/logger";
import { captureError } from "@/lib/observability/monitor";

export type SubsystemName =
  | "lease_recovery"
  | "production_tasks"
  | "render_jobs"
  | "notifications"
  | "reconciliation"
  | "output_verification"
  | "storage_cleanup";

export type SubsystemStatus = "ok" | "degraded" | "failed" | "skipped";

export type SubsystemOutcome = {
  /** `degraded`: the subsystem ran, but some of its items failed (recorded, retried). */
  status?: "ok" | "degraded";
  result: Record<string, unknown>;
  /** A summary of item failures when degraded. */
  error?: string;
};

export type WorkerSubsystem = {
  name: SubsystemName;
  /** Business critical: its failure makes the pass `error`, not `degraded`. */
  critical: boolean;
  /** Upper bound for this subsystem. */
  maxMs: number;
  /** Minimum useful budget; below it the subsystem is skipped (and recorded). */
  minMs?: number;
  run(budgetMs: number): Promise<SubsystemOutcome>;
};

export type SubsystemReport = {
  name: SubsystemName;
  critical: boolean;
  status: SubsystemStatus;
  startedAt: string;
  durationMs: number;
  error?: string;
  result: Record<string, unknown>;
};

export type WorkerPassReport = {
  /** Identifies this pass in worker health and logs. */
  runId: string;
  status: "ok" | "degraded" | "error";
  startedAt: string;
  durationMs: number;
  subsystems: SubsystemReport[];
};

export const WORKER_TOTAL_BUDGET_MS = 270_000;

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error);
  return String(message || "Unknown error").slice(0, 500);
}

/**
 * Run the subsystems in order. Never throws: every failure is contained in
 * its subsystem's report. `reserveAfter[i]` is the time kept free for the
 * subsystems after `i`.
 */
export async function runWorkerPass(
  subsystems: WorkerSubsystem[],
  options: { totalBudgetMs?: number; now?: () => number; runId?: string } = {},
): Promise<WorkerPassReport> {
  const now = options.now || Date.now;
  const runId = options.runId || randomUUID();
  const started = now();
  const deadline = started + (options.totalBudgetMs ?? WORKER_TOTAL_BUDGET_MS);
  const reports: SubsystemReport[] = [];

  for (let index = 0; index < subsystems.length; index++) {
    const subsystem = subsystems[index];
    // Time kept for every LATER subsystem's minimum, so none is starved.
    const reserved = subsystems.slice(index + 1).reduce((sum, later) => sum + (later.minMs ?? 1_000), 0);
    const budgetMs = Math.min(subsystem.maxMs, deadline - now() - reserved);
    const startedAt = new Date(now()).toISOString();
    const t0 = now();

    if (budgetMs < (subsystem.minMs ?? 1_000)) {
      const reason = "time budget exhausted: earlier subsystems used the pass budget";
      reports.push({ name: subsystem.name, critical: subsystem.critical, status: "skipped", startedAt, durationMs: 0, error: `Skipped: ${reason}`, result: { runId, reason, budgetMs: Math.max(0, budgetMs), skippedAt: startedAt } });
      // A skipped critical subsystem means customer work did not run: error level (monitoring).
      logEvent(subsystem.critical ? "error" : "warn", "worker.subsystem_skipped", { runId, subsystem: subsystem.name, critical: subsystem.critical, budgetMs, ...(subsystem.critical ? { error: new Error(`Critical worker subsystem ${subsystem.name} skipped: ${reason}`) } : {}) });
      continue;
    }

    try {
      const outcome = await subsystem.run(budgetMs);
      const status = outcome.status || "ok";
      reports.push({ name: subsystem.name, critical: subsystem.critical, status, startedAt, durationMs: now() - t0, result: { runId, ...outcome.result }, ...(outcome.error ? { error: outcome.error.slice(0, 500) } : {}) });
      if (status === "degraded") logEvent("warn", "worker.subsystem_degraded", { subsystem: subsystem.name, error: outcome.error, result: outcome.result });
    } catch (error) {
      const message = errorMessage(error);
      reports.push({ name: subsystem.name, critical: subsystem.critical, status: "failed", startedAt, durationMs: now() - t0, error: message, result: { runId } });
      if (subsystem.critical) {
        // Error level: logged and reported to monitoring.
        logEvent("error", "worker.subsystem_failed", { subsystem: subsystem.name, stage: subsystem.name, error });
      } else {
        // Maintenance: a warning, still reported to monitoring and health.
        logEvent("warn", "worker.maintenance_failed", { subsystem: subsystem.name, error: message });
        void captureError(error, { event: "worker.maintenance_failed", level: "warning", tags: { stage: subsystem.name } });
      }
    }
  }

  // A critical subsystem that failed or did not run at all is an error: customer
  // work (production, rendering, order emails) was not processed this pass.
  const status = reports.some((report) => report.critical && (report.status === "failed" || report.status === "skipped"))
    ? "error"
    : reports.some((report) => report.status === "failed" || report.status === "degraded" || report.status === "skipped")
      ? "degraded"
      : "ok";
  return { runId, status, startedAt: new Date(started).toISOString(), durationMs: now() - started, subsystems: reports };
}
