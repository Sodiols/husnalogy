import { describe, expect, it } from "vitest";
import { anchorGrownTextBox, normalizeTextGrowthDirection } from "../text-growth";
import { normalizeCustomizerTemplate, normalizeUserLayer } from "@/lib/customizer";
import { templateToDocument } from "../document";
import { buildPageSvg } from "../svg";
import { resolveTextBox, effectiveTextGrowth, type MeasureFn } from "../text-layout";
import { validateCustomerState } from "../validate";

/** The canvas position of a point on the box's local vertical axis (0 = centre, ±h/2 = edges). */
const along = (box: { x: number; y: number; rotation: number }, local: number) => {
  const angle = (box.rotation * Math.PI) / 180;
  return { x: box.x - Math.sin(angle) * local, y: box.y + Math.cos(angle) * local };
};

describe("normalizeTextGrowthDirection", () => {
  it("keeps the three directions and nothing else", () => {
    expect(normalizeTextGrowthDirection("up")).toBe("up");
    expect(normalizeTextGrowthDirection("CENTER")).toBe("center");
    expect(normalizeTextGrowthDirection("down")).toBe("down");
    for (const value of [undefined, null, "", "middle", "top", "bottom", 3]) expect(normalizeTextGrowthDirection(value)).toBeUndefined();
  });
});

describe("anchorGrownTextBox", () => {
  for (const rotation of [0, 30, 90, -135, 180]) {
    const before = { x: 400, y: 600, rotation };
    const fromHeight = 100;
    const toHeight = 260;

    it(`Downward keeps the top edge exactly (rotation ${rotation}°)`, () => {
      const after = { ...anchorGrownTextBox({ ...before, fromHeight, toHeight, growth: "down" }), rotation };
      const topBefore = along(before, -fromHeight / 2);
      const topAfter = along(after, -toHeight / 2);
      expect(topAfter.x).toBeCloseTo(topBefore.x, 9);
      expect(topAfter.y).toBeCloseTo(topBefore.y, 9);
    });

    it(`Upward keeps the bottom edge exactly (rotation ${rotation}°)`, () => {
      const after = { ...anchorGrownTextBox({ ...before, fromHeight, toHeight, growth: "up" }), rotation };
      const bottomBefore = along(before, fromHeight / 2);
      const bottomAfter = along(after, toHeight / 2);
      expect(bottomAfter.x).toBeCloseTo(bottomBefore.x, 9);
      expect(bottomAfter.y).toBeCloseTo(bottomBefore.y, 9);
    });

    it(`Center keeps the centre exactly (rotation ${rotation}°)`, () => {
      expect(anchorGrownTextBox({ ...before, fromHeight, toHeight, growth: "center" })).toEqual({ x: 400, y: 600 });
    });
  }

  it("shrinking moves the free edge back, and returning to the original height returns the box exactly", () => {
    for (const growth of ["up", "center", "down"] as const) {
      const grown = anchorGrownTextBox({ x: 10, y: 20, fromHeight: 50, toHeight: 170, rotation: 17, growth });
      const back = anchorGrownTextBox({ ...grown, fromHeight: 170, toHeight: 50, rotation: 17, growth });
      expect(back.x).toBeCloseTo(10, 9);
      expect(back.y).toBeCloseTo(20, 9);
    }
  });

  it("an unrotated box moves only vertically", () => {
    expect(anchorGrownTextBox({ x: 100, y: 100, fromHeight: 40, toHeight: 120, growth: "down" })).toEqual({ x: 100, y: 140 });
    expect(anchorGrownTextBox({ x: 100, y: 100, fromHeight: 40, toHeight: 120, growth: "up" })).toEqual({ x: 100, y: 60 });
  });
});

/* ------------------------------------------------------------ lifecycle -- */


// Deterministic metrics: every glyph is half the font size wide.
const measure: MeasureFn = (text, style) => text.length * style.fontSize * 0.5;

const paragraph = (text: string, extra: Record<string, unknown> = {}) => ({
  x: 500,
  y: 400,
  width: 600,
  height: 60,
  text,
  fontFamily: "Inter",
  fontSize: 50,
  lineHeight: 1.2,
  multiline: true,
  autoSizeMode: "height",
  ...extra,
});

