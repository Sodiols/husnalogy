import { requireAdmin } from "@/lib/auth/admin-server";
import { getRenderWorkerSecrets } from "@/lib/env/server-env";
import {
  RENDER_WORKER_DEFAULT_BATCH,
  RENDER_WORKER_MAX_BATCH,
  runRenderWorker,
} from "@/lib/customizer/render-jobs";
import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Render worker — platform independent.
 *
 * Invoked by a Hostinger cron job (or any scheduler that can send an HTTP
 * request), or manually by a signed-in admin. See HOSTINGER_DEPLOYMENT.md for the exact cron command.
 *
 * Authentication:
 *   - `Authorization: Bearer <CRON_SECRET or RENDER_WORKER_SECRET>`, or
 *   - `x-render-secret: <CRON_SECRET or RENDER_WORKER_SECRET>`, or
 *   - POST only: a signed-in admin session.
 * The secret is compared in constant time and never accepted from the query
 * string (URLs end up in access logs). Anonymous requests get 401.
 *
 * Responses: 200 run finished · 401 not authorized · 409 a run is already in
 * progress in this server process · 500 the run failed.
 */

function safeSecretMatch(provided: string, secret: string) {
  if (!provided || !secret) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(secret);
  return left.length === right.length && timingSafeEqual(left, right);
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

function hasWorkerSecret(request: Request): boolean {
  const provided = [bearerToken(request), (request.headers.get("x-render-secret") || "").trim()].filter(Boolean);
  const secrets = getRenderWorkerSecrets();
  if (!secrets.length) {
    console.error("[render-worker] Neither CRON_SECRET nor RENDER_WORKER_SECRET is configured; secret-authenticated runs are disabled.");
    return false;
  }
  // Every comparison runs, so timing does not reveal which secret matched.
  let matched = false;
  for (const candidate of provided) {
    for (const secret of secrets) {
      if (safeSecretMatch(candidate, secret)) matched = true;
    }
  }
  return matched;
}

function parseLimit(raw: unknown): number {
  const value = Math.floor(Number(raw));
  if (!Number.isFinite(value) || value < 1) return RENDER_WORKER_DEFAULT_BATCH;
  return Math.min(RENDER_WORKER_MAX_BATCH, value);
}

// One run at a time per server process. Runs in OTHER processes are already
// safe — every job is claimed atomically under a database lease — this only
// stops a slow run and the next cron tick from stacking up on one instance.
let activeRun: Promise<unknown> | null = null;

async function runWorker(limit: number) {
  if (activeRun) {
    return Response.json(
      { ok: false, error: "A render worker run is already in progress.", busy: true },
      { status: 409 },
    );
  }

  const run = runRenderWorker({ limit });
  activeRun = run;
  try {
    const result = await run;
    return Response.json({
      ok: true,
      processed: result.jobs.map((job) => ({ id: job.id, jobType: job.jobType, status: job.status, errorCode: job.errorCode })),
      failures: result.failures,
      recovered: result.recovered,
      remaining: result.remaining,
      stoppedReason: result.stoppedReason,
      durationMs: result.durationMs,
    });
  } catch (error) {
    console.error("Render worker failed:", error);
    return Response.json({ ok: false, error: "Render processing failed." }, { status: 500 });
  } finally {
    activeRun = null;
  }
}

// Scheduled entry (Hostinger cron). Secret only: no admin-session
// fallback on GET, so a stray browser request can never start production work.
export async function GET(request: Request) {
  if (!hasWorkerSecret(request)) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  return runWorker(parseLimit(new URL(request.url).searchParams.get("limit")));
}

// Manual or scheduled entry. Accepts the worker secret, or an admin session
// for the dashboard's "process now" action.
export async function POST(request: Request) {
  if (!hasWorkerSecret(request)) {
    const admin = await requireAdmin();
    if (!admin.ok) return admin.response;
  }

  const body = await request.json().catch(() => ({}));
  return runWorker(parseLimit(body?.limit));
}
