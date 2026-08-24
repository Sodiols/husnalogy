import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
import { normalizeCatalog } from "../google-fonts";
import { __seedFontCatalogCache, __resetFontCatalogCache } from "../server/google-fonts-catalog";
import { __resetFontFileCaches } from "../server/google-font-files";
import { __resetParsedFontCache } from "../server/server-fonts";

// Deterministic Google Fonts harness for render tests.
//
// The catalog is seeded directly and every fonts.gstatic.com download is
// served from a REAL local TTF, so the whole pipeline runs for real —
// dependency resolution → download → opentype parse → measurement → resvg →
// PNG/PDF — with no network call and no dependence on the live Google API
// (spec §35: build validation stays deterministic).
//
// Only the font BYTES are stand-ins. Which family/variant the pipeline asks
// for, and that it refuses to substitute, is genuinely exercised.

const BRAND_FONTS = join(process.cwd(), "app", "brand-fonts");

// Real, parseable font files used as the served payload.
const SERIF_REGULAR = join(BRAND_FONTS, "CormorantGaramond-400.ttf");
const SERIF_BOLD = join(BRAND_FONTS, "CormorantGaramond-700.ttf");
const SERIF_ITALIC = join(BRAND_FONTS, "CormorantGaramond-400-italic.ttf");
const SANS_REGULAR = join(BRAND_FONTS, "Inter-400.ttf");
const SANS_BOLD = join(BRAND_FONTS, "Inter-700.ttf");
const SANS_ITALIC = join(BRAND_FONTS, "Inter-400-italic.ttf");

// Unique per install() call: the on-disk font cache is keyed by URL, so a
// fresh install must not be able to reuse a file another test downloaded —
// otherwise a test that stubs a download FAILURE would silently pass from cache.
let installCounter = 0;
let RUN = `t${Date.now().toString(36)}-0`;

const url = (slug: string, variant: string) => `https://fonts.gstatic.com/s/${slug}/${RUN}/${slug}-${variant}.ttf`;

function buildCatalogPayload() {
  return {
    items: TEST_CATALOG_PAYLOAD.items.map((item) => ({
      ...item,
      files: Object.fromEntries(
        Object.entries(item.files).map(([key, value]) => [
          key,
          String(value).replace(/\/s\/([^/]+)\/[^/]+\//, `/s/$1/${RUN}/`),
        ]),
      ),
    })),
  };
}

/**
 * A catalog covering everything spec §34 requires: a serif, a sans-serif, a
 * script/display family, plus bold and italic variants.
 */
export const TEST_CATALOG_PAYLOAD = {
  items: [
    {
      family: "Playfair Display",
      category: "serif",
      subsets: ["latin"],
      version: "v30",
      lastModified: "2024-01-01",
      variants: ["regular", "700", "italic"],
      files: {
        regular: url("playfairdisplay", "400"),
        "700": url("playfairdisplay", "700"),
        italic: url("playfairdisplay", "400i"),
      },
    },
    {
      family: "Montserrat",
      category: "sans-serif",
      subsets: ["latin"],
      version: "v26",
      lastModified: "2024-01-01",
      variants: ["regular", "700", "italic"],
      files: {
        regular: url("montserrat", "400"),
        "700": url("montserrat", "700"),
        italic: url("montserrat", "400i"),
      },
    },
    {
      family: "Dancing Script",
      category: "handwriting",
      subsets: ["latin"],
      version: "v25",
      lastModified: "2024-01-01",
      variants: ["regular", "700"],
      files: { regular: url("dancingscript", "400"), "700": url("dancingscript", "700") },
    },
    {
      family: "Inter",
      category: "sans-serif",
      subsets: ["latin"],
      version: "v13",
      lastModified: "2024-01-01",
      variants: ["regular", "700", "italic"],
      files: { regular: url("inter", "400"), "700": url("inter", "700"), italic: url("inter", "400i") },
    },
  ],
};

export const TEST_CATALOG = normalizeCatalog(TEST_CATALOG_PAYLOAD);

/** Which real TTF backs each stubbed download. */
function fileForUrl(requested: string): string {
  const serif = requested.includes("playfairdisplay") || requested.includes("dancingscript");
  if (requested.endsWith("400i.ttf")) return serif ? SERIF_ITALIC : SANS_ITALIC;
  if (requested.endsWith("700.ttf")) return serif ? SERIF_BOLD : SANS_BOLD;
  return serif ? SERIF_REGULAR : SANS_REGULAR;
}

/** Every font URL the harness served, so tests can assert exact resolution. */
export const requestedFontUrls: string[] = [];

/**
 * Seed the catalog and stub font downloads. Call in `beforeEach`.
 * Returns the fetch spy so a test can assert download counts.
 */
export function installGoogleFontsHarness() {
  requestedFontUrls.length = 0;
  installCounter += 1;
  RUN = `t${Date.now().toString(36)}-${installCounter}`;
  __resetFontCatalogCache();
  __resetFontFileCaches();
  __resetParsedFontCache();
  __seedFontCatalogCache(normalizeCatalog(buildCatalogPayload()));

  const realFetch = globalThis.fetch;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
    const requested = String(typeof input === "string" ? input : input?.url || "");
    if (requested.startsWith("https://fonts.gstatic.com/")) {
      requestedFontUrls.push(requested);
      const bytes = readFileSync(fileForUrl(requested));
      return new Response(new Uint8Array(bytes), { status: 200 }) as any;
    }
    // Anything else (data: URIs, other test fixtures) behaves normally.
    return realFetch(input, init);
  });
}

export function resetGoogleFontsHarness() {
  __resetFontCatalogCache();
  __resetFontFileCaches();
  __resetParsedFontCache();
  requestedFontUrls.length = 0;
}
