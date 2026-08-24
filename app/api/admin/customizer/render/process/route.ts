import { requireAdmin } from "@/lib/auth/admin-server";
import { processQueuedRenderJobs } from "@/lib/customizer/render-jobs";
import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 300;

function safeSecretMatch(provided: string, expected: string) {
  if (!provided || !expected) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

async function runWorker(limit: number) {
  try {
    const jobs = await processQueuedRenderJobs(limit);
    return Response.json({
      ok: true,
      processed: jobs.map((job) => ({ id: job.id, jobType: job.jobType, status: job.status, errorCode: job.errorCode })),
    });
  } catch (error) {
    console.error("Render worker failed:", error);
    return Response.json({ ok: false, error: "Render processing failed." }, { status: 500 });
  }
}

// Vercel Cron sends CRON_SECRET as a Bearer token. No admin-session fallback is
// allowed on GET, so an accidental public request can never start production work.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET || process.env.RENDER_WORKER_SECRET || "";
  if (!safeSecretMatch(bearerToken(request), secret)) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  return runWorker(3);
}

// POST /api/admin/customizer/render/process — protected render worker entry
// (spec §23). Processes queued jobs by priority. Callable by an admin session
// or by a scheduled worker holding RENDER_WORKER_SECRET.
export async function POST(request: Request) {
  const secret = process.env.RENDER_WORKER_SECRET || "";
  const provided = request.headers.get("x-render-secret") || "";
  const workerAuthorized = safeSecretMatch(provided || bearerToken(request), secret);

  if (!workerAuthorized) {
    const admin = await requireAdmin();
    if (!admin.ok) return admin.response;
  }

  const body = await request.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(10, Number(body.limit) || 3));

  return runWorker(limit);
}
