import { describe, expect, it } from "vitest";
import {
  DEFAULT_FONT_FAMILY,
  collectFontDependencies,
  findFamily,
  isFamilyAllowedByTemplate,
  isKnownFamily,
  nearestWeight,
  normalizeCatalog,
  normalizeCatalogItem,
  normalizeFontUrl,
  parseVariantKey,
  resolveVariant,
  searchFamilies,
  supportedWeightsFor,
  supportsItalic,
  toClientCatalog,
} from "../google-fonts";

// A small fixture shaped exactly like the Google Fonts Developer API payload.
const RAW = {
  items: [
    {
      family: "Inter",
      variants: ["300", "regular", "italic", "500", "700", "700italic"],
      subsets: ["latin", "latin-ext"],
      version: "v13",
      lastModified: "2024-01-01",
      category: "sans-serif",
      files: {
        "300": "http://fonts.gstatic.com/s/inter/v13/inter-300.ttf",
        regular: "http://fonts.gstatic.com/s/inter/v13/inter-400.ttf",
        italic: "http://fonts.gstatic.com/s/inter/v13/inter-400i.ttf",
        "500": "http://fonts.gstatic.com/s/inter/v13/inter-500.ttf",
        "700": "http://fonts.gstatic.com/s/inter/v13/inter-700.ttf",
        "700italic": "http://fonts.gstatic.com/s/inter/v13/inter-700i.ttf",
      },
    },
    {
      family: "Playfair Display",
      variants: ["regular", "700"],
      subsets: ["latin"],
      version: "v30",
      lastModified: "2024-02-02",
      category: "serif",
      files: {
        regular: "https://fonts.gstatic.com/s/playfairdisplay/v30/pd-400.ttf",
        "700": "https://fonts.gstatic.com/s/playfairdisplay/v30/pd-700.ttf",
      },
    },
    {
      family: "Dancing Script",
      variants: ["regular"],
      subsets: ["latin"],
      version: "v25",
      lastModified: "2024-03-03",
      category: "handwriting",
      files: { regular: "https://fonts.gstatic.com/s/dancingscript/v25/ds-400.ttf" },
    },
    {
      family: "Montserrat",
      variants: ["regular", "italic", "600", "800"],
      subsets: ["latin"],
      version: "v26",
      lastModified: "2024-04-04",
      category: "sans-serif",
      files: {
        regular: "https://fonts.gstatic.com/s/montserrat/v26/m-400.ttf",
        italic: "https://fonts.gstatic.com/s/montserrat/v26/m-400i.ttf",
        "600": "https://fonts.gstatic.com/s/montserrat/v26/m-600.ttf",
        "800": "https://fonts.gstatic.com/s/montserrat/v26/m-800.ttf",
      },
    },
    // Must be dropped: declares variants but has no downloadable files.
    { family: "Broken Family", variants: ["regular"], files: {}, category: "serif", subsets: [] },
  ],
};

const catalog = normalizeCatalog(RAW);

describe("variant parsing", () => {
  it("maps Google variant keys to explicit weight + style", () => {
    expect(parseVariantKey("regular")).toEqual({ weight: "400", style: "normal" });
    expect(parseVariantKey("italic")).toEqual({ weight: "400", style: "italic" });
    expect(parseVariantKey("700")).toEqual({ weight: "700", style: "normal" });
    expect(parseVariantKey("300italic")).toEqual({ weight: "300", style: "italic" });
  });

  it("is case and whitespace tolerant", () => {
    expect(parseVariantKey("  700ITALIC ")).toEqual({ weight: "700", style: "italic" });
  });

  it("returns null for unusable keys instead of throwing", () => {
    expect(parseVariantKey("")).toBeNull();
    expect(parseVariantKey("not-a-variant")).toBeNull();
  });
});

