import { afterEach, describe, expect, it, vi } from "vitest";
import { changeTemplateOrientation, designContentBounds, isArtboardConsistent, orientationOf } from "../artboard";
import { normalizeCustomizerTemplate } from "@/lib/customizer";
import { templateToDocument } from "../document";
import { renderCustomizationPages } from "../server/render";
import { installGoogleFontsHarness, resetGoogleFontsHarness } from "./google-fonts-test-harness";

const portrait = (layers: any[]) =>
  normalizeCustomizerTemplate({
    id: "tpl", version: 1, canvasWidthPx: 1500, canvasHeightPx: 2100, cardWidthIn: 5, cardHeightIn: 7, dpi: 300,
    orientation: "portrait",
    pages: [{ id: "front", label: "Front", enabled: true, backgroundColor: "#ffffff" }],
    safeArea: { top: 90, right: 90, bottom: 90, left: 90 },
    bleed: { top: 30, right: 30, bottom: 30, left: 30 },
    guides: [{ id: "g", pageId: "front", axis: "vertical", position: 750 }],
    layers,
  });

const tallDesign = () =>
  portrait([
    { id: "title", page: "front", type: "text", text: "Ayesha & Omar", x: 750, y: 300, width: 1100, height: 160, zIndex: 2, textStyle: { fontFamily: "Inter", fontSize: 96 } },
    { id: "photo", page: "front", type: "image", x: 750, y: 1000, width: 900, height: 1100, zIndex: 3, imageTransform: { zoom: 1.4, offsetX: 50, offsetY: 0 } },
    { id: "badge", page: "front", type: "shape", shape: "rectangle", x: 1100, y: 1800, width: 300, height: 120, rotation: 30, strokeWidth: 6, zIndex: 4 },
    { id: "bg", page: "front", type: "background", x: 750, y: 1050, width: 1500, height: 2100, color: "#eee", zIndex: -1 },
  ]);

const byId = (template: any, id: string) => template.layers.find((layer: any) => layer.id === id);

describe("orientation is read from the dimensions", () => {
  it("portrait, landscape and square", () => {
    expect(orientationOf({ widthIn: 5, heightIn: 7 })).toBe("portrait");
    expect(orientationOf({ widthIn: 7, heightIn: 5 })).toBe("landscape");
    expect(orientationOf({ widthIn: 5, heightIn: 5 })).toBe("square");
  });

  it("loading a design never transforms it", () => {
    const template = tallDesign();
    expect(normalizeCustomizerTemplate(template)).toEqual(template);
  });
});

