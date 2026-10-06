import { describe, expect, it } from "vitest";
import {
  ERASE_LIMITS,
  canvasPointToDrawBox,
  eraseMaskAppliesTo,
  eraseStrokePaths,
  normalizeEraseMask,
} from "../erase-mask";
import { normalizeCustomizerTemplate } from "@/lib/customizer";
import { templateToDocument } from "../document";
import { buildPageSvg } from "../svg";
import { getLayer, replaceLayerImage, setImageFitMode } from "@/app/admin/dashboard/design-builder/builder-utils";

const stroke = { size: 0.1, points: [0.2, 0.2, 0.5, 0.5] };

describe("the eraser mask model", () => {
  it("keeps valid strokes, rounded and clamped", () => {
    const mask = normalizeEraseMask({ strokes: [{ size: 0.123456, points: [0.123456789, 5, -9, 0.5] }] });
    expect(mask).toEqual({ strokes: [{ size: 0.1235, points: [0.1235, 2, -1, 0.5] }] });
  });

  it("drops anything that is not a usable stroke, and stores nothing for nothing", () => {
    expect(normalizeEraseMask(null)).toBeNull();
    expect(normalizeEraseMask({ strokes: [] })).toBeNull();
    expect(normalizeEraseMask({ strokes: [{ size: 0, points: [0, 0] }, { size: 0.1, points: ["x", "y"] }, "junk"] })).toBeNull();
    expect(normalizeEraseMask({ strokes: [{ size: 0.1, points: [0.1, 0.1, NaN, 0.4, 0.3, 0.3] }] })?.strokes[0].points).toEqual([0.1, 0.1, 0.3, 0.3]);
  });

  it("caps the stored size of a mask", () => {
    const many = { strokes: Array.from({ length: ERASE_LIMITS.maxStrokes + 50 }, () => stroke) };
    expect(normalizeEraseMask(many)?.strokes).toHaveLength(ERASE_LIMITS.maxStrokes);
    const long = { strokes: [{ size: 0.1, points: Array.from({ length: (ERASE_LIMITS.maxPoints + 100) * 2 }, () => 0.5) }] };
    expect(normalizeEraseMask(long)!.strokes[0].points.length / 2).toBe(ERASE_LIMITS.maxPoints);
  });

  it("draws strokes in the picture's draw box, widths from its shorter side", () => {
    const [path] = eraseStrokePaths({ strokes: [stroke] }, { x: 100, y: 50, width: 400, height: 200 });
    expect(path).toEqual({ d: "M180 90 L300 150", width: 20 });
    // A single dab still draws a dot.
    expect(eraseStrokePaths({ strokes: [{ size: 0.1, points: [0.5, 0.5] }] }, { x: 0, y: 0, width: 100, height: 100 })[0].d).toBe("M50 50 l0.01 0");
  });

  it("applies only to the layer's own picture — never to a customer's replacement", () => {
    expect(eraseMaskAppliesTo({ eraseMask: { strokes: [stroke] } }, { source: "layer" })).toBe(true);
    expect(eraseMaskAppliesTo({ eraseMask: { strokes: [stroke] } }, { source: "field" })).toBe(false);
    expect(eraseMaskAppliesTo({}, { source: "layer" })).toBe(false);
  });

  it("maps a canvas point into the draw box through rotation and flips", () => {
    const draw = { x: 0, y: 0, width: 200, height: 200 };
    const layer = { x: 100, y: 100, rotation: 0 };
    expect(canvasPointToDrawBox({ x: 50, y: 100 }, layer, {}, draw)).toEqual({ x: 0.25, y: 0.5 });
    // Mirrored picture: the left of the screen is the right of the picture.
    expect(canvasPointToDrawBox({ x: 50, y: 100 }, layer, { flipX: true }, draw)).toEqual({ x: 0.75, y: 0.5 });
    // Layer turned 90° clockwise: the picture's right edge now faces down, so a
    // point below the centre is on the picture's right.
    const turned = canvasPointToDrawBox({ x: 100, y: 150 }, { ...layer, rotation: 90 }, {}, draw);
    expect(turned.x).toBeCloseTo(0.75, 6);
    expect(turned.y).toBeCloseTo(0.5, 6);
  });
});

describe("eraser marks are kept and drawn everywhere", () => {
  const template = normalizeCustomizerTemplate({
    canvasWidthPx: 400,
    canvasHeightPx: 400,
    pages: [{ id: "front", enabled: true }],
    layers: [
      { id: "p", page: "front", type: "image", src: "https://example.test/p.png", x: 200, y: 200, width: 200, height: 200, eraseMask: { strokes: [stroke] } },
      { id: "plain", page: "front", type: "image", src: "https://example.test/q.png", x: 50, y: 50, width: 40, height: 40 },
    ],
  });

  it("the template and the published document keep the strokes; untouched photos carry none", () => {
    expect(template.layers.find((layer: any) => layer.id === "p").eraseMask).toEqual({ strokes: [stroke] });
    expect(template.layers.find((layer: any) => layer.id === "plain")).not.toHaveProperty("eraseMask");
    const doc = templateToDocument(template).document.layers as any[];
    expect(doc.find((layer) => layer.id === "p").eraseMask).toEqual({ strokes: [stroke] });
  });

  it("the server/print SVG masks the picture with the strokes", () => {
    const svg = buildPageSvg({ template, pageId: "front", mode: "print" });
    expect(svg).toMatch(/<mask id="[^"]*-erase-p"/);
    expect(svg).toContain('stroke="#000" stroke-width="20"');
    expect(svg).toMatch(/<image href="https:\/\/example\.test\/p\.png"[^>]*mask="url\(#[^"]*-erase-p\)"/);
    expect(svg).not.toMatch(/-erase-plain/);
  });

  it("a customer's replacement photo is drawn whole", () => {
    const editable = {
      ...template,
      fields: [{ id: "photo", type: "image", label: "Photo" }],
      layers: template.layers.map((layer: any) => (layer.id === "p" ? { ...layer, customerEditable: true, fieldId: "photo" } : layer)),
    };
    const svg = buildPageSvg({ template: editable, pageId: "front", mode: "print", values: { photo: { url: "https://example.test/customer.png" } } });
    expect(svg).toContain("customer.png");
    expect(svg).not.toMatch(/-erase-p"/);
  });

  it("Fit and Fill keep the marks; Change image clears them with the old framing", () => {
    expect(getLayer(setImageFitMode(template, "p", "fit"), "p").eraseMask).toEqual({ strokes: [stroke] });
    const replaced = getLayer(
      replaceLayerImage(
        { ...template, layers: template.layers.map((layer: any) => (layer.id === "p" ? { ...layer, mask: { kind: "oval" }, imageTransform: { zoom: 2, offsetX: 30, cropX: 0.1, cropWidth: 0.5, flipX: true } } : layer)) },
        "p",
        { id: "new", title: "New", url: "https://example.test/new.png", editorUrl: "https://example.test/new-editor.png", bucket: "assets", originalPath: "o/new.png", editorPath: "e/new.webp", width: 3000, height: 2000 },
      ),
      "p",
    );
    expect(replaced).not.toHaveProperty("eraseMask");
    // The mask and the flip stay; the new picture starts unpanned and uncropped.
    expect(replaced.mask).toEqual({ kind: "oval" });
    expect(replaced.imageTransform).toEqual({ flipX: true, zoom: 1, offsetX: 0, offsetY: 0 });
    expect(replaced).toMatchObject({ src: "https://example.test/new-editor.png", assetId: "new", originalPath: "o/new.png", editorPath: "e/new.webp", sourceWidth: 3000 });
  });
});
