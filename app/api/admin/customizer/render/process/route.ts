import { withAdminMutation } from "@/lib/security/admin-mutation";
import { requireAdmin } from "@/lib/auth/admin-server";
import { RENDER_WORKER_DEFAULT_BATCH, RENDER_WORKER_MAX_BATCH } from "@/lib/customizer/render-jobs";
import { productionWorkerSubsystems } from "@/lib/outbox/supabase-tasks";
import { runWorkerPass, type WorkerPassReport } from "@/lib/worker/production-worker";
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
 * Each run records a heartbeat (worker_runs), then runs these subsystems in
 * order, each ISOLATED from the others (lib/worker/production-worker.ts):
 *   lease recovery → production tasks → render jobs → notifications →
 *   reconciliation → output verification → storage cleanup.
 * A failing subsystem (for example a storage outage during cleanup) is
 * recorded in worker health and the rest still run. Per-subsystem health is
 * stored in worker_subsystem_runs and served by production_health().
 *
 * Authentication: `Authorization: Bearer <CRON_SECRET|RENDER_WORKER_SECRET>`
 * or `x-render-secret`, compared in constant time and never read from the URL;
 * POST additionally accepts an admin session. Anonymous requests get 401.
 *
 * Responses: 200 pass completed (status ok or degraded) · 401 not authorized ·
 * 409 a run is already in progress in this server process · 503 a critical
 * subsystem (production, render or notifications) failed · 500 unexpected.
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

async function recordSubsystems(report: WorkerPassReport) {
  try {
    const { error } = await createServiceRoleClient().rpc("record_worker_subsystems", {
      p_worker: "render",
      p_subsystems: report.subsystems.map((subsystem) => ({
        name: subsystem.name,
        status: subsystem.status,
        startedAt: subsystem.startedAt,
        durationMs: subsystem.durationMs,
        error: subsystem.error ?? null,
        result: subsystem.result,
      })),
    });
    if (error) throw error;
  } catch (error) {
    logEvent("error", "worker.health_record_failed", { error });
  }
}

async function runWorker(limit: number) {
  if (activeRun) {
    return Response.json({ ok: false, error: "A render worker run is already in progress.", busy: true }, { status: 409 });
  }

  const run = (async () => {
    await heartbeat("start");
    // Never throws: each subsystem's failure is contained in its report.
    return runWorkerPass(productionWorkerSubsystems({ renderLimit: limit }));
  })();
  activeRun = run;
  try {
    const report = await run;
    const summary = {
      runId: report.runId,
      status: report.status,
      durationMs: report.durationMs,
      subsystems: Object.fromEntries(report.subsystems.map((subsystem) => [subsystem.name, { status: subsystem.status, durationMs: subsystem.durationMs, ...(subsystem.error ? { error: subsystem.error } : {}), result: subsystem.result }])),
    };
    await recordSubsystems(report);
    await heartbeat("finish", report.status, summary);
    if (report.status !== "ok") logEvent(report.status === "error" ? "error" : "warn", "worker.run_had_failures", { status: report.status, failed: report.subsystems.filter((subsystem) => subsystem.status !== "ok" && subsystem.status !== "skipped").map((subsystem) => subsystem.name) });
    // 200 for ok and degraded (the pass completed; details per subsystem);
    // 503 only when a business-critical subsystem could not run at all.
    return Response.json({ ok: report.status === "ok", ...summary }, { status: report.status === "error" ? 503 : 200 });
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
