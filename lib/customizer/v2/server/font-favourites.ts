/**
 * Favourite Fonts store (Customizer Point 4) — `customizer_font_favourites`.
 *
 * Read by every customizer (through /api/customizer/fonts/favourites) and
 * written only by administrators. Reads are cached briefly per server process;
 * a write clears the cache so the admin who toggled a star sees it at once.
 *
 * Until the migration that creates the table is applied, reads return an empty
 * list rather than failing: the font selector must keep working, it simply has
 * no favourites to show yet.
 */

import { createServiceRoleClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/observability/logger";

const TABLE = "customizer_font_favourites";
const CACHE_MS = 30_000;

let cache: { at: number; families: string[] } | null = null;

/** Postgres "undefined table" and PostgREST "table not in schema cache". */
function isMissingTable(error: any): boolean {
  const code = String(error?.code || "");
  return code === "42P01" || code === "PGRST205";
}

export function clearFontFavouritesCache() {
  cache = null;
}

export async function getFontFavourites(now = Date.now()): Promise<string[]> {
  if (cache && now - cache.at < CACHE_MS) return cache.families;
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from(TABLE).select("family").order("family");
  if (error) {
    if (!isMissingTable(error)) logEvent("error", "customizer.font_favourites_read_failed", { error });
    return [];
  }
  const families = (data || []).map((row: any) => String(row.family)).filter(Boolean);
  cache = { at: now, families };
  return families;
}

export type FavouriteWriteResult = { ok: true; favourites: string[] } | { ok: false; status: number; error: string };

export async function setFontFavourite(family: string, favourite: boolean, actorId: string): Promise<FavouriteWriteResult> {
  const supabase = createServiceRoleClient();
  const { error } = favourite
    ? await supabase.from(TABLE).upsert({ family, created_by: actorId || null }, { onConflict: "family", ignoreDuplicates: true })
    : await supabase.from(TABLE).delete().eq("family", family);
  if (error) {
    if (isMissingTable(error)) {
      return { ok: false, status: 503, error: "Favourite fonts are not set up yet. Apply the customizer_font_favourites migration." };
    }
    logEvent("error", "customizer.font_favourites_write_failed", { family, error });
    return { ok: false, status: 500, error: "The favourite could not be saved." };
  }
  clearFontFavouritesCache();
  return { ok: true, favourites: await getFontFavourites() };
}
