/**
 * New text: 17 pt by default, true auto width, and ONE units rule.
 *
 * Stored font sizes are document px (the artboard's own pixels at its DPI);
 * every font-size control shows points. 17 pt on a 300 DPI card is 70.83 px,
 * which is what a print editor's "17" means. Existing designs keep their
 * stored sizes — only the number shown changes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addLayer, getLayer, newTextLayer } from "@/app/admin/dashboard/design-builder/builder-utils";
import { normalizeCustomizerTemplate, normalizeEditorState, normalizeUserLayer } from "@/lib/customizer";
import { STUDIO_SELECTION_THEME, isSmallText } from "@/lib/customizer/v2/interaction/selection-theme";
import { resolveLayerSelectionGeometry } from "@/lib/customizer/v2/selection-geometry";
import { buildPageSvg } from "@/lib/customizer/v2/svg";
import {
  alignedEdgeShift,
  becomesMultilineFromAutoWidth,
  canonicalTextLayerUpdate,
  getTextPlacementStyle,
  widenForTypedLines,
} from "@/lib/customizer/v2/text-editing";
import { autoWidthPadding, fallbackMeasure, resolveTextBox, type MeasureFn } from "@/lib/customizer/v2/text-layout";
import { FONT_SIZE_RULES } from "@/lib/customizer/v2/text-toolbar";
import {
  DEFAULT_NEW_TEXT_POINT_SIZE,
  SMALL_TEXT_MAX_POINT_SIZE,
  documentPxToPoints,
  fontSizeBoundsInPoints,
  newTextFontSize,
  pointsToDocumentPx,
} from "@/lib/customizer/v2/type-units";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/** Every glyph is half the font size wide: easy to reason about, deterministic. */
const halfEm: MeasureFn = (text, style) => Array.from(text).length * style.fontSize * 0.5;

const template = (extra: Record<string, unknown> = {}) => ({
  canvasWidthPx: 1500,
  canvasHeightPx: 2100,
  dpi: 300,
  pages: [{ id: "front", label: "Front", enabled: true }],
  layers: [],
  fields: [],
  ...extra,
});

const boxOf = (layer: any, text = layer.text, measure: MeasureFn = halfEm) => {
  const style = layer.textStyle;
  return resolveTextBox(
    {
      x: layer.x,
      y: layer.y,
      width: layer.width,
      height: layer.height,
      text,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      multiline: style.multiline,
      textAlign: style.textAlign,
      autoSizeMode: style.autoSizeMode,
      fitMode: style.fitMode,
      growthDirection: style.growthDirection,
    },
    measure,
  );
};

describe("1. one centralized default: 17", () => {
  it("is 17 points, stored as document px for the artboard's DPI", () => {
    expect(DEFAULT_NEW_TEXT_POINT_SIZE).toBe(17);
    expect(newTextFontSize(300)).toBe(70.83);
    expect(newTextFontSize(150)).toBe(35.42);
    // An artboard without a DPI is a 300 DPI card.
    expect(newTextFontSize(undefined)).toBe(70.83);
  });

  it("shows as 17 in every font-size control", () => {
    expect(documentPxToPoints(newTextFontSize(300), 300)).toBe(17);
    expect(documentPxToPoints(newTextFontSize(150), 150)).toBe(17);
  });

  it("no creation path hardcodes its own size", () => {
    for (const path of [
      "app/admin/dashboard/design-builder/builder-utils.ts",
      "app/admin/dashboard/design-builder/AdminCustomerPreview.tsx",
      "app/products/[slug]/personalize/personalize-client.tsx",
    ]) {
      expect(read(path)).not.toMatch(/fontSize:\s*(17|70\.83)\b/);
    }
  });
});

describe("2. the standard preset: one line, auto width, 17 pt, centred", () => {
  it("returns the centralized size and true auto width", () => {
    const style = getTextPlacementStyle("text", 1500, 2100, 300);
    expect(style).toMatchObject({ fontSize: 70.83, multiline: false, textAlign: "center" });
    // Only a starting value: auto width measures the content.
    expect(style.width).toBeLessThan(100);
  });

  it("is the default of every editor and the Elements text", () => {
    expect(read("app/admin/dashboard/design-builder/AdminDesignBuilder.tsx")).toContain('useState<TextPlacementPreset>("text")');
    expect(read("app/admin/dashboard/design-builder/AdminCustomerPreview.tsx")).toContain('useState<TextPlacementPreset>("text")');
    expect(read("app/products/[slug]/personalize/personalize-client.tsx")).toContain('useState<TextPlacementPreset>("text")');
    const elements = read("app/components/customizer/CustomerElementsPanel.tsx");
    const presets = elements.slice(elements.indexOf("const TEXT_PRESETS"), elements.indexOf("];", elements.indexOf("const TEXT_PRESETS")));
    expect(presets.match(/id: "text"/g)?.length).toBe(6);
    expect(presets).not.toMatch(/id: "(heading|subheading|body)"/);
  });

  it("both Add Text panels offer it first", () => {
    const admin = read("app/admin/dashboard/design-builder/AdminTextToolPanel.tsx");
    expect(admin.indexOf('id: "text"')).toBeLessThan(admin.indexOf('id: "heading"'));
    const customer = read("app/components/customizer/CustomerAddTextPanel.tsx");
    expect(customer.indexOf('["text", "Add Text"')).toBeLessThan(customer.indexOf('["heading"'));
  });
});

