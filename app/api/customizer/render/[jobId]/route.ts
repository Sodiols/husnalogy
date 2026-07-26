import { createClient } from "@/lib/supabase/server";
import { cancelRenderJob, getRenderJob, getRenderOutputs } from "@/lib/customizer/render-jobs";
import { rateLimit } from "@/lib/security/rate-limit";

async function authorizeJob(jobId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: Response.json({ ok: false, error: "Sign in required." }, { status: 401 }) };
  const { data, error } = await supabase.from("customizer_render_jobs").select("id").eq("id", jobId).maybeSingle();
  if (error) return { ok: false as const, response: Response.json({ ok: false, error: "Could not verify this render job." }, { status: 500 }) };
  if (!data) return { ok: false as const, response: Response.json({ ok: false, error: "Not found." }, { status: 404 }) };
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

export async function DELETE(request: Request, { params }: any) {
  const limited = rateLimit(request, { name: "customizer-render-cancel", limit: 30, windowMs: 10 * 60 * 1000 });
  if (limited) return limited;
  const { jobId } = await params;
  const access = await authorizeJob(String(jobId));
  if (!access.ok) return access.response;
  const job = await cancelRenderJob(String(jobId));
  return Response.json({ ok: true, job });
}
