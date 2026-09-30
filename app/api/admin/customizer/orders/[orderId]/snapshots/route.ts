import { requireAdmin } from "@/lib/auth/admin-server";
import { getOrderDesignSnapshots } from "@/lib/customizer/order-snapshots";
import { createServiceRoleClient } from "@/lib/supabase/server";

// GET /api/admin/customizer/orders/[orderId]/snapshots
// Admin order design viewer data (spec §22): every snapshot for an order,
// including fresh signed URLs for any private render outputs.
export async function GET(request: Request, { params }: any) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { orderId } = await params;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(String(orderId || ""))) {
    return Response.json({ ok: false, error: "Invalid order." }, { status: 400 });
  }
  const url = new URL(request.url);
  const includeDocument = url.searchParams.get("document") === "1";

  try {
    const snapshots = await getOrderDesignSnapshots(String(orderId), includeDocument);

    // Refresh signed URLs for private render outputs (spec §11: never depend
    // on an expired signed URL — regenerate on request).
    const supabase = createServiceRoleClient();
    const withUrls = await Promise.all(
      snapshots.map(async (snapshot: any) => {
        const printFiles: Record<string, any> = { ...(snapshot.printFiles || {}) };
        for (const [key, file] of Object.entries(printFiles)) {
          if (file && typeof file === "object" && (file as any).bucket && (file as any).path) {
            const { data } = await supabase.storage
              .from((file as any).bucket)
              .createSignedUrl((file as any).path, 60 * 60);
            printFiles[key] = { ...(file as object), signedUrl: data?.signedUrl || "" };
          }
        }
        return { ...snapshot, printFiles };
      }),
    );

    // Durable production and notification work for this order (outbox), so
    // Admin can see whether production files and emails are on their way.
    const [{ data: productionTasks, error: productionError }, { data: notificationTasks, error: notificationError }] = await Promise.all([
      supabase
        .from("production_tasks")
        .select("id, order_item_id, snapshot_id, customization_id, task_type, status, source, attempt_count, last_error, next_attempt_at, completed_at, created_at")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true }),
      supabase
        .from("notification_tasks")
        .select("id, kind, status, attempt_count, last_error, next_attempt_at, sent_at, created_at")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true }),
    ]);
    if (productionError) throw productionError;
    if (notificationError) throw notificationError;

    return Response.json({ ok: true, snapshots: withUrls, productionTasks: productionTasks || [], notificationTasks: notificationTasks || [] });
  } catch (error) {
    console.error("Load order design snapshots failed:", error);
    return Response.json({ ok: false, error: "Could not load order design data." }, { status: 500 });
  }
}
