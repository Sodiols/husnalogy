// Iconify identity + license policy — pure, dependency-free, no network.
//
// Iconify is a DISCOVERY AND IMPORT source only. Once an icon is imported it
// becomes an ordinary Husnalogy `customizer_assets` record with its own stored
// bytes; nothing in a saved design, cart, order or render ever depends on
// Iconify again (spec §2, §55).
//
// Everything here is deterministic so identity validation, license policy and
// name formatting are unit tested without touching the Iconify API.

/* ------------------------------------------------------------- identity -- */

/**
 * A canonical Iconify icon identity, e.g. "mdi:heart" or "ph:flower-duotone".
 *
 * Both halves are restricted to lowercase alphanumerics and single hyphens.
 * That is deliberately stricter than Iconify itself: the client only ever
 * supplies an IDENTITY, never a URL, and the server builds the upstream URL
 * from these validated parts — so a crafted value cannot steer a request
 * (spec §12, §60).
 */
export type IconifyIdentity = {
  /** Collection prefix, e.g. "mdi". */
  prefix: string;
  /** Icon name within the collection, e.g. "heart-outline". */
  name: string;
  /** Canonical "prefix:name". */
  key: string;
};

const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SEGMENT_LENGTH = 64;

/**
 * Parse and validate a canonical icon key. Returns null for ANYTHING that is
 * not a plain `prefix:name` pair — URLs, schemes, paths, traversal, markup,
 * whitespace and empty segments are all rejected.
 */
export function parseIconIdentity(value: unknown): IconifyIdentity | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > MAX_SEGMENT_LENGTH * 2 + 1) return null;

  // Exactly one separator, and nothing that could be a scheme or a path.
  if (raw.includes("/") || raw.includes("\\") || raw.includes("..")) return null;
  const parts = raw.split(":");
  if (parts.length !== 2) return null;

  const [prefix, name] = parts.map((part) => part.trim().toLowerCase());
  if (!prefix || !name) return null;
  if (prefix.length > MAX_SEGMENT_LENGTH || name.length > MAX_SEGMENT_LENGTH) return null;
  if (!SEGMENT.test(prefix) || !SEGMENT.test(name)) return null;

  return { prefix, name, key: `${prefix}:${name}` };
}

export function isValidIconKey(value: unknown): boolean {
  return parseIconIdentity(value) !== null;
}

/** "heart-outline" → "Heart Outline" (spec §54). Canonical key is kept separately. */
export function friendlyIconName(name: string): string {
  return String(name || "")
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Search query normalization: bounded, trimmed, control characters removed. */
export const MAX_QUERY_LENGTH = 64;

export function normalizeSearchQuery(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

export const MIN_PAGE_SIZE = 1;
export const MAX_PAGE_SIZE = 60;
export const DEFAULT_PAGE_SIZE = 48;
export const MAX_PAGE = 40;

export function normalizePageSize(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, parsed));
}

export function normalizePage(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.min(MAX_PAGE, parsed);
}

/* -------------------------------------------------------------- licenses -- */

export type LicenseVerdict = "allowed" | "requires-attribution" | "blocked" | "unknown";

export type CollectionLicense = {
  title?: string;
  spdx?: string;
  url?: string;
};

export type LicenseDecision = {
  verdict: LicenseVerdict;
  /** Whether this collection may be offered to CUSTOMERS. */
  customerAllowed: boolean;
  /** Short, admin-facing explanation. */
  reason: string;
  spdx: string;
  title: string;
  url: string;
};

/**
 * SPDX identifiers Husnalogy accepts for customer-facing use: permissive or
 * public-domain families that carry no per-design attribution obligation.
 *
 * This list is the single place to widen the policy later (spec §25).
 */
export const ALLOWED_SPDX = new Set([
  "MIT",
  "APACHE-2.0",
  "BSD-2-CLAUSE",
  "BSD-3-CLAUSE",
  "ISC",
  "CC0-1.0",
  "UNLICENSE",
  "0BSD",
  "MIT-0",
]);

/**
 * Licenses that are legitimate open licenses but require visible attribution.
 * Husnalogy has no per-design attribution surface yet, so these are withheld
 * from customers rather than shipped with the obligation silently dropped
 * (spec §23).
 */
