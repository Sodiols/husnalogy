import { describe, expect, it } from "vitest";
import {
  CURATED_RETRO_FONTS,
  CURATED_SCRIPT_FONTS,
  FONT_CATEGORY_TABS,
  buildFontCategoryIndex,
  classifyFontFamily,
  filterFamiliesByCategory,
  fontFamilyKey,
} from "../font-categories";

const catalog = [
  { family: "Playfair Display", category: "serif" },
  { family: "Cormorant Garamond", category: "serif" },
  { family: "Inter", category: "sans-serif" },
  { family: "Great Vibes", category: "handwriting" },
  { family: "Caveat", category: "handwriting" },
  { family: "Lobster", category: "display" },
  { family: "Yellowtail", category: "handwriting" },
  { family: "Roboto Mono", category: "monospace" },
];
const index = buildFontCategoryIndex(catalog);
const names = (list: Array<{ family: string }>) => list.map((entry) => entry.family);

describe("font categories", () => {
  it("offers exactly the seven requested tabs, in order", () => {
    expect(FONT_CATEGORY_TABS.map((tab) => tab.label)).toEqual([
      "All Fonts",
      "Favourite Fonts",
      "Serif",
      "Sans Serif",
      "Script",
      "Retro",
      "Hand Written",
    ]);
  });

  it("takes Serif, Sans Serif and Hand Written from Google's own metadata", () => {
    expect(names(filterFamiliesByCategory(catalog, "serif", index, new Set()))).toEqual(["Playfair Display", "Cormorant Garamond"]);
    expect(names(filterFamiliesByCategory(catalog, "sans-serif", index, new Set()))).toEqual(["Inter"]);
    expect(names(filterFamiliesByCategory(catalog, "handwritten", index, new Set()))).toEqual(["Caveat"]);
  });

  it("takes Script and Retro from Husnalogy's curated lists, and moves formal scripts out of Hand Written", () => {
    expect(names(filterFamiliesByCategory(catalog, "script", index, new Set()))).toEqual(["Great Vibes", "Yellowtail"]);
    expect(names(filterFamiliesByCategory(catalog, "retro", index, new Set()))).toEqual(["Lobster", "Yellowtail"]);
    expect(classifyFontFamily({ family: "Great Vibes", category: "handwriting" })).toEqual(["script"]);
  });

  it("All Fonts is everything permitted, including uncategorised families", () => {
    expect(names(filterFamiliesByCategory(catalog, "all", index, new Set()))).toEqual(names(catalog));
  });

  it("Favourite Fonts can never show a font the design does not allow", () => {
    const favourites = new Set(["Great Vibes", "Inter"].map(fontFamilyKey));
    // The caller passes only PERMITTED families; Great Vibes is not among them.
    const permitted = catalog.filter((entry) => ["Inter", "Playfair Display"].includes(entry.family));
    expect(names(filterFamiliesByCategory(permitted, "favourites", buildFontCategoryIndex(permitted), favourites))).toEqual(["Inter"]);
  });

  it("matching ignores letter case and surrounding space", () => {
    expect(classifyFontFamily({ family: "  great vibes ", category: "handwriting" })).toEqual(["script"]);
    const favourites = new Set([fontFamilyKey("INTER")]);
    expect(names(filterFamiliesByCategory(catalog, "favourites", index, favourites))).toEqual(["Inter"]);
  });

  it("the curated lists contain no duplicates", () => {
    for (const list of [CURATED_SCRIPT_FONTS, CURATED_RETRO_FONTS]) {
      expect(new Set(list.map(fontFamilyKey)).size).toBe(list.length);
    }
  });
});
