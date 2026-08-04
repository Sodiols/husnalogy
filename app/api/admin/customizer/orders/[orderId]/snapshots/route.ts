import { requireAdmin } from "@/lib/auth/admin-server";
import { getOrderDesignSnapshots, verifySnapshotIntegrity } from "@/lib/customizer/order-snapshots";
import { createServiceRoleClient } from "@/lib/supabase/server";

// GET /api/admin/customizer/orders/[orderId]/snapshots
// Admin order design viewer + render monitoring data (spec §11, §32).
//
// Returns, for every personalized item: the frozen snapshot, its integrity
// verification result, preflight outcome, and the live state of its PNG/PDF
// render jobs with attempt counts and last error. Private storage paths are
// never handed to the browser directly — only short-lived signed URLs are.
export async function GET(request: Request, { params }: any) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { orderId } = await params;
  const url = new URL(request.url);
  const includeDocument = url.searchParams.get("document") === "1";

  try {
    const snapshots = await getOrderDesignSnapshots(orderId, includeDocument);
    const supabase = createServiceRoleClient();

    // Render jobs for this order, newest first, so each snapshot can report
    // the current state of its PNG and PDF production files.
    const { data: jobRows } = await supabase
      .from("customizer_render_jobs")
      .select("id, snapshot_id, customization_id, job_type, status, attempt_count, error_code, error_message, started_at, completed_at, created_at, updated_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false });

    const jobsForSnapshot = (snapshot: any) =>
      (jobRows || []).filter((job: any) =>
        job.snapshot_id ? job.snapshot_id === snapshot.id : job.customization_id === snapshot.customizationId,
      );

    const withDetail = await Promise.all(
      snapshots.map(async (snapshot: any) => {
        // Refresh signed URLs for private render outputs — never depend on an
        // expired signed URL, and never expose the bucket path itself.
        const printFiles: Record<string, any> = {};
        for (const [key, file] of Object.entries(snapshot.printFiles || {})) {
          if (file && typeof file === "object" && (file as any).bucket && (file as any).path) {
            const { data } = await supabase.storage
              .from((file as any).bucket)
              .createSignedUrl((file as any).path, 60 * 60);
            const { bucket: _bucket, path: _path, ...safe } = file as any;
            printFiles[key] = { ...safe, signedUrl: data?.signedUrl || "", available: Boolean(data?.signedUrl) };
          } else {
            printFiles[key] = file;
          }
        }

        const jobs = jobsForSnapshot(snapshot);
        const latestOfType = (jobType: string) => {
          const job = jobs.find((entry: any) => entry.job_type === jobType);
          if (!job) return { status: "not_queued", attemptCount: 0 };
          return {
            id: job.id,
            status: job.status,
            attemptCount: Number(job.attempt_count) || 0,
            errorCode: job.error_code || "",
            errorMessage: job.error_message || "",
            startedAt: job.started_at || "",
            completedAt: job.completed_at || "",
            lastAttemptAt: job.updated_at || job.created_at || "",
          };
        };

        const preflight = snapshot.preflight || {};
        const integrity = includeDocument
          ? verifySnapshotIntegrity({ snapshot: snapshot.snapshot, integrityHash: snapshot.integrityHash })
          : null;

        return {
          ...snapshot,
          printFiles,
          // Warn the admin when the stored payload no longer matches its hash
          // (spec §32) — the design must not be trusted for production.
          integrityVerified: integrity ? integrity.ok : null,
          preflightStatus: preflight.blocking ? "blocked" : preflight.ok === false ? "warnings" : "passed",
          preflightIssues: Array.isArray(preflight.issues) ? preflight.issues : [],
          render: {
            png: latestOfType("print_png"),
            pdf: latestOfType("print_pdf"),
          },
        };
      }),
    );

    const attentionCount = withDetail.filter((snapshot: any) =>
      ["failed", "queue_failed", "attention_required"].includes(String(snapshot.renderStatus)) ||
      snapshot.integrityVerified === false,
    ).length;

    return Response.json({ ok: true, snapshots: withDetail, attentionCount });
  } catch (error) {
    console.error("Load order design snapshots failed:", error);
    return Response.json({ ok: false, error: "Could not load order design data." }, { status: 500 });
  }
}
