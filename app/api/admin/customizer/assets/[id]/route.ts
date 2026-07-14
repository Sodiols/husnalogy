import { requireAdmin } from "@/lib/auth/admin-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assetFromRow } from "@/lib/customizer/assets";

// PATCH /api/admin/customizer/assets/[id] — update element metadata,
// availability, active state, or archive it.
export async function PATCH(request: Request, { params }: any) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};

  if (body.title !== undefined) patch.title = String(body.title).trim().slice(0, 200);
  if (body.categoryId !== undefined) patch.category_id = String(body.categoryId).trim() || null;
  if (body.tags !== undefined && Array.isArray(body.tags)) {
    patch.tags = body.tags.map((tag: unknown) => String(tag).trim().toLowerCase()).filter(Boolean).slice(0, 20);
  }
  if (body.keywords !== undefined) patch.keywords = String(body.keywords).trim().slice(0, 500);
  if (body.customerAvailable !== undefined) patch.customer_available = Boolean(body.customerAvailable);
  if (body.active !== undefined) patch.active = Boolean(body.active);
  if (body.archived !== undefined) patch.archived = Boolean(body.archived);
  if (body.tintable !== undefined) patch.tintable = Boolean(body.tintable);
  if (body.defaultColor !== undefined) patch.default_color = String(body.defaultColor).trim().slice(0, 32) || null;

  if (!Object.keys(patch).length) return Response.json({ ok: false, error: "Nothing to update." }, { status: 400 });

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("customizer_assets")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) return Response.json({ ok: false, error: "Could not update the element." }, { status: 500 });
  if (!data) return Response.json({ ok: false, error: "Not found." }, { status: 404 });
  return Response.json({ ok: true, asset: assetFromRow(data) });
}

// DELETE /api/admin/customizer/assets/[id] — permanently delete an element.
// Only archived elements can be deleted, and only when no order snapshot
// still references them (spec §14: delete unused assets safely).
export async function DELETE(_request: Request, { params }: any) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  const supabase = createServiceRoleClient();

  const { data: asset, error } = await supabase.from("customizer_assets").select("*").eq("id", id).maybeSingle();
  if (error) return Response.json({ ok: false, error: "Could not load the element." }, { status: 500 });
  if (!asset) return Response.json({ ok: false, error: "Not found." }, { status: 404 });
  if (!asset.archived) {
    return Response.json({ ok: false, error: "Archive the element before deleting it." }, { status: 409 });
  }

  // Reference check: any order snapshot or active customization mentioning
  // this asset id or storage path blocks deletion.
  const needles = [String(asset.id), String(asset.path)].filter(Boolean);
  const { data: snapshotRows } = await supabase
    .from("order_design_snapshots")
    .select("id, snapshot")
    .limit(500);
  const referenced = (snapshotRows || []).some((row: any) => {
    const haystack = JSON.stringify(row.snapshot || {});
    return needles.some((needle) => haystack.includes(needle));
  });
  if (referenced) {
    return Response.json(
      { ok: false, error: "This element is used in order snapshots and cannot be deleted. Keep it archived instead." },
      { status: 409 },
    );
  }

  await supabase.storage.from(asset.bucket).remove([asset.path]);
  const { error: deleteError } = await supabase.from("customizer_assets").delete().eq("id", id);
  if (deleteError) return Response.json({ ok: false, error: "Could not delete the element." }, { status: 500 });

  console.info(`[customizer] Element deleted: ${id} by=${admin.admin?.id}`);
  return Response.json({ ok: true });
}
