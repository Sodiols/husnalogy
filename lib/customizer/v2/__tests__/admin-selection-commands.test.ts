import { describe, expect, it } from "vitest";
import {
  alignLayers,
  distributeLayers,
  fitLayerToArtboard,
  flipLayerSelection,
  getLayer,
  normalizeDegrees,
  rotateLayerSelection,
  scaleLayerSelection,
  setImageFitMode,
} from "@/app/admin/dashboard/design-builder/builder-utils";
import { normalizeCustomizerTemplate } from "@/lib/customizer";
import { templateToDocument } from "../document";
import { buildPageSvg } from "../svg";
import { rotatedAxisHalfExtents } from "../groups";

const template = (layers: any[]) => ({ canvasWidthPx: 1500, canvasHeightPx: 2100, layers: layers.map((layer) => ({ page: "front", rotation: 0, ...layer })) });
const box = (id: string, x: number, y: number, width: number, height: number, extra: Record<string, unknown> = {}) => ({ id, type: "shape", shape: "rectangle", x, y, width, height, ...extra });
const bounds = (layer: any) => {
  const { halfW, halfH } = rotatedAxisHalfExtents(layer);
  return { left: layer.x - halfW, right: layer.x + halfW, top: layer.y - halfH, bottom: layer.y + halfH };
};

describe("align: Selection or Artboard", () => {
  const t = template([box("a", 300, 300, 200, 100), box("b", 900, 700, 100, 300)]);

  it("Selection aligns to the selection's bounds; Artboard aligns each object to the card", () => {
    const toSelection = alignLayers(t, ["a", "b"], "left", undefined, "selection");
    expect([getLayer(toSelection, "a").x, getLayer(toSelection, "b").x]).toEqual([300, 250]);
    const toArtboard = alignLayers(t, ["a", "b"], "left", undefined, "artboard");
    expect([getLayer(toArtboard, "a").x, getLayer(toArtboard, "b").x]).toEqual([100, 50]);
    const bottom = alignLayers(t, ["a", "b"], "bottom", undefined, "artboard");
    expect([getLayer(bottom, "a").y, getLayer(bottom, "b").y]).toEqual([2050, 1950]);
  });

  it("one object always aligns to the artboard", () => {
    const centred = alignLayers(t, ["b"], "center", undefined, "selection");
    expect(getLayer(centred, "b").x).toBe(750);
  });
});

describe("distribute across the artboard", () => {
  it("leaves equal gaps between objects and both card edges, with two or more objects", () => {
    const t = template([box("a", 200, 500, 300, 100), box("b", 260, 500, 300, 100)]);
    const next = distributeLayers(t, ["a", "b"], "horizontal", "spacing", undefined, "artboard");
    const gap = (1500 - 600) / 3;
    expect(getLayer(next, "a").x).toBe(Math.round(gap + 150));
    expect(getLayer(next, "b").x).toBe(Math.round(gap * 2 + 450));
    // Selection distribution still needs three objects.
    expect(distributeLayers(t, ["a", "b"], "horizontal", "spacing", undefined, "selection")).toBe(t);
  });
});

describe("scale a selection as one composition", () => {
  it("keeps relative layout: positions scale about the combined centre, sizes and type scale with them", () => {
    const t = template([
      box("a", 400, 400, 200, 100, { strokeWidth: 4 }),
      { id: "t", type: "text", text: "Hi", x: 800, y: 600, width: 300, height: 80, textStyle: { fontSize: 40, letterSpacing: 2 } },
    ]);
    const next = scaleLayerSelection(t, ["a", "t"], 1.1);
    const a = getLayer(next, "a");
    const text = getLayer(next, "t");
    const centre = { x: (300 + 950) / 2, y: (350 + 640) / 2 };
    expect(a.x).toBeCloseTo(centre.x + (400 - centre.x) * 1.1, 1);
    expect(a.width).toBeCloseTo(220, 5);
    expect(a.strokeWidth).toBeCloseTo(4.4, 5);
    expect(text.textStyle.fontSize).toBeCloseTo(44, 5);
    // The distance between the two centres grew by exactly the factor.
    expect(Math.hypot(text.x - a.x, text.y - a.y)).toBeCloseTo(Math.hypot(400, 200) * 1.1, 1);
  });

  it("a group scales with everything inside it", () => {
    const t = template([
      { id: "g", type: "group", x: 500, y: 500, width: 400, height: 200, childIds: ["c1", "c2"] },
      box("c1", 400, 500, 100, 100, { groupId: "g" }),
      box("c2", 600, 500, 100, 100, { groupId: "g" }),
    ]);
    const next = scaleLayerSelection(t, ["g"], 2);
    expect([getLayer(next, "c1").x, getLayer(next, "c2").x, getLayer(next, "c1").width]).toEqual([300, 700, 200]);
  });

  it("refuses to shrink anything below a few pixels", () => {
    const t = template([box("a", 400, 400, 4, 4)]);
    expect(scaleLayerSelection(t, ["a"], 0.5)).toBe(t);
  });
});

