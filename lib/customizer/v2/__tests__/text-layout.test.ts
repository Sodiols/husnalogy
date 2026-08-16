import { describe, it, expect } from "vitest";
import {
  fallbackMeasure,
  getSingleLineTextBox,
  getTextResizeConstraints,
  isSingleLineAutoSizeText,
  layoutText,
  scaleSingleLineText,
  scaleTextBox,
  type MeasureFn,
} from "../text-layout";

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
    expect(result.unbreakableWord).toBe(true);
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

  it("preserves manual breaks without adding automatic breaks to stored text", () => {
    const text = "Salman & Bobita\nDecember 20, 2026";
    const result = layoutText({ ...baseInput, width: 80, text }, fixedMeasure);
    expect(result.lines.length).toBeGreaterThan(2);
    expect(text).toBe("Salman & Bobita\nDecember 20, 2026");
    expect(text.split("\n")).toHaveLength(2);
  });

  it("recalculates wrapping when width, font size, weight, and spacing change", () => {
    const measured: MeasureFn = (text, style) => {
      const weightFactor = Number(style.fontWeight) >= 700 ? 0.62 : 0.5;
      return Array.from(text).length * style.fontSize * weightFactor + Math.max(0, text.length - 1) * style.letterSpacing;
    };
    const wide = layoutText({ ...baseInput, width: 220, text: "Jacob and Maria Eastman" }, measured);
    const narrow = layoutText({ ...baseInput, width: 100, text: "Jacob and Maria Eastman" }, measured);
    const boldSpaced = layoutText({ ...baseInput, width: 220, text: "Jacob and Maria Eastman", fontWeight: "700", letterSpacing: 3 }, measured);
    expect(narrow.lines.length).toBeGreaterThan(wide.lines.length);
    expect(boldSpaced.lines.length).toBeGreaterThanOrEqual(wide.lines.length);
  });

  it("uses line height for total wrapped height", () => {
    const compact = layoutText({ ...baseInput, text: "one\ntwo", lineHeight: 1 }, fixedMeasure);
    const loose = layoutText({ ...baseInput, text: "one\ntwo", lineHeight: 1.5 }, fixedMeasure);
    expect(compact.totalHeight).toBe(40);
    expect(loose.totalHeight).toBe(60);
  });

  it("prevents the Bobita 80px fixed-size regression", () => {
    const measured: MeasureFn = (text, style) =>
      Array.from(text).length * style.fontSize * 0.5 + Math.max(0, text.length - 1) * style.letterSpacing;
    const constraints = getTextResizeConstraints({
      text: "Bobita",
      width: 88,
      height: 54,
      fontFamily: "Georgia",
      fontSize: 80,
      fontWeight: "300",
      fontStyle: "normal",
      letterSpacing: 2,
      lineHeight: 1.1,
      multiline: false,
      fitMode: "fixed",
    }, measured);
    expect(constraints.minWidth).toBe(250);
    expect(constraints.minHeight).toBe(88);
    expect(constraints.minWidth).toBeGreaterThan(88);
    expect(constraints.minHeight).toBeGreaterThan(54);
  });

  it("allows multiline width changes but requires enough wrapped height", () => {
    const measured: MeasureFn = (text, style) => Array.from(text).length * style.fontSize * 0.5;
    const wide = getTextResizeConstraints({ ...baseInput, text: "Jacob and Maria Eastman", width: 220, height: 20 }, measured);
    const narrow = getTextResizeConstraints({ ...baseInput, text: "Jacob and Maria Eastman", width: 100, height: 20 }, measured);
    expect(narrow.requiredHeight).toBeGreaterThan(wide.requiredHeight);
    expect(narrow.minHeight).toBe(narrow.requiredHeight);
  });

  it("supports auto height and shrink-to-fit without distorting glyph proportions", () => {
    const measured: MeasureFn = (text, style) => Array.from(text).length * style.fontSize * 0.5;
    const auto = getTextResizeConstraints({ ...baseInput, text: "one two three four five", width: 70, height: 20, fitMode: "auto-height" }, measured);
    const shrink = layoutText({ ...baseInput, multiline: false, text: "Bobita", width: 40, height: 54, fitMode: "shrink", minFontSize: 8 }, measured);
    expect(auto.requiredHeight).toBeGreaterThan(20);
    expect(shrink.resolvedFontSize).toBeLessThan(20);
    expect(shrink.overflowX).toBe(false);
    expect(shrink.overflowY).toBe(false);
  });

  describe("single-line proportional font scaling", () => {
    const measured: MeasureFn = (text, style) =>
      Array.from(text).length * style.fontSize * 0.5 + Math.max(0, text.length - 1) * style.letterSpacing;
    const scaleInput = {
      text: "Bobita",
      x: 500,
      y: 300,
      fontFamily: "Georgia",
      fontSize: 80,
      minFontSize: 40,
      maxFontSize: 120,
      fontWeight: "300",
      fontStyle: "normal" as const,
      letterSpacing: 2,
      lineHeight: 1.1,
      rotation: 0,
    };

    it("recognizes only normal fixed single-line text as auto sized", () => {
      expect(isSingleLineAutoSizeText({ multiline: false, fitMode: "fixed" })).toBe(true);
      expect(isSingleLineAutoSizeText({ multiline: true, fitMode: "fixed" })).toBe(false);
      expect(isSingleLineAutoSizeText({ multiline: false, fitMode: "shrink" })).toBe(false);
    });

    it("keeps the natural box tight around the measured text", () => {
      const box = getSingleLineTextBox(scaleInput, measured);
      expect(box).toEqual({ width: 250, height: 88 });
    });

    it("scales outward and inward by changing the real font size and both dimensions", () => {
      const outward = scaleSingleLineText({ ...scaleInput, handle: "e", delta: 50 }, measured);
      const inward = scaleSingleLineText({ ...scaleInput, handle: "e", delta: -50 }, measured);
      expect(outward.fontSize).toBeGreaterThan(80);
      expect(outward.width).toBeGreaterThan(250);
      expect(outward.height).toBeGreaterThan(88);
      expect(inward.fontSize).toBeLessThan(80);
      expect(inward.width).toBeLessThan(250);
      expect(inward.height).toBeLessThan(88);
    });

    it("anchors the opposite edge for left and right handles", () => {
      const startLeft = scaleInput.x - 125;
      const startRight = scaleInput.x + 125;
      const right = scaleSingleLineText({ ...scaleInput, handle: "e", delta: 50 }, measured);
      const left = scaleSingleLineText({ ...scaleInput, handle: "w", delta: -50 }, measured);
      expect(right.x - right.width / 2).toBeCloseTo(startLeft, 0);
      expect(left.x + left.width / 2).toBeCloseTo(startRight, 0);
    });

    it("keeps the center anchored with Alt or Option scaling", () => {
      const result = scaleSingleLineText({ ...scaleInput, handle: "e", delta: 50, centered: true }, measured);
      expect(result.x).toBe(scaleInput.x);
      expect(result.y).toBe(scaleInput.y);
      expect(result.fontSize).toBeGreaterThan(80);
    });

    it("projects anchoring along a rotated text object's natural axis", () => {
      const result = scaleSingleLineText({ ...scaleInput, rotation: 90, handle: "e", delta: 50 }, measured);
      expect(result.x).toBe(scaleInput.x);
      expect(result.y).toBeGreaterThan(scaleInput.y);
    });

    it("respects minimum, maximum, and safe-area limits", () => {
      const minimum = scaleSingleLineText({ ...scaleInput, handle: "e", delta: -1000 }, measured);
      const maximum = scaleSingleLineText({ ...scaleInput, handle: "e", delta: 1000 }, measured);
      const safe = scaleSingleLineText({
        ...scaleInput,
        handle: "e",
        delta: 1000,
        safeBounds: { left: 0, top: 0, right: 650, bottom: 1000 },
      }, measured);
      expect(minimum.fontSize).toBe(40);
      expect(maximum.fontSize).toBe(120);
      expect(safe.x + safe.width / 2).toBeLessThanOrEqual(650.5);
      expect(safe.fontSize).toBeLessThan(120);
    });
  });

  describe('corner-drag text scaling', () => {
    // 200x100 box: the diagonal from the anchored corner is (200, 100), so a
    // 100px horizontal drag projects to 20000/50000 = 0.4 of that diagonal.
    const box = { x: 500, y: 400, width: 200, height: 100, fontSize: 50, letterSpacing: 4 };

    it('grows the font, the box and the letter spacing by one factor', () => {
      const result = scaleTextBox({ ...box, handle: 'se', deltaX: 100, deltaY: 0 });
      expect(result.width).toBe(280);
      expect(result.height).toBe(140);
      expect(result.fontSize).toBe(70);
      expect(result.letterSpacing).toBe(5.6);
    });

    it('anchors the opposite corner', () => {
      const se = scaleTextBox({ ...box, handle: 'se', deltaX: 100, deltaY: 0 });
      expect(se.x - se.width / 2).toBe(box.x - box.width / 2);
      expect(se.y - se.height / 2).toBe(box.y - box.height / 2);

      const nw = scaleTextBox({ ...box, handle: 'nw', deltaX: -100, deltaY: 0 });
      expect(nw.x + nw.width / 2).toBe(box.x + box.width / 2);
      expect(nw.y + nw.height / 2).toBe(box.y + box.height / 2);
      expect(nw.fontSize).toBe(70);
    });

    it('shrinks the font and clamps to the configured limits', () => {
      const smaller = scaleTextBox({ ...box, handle: 'se', deltaX: -100, deltaY: 0 });
      expect(smaller.fontSize).toBe(30);
      expect(smaller.width).toBe(120);

      const floored = scaleTextBox({ ...box, handle: 'se', deltaX: -10000, deltaY: 0, minFontSize: 10 });
      expect(floored.fontSize).toBe(10);
      expect(floored.width).toBe(40);

      const capped = scaleTextBox({ ...box, handle: 'se', deltaX: 10000, deltaY: 0, maxFontSize: 120 });
      expect(capped.fontSize).toBe(120);
    });

    it('follows the pointer exactly along the diagonal it is dragged on', () => {
      // (100, 50) is parallel to the (200, 100) diagonal: the corner lands
      // precisely under the pointer, so the box grows by exactly half.
      const exact = scaleTextBox({ ...box, handle: 'se', deltaX: 100, deltaY: 50 });
      expect(exact.width).toBe(300);
      expect(exact.height).toBe(150);
      expect(exact.fontSize).toBe(75);
    });

    it('stays continuous as a diagonal drag crosses between the axes', () => {
      const samples = [];
      for (let step = 0; step <= 20; step += 1) {
        const angle = (step / 20) * (Math.PI / 2);
        samples.push(scaleTextBox({
          ...box,
          handle: 'se',
          deltaX: Math.cos(angle) * 60,
          deltaY: Math.sin(angle) * 60,
        }).fontSize);
      }
      // No jump: sweeping the drag direction never steps the font size by more
      // than a point, which is what made the old dominant-axis rule feel jerky.
      for (let index = 1; index < samples.length; index += 1) {
        expect(Math.abs(samples[index] - samples[index - 1])).toBeLessThanOrEqual(1);
      }
    });

    it('leaves a zero drag untouched', () => {
      const same = scaleTextBox({ ...box, handle: 'ne', deltaX: 0, deltaY: 0 });
      expect(same).toMatchObject({ x: 500, y: 400, width: 200, height: 100, fontSize: 50, letterSpacing: 4 });
    });
  });
});
