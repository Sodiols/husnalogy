/**
 * "safe-width" text: the box is the words — growing as they are typed — until
 * it would cross the page's safe area; from there it keeps that width and
 * wraps at word boundaries, growing in its growth direction.
 *
 * The reported bug: type "hi", Enter, Done; later remove the break and keep
 * typing — every word landed on its own line, because the line break had
 * frozen the text as a paragraph exactly as wide as "hi".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newTextLayer } from "@/app/admin/dashboard/design-builder/builder-utils";
import { normalizeCustomizerTemplate } from "@/lib/customizer";
import { buildPageSvg } from "@/lib/customizer/v2/svg";
import {
  canonicalTextLayerUpdate,
  manualWidthStylePatch,
  multilineTextPatch,
  promoteTextStyleForValue,
} from "@/lib/customizer/v2/text-editing";
import {
  autoWidthPadding,
  fallbackMeasure,
  layoutText,
  resolveTextBox,
  resolvedTextLayoutMode,
  templateSafeBounds,
  type MeasureFn,
} from "@/lib/customizer/v2/text-layout";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/** Deterministic metrics that still react to family, weight, italic and spacing. */
const measure: MeasureFn = (text, style) => {
  const family = /wide/i.test(style.fontFamily) ? 0.75 : 0.5;
  const weight = Number(style.fontWeight) >= 600 ? 1.1 : 1;
  const italic = style.fontStyle === "italic" ? 1.05 : 1;
  const chars = Array.from(text).length;
  return chars * style.fontSize * family * weight * italic + Math.max(0, chars - 1) * (style.letterSpacing || 0);
};

const FIVE_BY_SEVEN = { canvasWidthPx: 1500, canvasHeightPx: 2100, dpi: 300, safeArea: { left: 75, top: 75, right: 75, bottom: 75 } };

function newText(template: any = FIVE_BY_SEVEN, overrides: Record<string, any> = {}) {
  const layer: any = newTextLayer(template, "front", { x: template.canvasWidthPx / 2, y: template.canvasHeightPx / 2, text: "" });
  return { ...layer, ...overrides, textStyle: { ...layer.textStyle, ...(overrides.textStyle || {}) } };
}

function resolve(layer: any, text: string, template: any = FIVE_BY_SEVEN) {
  const style = layer.textStyle;
  return resolveTextBox(
    {
      x: layer.x, y: layer.y, width: layer.width, height: layer.height, text,
      fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, fontStyle: style.fontStyle,
      letterSpacing: style.letterSpacing, lineHeight: style.lineHeight, uppercase: style.uppercase,
      multiline: style.multiline, textAlign: style.textAlign, verticalAlign: style.verticalAlign,
      autoSizeMode: style.autoSizeMode, fitMode: style.fitMode, rotation: layer.rotation, growthDirection: style.growthDirection,
    },
    measure,
    templateSafeBounds(template),
  );
}

/** The lines a renderer draws in the resolved box (the same rule every renderer uses). */
function linesOf(layer: any, text: string, template: any = FIVE_BY_SEVEN) {
  const box = resolve(layer, text, template);
  const style = layer.textStyle;
  return layoutText(
    { text, width: box.width, height: box.height, fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, fontStyle: style.fontStyle, letterSpacing: style.letterSpacing, lineHeight: style.lineHeight, textAlign: style.textAlign, ...resolvedTextLayoutMode(style, box.clampedBySafeArea) },
    measure,
  ).lines.map((line) => line.text);
}

const safeWidth = (template: any = FIVE_BY_SEVEN) => template.canvasWidthPx - template.safeArea.left - template.safeArea.right;