describe("3. studio Add Text and click placement create standard text", () => {
  it.each([
    ["Add Text (centre)", {}],
    ["click placement", { x: 300, y: 400, text: "" }],
  ])("%s", (_name, options) => {
    const layer: any = newTextLayer(template(), "front", options);
    expect(layer.textStyle).toMatchObject({ fontSize: 70.83, multiline: false, autoSizeMode: "safe-width", textAlign: "center" });
    expect(layer.width).toBeLessThan(100);
  });

  it("an explicit style preset is still honoured", () => {
    const layer: any = newTextLayer(template(), "front", { preset: "body" });
    expect(layer.textStyle.multiline).toBe(true);
    expect(layer.textStyle.autoSizeMode).toBe("height");
  });
});

describe("4. true auto width: the box is the words", () => {
  const layer: any = { ...newTextLayer(template(), "front", { text: "" }), x: 750, y: 1000 };
  const fontSize = layer.textStyle.fontSize;

  it("is the measured glyph width plus the minimal padding (and the trailing letter space)", () => {
    const box = boxOf(layer, "wedding invitations");
    expect(box.autoWidth).toBe(true);
    const trailingSpace = layer.textStyle.letterSpacing;
    expect(box.width).toBe(Math.round(19 * fontSize * 0.5 + autoWidthPadding(fontSize) + trailingSpace));
    expect(box.width).toBeLessThan(1500 * 0.62);
  });

  it("grows while typing and shrinks while deleting, live", () => {
    const widths = ["w", "wed", "wedding", "wedding invitations", "wedding", "w"].map((text) => boxOf(layer, text).width);
    expect(widths[1]).toBeGreaterThan(widths[0]);
    expect(widths[2]).toBeGreaterThan(widths[1]);
    expect(widths[3]).toBeGreaterThan(widths[2]);
    expect(widths[4]).toBe(widths[2]);
    expect(widths[5]).toBe(widths[0]);
  });

  it("makes room for wide letter spacing without moving the text", () => {
    const spaced = { ...layer, textStyle: { ...layer.textStyle, letterSpacing: 12 } };
    expect(boxOf(spaced, "wedding").width - boxOf(layer, "wedding").width).toBe(12 - layer.textStyle.letterSpacing);
    expect(boxOf(spaced, "wedding").x).toBe(750);
  });

  it("re-measures when the real font arrives", () => {
    const wider: MeasureFn = (text, style) => halfEm(text, style) * 1.2;
    expect(boxOf(layer, "wedding", wider).width).toBeGreaterThan(boxOf(layer, "wedding").width);
  });

  it("centred text keeps its centre", () => {
    expect(boxOf(layer, "w").x).toBe(750);
    expect(boxOf(layer, "wedding invitations").x).toBe(750);
  });
});

describe("5. the aligned edge holds as the width changes", () => {
  it.each(["left", "right"] as const)("%s-aligned text keeps its own edge", (align) => {
    const box = { x: 500, y: 500, width: 100 };
    const next = alignedEdgeShift(box, 300, align);
    const edge = (x: number, width: number) => (align === "left" ? x - width / 2 : x + width / 2);
    expect(edge(next.x, 300)).toBeCloseTo(edge(box.x, box.width), 6);
    expect(next.y).toBe(500);
  });

  it("centred text does not move", () => {
    expect(alignedEdgeShift({ x: 500, y: 500, width: 100 }, 300, "center")).toEqual({ x: 500, y: 500 });
  });

  it("a rotated box shifts along its own axis", () => {
    const next = alignedEdgeShift({ x: 0, y: 0, width: 100, rotation: 90 }, 300, "left");
    expect(next.x).toBeCloseTo(0, 6);
    expect(next.y).toBeCloseTo(100, 6);
  });

  it("the studio's box constraint applies it to one-line text", () => {
    const builder = read("app/admin/dashboard/design-builder/AdminDesignBuilder.tsx");
    expect(builder).toContain("autoSizedSingleLine ? alignedEdgeShift(layer, nextWidth, style.textAlign)");
  });
});