describe("Portrait → Landscape", () => {
  const before = tallDesign();
  const { template: after, scale } = changeTemplateOrientation(before, "landscape");

  it("swaps the real dimensions: 1500 × 2100 px becomes 2100 × 1500 px", () => {
    expect([after.cardWidthIn, after.cardHeightIn, after.canvasWidthPx, after.canvasHeightPx, after.dpi]).toEqual([7, 5, 2100, 1500, 300]);
    expect(after.orientation).toBe("landscape");
    expect(isArtboardConsistent(after)).toBe(true);
  });

  it("moves the design as ONE rigid unit: uniform scale, rotation and proportions kept", () => {
    expect(scale).toBeLessThan(1);
    for (const id of ["title", "photo", "badge"]) {
      expect(byId(after, id).width / byId(after, id).height).toBeCloseTo(byId(before, id).width / byId(before, id).height, 2);
      expect(byId(after, id).width).toBeCloseTo(byId(before, id).width * scale, 1);
    }
    expect(byId(after, "badge").rotation).toBe(30);
    // Relative placement is preserved: every vector between objects scales alike.
    const vector = (template: any) => ({ dx: byId(template, "badge").x - byId(template, "title").x, dy: byId(template, "badge").y - byId(template, "title").y });
    expect(vector(after).dx).toBeCloseTo(vector(before).dx * scale, 1);
    expect(vector(after).dy).toBeCloseTo(vector(before).dy * scale, 1);
    // Content scales with its box: type size, stroke and crop offset.
    expect(byId(after, "title").textStyle.fontSize).toBeCloseTo(96 * scale, 1);
    expect(byId(after, "badge").strokeWidth).toBeCloseTo(6 * scale, 1);
    expect(byId(after, "photo").imageTransform.offsetX).toBeCloseTo(50 * scale, 1);
  });

  it("the whole design — rotated objects included — fits inside the new safe area, centred", () => {
    const bounds = designContentBounds(after.layers)!;
    expect(bounds.left).toBeGreaterThanOrEqual(90 - 0.5);
    expect(bounds.right).toBeLessThanOrEqual(2100 - 90 + 0.5);
    expect(bounds.top).toBeGreaterThanOrEqual(90 - 0.5);
    expect(bounds.bottom).toBeLessThanOrEqual(1500 - 90 + 0.5);
    expect((bounds.left + bounds.right) / 2).toBeCloseTo(1050, 0);
    expect((bounds.top + bounds.bottom) / 2).toBeCloseTo(750, 0);
  });

  it("backgrounds cover the new page; guides move with the design; margins keep their size", () => {
    expect(byId(after, "bg")).toMatchObject({ x: 1050, y: 750, width: 2100, height: 1500 });
    const guide = after.guides[0].position;
    expect(guide).toBeCloseTo(byId(after, "title").x, 1); // it was on the title's centre line
    expect(after.safeArea).toEqual(before.safeArea);
    expect(after.bleed).toEqual(before.bleed);
  });

  it("is published and rendered at the landscape size", async () => {
    const { document } = templateToDocument(after);
    expect(document.canvas).toMatchObject({ widthPx: 2100, heightPx: 1500, widthIn: 7, heightIn: 5, orientation: "landscape" });
    installGoogleFontsHarness();
    try {
      const printable = { ...after, layers: after.layers.filter((layer: any) => layer.type !== "image") };
      const [page] = await renderCustomizationPages({ template: printable, values: {}, editorState: null, mode: "print", pageIds: ["front"] });
      expect([page.widthPx, page.heightPx]).toEqual([2100, 1500]);
    } finally {
      resetGoogleFontsHarness();
      vi.restoreAllMocks();
    }
  });
});

describe("other cases", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a design that already fits is only re-centred — never scaled", () => {
    const small = portrait([
      { id: "a", page: "front", type: "shape", shape: "rectangle", x: 600, y: 900, width: 200, height: 200, zIndex: 1 },
      { id: "b", page: "front", type: "shape", shape: "rectangle", x: 900, y: 1100, width: 200, height: 200, zIndex: 2 },
    ]);
    const { template: turned, scale } = changeTemplateOrientation(small, "landscape");
    expect(scale).toBe(1);
    expect(byId(turned, "a").width).toBe(200);
    expect(byId(turned, "b").x - byId(turned, "a").x).toBeCloseTo(300, 6);
    expect(byId(turned, "b").y - byId(turned, "a").y).toBeCloseTo(200, 6);
  });

  it("Landscape → Portrait works the same way", () => {
    const landscape = changeTemplateOrientation(tallDesign(), "landscape").template;
    const { template: back } = changeTemplateOrientation(landscape, "portrait");
    expect([back.canvasWidthPx, back.canvasHeightPx, back.orientation]).toEqual([1500, 2100, "portrait"]);
  });

  it("asking for the orientation a card already has changes nothing", () => {
    const template = tallDesign();
    expect(changeTemplateOrientation(template, "portrait").template).toBe(template);
  });

  it("a square card has no orientation to switch", () => {
    const square = normalizeCustomizerTemplate({ canvasWidthPx: 1500, canvasHeightPx: 1500, cardWidthIn: 5, cardHeightIn: 5, dpi: 300, pages: [{ id: "front", enabled: true }], layers: [] });
    expect(changeTemplateOrientation(square, "landscape").template).toBe(square);
  });
});
