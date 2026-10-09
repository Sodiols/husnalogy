import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as opentype from "opentype.js";
import { createOpentypeMeasure } from "../text-layout";
import { readGposPairKerning, withGposKerning } from "../gpos-kerning";

const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");
function load(file: string) {
  const buffer = readFileSync(path.join(process.cwd(), "app", "brand-fonts", file));
  const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return { bytes, font: opentype.parse(bytes) as any };
}
const style = { fontFamily: "x", fontSize: 60, fontWeight: "400", fontStyle: "normal" as const, letterSpacing: 0 };

describe("server text measurement applies GPOS kerning like the browser", () => {
  // Widths Chrome's canvas measured for the same Inter-400.ttf bytes at 60 px
  // (e2e/render-parity.spec.ts measures them live).
  const CHROME = { Together: 254.47, "Together with their families": 768.81, AVAT: 149.62 };

  it("reproduces the defect: opentype.js alone measures Inter unkerned (its kerning sits in Extension lookups)", () => {
    const { font } = load("Inter-400.ttf");
    const plain = createOpentypeMeasure(() => font);
    expect(plain("AVAT", style)).toBeCloseTo(162.92, 1);
    expect(font.tables.gpos.lookups[0].lookupType).toBe(9);
  });

  it("with the GPOS reader the server's widths equal the browser's", () => {
    const { bytes, font } = load("Inter-400.ttf");
    const measure = createOpentypeMeasure(() => withGposKerning(font, bytes));
    for (const [text, width] of Object.entries(CHROME)) expect(measure(text, style)).toBeCloseTo(width, 1);
  });

  it("reads pair adjustments directly (negative for AV/VA/AT, none for unrelated pairs)", () => {
    const { bytes, font } = load("Inter-400.ttf");
    const kern = readGposPairKerning(bytes)!;
    const g = (char: string) => font.charToGlyph(char).index;
    expect(kern(g("A"), g("V"))).toBeLessThan(0);
    expect(kern(g("V"), g("A"))).toBeLessThan(0);
    expect(kern(g("l"), g("l"))).toBe(0);
  });

  it("a font with kerning in plain PairPos lookups still kerns; garbage bytes give null, never a throw", () => {
    const { bytes, font } = load("CormorantGaramond-400.ttf");
    const kern = readGposPairKerning(bytes)!;
    expect(kern(font.charToGlyph("T").index, font.charToGlyph("o").index)).toBe(font.getKerningValue(font.charToGlyph("T"), font.charToGlyph("o")));
    expect(readGposPairKerning(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });

  it("every server font parse attaches it (studio preflight and production render)", () => {
    expect(read("lib/customizer/v2/server/server-fonts.ts")).toContain("withGposKerning(opentype.parse(arrayBuffer), arrayBuffer)");
    expect(read("lib/customizer/server/production-assets.ts")).toContain("withGposKerning(opentype.parse(fontBytes), fontBytes)");
  });
});
