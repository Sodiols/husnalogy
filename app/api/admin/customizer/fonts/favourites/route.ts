// PUT /api/admin/customizer/fonts/favourites — mark or unmark a Favourite Font
// (Customizer Point 4). Administrators only.
//
// The family must be one the trusted Google Fonts catalog actually serves, and
// it is stored under the catalog's own spelling, so a favourite can never name
// a font the renderer could not produce.

import { withAdminMutation } from "@/lib/security/admin-mutation";
import { canManageFontFavourites, requireCapability } from "@/lib/auth/roles";
import { readJsonObject } from "@/lib/http/read-body";
import { getFontCatalogSafe } from "@/lib/customizer/v2/server/google-fonts-catalog";
import { setFontFavourite } from "@/lib/customizer/v2/server/font-favourites";
import { fontFamilyKey } from "@/lib/customizer/v2/font-categories";

export const dynamic = "force-dynamic";

export const PUT = withAdminMutation(async function PUT(request: Request) {
  const session = await requireCapability(canManageFontFavourites, "Only an administrator can change Favourite Fonts.");
  if (!session.ok) return session.response;

  const read = await readJsonObject(request, 4 * 1024);
  if (read.response) return read.response;
  const requested = String(read.body.family || "").trim();
  if (!requested || requested.length > 120 || typeof read.body.favourite !== "boolean") {
    return Response.json({ ok: false, error: "A font family and a favourite flag are required." }, { status: 400 });
  }

  const catalog = await getFontCatalogSafe();
  if (!catalog.length) {
    return Response.json({ ok: false, error: "The font catalog is unavailable. Please try again." }, { status: 503 });
  }
  const entry = catalog.find((item) => fontFamilyKey(item.family) === fontFamilyKey(requested));
  if (!entry) return Response.json({ ok: false, error: "That font is not in the Google Fonts catalog." }, { status: 404 });

  const result = await setFontFavourite(entry.family, read.body.favourite, session.actor.id);
  if (result.ok === false) return Response.json({ ok: false, error: result.error }, { status: result.status });
  return Response.json({ ok: true, favourites: result.favourites });
});
