/**
 * Production health policy: turns production_health() into a verdict for
 * uptime monitoring.
 *
 *   CRITICAL subsystems fulfil customer orders. If one of them is failed,
 *   degraded (some of its items failed) or SKIPPED (it did not run, e.g. the
 *   pass ran out of time), customer work is not being done: UNHEALTHY (503).
 *
 *   MAINTENANCE subsystems keep the system tidy and self-repairing. Their
 *   failure, degradation or skip is reported as DEGRADED (200 with warnings):
 *   production and emails keep working, but someone should look. Their
 *   consequences that DO affect customers (stuck jobs, missing tasks, missing
 *   outputs) are caught separately by the chain checks, which are critical.
 */

export const CRITICAL_SUBSYSTEMS = ["production_tasks", "render_jobs", "notifications"] as const;
export const MAINTENANCE_SUBSYSTEMS = ["lease_recovery", "reconciliation", "output_verification", "storage_cleanup"] as const;

/** The queue section of production_health() that each critical subsystem drains. */
const QUEUE_OF: Record<(typeof CRITICAL_SUBSYSTEMS)[number], string> = {
  production_tasks: "productionTasks",
  render_jobs: "renderJobs",
  notifications: "notificationTasks",
};

export const STALE_WORKER_MINUTES = 15;
export const STALE_TASK_MINUTES = 30;
export const CLOCK_SKEW_LIMIT_MS = 2_000;

type SubsystemState = {
  last_status?: string;
  last_error?: string | null;
  consecutive_failures?: number;
  last_finished_at?: string | null;
  last_success_at?: string | null;
  last_result?: Record<string, unknown> | null;
};

export type SubsystemIssue = {
  subsystem: string;
  classification: "critical" | "maintenance";
  status: string;
  reason: string;
  runId: string | null;
  at: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  pending?: number | null;
  oldestPendingAt?: string | null;
};

export type HealthAssessment = {
  status: "healthy" | "degraded" | "unhealthy";
  httpStatus: 200 | 503;
  /** Customer-impacting: makes the check fail. */
  problems: string[];
  /** Maintenance: reported, does not fail the check. */
  warnings: string[];
  subsystemIssues: SubsystemIssue[];
};

function minutesSince(value: unknown, now: number): number | null {
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? Math.round((now - time) / 60_000) : null;
}

function count(value: unknown): number {
  return Number(value) || 0;
}

type Json = Record<string, unknown>;
/** production_health() is JSON from the database; read it defensively. */
function section(value: unknown, key: string): Json {
  const child = value && typeof value === "object" ? (value as Json)[key] : undefined;
  return child && typeof child === "object" ? (child as Json) : {};
}

