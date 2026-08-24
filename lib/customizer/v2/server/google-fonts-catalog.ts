// Server-only Google Fonts catalog service.
//
// Flow (spec §4):
//   Google Fonts Developer API → this module → sanitized catalog → customizer
//
// The browser NEVER talks to the Developer API and never sees the key. One
// cached catalog backs the API route, save validation, weight resolution, the
// admin config UI and the production renderer (spec §22).

import {
  normalizeCatalog,
  type GoogleFontFamily,
} from "../google-fonts";

const GOOGLE_FONTS_ENDPOINT = "https://www.googleapis.com/webfonts/v1/webfonts";

/** Catalog changes rarely; refresh once a day. */
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
/** How long a stale catalog may still be served when Google is failing. */
const STALE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

export class GoogleFontsConfigError extends Error {
  code = "GOOGLE_FONTS_NOT_CONFIGURED" as const;
  constructor(message = "Google Fonts is not configured on this server.") {
    super(message);
    this.name = "GoogleFontsConfigError";
  }
}

export class GoogleFontsUnavailableError extends Error {
  code = "GOOGLE_FONTS_UNAVAILABLE" as const;
  constructor(message = "The Google Fonts catalog is temporarily unavailable.") {
    super(message);
    this.name = "GoogleFontsUnavailableError";
  }
}

type CatalogCache = {
  families: GoogleFontFamily[];
  fetchedAt: number;
};

// Module-level cache. On serverless this is per-instance, which is exactly
// right for a read-only public catalog: worst case each instance fetches once
// a day. `globalThis` keeps it alive across dev hot reloads.
const globalCache = globalThis as unknown as {
  __husnalogyFontCatalog?: CatalogCache | null;
  __husnalogyFontCatalogInflight?: Promise<GoogleFontFamily[]> | null;
};

export function isGoogleFontsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_FONTS_API_KEY);
}

function cacheEntry(): CatalogCache | null {
  return globalCache.__husnalogyFontCatalog || null;
}

async function fetchCatalogFromGoogle(): Promise<GoogleFontFamily[]> {
  const apiKey = process.env.GOOGLE_FONTS_API_KEY;
  if (!apiKey) throw new GoogleFontsConfigError();

  const url = new URL(GOOGLE_FONTS_ENDPOINT);
  // `popularity` gives us a useful default ordering for the "Popular" section
  // without a second request (spec §27).
  url.searchParams.set("sort", "popularity");

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      // Keep the secret out of the URL so framework/network diagnostics can
      // never print it. The Developer API accepts the standard Google API-key
      // header. This response is larger than Next's 2 MB data-cache limit, so
      // the trusted TTL/stale cache below is the sole catalog cache.
      headers: { "x-goog-api-key": apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Raw fetch errors can echo request details; log only a controlled message.
    console.error("[fonts] Google Fonts catalog request failed.");
    throw new GoogleFontsUnavailableError();
  }

  if (!response.ok) {
    console.error(`[fonts] Google Fonts catalog responded ${response.status}.`);
    throw new GoogleFontsUnavailableError();
  }

  const payload = await response.json().catch(() => null);
  const families = normalizeCatalog(payload);
  if (!families.length) {
    console.error("[fonts] Google Fonts catalog returned no usable families.");
    throw new GoogleFontsUnavailableError();
  }
  return families;
}

/**
 * The trusted catalog. Serves fresh cache when possible, refreshes when stale,
 * and — critically — keeps serving a stale cache if Google is temporarily
 * failing so the customizer never becomes unusable (spec §5, §28).
 */
export async function getFontCatalog(options: { forceRefresh?: boolean } = {}): Promise<GoogleFontFamily[]> {
  const cached = cacheEntry();
  const now = Date.now();

  if (!options.forceRefresh && cached && now - cached.fetchedAt < CATALOG_TTL_MS) {
    return cached.families;
  }

  // Collapse concurrent refreshes into one request.
  if (globalCache.__husnalogyFontCatalogInflight) {
    try {
      return await globalCache.__husnalogyFontCatalogInflight;
    } catch {
      // fall through to the stale-cache handling below
    }
  }

  const inflight = (async () => {
    const families = await fetchCatalogFromGoogle();
    globalCache.__husnalogyFontCatalog = { families, fetchedAt: Date.now() };
    return families;
  })();

  globalCache.__husnalogyFontCatalogInflight = inflight;

  try {
    return await inflight;
  } catch (error) {
    if (cached && now - cached.fetchedAt < STALE_GRACE_MS) {
      console.warn("[fonts] Serving the cached Google Fonts catalog after a refresh failure.");
      return cached.families;
    }
    throw error;
  } finally {
    globalCache.__husnalogyFontCatalogInflight = null;
  }
}

/**
 * Catalog for code paths that must not throw (save validation, preflight).
 * Returns an empty array when the catalog is genuinely unavailable so callers
 * can decide their own policy rather than crashing a storefront request.
 */
export async function getFontCatalogSafe(): Promise<GoogleFontFamily[]> {
  try {
    return await getFontCatalog();
  } catch (error) {
    console.error("[fonts] Font catalog unavailable:", error instanceof Error ? error.message : error);
    return cacheEntry()?.families || [];
  }
}

/** Test/maintenance helper — clears the in-process cache. */
export function __resetFontCatalogCache(): void {
  globalCache.__husnalogyFontCatalog = null;
  globalCache.__husnalogyFontCatalogInflight = null;
}

/** Seed the cache directly (used by tests and by the offline validator). */
export function __seedFontCatalogCache(families: GoogleFontFamily[], fetchedAt = Date.now()): void {
  globalCache.__husnalogyFontCatalog = { families, fetchedAt };
}
