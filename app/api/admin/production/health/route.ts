import { requireAdmin } from "@/lib/auth/admin-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { hasWorkerSecret } from "@/lib/security/worker-auth";
import { logEvent } from "@/lib/observability/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A worker that has not finished a run for this long is considered down. */
const STALE_WORKER_MINUTES = 15;
/** Pending production work older than this means nothing is draining it. */
const STALE_TASK_MINUTES = 30;

function minutesSince(value: unknown): number | null {
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? Math.round((Date.now() - time) / 60_000) : null;
}

/**
 * GET /api/admin/production/health — worker and queue health for uptime
 * monitoring. Worker secret (for an external monitor) or admin session.
 * Returns 503 when something needs attention so a plain HTTP check alerts.
 */
export async function GET(request: Request) {
  if (!hasWorkerSecret(request)) {
    const admin = await requireAdmin();
    if (!admin.ok) return admin.response;
  }
  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase.rpc("production_health");
    if (error) throw error;
    const health = (data || {}) as Record<string, any>;

    const lastFinished = minutesSince(health.worker?.last_finished_at);
    const oldestTask = minutesSince(health.productionTasks?.oldestPendingAt);
    const oldestJob = minutesSince(health.renderJobs?.oldestPendingAt);
    const oldestNotification = minutesSince(health.notificationTasks?.oldestPendingAt);
    const problems: string[] = [];
    if (lastFinished === null) problems.push("The production worker has never completed a run (is the Hostinger cron configured?).");
    else if (lastFinished > STALE_WORKER_MINUTES) problems.push(`The production worker last finished ${lastFinished} minutes ago.`);
    if (health.worker?.last_status === "error") problems.push("The last worker run failed.");
    if (oldestTask !== null && oldestTask > STALE_TASK_MINUTES) problems.push(`A production task has been waiting ${oldestTask} minutes.`);
    if (oldestJob !== null && oldestJob > STALE_TASK_MINUTES) problems.push(`A render job has been waiting ${oldestJob} minutes.`);
    if (Number(health.productionTasks?.failed) > 0) problems.push(`${health.productionTasks.failed} production task(s) failed permanently.`);
    if (Number(health.renderJobs?.failed) > 0) problems.push(`${health.renderJobs.failed} render job(s) failed.`);
    if (Number(health.unscheduledSnapshots) > 0) problems.push(`${health.unscheduledSnapshots} ordered design(s) have no production work scheduled.`);
    for (const key of ["missingSnapshots", "legacySnapshots", "missingTasks", "missingJobs", "missingOutputs", "stuckJobs", "staleSnapshots"]) {
      if (Number(health.chain?.[key]) > 0) problems.push(`${health.chain[key]} fulfillment chain issue(s): ${key}.`);
    }
    if (Number(health.notificationTasks?.failed) > 0) problems.push(`${health.notificationTasks.failed} notification task(s) require recovery.`);
    if (oldestNotification !== null && oldestNotification > 60) problems.push(`An order email has been waiting ${oldestNotification} minutes (is email configured?).`);

    return Response.json(
      { ok: problems.length === 0, problems, health },
      { status: problems.length ? 503 : 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logEvent("error", "production.health_failed", { error });
    return Response.json({ ok: false, problems: ["Health could not be read."] }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
