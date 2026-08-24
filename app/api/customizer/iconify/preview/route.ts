// GET /api/customizer/iconify/preview?icon=mdi:heart
//
// Same-origin, sanitized preview for a search result that has NOT been
// imported yet. Deliberately NOT a general proxy (spec §11, §60): the only
// input is a canonical icon identity, and the upstream URL is constructed
// server-side from its validated parts.

import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/security/rate-limit";
import { parseIconIdentity, evaluateLicense } from "@/lib/customizer/v2/iconify";
import { fetchIconSvg, getCollectionFor, IconifyUnavailableError } from "@/lib/customizer/v2/server/iconify";
import { sanitizeSvg } from "@/lib/customizer/v2/uploads";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const limited = rateLimit(request, { name: "iconify-preview", limit: 300, windowMs: 5 * 60 * 1000 });
  if (limited) return limited;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Sign in required.", { status: 401 });

  const url = new URL(request.url);
  const identity = parseIconIdentity(url.searchParams.get("icon"));
  if (!identity) return new Response("Invalid icon.", { status: 400 });

  try {
    // A preview must respect the same license gate as search, so a blocked
    // collection cannot be previewed by guessing its key.
    const collection = await getCollectionFor(identity.key);
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (profile?.role !== "admin" && !evaluateLicense(collection?.license).customerAllowed) {
      return new Response("This graphic is not available.", { status: 403 });
    }

    const fetched = await fetchIconSvg(identity.key);
    const sanitized = sanitizeSvg(fetched.svg);
    if (sanitized.ok === false) {
      console.error(`[iconify] preview rejected unsafe SVG for ${identity.key}: ${sanitized.error}`);
      return new Response("This graphic could not be displayed.", { status: 422 });
    }

    return new Response(sanitized.svg, {
      status: 200,
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        // The sanitized bytes for a given icon key are stable, so this is
        // safe to cache hard and keeps the grid cheap to scroll.
        "cache-control": "public, max-age=86400, s-maxage=604800, immutable",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof IconifyUnavailableError) return new Response("Temporarily unavailable.", { status: 503 });
    console.error(`[iconify] preview failed for ${identity.key}:`, error instanceof Error ? error.message : error);
    return new Response("This graphic could not be displayed.", { status: 502 });
  }
}