describe("flip a selection as a world-space mirror", () => {
  it("mirrors positions across the selection centre, negates rotation and flips each object's artwork", () => {
    const t = template([
      box("s", 300, 500, 200, 100, { rotation: 20 }),
      { id: "t", type: "text", text: "Hi", x: 900, y: 500, width: 300, height: 80, textStyle: {} },
    ]);
    const next = flipLayerSelection(t, ["s", "t"], "horizontal");
    const centreX = (bounds(getLayer(t, "s")).left + 1050) / 2;
    expect(getLayer(next, "s").x).toBeCloseTo(2 * centreX - 300, 1);
    expect(getLayer(next, "s")).toMatchObject({ rotation: -20, flipX: true });
    expect(getLayer(next, "t").flipX).toBe(true);
    // Flipping twice is the identity.
    const back = flipLayerSelection(next, ["s", "t"], "horizontal");
    expect(getLayer(back, "s")).toMatchObject({ x: 300, rotation: 20, flipX: false });
  });

  it("a photo flips its picture and mirrors an asymmetric mask; its crop is kept", () => {
    const t = template([
      { id: "p", type: "image", src: "x", x: 500, y: 500, width: 300, height: 300, imageTransform: { zoom: 1.5, offsetX: 20, cropX: 0.1, cropWidth: 0.5, cropY: 0, cropHeight: 0.5 }, mask: { kind: "polygon", points: [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0.2, y: 1 }] } },
    ]);
    const next = getLayer(flipLayerSelection(t, ["p"], "horizontal"), "p");
    expect(next.imageTransform).toMatchObject({ zoom: 1.5, offsetX: 20, cropX: 0.1, cropWidth: 0.5, flipX: true });
    expect(next.mask.points).toEqual([{ x: 0.5, y: 0 }, { x: 0, y: 1 }, { x: 0.8, y: 1 }]);
  });

  it("a QR code moves with the mirror but is never mirrored itself", () => {
    const t = template([box("s", 300, 500, 100, 100), { id: "q", type: "qrCode", x: 900, y: 500, width: 200, height: 200, rotation: 0 }]);
    const qr = getLayer(flipLayerSelection(t, ["s", "q"], "horizontal"), "q");
    // Selection spans 250…1000, so the mirror line is x = 625.
    expect(qr.x).toBe(350);
    expect(qr.flipX).toBeUndefined();
  });
});

describe("rotate a selection rigidly", () => {
  it("turns centres about the combined centre and adds the angle to each object", () => {
    const t = template([box("a", 400, 500, 100, 100), box("b", 600, 500, 100, 100)]);
    const next = rotateLayerSelection(t, ["a", "b"], 90);
    expect(getLayer(next, "a")).toMatchObject({ x: 500, y: 400, rotation: 90 });
    expect(getLayer(next, "b")).toMatchObject({ x: 500, y: 600, rotation: 90 });
    // An already tilted object keeps its tilt and gains the turn.
    const tilted = template([box("c", 700, 700, 100, 100, { rotation: 10 })]);
    expect(getLayer(rotateLayerSelection(tilted, ["c"], 90), "c")).toMatchObject({ x: 700, y: 700, rotation: 100 });
  });

  it("keeps angles in (-180, 180]", () => {
    expect(normalizeDegrees(270)).toBe(-90);
    expect(normalizeDegrees(-180)).toBe(180);
    expect(normalizeDegrees(360)).toBe(0);
  });
});

describe("Fit and Fill", () => {
  it("a shape fits inside or covers the card, centred, without stretching", () => {
    const t = template([box("s", 300, 300, 300, 150)]);
    const fit = getLayer(fitLayerToArtboard(t, "s", "fit"), "s");
    expect(fit).toMatchObject({ x: 750, y: 1050, width: 1500, height: 750 });
    const fill = getLayer(fitLayerToArtboard(t, "s", "fill"), "s");
    expect(fill).toMatchObject({ x: 750, y: 1050, width: 4200, height: 2100 });
  });

  it("a photo's Fit shows the whole picture and Fill covers its box; the box never changes", () => {
    const t = template([{ id: "p", type: "image", src: "x", x: 500, y: 500, width: 300, height: 200, fitMode: "cover", imageTransform: { zoom: 2, offsetX: 40, cropX: 0.1, cropWidth: 0.5, flipX: true } }]);
    const fit = getLayer(setImageFitMode(t, "p", "fit"), "p");
    expect(fit).toMatchObject({ x: 500, width: 300, fitMode: "contain", imageTransform: { zoom: 1, offsetX: 0, offsetY: 0, flipX: true } });
    expect(fit.imageTransform.cropX).toBeUndefined();
    expect(getLayer(setImageFitMode(t, "p", "fill"), "p").fitMode).toBe("cover");
  });
});

describe("a mirrored text or shape is kept and drawn everywhere", () => {
  const flipped = normalizeCustomizerTemplate({
    canvasWidthPx: 400,
    canvasHeightPx: 400,
    pages: [{ id: "front", enabled: true }],
    layers: [
      { id: "s", page: "front", type: "shape", shape: "triangle", x: 200, y: 200, width: 100, height: 100, flipY: true, fill: "#000000" },
      { id: "t", page: "front", type: "text", text: "Hi", x: 200, y: 100, width: 200, height: 60, flipX: true, textStyle: { fontSize: 30 } },
      { id: "plain", page: "front", type: "shape", shape: "rectangle", x: 50, y: 50, width: 20, height: 20 },
    ],
  });

  it("template and published document keep the flags; unflipped layers carry none", () => {
    expect(flipped.layers.find((layer: any) => layer.id === "s").flipY).toBe(true);
    expect(flipped.layers.find((layer: any) => layer.id === "t").flipX).toBe(true);
    expect(flipped.layers.find((layer: any) => layer.id === "plain")).not.toHaveProperty("flipX");
    const doc = templateToDocument(flipped).document.layers;
    expect((doc.find((layer: any) => layer.id === "s") as any).flipY).toBe(true);
  });

  it("the server SVG mirrors them inside their own frame", () => {
    const svg = buildPageSvg({ template: flipped, pageId: "front", mode: "print", measure: (text, style) => text.length * style.fontSize * 0.5 });
    expect(svg).toContain("translate(200 200) scale(1 -1) translate(-200 -200)");
    expect(svg).toMatch(/scale\(-1 1\)/);
  });
});
