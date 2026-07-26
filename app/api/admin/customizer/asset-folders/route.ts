import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { folderFromRow } from "@/lib/customizer/assets";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: z.string().uuid().nullable().optional(),
}).strict();

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from("customizer_asset_folders").select("*").order("name");
  if (error) return Response.json({ ok: false, error: "Could not load folders." }, { status: 500 });
  return Response.json({ ok: true, folders: (data || []).map(folderFromRow) });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "A valid folder name is required." }, { status: 400 });

  const supabase = createServiceRoleClient();
  let duplicateQuery = supabase.from("customizer_asset_folders").select("id").ilike("name", parsed.data.name);
  duplicateQuery = parsed.data.parentId ? duplicateQuery.eq("parent_id", parsed.data.parentId) : duplicateQuery.is("parent_id", null);
  const { data: duplicate } = await duplicateQuery.limit(1).maybeSingle();
  if (duplicate) return Response.json({ ok: false, error: "A folder with this name already exists here." }, { status: 409 });

  const { data, error } = await supabase
    .from("customizer_asset_folders")
    .insert({ name: parsed.data.name, parent_id: parsed.data.parentId || null, created_by: admin.admin?.id || null })
    .select("*")
    .single();
  if (error) return Response.json({ ok: false, error: "Could not create the folder." }, { status: 500 });
  return Response.json({ ok: true, folder: folderFromRow(data) }, { status: 201 });
}
