import { createClient } from "@/lib/supabase/server";
import { rateLimit, rejectLargeRequest } from "@/lib/security/rate-limit";
import { enqueueRenderJob, processRenderJob, getRenderOutputs } from "@/lib/customizer/render-jobs";
import { RenderError } from "@/lib/customizer/v2/server/render";
import type { RenderJobType } from "@/lib/customizer/v2/types";

// POST /api/customizer/render — request a server-rendered preview of your own
// customization (spec §23). Preview/thumbnail jobs process inline; print jobs
// are queued for the protected worker.
export async function POST(request: Request) {
  const tooLarge = rejectLargeRequest(request, 32 * 1024);
  if (tooLarge) return tooLarge;
  const limited = rateLimit(request, { name: "customizer-render", limit: 20, windowMs: 10 * 60 * 1000 });
  if (limited) return limited;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const customizationId = String(body.customizationId || "").trim();
  const requestedJobType = String(body.jobType || "preview");
  const jobType = (["preview", "thumbnail", "cart_thumbnail", "mockup", "print_png", "print_pdf"].includes(requestedJobType) ? requestedJobType : "preview") as RenderJobType;
  if (!customizationId) {
    return Response.json({ ok: false, error: "customizationId is required." }, { status: 400 });
  }

  // Ownership check through the caller's RLS-scoped client (spec §33).
  const { data: owned, error: ownError } = await supabase
    .from("product_customizations")
    .select("id")
    .eq("id", customizationId)
    .maybeSingle();
  if (ownError) return Response.json({ ok: false, error: "Could not verify customization." }, { status: 500 });
  if (!owned) return Response.json({ ok: false, error: "Not found." }, { status: 404 });

  if (jobType === "print_png" || jobType === "print_pdf") {
    const { data: actor } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (actor?.role !== "admin") {
      return Response.json({ ok: false, error: "Print production is restricted to administrators and order processing." }, { status: 403 });
    }
  }

  try {
    const { job, reused } = await enqueueRenderJob({ customizationId, jobType });
    const finished = job.status === "completed" && reused ? job : await processRenderJob(job.id);
    if (finished.status !== "completed") {
      return Response.json(
        { ok: false, error: finished.errorMessage || "Preview rendering failed. Please try again.", errorCode: finished.errorCode, jobId: finished.id, status: finished.status },
        { status: 502 },
      );
    }
    const outputs = await getRenderOutputs(finished.id);
    return Response.json({ ok: true, jobId: finished.id, status: finished.status, outputs });
  } catch (error) {
    console.error("Customer render request failed:", error);
    if (error instanceof RenderError && error.code === "FEATURE_DISABLED") {
      return Response.json({ ok: false, error: "Server rendering is not enabled for this product.", errorCode: error.code }, { status: 403 });
    }
    return Response.json({ ok: false, error: "Rendering is unavailable right now." }, { status: 500 });
  }
}
