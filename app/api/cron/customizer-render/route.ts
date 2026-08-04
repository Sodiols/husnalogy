import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getRenderHealthSummary, processQueuedRenderJobs } from "@/lib/customizer/render-jobs";
import { assertNoPublicWorkerSecret, checkRenderWorkerEnv } from "@/lib/customizer/server/env";

// Scheduled production render worker (spec §9).
//
// Runs on the schedule declared in vercel.json. It recovers abandoned jobs,
// then processes queued and retrying jobs by priority through the existing
// render pipeline — it never duplicates the renderer itself.
//
// Authentication is by shared secret only. Vercel Cron sends
// `Authorization: Bearer $CRON_SECRET`; an operator or an external scheduler
// may instead send `x-render-secret: $RENDER_WORKER_SECRET`. Neither secret is
// ever a NEXT_PUBLIC_* variable, so neither reaches the browser.

export const dynamic = "force-dynamic";
// Rendering is CPU-bound (resvg + sharp + pdf-lib); give the batch room.
export const maxDuration = 300;

function secretsMatch(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual requires equal lengths; compare lengths separately so a
  // wrong-length guess cannot throw.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isAuthorized(request: Request): boolean {
  const cronSecret = String(process.env.CRON_SECRET || "").trim();
  const workerSecret = String(process.env.RENDER_WORKER_SECRET || "").trim();

  const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (cronSecret && secretsMatch(bearer, cronSecret)) return true;

  const headerSecret = (request.headers.get("x-render-secret") || "").trim();
  if (workerSecret && secretsMatch(headerSecret, workerSecret)) return true;

  return false;
}

async function runWorker(request: Request) {
  assertNoPublicWorkerSecret();

  const env = checkRenderWorkerEnv();
  if (!env.ok) {
    // Names only — never the values.
    console.error(`[customizer] Render worker cannot run; missing environment variables: ${env.missing.join(", ")}`);
    return NextResponse.json(
      { ok: false, error: "The render worker is not configured.", missingEnv: env.missing },
      { status: 503 },
    );
  }

  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(10, Number(url.searchParams.get("limit")) || 5));

  try {
    // processQueuedRenderJobs recovers abandoned (lease-expired) jobs first,
    // then claims queued/retrying jobs by priority and attempt policy.
    const jobs = await processQueuedRenderJobs(limit);
    const health = await getRenderHealthSummary();

    return NextResponse.json({
      ok: true,
      processed: jobs.map((job) => ({
        id: job.id,
        jobType: job.jobType,
        status: job.status,
        attemptCount: job.attemptCount,
        errorCode: job.errorCode,
      })),
      health,
    });
  } catch (error) {
    console.error("[customizer] Scheduled render worker failed:", error);
    return NextResponse.json({ ok: false, error: "Render processing failed." }, { status: 500 });
  }
}

// Vercel Cron issues GET requests.
export async function GET(request: Request) {
  return runWorker(request);
}

// POST keeps parity with the manual admin worker entry point.
export async function POST(request: Request) {
  return runWorker(request);
}