describe("6. a line break never falls back to a huge — or a one-word — width", () => {
  const style = { fontFamily: "Inter", fontSize: 70.83, lineHeight: 1.2, autoSizeMode: "width", multiline: false, textAlign: "center" };

  it("knows when one-line auto-width text becomes multi-line", () => {
    expect(becomesMultilineFromAutoWidth(style, "Hello", "Hello\nWorld")).toBe(true);
    expect(becomesMultilineFromAutoWidth(style, "Hello\nWorld", "Hello\nWorld!")).toBe(false);
    expect(becomesMultilineFromAutoWidth({ ...style, autoSizeMode: "fixed" }, "Hello", "Hello\nWorld")).toBe(false);
  });

  it("promotes it to a paragraph (the existing rule)", () => {
    expect(canonicalTextLayerUpdate("Hello\nWorld", style).textStyle).toMatchObject({ multiline: true, autoSizeMode: "height" });
  });

  it("wraps at the widest typed line plus the padding", () => {
    const layer = { x: 750, y: 1000, width: 80, textStyle: style };
    const widened = widenForTypedLines(layer, "Hi\nwedding invitations", halfEm, 1500);
    expect(widened.width).toBe(Math.ceil(19 * 70.83 * 0.5 + autoWidthPadding(70.83)));
    expect(widened.x).toBe(750);
  });

  it("is never narrower than it was, and never wider than the artboard", () => {
    expect(widenForTypedLines({ x: 0, y: 0, width: 900, textStyle: style }, "a\nb", halfEm, 1500).width).toBe(900);
    expect(widenForTypedLines({ x: 0, y: 0, width: 80, textStyle: style }, `a\n${"w".repeat(200)}`, halfEm, 1500).width).toBe(1500);
  });

  it("left-aligned text keeps its left edge as it widens", () => {
    const layer = { x: 500, y: 500, width: 100, textStyle: { ...style, textAlign: "left" } };
    const widened = widenForTypedLines(layer, "a\nwedding invitations", halfEm, 1500);
    expect(widened.x - widened.width / 2).toBeCloseTo(500 - 50, 6);
  });

  it("is wired into the studio, the customer editor and the preview", () => {
    for (const path of [
      "app/admin/dashboard/design-builder/AdminDesignBuilder.tsx",
      "app/products/[slug]/personalize/personalize-client.tsx",
      "app/admin/dashboard/design-builder/AdminCustomerPreview.tsx",
    ]) {
      const source = read(path);
      expect(source).toContain("becomesMultilineFromAutoWidth(");
      expect(source).toContain("widenForTypedLines(");
    }
  });
});

describe("7. selection and hit testing use the resolved geometry", () => {
  it("the selection box is the auto-width box", () => {
    const layer: any = { ...newTextLayer(template(), "front", { text: "wedding invitations" }), x: 750, y: 1000 };
    const geometry = resolveLayerSelectionGeometry(layer, { measure: halfEm, safeBounds: { left: 0, top: 0, right: 1500, bottom: 2100 } });
    const box = boxOf(layer);
    expect(geometry.width).toBe(box.width);
    expect(geometry.height).toBe(box.height);
    expect(geometry.x).toBe(box.x);
  });
});

describe("8. points <-> document px: one conversion", () => {
  it("round-trips at one decimal", () => {
    for (const points of [1, 4.5, 10, 11, 17, 24, 36, 72, 120]) {
      expect(documentPxToPoints(pointsToDocumentPx(points, 300), 300)).toBe(points);
      expect(documentPxToPoints(pointsToDocumentPx(points, 150), 150)).toBe(points);
    }
  });

  it("shows existing designs' sizes honestly — their stored px never change", () => {
    expect(documentPxToPoints(72, 300)).toBe(17.3);
    expect(documentPxToPoints(48, 300)).toBe(11.5);
  });

  it("converts the stored limits to point limits that stay inside them", () => {
    const bounds = fontSizeBoundsInPoints(FONT_SIZE_RULES, 300);
    expect(bounds).toEqual({ minimum: 1, maximum: 120 });
    expect(pointsToDocumentPx(bounds.minimum, 300)).toBeGreaterThanOrEqual(FONT_SIZE_RULES.minimum);
    expect(pointsToDocumentPx(bounds.maximum, 300)).toBeLessThanOrEqual(FONT_SIZE_RULES.maximum);
    const layerBounds = fontSizeBoundsInPoints({ minimum: 30, maximum: 90 }, 300);
    expect(pointsToDocumentPx(layerBounds.minimum, 300)).toBeGreaterThanOrEqual(30);
    expect(pointsToDocumentPx(layerBounds.maximum, 300)).toBeLessThanOrEqual(90);
  });

  it("every font-size control converts at the boundary", () => {
    const toolbar = read("app/admin/dashboard/design-builder/AdminContextToolbar.tsx");
    expect(toolbar).toContain("value={documentPxToPoints(Number(fontSize.value), props.dpi)}");
    expect(read("app/admin/dashboard/design-builder/AdminDesignBuilder.tsx")).toContain("dpi={t.dpi}");
    const customer = read("app/components/customizer/CustomerContextToolbar.tsx");
    expect(customer).toContain("value={documentPxToPoints(fontSize, dpi)}");
    expect(customer).toContain("fontSize: pointsToDocumentPx(points, dpi)");
    for (const path of ["app/admin/dashboard/design-builder/AdminCustomerPreview.tsx", "app/products/[slug]/personalize/personalize-client.tsx"]) {
      expect(read(path)).toContain("dpi={template?.dpi}");
    }
  });
});

