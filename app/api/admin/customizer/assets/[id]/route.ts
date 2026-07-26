import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getAdminAssetUsage, signAdminAssetRow } from "@/lib/customizer/server/admin-assets";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  categoryId: z.string().trim().max(80).nullable().optional(),
  folderId: z.string().trim().max(80).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  keywords: z.string().trim().max(500).optional(),
  assetType: z.enum(["image", "element", "svg", "frame", "background", "texture", "mockup", "overlay", "other"]).optional(),
  customerAvailable: z.boolean().optional(),
  adminAvailable: z.boolean().optional(),
  active: z.boolean().optional(),
  archived: z.boolean().optional(),
  tintable: z.boolean().optional(),
  defaultColor: z.string().trim().max(32).nullable().optional(),
}).strict();

// GET refreshes short-lived display URLs from permanent bucket/path metadata.
export async function GET(_request: Request, { params }: any) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const { id } = await params;
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from("customizer_assets").select("*").eq("id", id).maybeSingle();
  if (error) return Response.json({ ok: false, error: "Could not load the asset." }, { status: 500 });
  if (!data) return Response.json({ ok: false, error: "Asset not found." }, { status: 404 });
  return Response.json({ ok: true, asset: await signAdminAssetRow(supabase, data) });
}

// PATCH /api/admin/customizer/assets/[id] — rename, organize, tag, expose,
// archive, or restore a permanent administrator asset.
export async function PATCH(request: Request, { params }: any) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "Invalid asset update." }, { status: 400 });
  const body = parsed.data;
  const patch: Record<string, unknown> = {};

  if (body.title !== undefined) patch.title = body.title;
  if (body.categoryId !== undefined) patch.category_id = body.categoryId || null;
  if (body.folderId !== undefined) patch.folder_id = body.folderId || null;
  if (body.tags !== undefined) patch.tags = [...new Set(body.tags.map((tag) => tag.toLowerCase()))];
  if (body.keywords !== undefined) patch.keywords = body.keywords;
  if (body.assetType !== undefined) patch.asset_type = body.assetType;
  if (body.customerAvailable !== undefined) patch.customer_available = body.customerAvailable;
  if (body.adminAvailable !== undefined) patch.admin_available = body.adminAvailable;
  if (body.active !== undefined) patch.active = body.active;
  if (body.archived !== undefined) {
    patch.archived = body.archived;
    patch.status = body.archived ? "archived" : "ready";
    patch.active = !body.archived;
  }
  if (body.tintable !== undefined) patch.tintable = body.tintable;
  if (body.defaultColor !== undefined) patch.default_color = body.defaultColor || null;

  if (!Object.keys(patch).length) return Response.json({ ok: false, error: "Nothing to update." }, { status: 400 });

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("customizer_assets")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) return Response.json({ ok: false, error: "Could not update the asset." }, { status: 500 });
  if (!data) return Response.json({ ok: false, error: "Asset not found." }, { status: 404 });
  return Response.json({ ok: true, asset: await signAdminAssetRow(supabase, data) });
}

// DELETE /api/admin/customizer/assets/[id] — permanent deletion is permitted
// only for archived, unreferenced assets. Existing templates/orders keep using
// archived assets because their private paths remain signable.
export async function DELETE(_request: Request, { params }: any) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { id } = await params;
  const supabase = createServiceRoleClient();
  const { data: asset, error } = await supabase.from("customizer_assets").select("*").eq("id", id).maybeSingle();
  if (error) return Response.json({ ok: false, error: "Could not load the asset." }, { status: 500 });
  if (!asset) return Response.json({ ok: false, error: "Asset not found." }, { status: 404 });
  if (!asset.archived || asset.status !== "archived") {
    return Response.json({ ok: false, error: "Archive the asset before deleting it permanently." }, { status: 409 });
  }

  let usage: any[] = [];
  try {
    usage = await getAdminAssetUsage(supabase, asset);
  } catch (usageError) {
    console.error("Asset usage check failed:", usageError);
    return Response.json({ ok: false, error: "Could not verify whether this asset is in use, so deletion was blocked." }, { status: 500 });
  }
  await supabase.from("customizer_assets").update({ usage_count: usage.length }).eq("id", id);
  if (usage.length) {
    return Response.json(
      {
        ok: false,
        error: `This asset is used in ${usage.length} saved location${usage.length === 1 ? "" : "s"}. Keep it archived instead.`,
        usage,
      },
      { status: 409 },
    );
  }

  const { error: deleteError } = await supabase.from("customizer_assets").delete().eq("id", id);
  if (deleteError) {
    const message = /still in use|customizer asset/i.test(deleteError.message)
      ? "This asset became referenced while deletion was being checked. Keep it archived instead."
      : "Could not delete the asset record.";
    return Response.json({ ok: false, error: message }, { status: 409 });
  }

  const removePaths = [...new Set([asset.path, asset.editor_path, asset.thumbnail_path].filter(Boolean))];
  const { error: storageError } = await supabase.storage.from(asset.bucket).remove(removePaths);
  if (storageError) {
    // Restore the authoritative record if Storage could not be cleaned up, so
    // database metadata and object files never intentionally diverge.
    const { error: restoreError } = await supabase.from("customizer_assets").insert(asset);
    console.error("Asset storage cleanup failed:", storageError, "record restore:", restoreError);
    return Response.json({ ok: false, error: "Storage cleanup failed; the archived asset record was restored. Please retry." }, { status: 500 });
  }

  console.info(`[customizer] Asset deleted: ${id} by=${admin.admin?.id || "unknown"}`);
  return Response.json({ ok: true });
}
