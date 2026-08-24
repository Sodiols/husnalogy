// Google Fonts catalog model — pure, dependency-free, no network.
//
// This replaces the old fixed six-font registry (lib/customizer/v2/fonts.ts).
// Everything here is deterministic so catalog normalization, search, variant
// parsing, weight resolution and validation are all unit testable without
// touching the Google Fonts Developer API.
//
// The Developer API returns variants as the strings "regular", "italic",
// "100", "300italic", "700", "700italic", ... and a `files` map keyed by those
// same strings. We normalize that into an explicit {weight, style} model the
// toolbar, validator and renderer can all share.

/** One concrete downloadable cut of a family. */
export type GoogleFontVariant = {
  /** Google's own variant key, e.g. "regular" | "700italic" — also the `files` key. */
  key: string;
  /** CSS numeric weight as a string, e.g. "400" | "700". */
  weight: string;
  style: "normal" | "italic";
  /** Absolute font file URL from the trusted catalog. */
  url: string;
};

export type GoogleFontFamily = {
  family: string;
  category: string;
  variants: GoogleFontVariant[];
  weights: string[];
  hasItalic: boolean;
  subsets: string[];
  version: string;
  lastModified: string;
};

/** The trimmed shape sent to the browser — no file URLs, no API metadata. */
export type CatalogFamilyForClient = {
  family: string;
  category: string;
  weights: string[];
  hasItalic: boolean;
};

/**
 * The single default family for the whole customizer. Centralized so no module
 * hardcodes its own assumption (spec §24). Inter is a stable, long-standing
 * Google family; if it ever disappears from the catalog the resolver falls
 * back to the first available family rather than to a bundled local file.
 */
export const DEFAULT_FONT_FAMILY = "Inter";

/** Exact default written by the retired six-font registry. Only this complete
 * set is migrated to the new empty-means-all rule; genuine custom allowlists
 * remain restrictions. */
export const LEGACY_DEFAULT_CUSTOMER_FONTS = [
  "Cormorant Garamond",
  "Inter",
  "Georgia",
  "Times New Roman",
  "Arial",
  "Courier New",
] as const;

/** Catalog schema version — bumped when normalization changes so cached
 *  render input hashes invalidate correctly. Replaces FONT_REGISTRY_VERSION. */
export const FONT_CATALOG_VERSION = "google-fonts.2026.08.24.1";

const VARIANT_PATTERN = /^(\d{3})?(regular|italic)?$/;

/** Parse one Google variant key into an explicit weight + style. */
export function parseVariantKey(key: string): { weight: string; style: "normal" | "italic" } | null {
  const raw = String(key || "").trim().toLowerCase();
  if (!raw) return null;

  if (raw === "regular") return { weight: "400", style: "normal" };
  if (raw === "italic") return { weight: "400", style: "italic" };

  const italic = raw.endsWith("italic");
  const numeric = italic ? raw.slice(0, -"italic".length) : raw;

  // "italic" already handled; a bare numeric or numeric+italic is what remains.
  if (!/^\d{3}$/.test(numeric)) {
    // Tolerate unexpected keys rather than throwing — an unknown variant is
    // simply not offered instead of breaking the whole catalog.
    return VARIANT_PATTERN.test(raw) ? { weight: "400", style: italic ? "italic" : "normal" } : null;
  }
  return { weight: numeric, style: italic ? "italic" : "normal" };
}

function sortWeights(weights: string[]): string[] {
  return [...new Set(weights)].sort((a, b) => Number(a) - Number(b));
}

/**
 * Normalize one raw Developer API item. Returns null for an item that carries
 * no usable downloadable variant, so the catalog never contains a family the
 * renderer could not actually produce.
 */
