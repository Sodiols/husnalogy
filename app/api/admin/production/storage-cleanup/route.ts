import { withAdminMutation } from "@/lib/security/admin-mutation";
import { getCurrentAdmin, requireAdmin } from "@/lib/auth/admin-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { readJsonObject } from "@/lib/http/read-body";
import { logEvent } from "@/lib/observability/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/production/storage-cleanup — storage cleanup objects that
 * keep failing or were dead-lettered, for staff review. Admin session only.
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  try {
    const { data, error } = await createServiceRoleClient()
      .from("production_storage_cleanup_items")
      .select("id,bucket,path,reason,order_id,status,attempt_count,last_error,last_attempt_at,next_attempt_at,dead_lettered_at,manual_review_required,first_seen_at")
      .in("status", ["pending", "dead_letter"])
      .order("manual_review_required", { ascending: false })
      .order("attempt_count", { ascending: false })
      .limit(100);
    if (error) throw error;
    return Response.json({ ok: true, items: data || [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logEvent("error", "production.cleanup_review_list_failed", { error });
    return Response.json({ ok: false, error: "Cleanup items could not be read." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

/**
 * POST { id, action: "retry" | "dismiss", reason } — retry after fixing the
 * cause, or keep the object. Audited in production_recovery_audit.
 */
export const POST = withAdminMutation(async function POST(request: Request) {
  const { body, response } = await readJsonObject(request, 4096);
  if (response) return response;
  if (!/^[a-f0-9-]{36}$/i.test(String(body.id)) || !["retry", "dismiss"].includes(String(body.action)) || typeof body.reason !== "string" || body.reason.trim().length < 10 || body.reason.length > 500) {
    return Response.json({ ok: false, error: "Provide the item id, action (retry or dismiss) and a review reason (10–500 characters)." }, { status: 400 });
  }
  const admin = await getCurrentAdmin();
  if (!admin) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  const { data, error } = await createServiceRoleClient().rpc("review_storage_cleanup_item", { p_id: body.id, p_actor_id: admin.id, p_action: body.action, p_reason: body.reason });
  if (error) return Response.json({ ok: false, error: "Review refused: the item is not pending or dead-lettered.", code: error.code }, { status: error.code === "42501" ? 403 : 409 });
  return Response.json(data);
}, { maxBytes: 4096 });