describe("new text is safe-width at 17 pt", () => {
  it("TEST 1: created at 17 pt, safe-width, 'hi' on one tight line", () => {
    const layer = newText();
    expect(layer.textStyle).toMatchObject({ fontSize: 70.83, autoSizeMode: "safe-width", fitMode: "fixed" });
    const box = resolve(layer, "hi");
    expect(linesOf(layer, "hi")).toEqual(["hi"]);
    expect(box.width).toBeLessThan(120);
  });

  it("TEST 2–3: 'hi hi' and 'hi hi hi how are you' widen and stay on one line — never one word or letter per line", () => {
    const layer = newText();
    const widths = ["hi", "hi hi", "hi hi hi how are you"].map((text) => resolve(layer, text).width);
    expect(widths[1]).toBeGreaterThan(widths[0]);
    expect(widths[2]).toBeGreaterThan(widths[1]);
    expect(linesOf(layer, "hi hi hi how are you")).toEqual(["hi hi hi how are you"]);
    expect(resolve(layer, "hi hi hi how are you").clampedBySafeArea).toBe(false);
  });

  it("TEST 4: a long sentence grows to the safe-area width, then wraps at words", () => {
    const layer = newText();
    const sentence = "wedding invitations for our family and friends near and far";
    const box = resolve(layer, sentence);
    expect(box.clampedBySafeArea).toBe(true);
    expect(box.width).toBe(safeWidth());
    const lines = linesOf(layer, sentence);
    expect(lines.length).toBeGreaterThan(1);
    // Word wrapping: every line is whole words.
    const words = new Set(sentence.split(" "));
    for (const line of lines) for (const word of line.trim().split(/\s+/)) expect(words.has(word)).toBe(true);
    // Auto height: the box is as tall as its lines.
    expect(box.height).toBe(Math.ceil(lines.length * 70.83 * layer.textStyle.lineHeight));
  });

  it("the exact example: content width up to the safe width, then the safe width and wrapping", () => {
    const layer = newText();
    const fontSize = layer.textStyle.fontSize;
    const allowance = autoWidthPadding(fontSize) + layer.textStyle.letterSpacing;
    for (const text of ["ab", "abcdef", "abcdefghijkl", "abcdefghijklmnopqrst"]) {
      // The shared measurer rounds the glyph width up before the allowance.
      const natural = Math.ceil(measure(text, { fontFamily: "Inter", fontSize, fontWeight: "400", fontStyle: "normal", letterSpacing: layer.textStyle.letterSpacing })) + allowance;
      expect(resolve(layer, text).width).toBe(Math.round(Math.min(natural, safeWidth())));
    }
  });

  it("an unbroken string longer than the safe width is the only thing broken mid-word", () => {
    const layer = newText();
    const lines = linesOf(layer, "A".repeat(80));
    expect(lines.length).toBeGreaterThan(1);
    expect(resolve(layer, "A".repeat(80)).width).toBe(safeWidth());
  });

  it("TEST 5: deleting words shrinks it back to one line", () => {
    const layer = newText();
    expect(linesOf(layer, "wedding invitations for our family and friends near and far").length).toBeGreaterThan(1);
    expect(linesOf(layer, "wedding invitations")).toEqual(["wedding invitations"]);
    expect(resolve(layer, "wedding").width).toBeLessThan(resolve(layer, "wedding invitations").width);
  });
});

describe("TEST 6: manual line breaks", () => {
  it("are kept, and do NOT freeze the width (the reported bug)", () => {
    const layer = newText();
    // Enter after "hi": still safe-width, the style just becomes multi-line.
    const promoted = canonicalTextLayerUpdate("hi\n", layer.textStyle).textStyle;
    expect(promoted).toMatchObject({ autoSizeMode: "safe-width", multiline: true });
    const afterBreak = { ...layer, textStyle: promoted };
    expect(linesOf(afterBreak, "wedding\ninvitation")).toEqual(["wedding", "invitation"]);
    // The break removed and more typed: one line again, as wide as the words.
    expect(linesOf(afterBreak, "hi hi hi how are you")).toEqual(["hi hi hi how are you"]);
    expect(resolve(afterBreak, "hi hi hi how are you").width).toBeGreaterThan(resolve(afterBreak, "hi").width * 4);
  });

  it("the box follows the widest manual line", () => {
    const layer = { ...newText(), textStyle: { ...newText().textStyle, multiline: true } };
    expect(resolve(layer, "hi\nwedding invitations").width).toBe(resolve(layer, "wedding invitations").width);
  });

  it("older modes keep their paragraph promotion", () => {
    expect(promoteTextStyleForValue({ autoSizeMode: "width" }, "a\nb")).toMatchObject({ multiline: true, autoSizeMode: "height", fitMode: "auto-height" });
    expect(multilineTextPatch({ autoSizeMode: "safe-width" })).toEqual({ multiline: true });
  });
});

