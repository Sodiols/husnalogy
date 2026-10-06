import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  TRANSPARENT_PAINT,
  canonicalPaint,
  isTransparentPaint,
  normalizePaintValue,
  svgPaint,
} from "../paint";
import { normalizeCustomizerTemplate, normalizeUserLayer } from "@/lib/customizer";
import { templateToDocument } from "../document";
import { buildPageSvg } from "../svg";
import { createServerMeasure } from "../server/server-fonts";
import { renderCustomizationPages } from "../server/render";
import { validateCustomerState } from "../validate";
import { isUnchangedPersistedOverrideViolation } from "@/lib/customizer/save-validation";
import { installGoogleFontsHarness, resetGoogleFontsHarness } from "./google-fonts-test-harness";

describe("paint values", () => {
  it("transparent has one canonical value: the renderer's own \"none\"", () => {
    expect(TRANSPARENT_PAINT).toBe("none");
    expect(normalizePaintValue("transparent")).toBe("none");
    expect(normalizePaintValue("NONE")).toBe("none");
    expect(canonicalPaint("Transparent")).toBe("none");
  });

  it("accepts hex colours and refuses anything else a paint could smuggle in", () => {
    expect(normalizePaintValue("#D4AF37")).toBe("#d4af37");
    expect(normalizePaintValue("#fff")).toBe("#fff");
    expect(normalizePaintValue("url(#evil)")).toBeNull();
    expect(normalizePaintValue("red; stroke:black")).toBeNull();
    expect(normalizePaintValue("")).toBeNull();
  });

  it("an empty value still renders as no paint, exactly as before", () => {
    expect(isTransparentPaint("")).toBe(true);
    expect(svgPaint("")).toBe("none");
    expect(svgPaint(undefined)).toBe("none");
    expect(svgPaint("transparent")).toBe("none");
    expect(svgPaint("#303839")).toBe("#303839");
  });
});

const shapeTemplate = (layer: Record<string, unknown>, settings: Record<string, unknown> = {}) =>
  normalizeCustomizerTemplate({
    id: "t", version: 1, canvasWidthPx: 400, canvasHeightPx: 400, cardWidthIn: 4, cardHeightIn: 4, dpi: 100,
    pages: [{ id: "front", label: "Front", enabled: true, backgroundColor: "#ffffff" }],
    layers: [{ id: "box", page: "front", type: "shape", shape: "rectangle", x: 200, y: 200, width: 200, height: 200, zIndex: 1, customerEditable: true, ...layer }],
    settings,
  });

describe("normalisation keeps transparent and every existing value", () => {
  it("a transparent fill/stroke survives the template, the published document and a customer layer", () => {
    const template = shapeTemplate({ fill: "transparent", stroke: "none", strokeWidth: 6 });
    expect(template.layers[0]).toMatchObject({ fill: "none", stroke: "none" });
    const { document } = templateToDocument(template);
    expect(document.layers[0]).toMatchObject({ fill: "none", stroke: "none" });
    expect(normalizeUserLayer({ type: "shape", shape: "rectangle", fill: "none", stroke: "transparent" })).toMatchObject({ fill: "none", stroke: "none" });
  });

  it("a missing fill still gets the default, and an empty stroke still means no border", () => {
    const template = shapeTemplate({ fill: undefined, stroke: "" });
    expect(template.layers[0]).toMatchObject({ fill: "#F8F6F1", stroke: "" });
  });
});

