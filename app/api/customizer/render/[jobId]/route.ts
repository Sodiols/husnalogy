import { createClient } from "@/lib/supabase/server";
import { cancelRenderJob, getRenderJob, getRenderOutputs } from "@/lib/customizer/render-jobs";
import { rateLimit } from "@/lib/security/rate-limit";
import { rejectCrossSiteRequest } from "@/lib/security/same-origin";

async function authorizeJob(jobId: string, { forCancel = false } = {}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: Response.json({ ok: false, error: "Sign in required." }, { status: 401 }) };
  const { data, error } = await supabase.from("customizer_render_jobs").select("id,customization_id,order_id").eq("id", jobId).maybeSingle();
  if (error) return { ok: false as const, response: Response.json({ ok: false, error: "Could not verify this render job." }, { status: 500 }) };
  if (!data) return { ok: false as const, response: Response.json({ ok: false, error: "Not found." }, { status: 404 }) };
  const { data: owned } = await supabase.from("product_customizations").select("id").eq("id", data.customization_id).eq("user_id", user.id).maybeSingle();
  if (!owned) return { ok: false as const, response: Response.json({ ok: false, error: "Not found." }, { status: 404 }) };
  // Production renders of a placed order belong to fulfilment, not to the
  // customer: cancelling them would silently stall the order's production.
  if (forCancel && data.order_id) {
    return { ok: false as const, response: Response.json({ ok: false, error: "Order production renders cannot be cancelled." }, { status: 403 }) };
  }
  return { ok: true as const };
}

export async function GET(request: Request, { params }: any) {
  const limited = rateLimit(request, { name: "customizer-render-status", limit: 90, windowMs: 10 * 60 * 1000 });
  if (limited) return limited;
  const { jobId } = await params;
  const access = await authorizeJob(String(jobId));
  if (!access.ok) return access.response;
  const job = await getRenderJob(String(jobId));
  const outputs = job?.status === "completed" ? await getRenderOutputs(String(jobId)) : [];
  return Response.json({ ok: true, job, outputs });
}

// DELETE — cancel one of the caller's own render jobs. The same mutation
// contract as every other customer write: same-origin first, then rate limit,
// session, ownership, and the job's state (lib/customizer/render-jobs).
export async function DELETE(request: Request, { params }: any) {
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;
  const limited = rateLimit(request, { name: "customizer-render-cancel", limit: 30, windowMs: 10 * 60 * 1000 });
  if (limited) return limited;
  const { jobId } = await params;
  const access = await authorizeJob(String(jobId), { forCancel: true });
  if (!access.ok) return access.response;
  const job = await cancelRenderJob(String(jobId));
  return Response.json({ ok: true, job });
}
