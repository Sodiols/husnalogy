import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

// DELETE /api/customizer/library/[id] — remove an unused upload from the
// caller's library. Refuses when the asset is still referenced by an active
// cart item or an order snapshot (spec §15).
export async function DELETE(_request: Request, { params }: any) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const { data: asset, error } = await supabase
    .from("customer_asset_library")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return Response.json({ ok: false, error: "Could not load this photo." }, { status: 500 });
  if (!asset) return Response.json({ ok: false, error: "Not found." }, { status: 404 });

  // Reference check (spec §15): never delete an asset still used by an active
  // cart item or ordered design. JSONB containment cannot express "any field
  // references this path", so fetch the user's active customizations' value
  // payloads and search them.
  const service = createServiceRoleClient();
  const paths = [asset.path, asset.editor_path].filter(Boolean).map(String);

  const { data: activeRows } = await service
    .from("product_customizations")
    .select("id, values, uploaded_files")
    .eq("user_id", user.id)
    .in("status", ["in_cart", "ordered"])
    .limit(300);
  const referenced = (activeRows || []).some((row: any) => {
    const haystack = JSON.stringify({ v: row.values, u: row.uploaded_files });
    return paths.some((path) => haystack.includes(path));
  });
  if (referenced) {
    return Response.json(
      { ok: false, error: "This photo is used by a design in your cart or an order and cannot be deleted." },
      { status: 409 },
    );
  }

  // Delete storage objects, then the record.
  const removePaths = [asset.path, asset.editor_path, asset.thumbnail_path].filter(Boolean);
  if (removePaths.length) {
    await service.storage.from(asset.bucket).remove(removePaths);
  }
  const { error: deleteError } = await supabase.from("customer_asset_library").delete().eq("id", id).eq("user_id", user.id);
  if (deleteError) return Response.json({ ok: false, error: "Could not delete this photo." }, { status: 500 });

  return Response.json({ ok: true });
}