describe("catalog normalization", () => {
  it("keeps only families with at least one downloadable variant", () => {
    expect(catalog.map((entry) => entry.family)).toEqual([
      "Inter",
      "Playfair Display",
      "Dancing Script",
      "Montserrat",
    ]);
    expect(findFamily(catalog, "Broken Family")).toBeNull();
  });

  it("derives ascending weights and italic availability", () => {
    const inter = findFamily(catalog, "Inter");
    expect(inter?.weights).toEqual(["300", "400", "500", "700"]);
    expect(inter?.hasItalic).toBe(true);

    const playfair = findFamily(catalog, "Playfair Display");
    expect(playfair?.weights).toEqual(["400", "700"]);
    expect(playfair?.hasItalic).toBe(false);
  });

  it("upgrades http font urls to https so binaries never load in plaintext", () => {
    const inter = findFamily(catalog, "Inter");
    expect(inter?.variants.every((variant) => variant.url.startsWith("https://"))).toBe(true);
    expect(normalizeFontUrl("http://fonts.gstatic.com/a.ttf")).toBe("https://fonts.gstatic.com/a.ttf");
  });

  it("drops a family whose variants have no matching file entry", () => {
    expect(normalizeCatalogItem({ family: "X", variants: ["regular"], files: {} })).toBeNull();
    expect(normalizeCatalogItem({ family: "", variants: ["regular"], files: { regular: "https://x/a.ttf" } })).toBeNull();
  });

  it("preserves category, subsets and version metadata", () => {
    const playfair = findFamily(catalog, "Playfair Display");
    expect(playfair?.category).toBe("serif");
    expect(playfair?.subsets).toEqual(["latin"]);
    expect(playfair?.version).toBe("v30");
  });
});

describe("search", () => {
  it("is case insensitive and finds a family by prefix", () => {
    expect(searchFamilies(catalog, "playfair").map((e) => e.family)).toEqual(["Playfair Display"]);
    expect(searchFamilies(catalog, "PLAYFAIR").map((e) => e.family)).toEqual(["Playfair Display"]);
  });

  it("finds Montserrat from a partial term", () => {
    expect(searchFamilies(catalog, "mont").map((e) => e.family)).toContain("Montserrat");
  });

  it("ranks exact match above prefix above substring", () => {
    const results = searchFamilies(catalog, "inter").map((e) => e.family);
    expect(results[0]).toBe("Inter");
  });

  it("can find families by category, so 'handwriting' surfaces script fonts", () => {
    expect(searchFamilies(catalog, "handwriting").map((e) => e.family)).toContain("Dancing Script");
  });

  it("returns the head of the catalog for an empty query", () => {
    expect(searchFamilies(catalog, "", 2)).toHaveLength(2);
  });

  it("honours the result limit so the dropdown never renders thousands of rows", () => {
    expect(searchFamilies(catalog, "a", 1).length).toBeLessThanOrEqual(1);
  });
});

describe("weights and italic availability", () => {
  it("reports only the weights a family genuinely has", () => {
    expect(supportedWeightsFor(catalog, "Playfair Display")).toEqual(["400", "700"]);
    expect(supportedWeightsFor(catalog, "Unknown Family")).toEqual([]);
  });

  it("reports italic availability from real variants", () => {
    expect(supportsItalic(catalog, "Inter")).toBe(true);
    expect(supportsItalic(catalog, "Playfair Display")).toBe(false);
  });

  it("snaps an unsupported weight to the nearest available cut", () => {
    // Playfair has only 400/700 — 500 must not stay 500.
    expect(nearestWeight(["400", "700"], 500)).toBe("400");
    expect(nearestWeight(["400", "700"], 600)).toBe("700");
    expect(nearestWeight(["400", "700"], 700)).toBe("700");
  });

  it("breaks a tie toward the heavier cut, matching the renderer", () => {
    expect(nearestWeight(["400", "600"], 500)).toBe("600");
  });

  it("falls back to 400 when a family has no weights at all", () => {
    expect(nearestWeight([], 700)).toBe("400");
  });
});