export const ATTRIBUTION_SPDX = new Set([
  "CC-BY-4.0",
  "CC-BY-3.0",
  "CC-BY-SA-4.0",
  "CC-BY-SA-3.0",
  "OFL-1.1",
  "GPL-3.0",
  "GPL-2.0",
  "AGPL-3.0",
  "LGPL-3.0",
  "MPL-2.0",
]);

function normalizeSpdx(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

/**
 * Some collections report only a human title. Map the unambiguous ones; a
 * title we cannot map confidently stays UNKNOWN and therefore blocked.
 */
const TITLE_TO_SPDX: Array<[RegExp, string]> = [
  [/^mit\b/i, "MIT"],
  [/apache\s*2/i, "APACHE-2.0"],
  [/^isc\b/i, "ISC"],
  [/cc0/i, "CC0-1.0"],
  [/public\s*domain/i, "CC0-1.0"],
  [/unlicense/i, "UNLICENSE"],
  [/bsd[\s-]*3/i, "BSD-3-CLAUSE"],
  [/bsd[\s-]*2/i, "BSD-2-CLAUSE"],
  [/cc[\s-]*by[\s-]*sa/i, "CC-BY-SA-4.0"],
  [/cc[\s-]*by/i, "CC-BY-4.0"],
  [/open\s*font|ofl/i, "OFL-1.1"],
  [/apache/i, "APACHE-2.0"],
];

export function inferSpdx(license: CollectionLicense | null | undefined): string {
  const direct = normalizeSpdx(license?.spdx);
  if (direct) return direct;
  const title = String(license?.title ?? "").trim();
  if (!title) return "";
  for (const [pattern, spdx] of TITLE_TO_SPDX) {
    if (pattern.test(title)) return spdx;
  }
  return "";
}

/**
 * The single license gate (spec §22–§25).
 *
 * FAILS CLOSED: anything we cannot positively identify as permissive is
 * withheld from customers. Admin still receives the diagnostic verdict so the
 * policy can be reviewed and widened deliberately.
 */
export function evaluateLicense(license: CollectionLicense | null | undefined): LicenseDecision {
  const spdx = inferSpdx(license);
  const title = String(license?.title ?? "").trim();
  const url = String(license?.url ?? "").trim();

  if (!spdx) {
    return {
      verdict: "unknown",
      customerAllowed: false,
      reason: title
        ? `License "${title}" could not be identified, so this collection is withheld from customers.`
        : "This collection reports no license, so it is withheld from customers.",
      spdx: "",
      title,
      url,
    };
  }

  if (ALLOWED_SPDX.has(spdx)) {
    return { verdict: "allowed", customerAllowed: true, reason: `${spdx} is a permitted permissive license.`, spdx, title, url };
  }

  if (ATTRIBUTION_SPDX.has(spdx)) {
    return {
      verdict: "requires-attribution",
      customerAllowed: false,
      reason: `${spdx} requires attribution, which Husnalogy does not yet surface on designs.`,
      spdx,
      title,
      url,
    };
  }

  return {
    verdict: "blocked",
    customerAllowed: false,
    reason: `${spdx} is not on the permitted license list.`,
    spdx,
    title,
    url,
  };
}

/** Convenience: may this collection be shown to a customer? */
export function isCustomerAllowedLicense(license: CollectionLicense | null | undefined): boolean {
  return evaluateLicense(license).customerAllowed;
}

/* ------------------------------------------------------------ collections -- */

export type IconifyCollection = {
  prefix: string;
  name: string;
  author: string;
  authorUrl: string;
  license: CollectionLicense;
  total: number;
  category: string;
};

export function normalizeCollection(prefix: string, raw: any): IconifyCollection | null {
  const identity = String(prefix || "").trim().toLowerCase();
  if (!identity || !SEGMENT.test(identity)) return null;
  return {
    prefix: identity,
    name: String(raw?.name ?? identity).trim(),
    author: String(raw?.author?.name ?? "").trim(),
    authorUrl: String(raw?.author?.url ?? "").trim(),
    license: {
      title: String(raw?.license?.title ?? "").trim() || undefined,
      spdx: String(raw?.license?.spdx ?? "").trim() || undefined,
      url: String(raw?.license?.url ?? "").trim() || undefined,
    },
    total: Number(raw?.total) || 0,
    category: String(raw?.category ?? "").trim(),
  };
}

export function normalizeCollections(raw: any): Map<string, IconifyCollection> {
  const collections = new Map<string, IconifyCollection>();
  if (!raw || typeof raw !== "object") return collections;
  for (const [prefix, entry] of Object.entries(raw)) {
    const normalized = normalizeCollection(prefix, entry);
    if (normalized) collections.set(normalized.prefix, normalized);
  }
  return collections;
}

/* ---------------------------------------------------------------- search -- */

export type IconifySearchResult = {
  key: string;
  prefix: string;
  name: string;
  /** Friendly display name, e.g. "Heart Outline". */
  title: string;
  collection: string;
  collectionName: string;
  author: string;
  license: CollectionLicense;
  licenseVerdict: LicenseVerdict;
};

export type NormalizedSearch = {
  results: IconifySearchResult[];
  /** Upstream total BEFORE license filtering (used only for "has more"). */
  total: number;
  /** How many upstream results this policy withheld. */
  filtered: number;
};

/**
 * Normalize a raw Iconify `/search` payload and apply the license gate.
 *
 * `audience: "customer"` returns only customer-permitted collections.
 * `audience: "admin"` returns everything but labels each verdict, so an
 * administrator can see WHY a collection is unavailable (spec §26).
 */
export function normalizeSearchResponse(
  raw: any,
  collections: Map<string, IconifyCollection>,
  audience: "customer" | "admin" = "customer",
): NormalizedSearch {
  const icons: string[] = Array.isArray(raw?.icons) ? raw.icons : [];
  const results: IconifySearchResult[] = [];
  let filtered = 0;

  for (const entry of icons) {
    const identity = parseIconIdentity(entry);
    if (!identity) {
      filtered += 1;
      continue;
    }
    const collection = collections.get(identity.prefix);
    const decision = evaluateLicense(collection?.license);

    if (audience === "customer" && !decision.customerAllowed) {
      filtered += 1;
      continue;
    }

    results.push({
      key: identity.key,
      prefix: identity.prefix,
      name: identity.name,
      title: friendlyIconName(identity.name),
      collection: identity.prefix,
      collectionName: collection?.name || identity.prefix,
      author: collection?.author || "",
      license: collection?.license || {},
      licenseVerdict: decision.verdict,
    });
  }

  return { results, total: Number(raw?.total) || icons.length, filtered };
}

/* ------------------------------------------------------------- curation -- */

/**
 * Customer-friendly discovery categories (spec §32). Each maps to a curated
 * query rather than a bespoke taxonomy, so it stays cheap to maintain.
 */
export const GRAPHIC_CATEGORIES: Array<{ id: string; label: string; query: string }> = [
  { id: "wedding", label: "Wedding", query: "wedding" },
  { id: "love", label: "Love", query: "heart" },
  { id: "flowers", label: "Flowers", query: "flower" },
  { id: "nature", label: "Nature", query: "leaf" },
  { id: "celebration", label: "Celebration", query: "celebration" },
  { id: "christmas", label: "Christmas", query: "christmas" },
  { id: "birthday", label: "Birthday", query: "birthday" },
  { id: "stars", label: "Stars", query: "star" },
  { id: "sparkles", label: "Sparkles", query: "sparkle" },
  { id: "arrows", label: "Arrows", query: "arrow" },
  { id: "gifts", label: "Gifts", query: "gift" },
  { id: "travel", label: "Travel", query: "travel" },
  { id: "food", label: "Food", query: "food" },
  { id: "symbols", label: "Symbols", query: "symbol" },
  { id: "decorative", label: "Decorative", query: "ornament" },
];

/** Stable favourite/recent identity for a not-yet-imported search result. */
export function remoteElementIdentity(key: string): string {
  return `iconify:${key}`;
}

export function isRemoteElementIdentity(value: string): boolean {
  return typeof value === "string" && value.startsWith("iconify:");
}
