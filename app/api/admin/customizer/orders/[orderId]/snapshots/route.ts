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
  const url = new URL(request.url);
  const includeDocument = url.searchParams.get("document") === "1";

  try {
    const snapshots = await getOrderDesignSnapshots(orderId, includeDocument);

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

    return Response.json({ ok: true, snapshots: withUrls });
  } catch (error) {
    console.error("Load order design snapshots failed:", error);
    return Response.json({ ok: false, error: "Could not load order design data." }, { status: 500 });
  }
}