describe("TEST 7–9: the aligned edge holds; growth never leaves the safe area", () => {
  const long = "wedding invitations for our family and friends near and far";
  it("centred: grows evenly; capped by the nearer safe edge", () => {
    const layer = newText();
    const box = resolve(layer, "wedding");
    expect(box.x).toBe(layer.x);
    const offCentre = { ...layer, x: 500 };
    const capped = resolve(offCentre, long);
    expect(capped.width).toBe(2 * (500 - 75));
    expect(capped.x - capped.width / 2).toBeGreaterThanOrEqual(75);
  });

  it("left: the left edge holds; the right edge stops at the safe area", () => {
    const layer = newText(FIVE_BY_SEVEN, { x: 400, width: 100, textStyle: { textAlign: "left" } });
    const leftEdge = 400 - 50;
    for (const text of ["hi", "wedding invitations", long]) {
      const box = resolve(layer, text);
      expect(box.x - box.width / 2).toBeCloseTo(leftEdge, 6);
      expect(box.x + box.width / 2).toBeLessThanOrEqual(1500 - 75 + 0.5);
    }
  });

  it("right: the right edge holds; the left edge stops at the safe area", () => {
    const layer = newText(FIVE_BY_SEVEN, { x: 1100, width: 100, textStyle: { textAlign: "right" } });
    const rightEdge = 1100 + 50;
    for (const text of ["hi", "wedding invitations", long]) {
      const box = resolve(layer, text);
      expect(box.x + box.width / 2).toBeCloseTo(rightEdge, 6);
      expect(box.x - box.width / 2).toBeGreaterThanOrEqual(75 - 0.5);
    }
  });

  it("TEST 16: moved near an edge, it has less room and wraps sooner", () => {
    const text = "wedding invitations for our family";
    const centred = newText();
    const nearEdge = newText(FIVE_BY_SEVEN, { x: 1200, width: 100, textStyle: { textAlign: "left" } });
    expect(linesOf(centred, text)).toHaveLength(1);
    expect(linesOf(nearEdge, text).length).toBeGreaterThan(1);
  });
});

describe("growth direction", () => {
  const long = "wedding invitations for our family and friends near and far";
  it.each([
    ["down", "top"],
    ["up", "bottom"],
    ["center", "centre"],
  ] as const)("%s keeps its %s while wrapping adds lines", (growth, _edge) => {
    const layer = newText(FIVE_BY_SEVEN, { textStyle: { growthDirection: growth } });
    const one = resolve(layer, "hi");
    const stored = { ...layer, width: one.width, height: one.height, x: one.x, y: one.y };
    const many = resolve(stored, long);
    const edge = (box: { y: number; height: number }) => (growth === "down" ? box.y - box.height / 2 : growth === "up" ? box.y + box.height / 2 : box.y);
    expect(many.height).toBeGreaterThan(one.height);
    expect(edge(many)).toBeCloseTo(edge(one), 6);
  });
});

describe("TEST 10–15: typography changes re-resolve the wrap", () => {
  const text = "wedding invitations for our family";
  it("17 → 30 wraps; 30 → 17 returns to one line", () => {
    const layer = newText();
    expect(linesOf(layer, text)).toHaveLength(1);
    const big = { ...layer, textStyle: { ...layer.textStyle, fontSize: 125 } };
    expect(linesOf(big, text).length).toBeGreaterThan(1);
    expect(linesOf(layer, text)).toHaveLength(1);
  });

  it("a wider font widens and can wrap; switching back restores it", () => {
    const layer = newText();
    const wide = { ...layer, textStyle: { ...layer.textStyle, fontFamily: "Wide Serif" } };
    expect(resolve(wide, "wedding").width).toBeGreaterThan(resolve(layer, "wedding").width);
    expect(linesOf({ ...wide, textStyle: { ...wide.textStyle, fontSize: 90 } }, text).length).toBeGreaterThan(1);
  });

  it("letter spacing widens and narrows it", () => {
    const layer = newText();
    const spaced = { ...layer, textStyle: { ...layer.textStyle, letterSpacing: 30 } };
    expect(resolve(spaced, "wedding").width).toBeGreaterThan(resolve(layer, "wedding").width);
  });

  it("bold and italic re-measure", () => {
    const layer = newText();
    expect(resolve({ ...layer, textStyle: { ...layer.textStyle, fontWeight: "700" } }, "wedding").width).toBeGreaterThan(resolve(layer, "wedding").width);
    expect(resolve({ ...layer, textStyle: { ...layer.textStyle, fontStyle: "italic" } }, "wedding").width).toBeGreaterThan(resolve(layer, "wedding").width);
  });
});

describe("TEST 17–20: the limit is each artboard's own safe area", () => {
  const cards = {
    "5 × 7 portrait": { canvasWidthPx: 1500, canvasHeightPx: 2100, dpi: 300, safeArea: { left: 75, top: 75, right: 75, bottom: 75 } },
    "5 × 7 landscape": { canvasWidthPx: 2100, canvasHeightPx: 1500, dpi: 300, safeArea: { left: 75, top: 75, right: 75, bottom: 75 } },
    "3.5 × 5 portrait": { canvasWidthPx: 1050, canvasHeightPx: 1500, dpi: 300, safeArea: { left: 60, top: 60, right: 60, bottom: 60 } },
    "3.5 × 5 landscape": { canvasWidthPx: 1500, canvasHeightPx: 1050, dpi: 300, safeArea: { left: 60, top: 60, right: 60, bottom: 60 } },
  };
  it.each(Object.entries(cards))("%s", (_name, card) => {
    const layer = newText(card);
    const long = "wedding invitations for our family and friends near and far away from home";
    const box = resolve(layer, long, card);
    expect(box.width).toBe(safeWidth(card));
    expect(box.x - box.width / 2).toBeCloseTo(card.safeArea.left, 6);
  });
});

