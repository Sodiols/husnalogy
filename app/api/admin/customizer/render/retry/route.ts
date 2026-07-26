import { requireAdmin } from "@/lib/auth/admin-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { enqueueRenderJob, processRenderJob } from "@/lib/customizer/render-jobs";
import { RenderError } from "@/lib/customizer/v2/server/render";

// POST /api/admin/customizer/render/retry — retry a failed render job, or
// (re)queue production rendering for an order snapshot (spec §22, §23).
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const body = await request.json().catch(() => ({}));
  const jobId = String(body.jobId || "").trim();
  const snapshotId = String(body.snapshotId || "").trim();

  try {
    if (jobId) {
      // Audit logging for render retries (spec §33).
      console.info(`[customizer] Render retry: job=${jobId} by=${admin.admin?.id}`);
      const supabase = createServiceRoleClient();
      const { error: resetError } = await supabase.from("customizer_render_jobs").update({
        status: "retrying",
        attempt_count: 0,
        next_attempt_at: null,
        cancel_requested_at: null,
        completed_at: null,
        error_code: null,
        error_message: null,
        locked_by: null,
        lock_token: null,
        lock_expires_at: null,
      }).eq("id", jobId).in("status", ["failed", "cancelled", "retrying"]);
      if (resetError) throw resetError;
      const job = await processRenderJob(jobId);
      return Response.json({ ok: true, job: { id: job.id, status: job.status, errorCode: job.errorCode } });
    }

    if (snapshotId) {
      const supabase = createServiceRoleClient();
      const { data: snapshot, error } = await supabase
        .from("order_design_snapshots")
        .select("id, order_id, customization_id")
        .eq("id", snapshotId)
        .maybeSingle();
      if (error) throw error;
      if (!snapshot?.customization_id) {
        return Response.json({ ok: false, error: "Snapshot has no customization to render." }, { status: 400 });
      }
      console.info(`[customizer] Snapshot render: snapshot=${snapshotId} by=${admin.admin?.id}`);
      const results = [];
      for (const jobType of ["print_png", "print_pdf"] as const) {
        try {
          const { job } = await enqueueRenderJob({
            customizationId: snapshot.customization_id,
            orderId: snapshot.order_id,
            jobType,
            priority: 10,
          });
          const finished = job.status === "completed" ? job : await processRenderJob(job.id);
          results.push({ id: finished.id, jobType, status: finished.status, errorCode: finished.errorCode });
        } catch (error) {
          if (error instanceof RenderError && error.code === "FEATURE_DISABLED") {
            results.push({ id: null, jobType, status: "disabled", errorCode: error.code });
            continue;
          }
          throw error;
        }
      }
      return Response.json({ ok: true, jobs: results });
    }

    return Response.json({ ok: false, error: "Provide jobId or snapshotId." }, { status: 400 });
  } catch (error) {
    console.error("Render retry failed:", error);
    return Response.json({ ok: false, error: "Render retry failed." }, { status: 500 });
  }
}
