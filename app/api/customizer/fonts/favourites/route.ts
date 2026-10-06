// GET /api/customizer/fonts/favourites — the Husnalogy-wide Favourite Fonts
// (Customizer Point 4), and whether the caller may change them.
//
// Public: the list is a set of public Google Fonts family names. It is never a
// permission — every customizer still filters by the template's allowed fonts
// before showing any category, favourites included.

import { canManageFontFavourites, getCurrentActor } from "@/lib/auth/roles";
import { getFontFavourites } from "@/lib/customizer/v2/server/font-favourites";
import { rateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limited = rateLimit(request, { name: "customizer-font-favourites", limit: 120, windowMs: 10 * 60 * 1000 });
  if (limited) return limited;
  const [favourites, actor] = await Promise.all([getFontFavourites(), getCurrentActor().catch(() => null)]);
  return Response.json(
    { ok: true, favourites, canManage: canManageFontFavourites(actor) },
    // Per-viewer (canManage), and an admin's change must show up at once.
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
