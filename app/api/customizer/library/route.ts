import { createClient } from "@/lib/supabase/server";
import { assetRowToReference, resolvePrivateAssetUrl } from "@/lib/customizer/server/private-assets";

// GET /api/customizer/library — the caller's reusable upload library
// (spec §15). Fresh signed URLs are generated on every request; expired links
// are never a problem because clients always come back here.
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const url = new URL(request.url);
  const search = (url.searchParams.get("search") || "").trim().slice(0, 120);
  const sort = url.searchParams.get("sort") === "oldest" ? "oldest" : "newest";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.max(1, Math.min(50, Number(url.searchParams.get("pageSize")) || 24));

  let query = supabase
    .from("customer_asset_library")
    .select("*", { count: "exact" })
    .eq("user_id", user.id)
    .eq("status", "ready")
    .order("created_at", { ascending: sort === "oldest" })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (search) query = query.ilike("file_name", `%${search}%`);

  const { data, error, count } = await query;
  if (error) return Response.json({ ok: false, error: "Could not load your photos." }, { status: 500 });

  const assets = await Promise.all(
    (data || []).map(async (row: any) => {
      const editorPath = row.editor_path || row.path;
      const assetReference = assetRowToReference(row);
      const [signedEditor, signedThumb] = await Promise.all([
        resolvePrivateAssetUrl({ reference: assetReference, actor: { userId: user.id }, variant: "editor", supabase }),
        resolvePrivateAssetUrl({ reference: assetReference, actor: { userId: user.id }, variant: "thumbnail", supabase }),
      ]);
      return {
        id: row.id,
        assetId: row.id,
        ownerId: row.user_id,
        bucket: row.bucket,
        path: editorPath,
        originalPath: row.path,
        fileName: row.file_name,
        mimeType: row.mime_type,
        sizeBytes: Number(row.size_bytes) || 0,
        width: Number(row.width) || 0,
        height: Number(row.height) || 0,
        createdAt: row.created_at,
        checksum: row.checksum || "",
        assetReference,
        url: signedEditor.signedUrl,
        signedUrl: signedEditor.signedUrl,
        thumbnailUrl: signedThumb.signedUrl,
      };
    }),
  );

  return Response.json({ ok: true, assets, total: count || assets.length, page, pageSize });
}