describe("rendering", () => {
  afterEach(() => {
    resetGoogleFontsHarness();
    vi.restoreAllMocks();
  });

  it("the server SVG draws transparent as fill/stroke \"none\", never white", () => {
    const svg = buildPageSvg({
      template: shapeTemplate({ fill: "none", stroke: "transparent", strokeWidth: 8 }),
      values: {},
      editorState: null,
      pageId: "front",
      measure: createServerMeasure(),
      mode: "print",
    });
    // The shape's own rect (the page background is a separate white rect).
    expect(svg).toMatch(/<rect x="100" y="100" width="200" height="200"[^>]*fill="none"[^>]*stroke="none"/);
  });

  it("a transparent line draws nothing; a coloured line keeps its colour", () => {
    const line = (stroke: string) =>
      buildPageSvg({
        template: shapeTemplate({ shape: "line", fill: "none", stroke, strokeWidth: 6, height: 8 }),
        values: {}, editorState: null, pageId: "front", measure: createServerMeasure(), mode: "print",
      });
    expect(line("none")).toMatch(/<line [^>]*stroke="none"/);
    expect(line("#d4af37")).toMatch(/<line [^>]*stroke="#d4af37"/);
  });

  it("the print raster shows the page through a transparent fill", async () => {
    installGoogleFontsHarness();
    const template = shapeTemplate({ fill: "none", stroke: "#000000", strokeWidth: 10 }, {});
    template.pages[0].backgroundColor = "#00ff00";
    const [page] = await renderCustomizationPages({ template, values: {}, editorState: null, mode: "print", pageIds: ["front"] });
    const { data, info } = await sharp(page.png).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => {
      const offset = (y * info.width + x) * info.channels;
      return [data[offset], data[offset + 1], data[offset + 2]];
    };
    // Centre of the rectangle: the green page, not white.
    expect(pixel(200, 200)).toEqual([0, 255, 0]);
    // On the border: the stroke.
    expect(pixel(100, 200)).toEqual([0, 0, 0]);
  });
});

describe("server validation of customer paints", () => {
  const editable = { customerPermissions: { changeFill: true, changeBorder: true } };

  it("transparent is never a palette violation, for customer objects and template shapes alike", () => {
    const template = shapeTemplate(editable, { allowedCustomerColors: ["#d4af37"], allowCustomerShapes: true });
    const result = validateCustomerState(template, {
      values: {},
      editorState: {
        layerOverrides: { box: { properties: { fill: "transparent", stroke: "none" } } },
        userLayers: [{ id: "u1", type: "shape", shape: "rectangle", page: "front", fill: "none", stroke: "#d4af37", x: 100, y: 100, width: 50, height: 50 }],
      },
    });
    expect(result.violations.map((violation) => violation.code)).not.toContain("paint-not-allowed");
    expect(result.violations.map((violation) => violation.code)).not.toContain("color-not-allowed-by-template");
    expect(result.sanitizedEditorState.layerOverrides.box.properties).toEqual({ fill: "none", stroke: "none" });
  });

  it("refuses a paint outside the palette, and anything that is not a colour", () => {
    const template = shapeTemplate(editable, { allowedCustomerColors: ["#d4af37"] });
    const outside = validateCustomerState(template, { values: {}, editorState: { layerOverrides: { box: { properties: { fill: "#123456" } } } } });
    expect(outside.violations.map((violation) => violation.code)).toContain("paint-not-allowed");
    const smuggled = validateCustomerState(shapeTemplate(editable), { values: {}, editorState: { layerOverrides: { box: { properties: { stroke: "url(#x)" } } } } });
    expect(smuggled.violations.map((violation) => violation.code)).toContain("paint-not-allowed");
    expect(smuggled.sanitizedEditorState.layerOverrides.box?.properties?.stroke).toBeUndefined();
  });

  it("a colour saved before the palette existed does not block the next save", () => {
    const violation = { code: "paint-not-allowed", layerId: "box", message: "" };
    const persisted = { layerOverrides: { box: { properties: { fill: "#123456" } } } };
    expect(isUnchangedPersistedOverrideViolation(violation as any, persisted, persisted)).toBe(true);
    const changed = { layerOverrides: { box: { properties: { fill: "#654321" } } } };
    expect(isUnchangedPersistedOverrideViolation(violation as any, changed, persisted)).toBe(false);
  });
});
