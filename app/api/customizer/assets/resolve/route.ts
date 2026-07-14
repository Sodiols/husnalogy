import { createClient } from "@/lib/supabase/server";
import { rateLimit, rejectLargeRequest } from "@/lib/security/rate-limit";
import { resolvePrivateAssetUrl } from "@/lib/customizer/server/private-assets";
import { RenderError } from "@/lib/customizer/v2/server/render";

export async function POST(request: Request) {
  const tooLarge = rejectLargeRequest(request, 64 * 1024);
  if (tooLarge) return tooLarge;
  const limited = rateLimit(request, { name: "customizer-asset-resolve", limit: 80, windowMs: 10 * 60 * 1000 });
  if (limited) return limited;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const references = Array.isArray(body.references) ? body.references.slice(0, 50) : body.reference ? [body.reference] : [];
  const variant = ["original", "editor", "thumbnail"].includes(body.variant) ? body.variant : "editor";
  if (!references.length) return Response.json({ ok: false, error: "Provide at least one asset reference." }, { status: 400 });

  try {
    const assets = await Promise.all(
      references.map((reference: any) => resolvePrivateAssetUrl({
        reference,
        actor: { userId: user.id },
        variant,
        supabase,
      })),
    );
    return Response.json({ ok: true, assets });
  } catch (error) {
    const code = error instanceof RenderError ? error.code : "ASSET_SIGNING_FAILED";
    const status = code === "ASSET_ACCESS_DENIED" ? 403 : code === "ASSET_NOT_FOUND" ? 404 : 422;
    console.warn(`[customizer] Asset resolution rejected for ${user.id}: ${code}`);
    return Response.json({ ok: false, error: "That photo could not be opened securely.", errorCode: code }, { status });
  }
}
