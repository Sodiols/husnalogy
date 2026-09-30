import { requireAdmin } from "@/lib/auth/admin-server";
import { createServiceRoleClient } from "@/lib/supabase/server";

/** Originals are staff-only. Customer previews use the existing preview routes. */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const url = new URL(request.url);
  const snapshotId = url.searchParams.get("snapshotId");
  const key = url.searchParams.get("key");
  if (!snapshotId || !key) return Response.json({ ok: false, error: "Missing asset identity." }, { status: 400 });
  const supabase = createServiceRoleClient();
  const { data: asset, error } = await supabase.from("order_production_assets").select("bucket,path").eq("snapshot_id", snapshotId).eq("asset_key", key).maybeSingle();
  if (error || !asset) return Response.json({ ok: false, error: "Asset unavailable." }, { status: 404 });
  const { data, error: signingError } = await supabase.storage.from(asset.bucket).createSignedUrl(asset.path, 120);
  if (signingError || !data) return Response.json({ ok: false, error: "Asset unavailable." }, { status: 503 });
  return Response.json({ ok: true, url: data.signedUrl, expiresIn: 120 }, { headers: { "Cache-Control": "no-store" } });
}
