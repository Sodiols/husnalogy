import { requireAdmin } from "@/lib/auth/admin-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { enqueueRenderJob, processRenderJob, refreshOrderProductionStatus } from "@/lib/customizer/render-jobs";
import { RenderError } from "@/lib/customizer/v2/server/render";

const PRINT_JOB_TYPES = ["print_png", "print_pdf"] as const;
type PrintJobType = (typeof PRINT_JOB_TYPES)[number];

// POST /api/admin/customizer/render/retry — admin render recovery actions
// (spec §11):
//   { jobId }                     retry one failed job
//   { snapshotId }                (re)queue all production files
//   { snapshotId, jobTypes:[..] } queue only the missing PNG or PDF
//   { snapshotId, markForReview } flag the snapshot for manual review
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const body = await request.json().catch(() => ({}));
  const jobId = String(body.jobId || "").trim();
  const snapshotId = String(body.snapshotId || "").trim();
  const markForReview = body.markForReview === true;
  const requestedTypes = Array.isArray(body.jobTypes)
    ? body.jobTypes.map((value: unknown) => String(value)).filter((value: string): value is PrintJobType =>
        (PRINT_JOB_TYPES as readonly string[]).includes(value),
      )
    : [];

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
        .select("id, order_id, order_item_id, customization_id")
        .eq("id", snapshotId)
        .maybeSingle();
      if (error) throw error;
      if (!snapshot) return Response.json({ ok: false, error: "Snapshot not found." }, { status: 404 });

      // Mark for manual review: an operational flag only. The frozen design
      // payload and its integrity hash are never touched.
      if (markForReview) {
        console.info(`[customizer] Snapshot marked for manual review: snapshot=${snapshotId} by=${admin.admin?.id}`);
        const { error: reviewError } = await supabase
          .from("order_design_snapshots")
          .update({
            render_status: "attention_required",
            manual_review_requested_at: new Date().toISOString(),
            manual_review_note: String(body.note || "").slice(0, 1000) || null,
          })
          .eq("id", snapshotId);
        if (reviewError) throw reviewError;
        await refreshOrderProductionStatus(supabase, snapshot.order_id);
        return Response.json({ ok: true, markedForReview: true });
      }

      if (!snapshot.customization_id) {
        return Response.json({ ok: false, error: "Snapshot has no customization to render." }, { status: 400 });
      }

      console.info(`[customizer] Snapshot render: snapshot=${snapshotId} by=${admin.admin?.id}`);
      const jobTypes: readonly PrintJobType[] = requestedTypes.length ? requestedTypes : PRINT_JOB_TYPES;
      const results = [];
      for (const jobType of jobTypes) {
        try {
          // snapshotId binds the job to the frozen order design, so a retry
          // renders exactly what the customer approved — never the live draft.
          const { job } = await enqueueRenderJob({
            customizationId: snapshot.customization_id,
            orderId: snapshot.order_id,
            orderItemId: snapshot.order_item_id,
            snapshotId: snapshot.id,
            jobType,
            priority: 10,
            force: true,
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
      await refreshOrderProductionStatus(supabase, snapshot.order_id);
      return Response.json({ ok: true, jobs: results });
    }

    return Response.json({ ok: false, error: "Provide jobId or snapshotId." }, { status: 400 });
  } catch (error) {
    console.error("Render retry failed:", error);
    return Response.json({ ok: false, error: "Render retry failed." }, { status: 500 });
  }
}