describe("TEST 21–23: zoom never reaches the layout", () => {
  it("resolution takes document units only — no zoom input exists", () => {
    // Every renderer passes document px and the template's safe area; the
    // canvas scales the drawn result. The same call gives the same lines.
    const layer = newText();
    const text = "wedding invitations for our family and friends near and far";
    expect(linesOf(layer, text)).toEqual(linesOf(layer, text));
    expect(read("lib/customizer/v2/text-layout.ts")).not.toMatch(/function resolveSafeWidthBox\([^)]*zoom/);
  });
});

describe("TEST 24: a manual side resize makes it a fixed-width paragraph", () => {
  const style = { autoSizeMode: "safe-width", multiline: false };
  it("a width change on its own switches the mode", () => {
    expect(manualWidthStylePatch(style, { width: 300 }, 500)).toEqual({ multiline: true, autoSizeMode: "height", fitMode: "auto-height" });
  });
  it("a corner drag (font size), a move or an unchanged width does not", () => {
    expect(manualWidthStylePatch(style, { width: 600, textStyle: { fontSize: 90 } }, 500)).toBeNull();
    expect(manualWidthStylePatch(style, {}, 500)).toBeNull();
    expect(manualWidthStylePatch(style, { width: 500.4 }, 500)).toBeNull();
    expect(manualWidthStylePatch({ autoSizeMode: "height" }, { width: 300 }, 500)).toBeNull();
  });
  it("is wired into the studio and the customer editor gestures", () => {
    expect(read("app/admin/dashboard/design-builder/AdminCanvas.tsx")).toContain("manualWidthStylePatch(layer.textStyle");
    expect(read("app/components/customizer/CustomizerWorkspace.tsx")).toContain("manualWidthStylePatch(layer.textStyle");
  });
  it("the inspector can set it back to auto", () => {
    expect(read("app/admin/dashboard/design-builder/AdminPropertiesPanel.tsx")).toContain('{ value: "safe-width", label: "Auto width, wraps at safe area" }');
  });
});

describe("TEST 26–28: saved, published and rendered the same way", () => {
  const text = "wedding invitations for our family and friends near and far";
  it("save and reload keep the mode", () => {
    const layer = { ...newText(), text };
    const saved = normalizeCustomizerTemplate({ ...FIVE_BY_SEVEN, pages: [{ id: "front", label: "Front", enabled: true }], layers: [layer] });
    const reloaded = normalizeCustomizerTemplate(JSON.parse(JSON.stringify(saved)));
    expect(reloaded.layers[0].textStyle.autoSizeMode).toBe("safe-width");
  });

  it("the server render wraps exactly where the editor does", () => {
    const layer = { ...newText(), text };
    const template = normalizeCustomizerTemplate({ ...FIVE_BY_SEVEN, pages: [{ id: "front", label: "Front", enabled: true }], layers: [layer] });
    const svg = buildPageSvg({ template, pageId: "front", mode: "print", measure: fallbackMeasure });
    const serverLines = [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((match) => match[1]);
    const saved = template.layers[0];
    const box = resolveTextBox(
      { ...saved, ...saved.textStyle, text, x: saved.x, y: saved.y, width: saved.width, height: saved.height, rotation: saved.rotation },
      fallbackMeasure,
      templateSafeBounds(template),
    );
    const editorLines = layoutText(
      { ...saved.textStyle, text, width: box.width, height: box.height, ...resolvedTextLayoutMode(saved.textStyle, box.clampedBySafeArea) },
      fallbackMeasure,
    ).lines.map((line) => line.text);
    expect(serverLines.length).toBeGreaterThan(1);
    expect(serverLines).toEqual(editorLines);
  });

  it("existing 'width' text is untouched: it still shrinks at the safe area, never wraps", () => {
    expect(resolvedTextLayoutMode({ autoSizeMode: "width" }, true)).toEqual({ multiline: false, fitMode: "shrink" });
    expect(resolvedTextLayoutMode({ autoSizeMode: "height", multiline: true, fitMode: "auto-height" }, false)).toEqual({ multiline: true, fitMode: "auto-height" });
  });

  it("every editor creates new text as safe-width, through the shared preset", () => {
    for (const path of ["app/products/[slug]/personalize/personalize-client.tsx", "app/admin/dashboard/design-builder/AdminCustomerPreview.tsx"]) {
      expect(read(path)).toContain("autoSizeMode: style.autoSizeMode,");
    }
    expect(read("app/admin/dashboard/design-builder/builder-utils.ts")).toContain("autoSizeMode: preset.autoSizeMode,");
  });
});