describe("variant resolution", () => {
  it("resolves an exact weight + style", () => {
    const variant = resolveVariant(catalog, "Inter", "700", "italic");
    expect(variant?.key).toBe("700italic");
    expect(variant?.weight).toBe("700");
    expect(variant?.style).toBe("italic");
    expect(variant?.url).toContain("inter-700i.ttf");
  });

  it("falls back within the SAME family, never to another typeface", () => {
    // Playfair has no italic — must return a Playfair upright, not Inter italic.
    const variant = resolveVariant(catalog, "Playfair Display", "700", "italic");
    expect(variant?.url).toContain("playfairdisplay");
    expect(variant?.style).toBe("normal");
  });

  it("picks the nearest weight in the requested style", () => {
    const variant = resolveVariant(catalog, "Montserrat", "700", "normal");
    // Montserrat here has 400/600/800 — 700 ties 600 vs 800, heavier wins.
    expect(variant?.weight).toBe("800");
  });

  it("returns null for an unknown family so callers can fail loudly", () => {
    expect(resolveVariant(catalog, "Definitely Not A Font", "400", "normal")).toBeNull();
  });
});

describe("font dependency collection", () => {
  it("collects exactly the distinct variants a design uses", () => {
    const { dependencies, missingFamilies } = collectFontDependencies(catalog, [
      { fontFamily: "Playfair Display", fontWeight: "700", fontStyle: "normal" },
      { fontFamily: "Montserrat", fontWeight: "400", fontStyle: "normal" },
      { fontFamily: "Montserrat", fontWeight: "400", fontStyle: "italic" },
      // duplicate of the first — must not produce a second dependency
      { fontFamily: "Playfair Display", fontWeight: "700", fontStyle: "normal" },
    ]);
    expect(missingFamilies).toEqual([]);
    expect(dependencies).toHaveLength(3);
    expect(dependencies.map((d) => `${d.family} ${d.weight} ${d.style}`).sort()).toEqual([
      "Montserrat 400 italic",
      "Montserrat 400 normal",
      "Playfair Display 700 normal",
    ]);
  });

  it("reports an unknown family instead of silently substituting", () => {
    const { dependencies, missingFamilies } = collectFontDependencies(catalog, [
      { fontFamily: "Totally Fake Font", fontWeight: "400" },
    ]);
    expect(missingFamilies).toEqual(["Totally Fake Font"]);
    expect(dependencies).toHaveLength(0);
  });

  it("uses the centralized default family when a style has none", () => {
    const { dependencies } = collectFontDependencies(catalog, [{ fontWeight: "400" }]);
    expect(dependencies[0]?.family).toBe(DEFAULT_FONT_FAMILY);
  });
});

describe("template allowlist", () => {
  it("treats an empty allowlist as 'all Google Fonts'", () => {
    expect(isFamilyAllowedByTemplate([], "Montserrat")).toBe(true);
    expect(isFamilyAllowedByTemplate(undefined, "Montserrat")).toBe(true);
  });

  it("restricts to exactly the configured families", () => {
    expect(isFamilyAllowedByTemplate(["Inter", "Montserrat"], "Montserrat")).toBe(true);
    expect(isFamilyAllowedByTemplate(["Inter"], "Montserrat")).toBe(false);
  });

  it("matches family names case insensitively", () => {
    expect(isFamilyAllowedByTemplate(["montserrat"], "Montserrat")).toBe(true);
  });
});

describe("client catalog shape", () => {
  it("never leaks font file urls to the browser payload", () => {
    const client = toClientCatalog(catalog);
    const serialized = JSON.stringify(client);
    expect(serialized).not.toContain("fonts.gstatic.com");
    expect(serialized).not.toContain("http");
    expect(client[0]).toHaveProperty("family");
    expect(client[0]).toHaveProperty("weights");
    expect(client[0]).toHaveProperty("hasItalic");
  });
});

describe("known-family validation", () => {
  it("accepts a genuine catalog family and rejects a fake one", () => {
    expect(isKnownFamily(catalog, "Inter")).toBe(true);
    expect(isKnownFamily(catalog, "inter")).toBe(true);
    expect(isKnownFamily(catalog, "'); DROP TABLE fonts;--")).toBe(false);
    expect(isKnownFamily(catalog, "")).toBe(false);
  });
});