describe("resolveTextBox honours the growth direction", () => {
  const one = resolveTextBox(paragraph("One"), measure);
  const three = (growth?: string, rotation = 0) => resolveTextBox(paragraph("One\nTwo\nThree", { growthDirection: growth, rotation }), measure);

  it("Downward keeps the stored top edge; Upward the stored bottom; Center the stored centre", () => {
    const top = 400 - 60 / 2;
    const bottom = 400 + 60 / 2;
    const down = three("down");
    const up = three("up");
    const centre = three("center");
    expect(down.height).toBeGreaterThan(one.height * 2);
    expect(down.y - down.height / 2).toBeCloseTo(top, 9);
    expect(up.y + up.height / 2).toBeCloseTo(bottom, 9);
    expect(centre.y).toBe(400);
    expect([down.x, up.x, centre.x]).toEqual([500, 500, 500]);
  });

  it("a rotated box grows along its own vertical axis", () => {
    const rotated = three("down", 90);
    // Rotated 90° clockwise, the box's "down" points to canvas -x.
    expect(rotated.y).toBeCloseTo(400, 9);
    expect(rotated.x).toBeCloseTo(500 - (rotated.height - 60) / 2, 9);
  });

  it("without a direction, older documents keep exactly what they did", () => {
    const legacy = three(undefined);
    expect(legacy.y - legacy.height / 2).toBeCloseTo(400 - 30, 9);
    expect(legacy.x).toBe(500);
    expect(resolveTextBox(paragraph("One\nTwo\nThree", { rotation: 90 }), measure)).toEqual(legacy);
  });

  it("a single line growing with its font size follows the direction too", () => {
    const line = (growthDirection?: string) =>
      resolveTextBox({ x: 300, y: 300, width: 200, height: 40, text: "Hello", fontFamily: "Inter", fontSize: 80, autoSizeMode: "width", growthDirection }, measure);
    const up = line("up");
    const down = line("down");
    expect(up.y + up.height / 2).toBeCloseTo(320, 9);
    expect(down.y - down.height / 2).toBeCloseTo(280, 9);
  });

  it("the control shows what an older object does when no direction was chosen", () => {
    expect(effectiveTextGrowth({ autoSizeMode: "height" }, "a")).toBe("down");
    expect(effectiveTextGrowth({ autoSizeMode: "width" }, "a\nb")).toBe("down");
    expect(effectiveTextGrowth({ autoSizeMode: "width", verticalAlign: "middle" }, "a")).toBe("center");
    expect(effectiveTextGrowth({ autoSizeMode: "width", verticalAlign: "bottom" }, "a")).toBe("up");
    expect(effectiveTextGrowth({ growthDirection: "up", autoSizeMode: "height" }, "a")).toBe("up");
  });
});

describe("the property survives every layer of the document", () => {
  const textLayer = { id: "t1", page: "front", type: "text", text: "Hi", x: 100, y: 100, width: 300, height: 60, textStyle: { fontSize: 40, growthDirection: "up" } };

  it("template, published document, customer layer and customer override all keep it; junk is dropped", () => {
    const template = normalizeCustomizerTemplate({ pages: [{ id: "front", enabled: true }], layers: [textLayer, { ...textLayer, id: "t2", textStyle: { growthDirection: "sideways" } }] });
    expect(template.layers[0].textStyle.growthDirection).toBe("up");
    expect(template.layers[1].textStyle).not.toHaveProperty("growthDirection");
    expect((templateToDocument(template).document.layers[0] as any).textStyle.growthDirection).toBe("up");
    expect(normalizeUserLayer({ ...textLayer, id: "u1" }).textStyle.growthDirection).toBe("up");
  });
});

describe("server validation of a customer's growth choice", () => {
  const template = (permissions: Record<string, boolean>) =>
    normalizeCustomizerTemplate({
      pages: [{ id: "front", enabled: true, allowCustomerText: true }],
      layers: [{ id: "t1", page: "front", type: "text", text: "Hi", x: 100, y: 100, width: 300, height: 60, customerEditable: true, customerPermissions: permissions }],
      settings: { allowCustomerText: true },
    });

  it("is kept when alignment may be changed, and refused when it may not", () => {
    const allowed = validateCustomerState(template({ changeAlignment: true }), { values: {}, editorState: { layerOverrides: { t1: { textStyle: { growthDirection: "up" } } } } });
    expect(allowed.sanitizedEditorState.layerOverrides.t1.textStyle.growthDirection).toBe("up");
    const refused = validateCustomerState(template({ changeAlignment: false, editStyle: false }), { values: {}, editorState: { layerOverrides: { t1: { textStyle: { growthDirection: "up" } } } } });
    expect(refused.violations.map((violation) => violation.code)).toContain("text-growth-not-allowed");
  });

  it("a customer's own text keeps its direction; an unknown value is not accepted", () => {
    const own = { id: "u1", type: "text", page: "front", text: "Hi", x: 100, y: 100, width: 300, height: 60, textStyle: { growthDirection: "center" } };
    const ok = validateCustomerState(template({}), { values: {}, editorState: { userLayers: [own] } });
    expect(ok.sanitizedEditorState.userLayers[0].textStyle.growthDirection).toBe("center");
    const bad = validateCustomerState(template({}), { values: {}, editorState: { userLayers: [{ ...own, textStyle: { growthDirection: "sideways" } }] } });
    expect(bad.sanitizedEditorState.userLayers.some((layer: any) => layer.textStyle?.growthDirection === "sideways")).toBe(false);
  });
});

describe("server rendering places grown text by its direction", () => {
  const svgFor = (growthDirection: string) =>
    buildPageSvg({
      template: normalizeCustomizerTemplate({
        canvasWidthPx: 1000,
        canvasHeightPx: 1000,
        pages: [{ id: "front", enabled: true }],
        layers: [{ id: "t1", page: "front", type: "text", text: "One\nTwo\nThree", x: 500, y: 500, width: 600, height: 60, rotation: 0, textStyle: { fontSize: 50, lineHeight: 1.2, multiline: true, autoSizeMode: "height", fitMode: "auto-height", growthDirection } }],
      }),
      pageId: "front",
      mode: "print",
      measure,
    });
  const lineYs = (svg: string) => [...svg.matchAll(/<tspan[^>]*\sy="([\d.\-]+)"/g)].map((match) => Number(match[1]));

  it("Upward draws every line higher than Downward, Center in between, and the same input always renders the same SVG", () => {
    const up = lineYs(svgFor("up"));
    const centre = lineYs(svgFor("center"));
    const down = lineYs(svgFor("down"));
    expect(up.length).toBeGreaterThan(0);
    expect(up[0]).toBeLessThan(centre[0]);
    expect(centre[0]).toBeLessThan(down[0]);
    expect(svgFor("up")).toBe(svgFor("up"));
  });
});