export function normalizeCatalogItem(item: any): GoogleFontFamily | null {
  const family = String(item?.family || "").trim();
  if (!family) return null;

  const files = (item?.files && typeof item.files === "object") ? item.files : {};
  const variants: GoogleFontVariant[] = [];

  for (const key of Array.isArray(item?.variants) ? item.variants : []) {
    const parsed = parseVariantKey(key);
    if (!parsed) continue;
    const url = files[key];
    if (typeof url !== "string" || !url) continue;
    variants.push({ key: String(key), weight: parsed.weight, style: parsed.style, url: normalizeFontUrl(url) });
  }

  if (!variants.length) return null;

  return {
    family,
    category: String(item?.category || "").trim() || "sans-serif",
    variants,
    weights: sortWeights(variants.map((variant) => variant.weight)),
    hasItalic: variants.some((variant) => variant.style === "italic"),
    subsets: Array.isArray(item?.subsets) ? item.subsets.map(String) : [],
    version: String(item?.version || ""),
    lastModified: String(item?.lastModified || ""),
  };
}

/** Google still returns some http:// URLs; upgrade them so we never fetch font
 *  binaries over plaintext. */
export function normalizeFontUrl(url: string): string {
  return String(url || "").replace(/^http:\/\//i, "https://");
}

export function normalizeCatalog(payload: any): GoogleFontFamily[] {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const families: GoogleFontFamily[] = [];
  for (const item of items) {
    const normalized = normalizeCatalogItem(item);
    if (normalized) families.push(normalized);
  }
  return families;
}

/* ------------------------------------------------------------------ lookup */

export function findFamily(catalog: GoogleFontFamily[], family: string | null | undefined): GoogleFontFamily | null {
  const wanted = String(family || "").trim().toLowerCase();
  if (!wanted) return null;
  return catalog.find((entry) => entry.family.toLowerCase() === wanted) || null;
}

export function isKnownFamily(catalog: GoogleFontFamily[], family: string | null | undefined): boolean {
  return findFamily(catalog, family) !== null;
}

/* ------------------------------------------------------------------ search */

/**
 * Case-insensitive family search. Ranks exact match first, then prefix, then
 * substring, then category match — so "mont" surfaces Montserrat above
 * "Font-ish" names, and "script" can still find handwriting families.
 */
export function searchFamilies(
  catalog: GoogleFontFamily[],
  query: string,
  limit = 100,
): GoogleFontFamily[] {
  const term = String(query || "").trim().toLowerCase();
  if (!term) return catalog.slice(0, limit);

  const scored: Array<{ entry: GoogleFontFamily; score: number }> = [];
  for (const entry of catalog) {
    const name = entry.family.toLowerCase();
    let score = -1;
    if (name === term) score = 0;
    else if (name.startsWith(term)) score = 1;
    else if (name.includes(term)) score = 2;
    else if (entry.category.toLowerCase().includes(term)) score = 3;
    if (score >= 0) scored.push({ entry, score });
  }

  scored.sort((a, b) => a.score - b.score || a.entry.family.localeCompare(b.entry.family));
  return scored.slice(0, limit).map((item) => item.entry);
}

/* ----------------------------------------------------------------- weights */

/** Weights a family can actually render, ascending. Empty for unknown. */
export function supportedWeightsFor(catalog: GoogleFontFamily[], family: string | undefined): string[] {
  const entry = findFamily(catalog, family);
  return entry ? [...entry.weights] : [];
}

export function supportsItalic(catalog: GoogleFontFamily[], family: string | undefined): boolean {
  const entry = findFamily(catalog, family);
  return Boolean(entry?.hasItalic);
}

/**
 * Nearest weight the family genuinely has. Ties resolve to the heavier cut,
 * matching how the renderer picks a variant, so the toolbar never shows a
 * weight production cannot reproduce.
 */
export function nearestWeight(available: string[], requested: unknown): string {
  const weights = sortWeights(available.filter(Boolean));
  if (!weights.length) return "400";
  const target = Number(requested) || 400;
  if (weights.includes(String(target))) return String(target);
  return weights.reduce((best, current) => {
    const bestDelta = Math.abs(Number(best) - target);
    const currentDelta = Math.abs(Number(current) - target);
    if (currentDelta < bestDelta) return current;
    if (currentDelta === bestDelta && Number(current) > Number(best)) return current;
    return best;
  }, weights[0]);
}

/**
 * Resolve the exact downloadable variant for a family/weight/style.
 * Falls back within the SAME family only — never to a different family, so
 * production output can never silently change typeface (spec §18).
 */
export function resolveVariant(
  catalog: GoogleFontFamily[],
  family: string,
  weight: string | number = "400",
  style: "normal" | "italic" = "normal",
): GoogleFontVariant | null {
  const entry = findFamily(catalog, family);
  if (!entry) return null;

  const wanted = String(weight || "400");
  const exact = entry.variants.find((variant) => variant.weight === wanted && variant.style === style);
  if (exact) return exact;

  const sameStyle = entry.variants.filter((variant) => variant.style === style);
  if (sameStyle.length) {
    const best = nearestWeight(sameStyle.map((variant) => variant.weight), wanted);
    return sameStyle.find((variant) => variant.weight === best) || sameStyle[0];
  }

  // Requested italic but the family has none: use the upright cut of the
  // nearest weight. Same family, so the typeface itself is preserved.
  const best = nearestWeight(entry.weights, wanted);
  return entry.variants.find((variant) => variant.weight === best) || entry.variants[0] || null;
}

/* -------------------------------------------------------------- dependency */

export type TextStyleLike = { fontFamily?: string; fontWeight?: string | number; fontStyle?: string };

export type FontDependency = {
  family: string;
  weight: string;
  style: "normal" | "italic";
  url: string;
  variantKey: string;
};

/**
 * Every distinct font variant a set of text styles depends on, plus any family
 * the catalog does not know. The render pipeline uses this to fetch exactly
 * the files a job needs and to fail loudly on an unresolvable family.
 */
export function collectFontDependencies(
  catalog: GoogleFontFamily[],
  styles: TextStyleLike[],
  defaultFamily: string = DEFAULT_FONT_FAMILY,
): { dependencies: FontDependency[]; missingFamilies: string[] } {
  const found = new Map<string, FontDependency>();
  const missing = new Set<string>();

  for (const style of styles) {
    const family = String(style?.fontFamily || defaultFamily).trim() || defaultFamily;
    const wantedStyle = style?.fontStyle === "italic" ? "italic" : "normal";
    const variant = resolveVariant(catalog, family, style?.fontWeight ?? "400", wantedStyle);
    if (!variant) {
      missing.add(family);
      continue;
    }
    const entry = findFamily(catalog, family);
    const key = `${entry?.family || family}|${variant.key}`;
    if (!found.has(key)) {
      found.set(key, {
        family: entry?.family || family,
        weight: variant.weight,
        style: variant.style,
        url: variant.url,
        variantKey: variant.key,
      });
    }
  }

  return { dependencies: [...found.values()], missingFamilies: [...missing] };
}

/* -------------------------------------------------------------- allowlist  */

/**
 * Template allowlist rule (spec §21): an EMPTY allowedCustomerFonts means
 * "every valid Google Font", matching the existing Husnalogy template rule.
 * A populated list restricts to exactly those families.
 */
export function isFamilyAllowedByTemplate(allowedCustomerFonts: unknown, family: string): boolean {
  const allowed = normalizeAllowedCustomerFonts(allowedCustomerFonts);
  if (!allowed.length) return true;
  const wanted = String(family || "").trim().toLowerCase();
  return allowed.some((entry) => entry.trim().toLowerCase() === wanted);
}

/**
 * Normalize stored customer font permissions without widening a deliberate
 * Admin allowlist. The only widening migration is the exact retired default
 * six-font set (order/case/outer whitespace insensitive).
 */
export function normalizeAllowedCustomerFonts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const candidate of value) {
    const family = String(candidate || "").trim();
    const key = family.toLowerCase();
    if (!family || seen.has(key)) continue;
    seen.add(key);
    normalized.push(family);
  }

  const legacy = new Set(LEGACY_DEFAULT_CUSTOMER_FONTS.map((family) => family.toLowerCase()));
  const isExactLegacyDefault = normalized.length === legacy.size
    && normalized.every((family) => legacy.has(family.toLowerCase()));
  return isExactLegacyDefault ? [] : normalized;
}

/** Trim a family list down to what the client actually needs. */
export function toClientCatalog(catalog: GoogleFontFamily[]): CatalogFamilyForClient[] {
  return catalog.map((entry) => ({
    family: entry.family,
    category: entry.category,
    weights: entry.weights,
    hasItalic: entry.hasItalic,
  }));
}
