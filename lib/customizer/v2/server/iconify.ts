// Server-only Iconify service: search, collections, and SVG fetch.
//
// Iconify is a discovery/import source, never a runtime dependency of a saved
// design (spec §2). This module is the ONLY place that talks to Iconify.
//
// PROVIDER ABSTRACTION (spec §3): the upstream origin comes from
// ICONIFY_API_BASE_URL and defaults to the public API. Pointing Husnalogy at a
// self-hosted instance later (e.g. https://icons.husnalogy.com) is a config
// change, not a customizer rewrite. No API key exists or is required (spec §4).
//
// SECURITY: every upstream URL is constructed here from validated identity
// parts. No client-supplied URL ever reaches fetch(), and this is not a general
// proxy (spec §60).

import {
  normalizeCollections,
  normalizeSearchResponse,
  parseIconIdentity,
  type IconifyCollection,
  type NormalizedSearch,
} from "../iconify";

const DEFAULT_BASE_URL = "https://api.iconify.design";

const SEARCH_TIMEOUT_MS = 6000;
const COLLECTIONS_TIMEOUT_MS = 8000;
const SVG_TIMEOUT_MS = 6000;

/** Hard ceiling on an upstream SVG (spec §61). */
export const MAX_SVG_BYTES = 512 * 1024;

const COLLECTIONS_TTL_MS = 12 * 60 * 60 * 1000;
const SEARCH_TTL_MS = 30 * 60 * 1000;
/** Bounded so a hostile query stream cannot grow memory without limit (spec §9). */
const SEARCH_CACHE_MAX_ENTRIES = 300;

export class IconifyUnavailableError extends Error {
  code = "ICONIFY_UNAVAILABLE" as const;
  constructor(message = "Online graphics are temporarily unavailable.") {
    super(message);
    this.name = "IconifyUnavailableError";
  }
}

/**
 * The configured upstream origin. Validated so a malformed env value fails
 * loudly here rather than producing a surprising request later.
 */
export function iconifyBaseUrl(): string {
  const configured = String(process.env.ICONIFY_API_BASE_URL || "").trim();
  if (!configured) return DEFAULT_BASE_URL;
  try {
    const parsed = new URL(configured);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      console.error("[iconify] ICONIFY_API_BASE_URL must be an http(s) origin; falling back to the default.");
      return DEFAULT_BASE_URL;
    }
    return parsed.origin;
  } catch {
    console.error("[iconify] ICONIFY_API_BASE_URL is not a valid URL; falling back to the default.");
    return DEFAULT_BASE_URL;
  }
}

