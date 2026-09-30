import { withAdminMutation } from "@/lib/security/admin-mutation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { folderFromRow } from "@/lib/customizer/assets";
import { readJsonObject } from "@/lib/http/read-body";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  parentId: z.string().uuid().nullable().optional(),
}).strict();

export const PATCH = withAdminMutation(async function PATCH(request: Request, { params }: any) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const { id } = await params;
  const bodyRead9 = await readJsonObject(request, 16 * 1024);
  if (bodyRead9.response) return bodyRead9.response;
  const parsed = patchSchema.safeParse(bodyRead9.body);
  if (!parsed.success || !Object.keys(parsed.data).length) return Response.json({ ok: false, error: "Invalid folder update." }, { status: 400 });
  if (parsed.data.parentId === id) return Response.json({ ok: false, error: "A folder cannot contain itself." }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.parentId !== undefined) patch.parent_id = parsed.data.parentId || null;
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from("customizer_asset_folders").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) return Response.json({ ok: false, error: "Could not update the folder." }, { status: 500 });
  if (!data) return Response.json({ ok: false, error: "Folder not found." }, { status: 404 });
  return Response.json({ ok: true, folder: folderFromRow(data) });
}, { maxBytes: 1024 * 1024 });

export const DELETE = withAdminMutation(async function DELETE(_request: Request, { params }: any) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const { id } = await params;
  const supabase = createServiceRoleClient();
  const [{ count: assetCount }, { count: childCount }] = await Promise.all([
    supabase.from("customizer_assets").select("id", { count: "exact", head: true }).eq("folder_id", id),
    supabase.from("customizer_asset_folders").select("id", { count: "exact", head: true }).eq("parent_id", id),
  ]);
  if ((assetCount || 0) > 0 || (childCount || 0) > 0) {
    return Response.json({ ok: false, error: "Move the assets and subfolders before deleting this folder." }, { status: 409 });
  }
  const { error } = await supabase.from("customizer_asset_folders").delete().eq("id", id);
  if (error) return Response.json({ ok: false, error: "Could not delete the folder." }, { status: 500 });
  return Response.json({ ok: true });
}, { maxBytes: 1024 * 1024 });