describe("9. small text is 10 pt or less; 17 pt is normal", () => {
  const theme = { ...STUDIO_SELECTION_THEME, smallTextMaxFontSize: pointsToDocumentPx(SMALL_TEXT_MAX_POINT_SIZE, 300) };
  it("uses compact controls at 10 pt and below only", () => {
    expect(isSmallText(pointsToDocumentPx(10, 300), theme)).toBe(true);
    expect(isSmallText(pointsToDocumentPx(8, 300), theme)).toBe(true);
    expect(isSmallText(pointsToDocumentPx(11, 300), theme)).toBe(false);
    expect(isSmallText(newTextFontSize(300), theme)).toBe(false);
  });

  it("the studio converts the rule with the artboard's DPI", () => {
    expect(read("app/admin/dashboard/design-builder/AdminCanvas.tsx")).toContain(
      "smallTextMaxFontSize: pointsToDocumentPx(SMALL_TEXT_MAX_POINT_SIZE, documentDpi)",
    );
  });
});

describe("10. save and reload keep the exact size and auto width", () => {
  it("the template normalizer keeps 70.83 px (not 71)", () => {
    const layer = newTextLayer(template(), "front", { text: "wedding invitations" });
    const saved = normalizeCustomizerTemplate(addLayer(template(), layer));
    const reloaded = normalizeCustomizerTemplate(JSON.parse(JSON.stringify(saved)));
    const text = getLayer(reloaded, (layer as any).id) || reloaded.layers.find((item: any) => item.type === "text");
    expect(text.textStyle.fontSize).toBe(70.83);
    expect(text.textStyle.autoSizeMode).toBe("safe-width");
    expect(text.textStyle.multiline).toBe(false);
  });

  it("customer text and style patches keep it too", () => {
    const user = normalizeUserLayer({ page: "front", text: "Hello", x: 10, y: 10, width: 71, height: 85, textStyle: { fontSize: 70.83, autoSizeMode: "width" } });
    expect(user.textStyle.fontSize).toBe(70.83);
    const state = normalizeEditorState({ layerOverrides: { t: { textStyle: { fontSize: 41.67 } } } });
    expect(JSON.stringify(state)).toContain("41.67");
  });
});

describe("11. backward compatibility: no migration, no reflow", () => {
  it("whole-pixel sizes of existing designs are untouched", () => {
    const old = {
      ...template(),
      layers: [{ id: "t", page: "front", type: "text", text: "Old title", x: 750, y: 500, width: 1000, height: 120, zIndex: 1, textStyle: { fontFamily: "Inter", fontSize: 72, autoSizeMode: "fixed" } }],
    };
    const saved = normalizeCustomizerTemplate(old);
    expect(saved.layers[0].textStyle.fontSize).toBe(72);
    expect(saved.layers[0].width).toBe(1000);
    // A fixed box still renders exactly as stored.
    expect(boxOf({ ...saved.layers[0], textStyle: { ...saved.layers[0].textStyle } }).width).toBe(1000);
  });
});

describe("12. the server/print render agrees with the editor", () => {
  it("draws new text at 70.83 px in the measured auto-width box", () => {
    const layer: any = { ...newTextLayer(template(), "front", { text: "wedding invitations" }), x: 750, y: 1000 };
    const doc = { ...template(), layers: [layer] };
    const svg = buildPageSvg({ template: doc, pageId: "front", mode: "print", measure: fallbackMeasure });
    expect(svg).toContain('font-size="70.83"');
    const box = boxOf(layer, layer.text, fallbackMeasure);
    expect(svg).toContain(`width="${box.width}" height="${box.height}"`);
  });
});
