import { describe, it, expect } from "vitest";
import { layoutText, fallbackMeasure, type MeasureFn } from "../text-layout";

// Deterministic 10px-per-char measurer for predictable assertions.
const fixedMeasure: MeasureFn = (text) => Array.from(text).length * 10;

const baseInput = {
  fontFamily: "Test",
  fontSize: 20,
  lineHeight: 1.0,
  multiline: true,
  width: 100,
  height: 200,
};

describe("text layout service", () => {
  it("wraps words to the box width", () => {
    const result = layoutText({ ...baseInput, text: "aaaa bbbb cccc" }, fixedMeasure);
    // "aaaa bbbb" = 9 chars = 90px fits; adding " cccc" overflows.
    expect(result.lines.map((l) => l.text)).toEqual(["aaaa bbbb", "cccc"]);
    expect(result.overflowWidth).toBe(false);
  });

  it("honours manual line breaks", () => {
    const result = layoutText({ ...baseInput, text: "one\ntwo" }, fixedMeasure);
    expect(result.lines.map((l) => l.text)).toEqual(["one", "two"]);
  });

  it("keeps single-line mode unwrapped and reports overflow", () => {
    const result = layoutText(
      { ...baseInput, multiline: false, text: "aaaa bbbb cccc dddd" },
      fixedMeasure,
    );
    expect(result.lines).toHaveLength(1);
    expect(result.overflowWidth).toBe(true);
  });

  it("hard-breaks a single word wider than the box", () => {
    const result = layoutText({ ...baseInput, text: "abcdefghijklmnop" }, fixedMeasure);
    expect(result.lines.length).toBeGreaterThan(1);
    expect(result.lines[0].text.length).toBeLessThanOrEqual(10);
  });

  it("shrink-to-fit reduces font size until content fits", () => {
    const measure: MeasureFn = (text, style) => Array.from(text).length * style.fontSize * 0.5;
    const result = layoutText(
      { ...baseInput, text: "wide text that must fit", fitMode: "shrink", minFontSize: 6, height: 22 },
      measure,
    );
    expect(result.fontSize).toBeLessThan(20);
    expect(result.overflowHeight).toBe(false);
  });

  it("truncates at maxLines and reports it", () => {
    const result = layoutText({ ...baseInput, text: "a\nb\nc\nd", maxLines: 2 }, fixedMeasure);
    expect(result.lines).toHaveLength(2);
    expect(result.truncatedLines).toBe(true);
  });

  it("applies uppercase before measuring", () => {
    const result = layoutText({ ...baseInput, text: "abc", uppercase: true }, fixedMeasure);
    expect(result.lines[0].text).toBe("ABC");
  });

  it("centers vertically by default and anchors by alignment", () => {
    const result = layoutText({ ...baseInput, text: "hi", textAlign: "left" }, fixedMeasure);
    expect(result.anchor).toBe("start");
    expect(result.lines[0].x).toBe(0);
    // One 20px line in a 200px box, centred: line centre at 100.
    expect(result.lines[0].y).toBe(100);
  });

  it("fallback measurer accounts for letter spacing", () => {
    const style = { fontFamily: "x", fontSize: 10, fontWeight: "400", fontStyle: "normal" as const, letterSpacing: 5 };
    const wide = fallbackMeasure("aa", style);
    const noSpacing = fallbackMeasure("aa", { ...style, letterSpacing: 0 });
    expect(wide).toBeCloseTo(noSpacing + 5);
  });
});