async function fetchUpstream(path: string, params: Record<string, string>, timeoutMs: number): Promise<Response> {
  // The URL is always built here from a fixed path plus encoded params.
  const url = new URL(path, `${iconifyBaseUrl()}/`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  try {
    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json, image/svg+xml;q=0.9, */*;q=0.1" },
    });
    if (!response.ok) {
      console.error(`[iconify] upstream ${path} responded ${response.status}`);
      throw new IconifyUnavailableError();
    }
    return response;
  } catch (error) {
    if (error instanceof IconifyUnavailableError) throw error;
    console.error(`[iconify] upstream ${path} failed:`, error instanceof Error ? error.message : error);
    throw new IconifyUnavailableError();
  }
}

/* ---------------------------------------------------------- collections -- */

type CollectionsCache = { collections: Map<string, IconifyCollection>; fetchedAt: number };

const globalCache = globalThis as unknown as {
  __husnalogyIconifyCollections?: CollectionsCache | null;
  __husnalogyIconifyCollectionsInflight?: Promise<Map<string, IconifyCollection>> | null;
  __husnalogyIconifySearch?: Map<string, { value: NormalizedSearch; fetchedAt: number }>;
};

function searchCache() {
  if (!globalCache.__husnalogyIconifySearch) globalCache.__husnalogyIconifySearch = new Map();
  return globalCache.__husnalogyIconifySearch;
}

/**
 * Collection metadata (names, authors, licenses). This is what the license
 * policy is applied against, so it is fetched once and cached — a search must
 * never be gated on stale-or-missing license data.
 */
export async function getCollections(options: { forceRefresh?: boolean } = {}): Promise<Map<string, IconifyCollection>> {
  const cached = globalCache.__husnalogyIconifyCollections;
  const now = Date.now();
  if (!options.forceRefresh && cached && now - cached.fetchedAt < COLLECTIONS_TTL_MS) {
    return cached.collections;
  }

  if (globalCache.__husnalogyIconifyCollectionsInflight) {
    try {
      return await globalCache.__husnalogyIconifyCollectionsInflight;
    } catch {
      // fall through to the stale-cache handling below
    }
  }

  const inflight = (async () => {
    const response = await fetchUpstream("collections", {}, COLLECTIONS_TIMEOUT_MS);
    const payload = await response.json().catch(() => null);
    const collections = normalizeCollections(payload);
    if (!collections.size) throw new IconifyUnavailableError();
    globalCache.__husnalogyIconifyCollections = { collections, fetchedAt: Date.now() };
    return collections;
  })();

  globalCache.__husnalogyIconifyCollectionsInflight = inflight;
  try {
    return await inflight;
  } catch (error) {
    // A cached copy keeps search working through a brief upstream outage.
    if (cached) {
      console.warn("[iconify] serving cached collections after a refresh failure");
      return cached.collections;
    }
    throw error;
  } finally {
    globalCache.__husnalogyIconifyCollectionsInflight = null;
  }
}

/* -------------------------------------------------------------- search -- */

export type SearchOptions = {
  query: string;
  page: number;
  pageSize: number;
  audience?: "customer" | "admin";
};

function searchCacheKey(options: SearchOptions): string {
  return `${options.audience || "customer"}|${options.query}|${options.page}|${options.pageSize}`;
}

function readSearchCache(key: string): NormalizedSearch | null {
  const entry = searchCache().get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > SEARCH_TTL_MS) {
    searchCache().delete(key);
    return null;
  }
  // Refresh recency for the bounded LRU below.
  searchCache().delete(key);
  searchCache().set(key, entry);
  return entry.value;
}

function writeSearchCache(key: string, value: NormalizedSearch): void {
  const cache = searchCache();
  cache.set(key, { value, fetchedAt: Date.now() });
  while (cache.size > SEARCH_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Search Iconify and apply the license policy.
 *
 * Results are cached per (audience, query, page, pageSize) so common terms
 * ("heart", "flower", "wedding") do not hit Iconify repeatedly (spec §9).
 */
export async function searchIcons(options: SearchOptions): Promise<NormalizedSearch> {
  const key = searchCacheKey(options);
  const cached = readSearchCache(key);
  if (cached) return cached;

  const collections = await getCollections();

  // Iconify pages by absolute offset; over-fetch a little because the license
  // gate removes some results and we still want a full-looking page.
  const start = (options.page - 1) * options.pageSize;
  const response = await fetchUpstream(
    "search",
    { query: options.query, limit: String(Math.min(999, options.pageSize * 2)), start: String(start) },
    SEARCH_TIMEOUT_MS,
  );
  const payload = await response.json().catch(() => null);

  const normalized = normalizeSearchResponse(payload, collections, options.audience || "customer");
  const trimmed: NormalizedSearch = {
    ...normalized,
    results: normalized.results.slice(0, options.pageSize),
  };
  writeSearchCache(key, trimmed);
  return trimmed;
}

/* ----------------------------------------------------------------- svg -- */

export type FetchedIconSvg = {
  key: string;
  svg: string;
  bytes: number;
};

/**
 * Fetch one icon's raw SVG from the trusted upstream.
 *
 * `iconKey` MUST already be a validated canonical identity — the URL is built
 * from its parts, so there is no way for a caller to reach an arbitrary
 * address. The response is size-capped before it is read into memory.
 *
 * The returned SVG is NOT yet sanitized: the caller passes it through
 * Husnalogy's existing sanitizer (spec §59).
 */
export async function fetchIconSvg(iconKey: string): Promise<FetchedIconSvg> {
  const identity = parseIconIdentity(iconKey);
  if (!identity) throw new Error("Invalid icon identity.");

  // Path segments come from the validated identity: [a-z0-9-] only.
  const response = await fetchUpstream(`${identity.prefix}/${identity.name}.svg`, {}, SVG_TIMEOUT_MS);

  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength && declaredLength > MAX_SVG_BYTES) {
    throw new Error("This graphic is too large to import.");
  }

  const text = await response.text();
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_SVG_BYTES) throw new Error("This graphic is too large to import.");
  if (!text.trim()) throw new Error("The graphic could not be downloaded.");
  // Iconify answers a miss with a 404-ish body rather than markup.
  if (!/<svg[\s>]/i.test(text)) throw new Error("This graphic is no longer available.");

  return { key: identity.key, svg: text, bytes };
}

/** Metadata for one icon's collection, for import provenance (spec §18). */
export async function getCollectionFor(iconKey: string): Promise<IconifyCollection | null> {
  const identity = parseIconIdentity(iconKey);
  if (!identity) return null;
  const collections = await getCollections();
  return collections.get(identity.prefix) || null;
}

/* ------------------------------------------------------------ test hooks -- */

export function __resetIconifyCaches(): void {
  globalCache.__husnalogyIconifyCollections = null;
  globalCache.__husnalogyIconifyCollectionsInflight = null;
  globalCache.__husnalogyIconifySearch = new Map();
}

export function __seedIconifyCollections(collections: Map<string, IconifyCollection>, fetchedAt = Date.now()): void {
  globalCache.__husnalogyIconifyCollections = { collections, fetchedAt };
}

export function __searchCacheSize(): number {
  return searchCache().size;
}
