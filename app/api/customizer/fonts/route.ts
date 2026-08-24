// GET /api/customizer/fonts — sanitized Google Fonts catalog for the
// Admin and customer customizers (spec §4).
//
// The Google Fonts Developer API key lives ONLY on the server. This route
// returns family/category/weights/italic and nothing else — no key, no font
// file URLs, no upstream metadata (spec §30).

import { getFontCatalog, GoogleFontsConfigError } from "@/lib/customizer/v2/server/google-fonts-catalog";
import { searchFamilies, toClientCatalog, DEFAULT_FONT_FAMILY } from "@/lib/customizer/v2/google-fonts";
import { rateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
// The catalog is public, non-personal and identical for everyone, so it is
// safe (and much faster) to let Next cache the response.
export const revalidate = 3600;

type ParsedLimit =
  | { ok: true; value: number | null }
  | { ok: false };

/**
 * A missing limit deliberately means "the complete current catalog". Parse
 * the raw string before converting it to a number so `null` can never become
 * `0` (and subsequently be clamped to `1`). The eventual result count is
 * bounded by the cached catalog length, not by a stale hard-coded ceiling.
 */
function parseLimit(rawLimit: string | null): ParsedLimit {
  if (rawLimit === null) return { ok: true, value: null };

  const normalized = rawLimit.trim();
  if (!/^[1-9]\d*$/.test(normalized)) return { ok: false };

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) return { ok: false };

  return { ok: true, value: parsed };
}

export async function GET(request: Request) {
  const limited = rateLimit(request, { name: "customizer-fonts", limit: 120, windowMs: 10 * 60 * 1000 });
  if (limited) return limited;

  const url = new URL(request.url);

  // Validated query parameters only — nothing here can steer a server fetch.
  const rawQuery = url.searchParams.get("q") || "";
  const query = rawQuery.slice(0, 80).trim();
  const parsedLimit = parseLimit(url.searchParams.get("limit"));

  if (!parsedLimit.ok) {
    return Response.json(
      { ok: false, error: "The limit parameter must be a positive safe integer.", code: "INVALID_LIMIT" },
      { status: 400 },
    );
  }

  try {
    const catalog = await getFontCatalog();
    const limit = parsedLimit.value === null
      ? catalog.length
      : Math.min(parsedLimit.value, catalog.length);
    const matched = query ? searchFamilies(catalog, query, limit) : catalog.slice(0, limit);

    return Response.json({
      ok: true,
      total: catalog.length,
      defaultFamily: DEFAULT_FONT_FAMILY,
      families: toClientCatalog(matched),
    });
  } catch (error) {
    if (error instanceof GoogleFontsConfigError) {
      // A controlled configuration error — never a crash, and never surfaced
      // as a raw upstream message.
      return Response.json(
        { ok: false, error: "Google Fonts is not configured on this server.", code: "GOOGLE_FONTS_NOT_CONFIGURED" },
        { status: 503 },
      );
    }
    console.error("[fonts] Could not serve the font catalog:", error instanceof Error ? error.message : error);
    return Response.json(
      { ok: false, error: "Google Fonts are temporarily unavailable.", code: "GOOGLE_FONTS_UNAVAILABLE" },
      { status: 503 },
    );
  }
}