export function assessProductionHealth(health: Json, now = Date.now()): HealthAssessment {
  const worker = section(health, "worker");
  const productionTasks = section(health, "productionTasks");
  const renderJobs = section(health, "renderJobs");
  const notificationTasks = section(health, "notificationTasks");
  const chain = section(health, "chain");
  const problems: string[] = [];
  const warnings: string[] = [];
  const subsystemIssues: SubsystemIssue[] = [];

  const lastFinished = minutesSince(worker.last_finished_at, now);
  if (lastFinished === null) problems.push("The production worker has never completed a run (is the Hostinger cron configured?).");
  else if (lastFinished > STALE_WORKER_MINUTES) problems.push(`The production worker last finished ${lastFinished} minutes ago.`);
  if (worker.last_status === "error") problems.push("The last worker run did not process all customer work (a critical subsystem failed or was skipped).");

  const oldestTask = minutesSince(productionTasks.oldestPendingAt, now);
  const oldestJob = minutesSince(renderJobs.oldestPendingAt, now);
  const oldestNotification = minutesSince(notificationTasks.oldestPendingAt, now);
  if (oldestTask !== null && oldestTask > STALE_TASK_MINUTES) problems.push(`A production task has been waiting ${oldestTask} minutes.`);
  if (oldestJob !== null && oldestJob > STALE_TASK_MINUTES) problems.push(`A render job has been waiting ${oldestJob} minutes.`);
  if (count(productionTasks.failed) > 0) problems.push(`${productionTasks.failed} production task(s) failed permanently.`);
  if (count(renderJobs.failed) > 0) problems.push(`${renderJobs.failed} render job(s) failed.`);
  if (count(health.unscheduledSnapshots) > 0) problems.push(`${String(health.unscheduledSnapshots)} ordered design(s) have no production work scheduled.`);
  for (const key of ["missingSnapshots", "legacySnapshots", "missingTasks", "missingJobs", "missingOutputs", "stuckJobs", "staleSnapshots"]) {
    if (count(chain[key]) > 0) problems.push(`${chain[key]} fulfillment chain issue(s): ${key}.`);
  }
  if (count(notificationTasks.failed) > 0) problems.push(`${notificationTasks.failed} notification task(s) require recovery.`);
  if (oldestNotification !== null && oldestNotification > 60) problems.push(`An order email has been waiting ${oldestNotification} minutes (is email configured?).`);
  if (count(section(health, "outputs").invalid) > 0) problems.push(`${section(health, "outputs").invalid} production output(s) failed verification and are being re-rendered.`);

  const subsystems = { ...section(health, "subsystems") } as Record<string, SubsystemState>;
  const critical = new Set<string>(CRITICAL_SUBSYSTEMS);
  // A critical subsystem that has NEVER been recorded did not run either.
  for (const name of CRITICAL_SUBSYSTEMS) {
    if (!subsystems[name] && worker.last_finished_at) {
      subsystems[name] = { last_status: "skipped", last_error: "No run of this subsystem has been recorded." };
    }
  }
  for (const [name, state] of Object.entries(subsystems)) {
    const status = String(state.last_status || "");
    if (!["failed", "degraded", "skipped"].includes(status)) continue;
    const isCritical = critical.has(name);
    const result = (state.last_result || {}) as Record<string, unknown>;
    const queue = isCritical ? section(health, QUEUE_OF[name as (typeof CRITICAL_SUBSYSTEMS)[number]]) : undefined;
    const issue: SubsystemIssue = {
      subsystem: name,
      classification: isCritical ? "critical" : "maintenance",
      status,
      reason: String(state.last_error || result.reason || "").slice(0, 300),
      runId: typeof result.runId === "string" ? result.runId : null,
      at: state.last_finished_at || (typeof result.skippedAt === "string" ? result.skippedAt : null),
      lastSuccessAt: state.last_success_at || null,
      consecutiveFailures: count(state.consecutive_failures),
      ...(isCritical ? { pending: queue ? count(queue.pending) : null, oldestPendingAt: typeof queue?.oldestPendingAt === "string" ? queue.oldestPendingAt : null } : {}),
    };
    subsystemIssues.push(issue);
    const detail = [
      issue.reason && `reason: ${issue.reason}`,
      issue.runId && `run ${issue.runId}`,
      issue.at && `at ${issue.at}`,
      `last success ${issue.lastSuccessAt || "never"}`,
      isCritical && `${issue.pending ?? "unknown"} pending${issue.oldestPendingAt ? `, oldest since ${issue.oldestPendingAt}` : ""}`,
    ].filter(Boolean).join("; ");
    (isCritical ? problems : warnings).push(`${isCritical ? "Critical" : "Maintenance"} worker subsystem ${name} is ${status} (${detail}).`);
  }

  if (count(section(health, "storageCleanup").deadLettered) > 0) warnings.push(`${section(health, "storageCleanup").deadLettered} storage cleanup object(s) need manual review (Admin → production storage cleanup).`);
  if (count(section(health, "checkoutPreparations").expiredActive) > 0) warnings.push(`${section(health, "checkoutPreparations").expiredActive} checkout preparation lease(s) expired and await the worker.`);
  const clock = subsystems.lease_recovery?.last_result?.clock as { offsetMs?: number } | undefined;
  if (clock && Math.abs(Number(clock.offsetMs)) > CLOCK_SKEW_LIMIT_MS) {
    // Leases, JWT validation and signed URLs depend on it: customer-impacting.
    problems.push(`Server clock differs from the database clock by ${Math.round(Number(clock.offsetMs))} ms: synchronize the host clock (NTP).`);
  }

  const status = problems.length ? "unhealthy" : warnings.length ? "degraded" : "healthy";
  return { status, httpStatus: problems.length ? 503 : 200, problems, warnings, subsystemIssues };
}
