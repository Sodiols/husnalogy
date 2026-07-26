import { requireAdmin } from "@/lib/auth/admin-server";
import { processQueuedRenderJobs } from "@/lib/customizer/render-jobs";

// POST /api/admin/customizer/render/process — protected render worker entry
// (spec §23). Processes queued jobs by priority. Callable by an admin session
// or by a scheduled worker holding RENDER_WORKER_SECRET.
export async function POST(request: Request) {
  const secret = process.env.RENDER_WORKER_SECRET || "";
  const provided = request.headers.get("x-render-secret") || "";
  const workerAuthorized = Boolean(secret) && provided === secret;

  if (!workerAuthorized) {
    const admin = await requireAdmin();
    if (!admin.ok) return admin.response;
  }

  const body = await request.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(10, Number(body.limit) || 3));

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
