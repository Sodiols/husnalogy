import { existsSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { collectFontDependencies, FONT_REGISTRY, listFonts, resolveFontFile } from "../fonts";
import { createServerMeasure, findMissingFontFiles } from "../server/server-fonts";

describe("local customizer font registry", () => {
  it("points every production font face at a real local file", () => {
    const productionFonts = FONT_REGISTRY.filter((font) => font.serverRenderable);
    expect(productionFonts.length).toBeGreaterThan(0);
    for (const font of productionFonts) {
      expect(font.licenseReference).toBeTruthy();
      for (const face of font.files) {
        const absolute = join(process.cwd(), "public", face.file);
        expect(existsSync(absolute), absolute).toBe(true);
        expect(statSync(absolute).size).toBeGreaterThan(10_000);
        expect(face.browserUrl).toBe(`/${face.file}`);
      }
    }
  });

  it("uses the same customer list and server dependency resolver", () => {
    expect(listFonts({ customerOnly: true }).every((font) => font.serverRenderable)).toBe(true);
    expect(resolveFontFile("Inter", "700", "normal")?.file).toContain("Inter-700");
    expect(resolveFontFile("Cormorant Garamond", "400", "italic")?.file).toContain("italic");
    const dependencies = collectFontDependencies([
      { fontFamily: "Inter", fontWeight: "700" },
      { fontFamily: "Inter", fontWeight: "700" },
    ]);
    expect(dependencies.files).toHaveLength(1);
    expect(dependencies.missingFamilies).toEqual([]);
  });

  it("loads real font metrics and reports no missing configured files", () => {
    const measure = createServerMeasure();
    const width = measure("Husnalogy", { fontFamily: "Cormorant Garamond", fontSize: 64, fontWeight: "600", fontStyle: "normal", letterSpacing: 0 });
    expect(width).toBeGreaterThan(100);
    expect(findMissingFontFiles({ layers: [{ type: "text", textStyle: { fontFamily: "Inter", fontWeight: "500" } }] })).toEqual([]);
  });
});
