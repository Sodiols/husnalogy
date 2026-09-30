import { withAdminMutation } from "@/lib/security/admin-mutation";
import { requireAdmin } from "@/lib/auth/admin-server";
import { RENDER_WORKER_DEFAULT_BATCH, RENDER_WORKER_MAX_BATCH, runRenderWorker } from "@/lib/customizer/render-jobs";
import { runOutboxPass } from "@/lib/outbox/supabase-tasks";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { hasWorkerSecret } from "@/lib/security/worker-auth";
import { bodyErrorResponse, readJsonBody } from "@/lib/http/read-body";
import { logEvent } from "@/lib/observability/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Production worker — platform independent (Hostinger cron every 5 minutes;
 * see HOSTINGER_DEPLOYMENT.md §5), or manually by a signed-in admin.
 *
 * Each run:
 *   1. records a heartbeat (worker_runs) — visible in production_health();
 *   2. recovers finalized snapshots that never got production work;
 *   3. drains due production tasks (outbox → render jobs) and notification
 *      tasks (outbox → email);
 *   4. processes render jobs.
 *
 * Authentication: `Authorization: Bearer <CRON_SECRET|RENDER_WORKER_SECRET>`
 * or `x-render-secret`, compared in constant time and never read from the URL;
 * POST additionally accepts an admin session. Anonymous requests get 401.
 *
 * Responses: 200 run finished · 401 not authorized · 409 a run is already in
 * progress in this server process · 500 the run failed.
 */

function parseLimit(raw: unknown): number {
  const value = Math.floor(Number(raw));
  if (!Number.isFinite(value) || value < 1) return RENDER_WORKER_DEFAULT_BATCH;
  return Math.min(RENDER_WORKER_MAX_BATCH, value);
}

// One run at a time per server process. Runs in OTHER processes are already
// safe — every job and task is claimed atomically under a database lease.
let activeRun: Promise<unknown> | null = null;

async function heartbeat(phase: "start" | "finish", status?: string, result: Record<string, unknown> = {}) {
  try {
    const supabase = createServiceRoleClient();
    const { error } = await supabase.rpc("record_worker_run", { p_worker: "render", p_phase: phase, p_status: status ?? null, p_result: result });
    if (error) throw error;
  } catch (error) {
    logEvent("error", "worker.heartbeat_failed", { phase, error });
  }
}

async function runWorker(limit: number) {
  if (activeRun) {
    return Response.json({ ok: false, error: "A render worker run is already in progress.", busy: true }, { status: 409 });
  }

  const run = (async () => {
    const started = Date.now();
    await heartbeat("start");
    const outbox = await runOutboxPass({ limit: 25, timeBudgetMs: 60_000 });
    const render = await runRenderWorker({ limit, timeBudgetMs: Math.max(1000, 240_000 - (Date.now() - started)) });
    return { outbox, render };
  })();
  activeRun = run;
  try {
    const { outbox, render } = await run;
    const summary = {
      recoveredSnapshots: outbox.recovered,
      outputVerification: outbox.outputVerification,
      storageCleanup: outbox.storageCleanup,
      productionTasks: { completed: outbox.production.completed, failed: outbox.production.failed.length },
      notifications: { sent: outbox.notifications.completed, deferred: outbox.notifications.deferred, failed: outbox.notifications.failed.length },
      renderJobs: { processed: render.jobs.length, failed: render.failures.length, remaining: render.remaining },
    };
    const failed = outbox.production.failed.length || outbox.notifications.failed.length || render.failures.length || render.jobs.some((job) => ["failed", "retrying", "cancelled"].includes(job.status));
    await heartbeat("finish", failed ? "error" : "ok", summary);
    if (outbox.production.failed.length || render.failures.length) {
      logEvent("error", "worker.run_had_failures", summary);
    }
    return Response.json({
      ok: !failed,
      processed: render.jobs.map((job) => ({ id: job.id, jobType: job.jobType, status: job.status, errorCode: job.errorCode })),
      failures: render.failures,
      recovered: render.recovered,
      remaining: render.remaining,
      stoppedReason: render.stoppedReason,
      durationMs: render.durationMs,
      outbox: summary,
    });
  } catch (error) {
    await heartbeat("finish", "error", { error: error instanceof Error ? error.message : String(error) });
    logEvent("error", "worker.run_failed", { error });
    return Response.json({ ok: false, error: "Render processing failed." }, { status: 500 });
  } finally {
    activeRun = null;
  }
}

// Scheduled entry (Hostinger cron). Secret only: no admin-session fallback on
// GET, so a stray browser request can never start production work.
export async function GET(request: Request) {
  if (!hasWorkerSecret(request)) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  return runWorker(parseLimit(new URL(request.url).searchParams.get("limit")));
}

// Manual or scheduled entry. Accepts the worker secret, or an admin session
// for the dashboard's "process now" action.
export const POST = withAdminMutation(async function POST(request: Request) {
  if (!hasWorkerSecret(request)) {
    const admin = await requireAdmin();
    if (!admin.ok) return admin.response;
  }

  let body: unknown = {};
  if (request.headers.get("content-length") !== "0" && request.body) {
    try {
      body = await readJsonBody(request, 1024);
    } catch (error) {
      const response = bodyErrorResponse(error);
      if (response && response.status === 413) return response;
      body = {};
    }
  }
  const limit = body && typeof body === "object" ? (body as { limit?: unknown }).limit : undefined;
  return runWorker(parseLimit(limit));
}, { maxBytes: 1024 * 1024, worker: true });
