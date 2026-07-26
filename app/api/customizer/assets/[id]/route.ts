import { createServiceRoleClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/security/rate-limit";

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Stable same-origin display URL for customer-visible private assets. The URL
// stored in product metadata never expires; every request redirects to a newly
// signed Storage URL.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(request, { name: "customizer-asset-display", limit: 240, windowMs: 10 * 60 * 1000 });
  if (limited) return limited;

  const { id } = await params;
  if (!ID_PATTERN.test(id)) return Response.json({ ok: false, error: "Invalid asset." }, { status: 400 });

  const variant = new URL(request.url).searchParams.get("variant") || "editor";
  if (!["editor", "thumbnail", "original"].includes(variant)) {
    return Response.json({ ok: false, error: "Invalid asset variant." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data: asset, error } = await supabase
    .from("customizer_assets")
    .select("bucket,path,editor_path,thumbnail_path,active,archived,status,customer_available")
    .eq("id", id)
    .eq("customer_available", true)
    .in("status", ["ready", "archived"])
    .maybeSingle();
  if (error || !asset) return Response.json({ ok: false, error: "Asset not found." }, { status: 404 });

  const path = variant === "thumbnail"
    ? asset.thumbnail_path || asset.editor_path || asset.path
    : variant === "original"
      ? asset.path
      : asset.editor_path || asset.path;
  const { data, error: signError } = await supabase.storage.from(asset.bucket).createSignedUrl(path, 15 * 60);
  if (signError || !data?.signedUrl) {
    console.error("Sign customer asset failed:", signError);
    return Response.json({ ok: false, error: "Asset could not be opened." }, { status: 500 });
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: data.signedUrl,
      "Cache-Control": "private, no-store, max-age=0",
      "Referrer-Policy": "same-origin",
    },
  });
}
