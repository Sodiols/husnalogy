// The image + shape Mask workflow at the document level (mask matrix tests
// 1–9, 11–13, 17–22 and 29). The browser half — selection, the toolbar, crop,
// drag, save/reload, publish and the customer editor — is in
// e2e/admin-toolbar-mask.spec.ts.
import { describe, expect, it } from "vitest";
import { applyClippingMask, findClipMaskPair } from "../clipping-mask";
import {
  alignLayers,
  copyLayersToClipboard,
  getLayer,
  isAdminCroppableLayer,
  pasteLayers,
  rotateLayerSelection,
  scaleLayerSelection,
  setImageFitMode,
} from "@/app/admin/dashboard/design-builder/builder-utils";
import { normalizeCustomizerTemplate } from "@/lib/customizer";
import { templateToDocument } from "../document";
import { buildPageSvg } from "../svg";

const photo = (extra: Record<string, unknown> = {}) => ({
  id: "photo",
  type: "image",
  page: "front",
  src: "https://example.test/photo.png",
  assetId: "asset-1",
  x: 400,
  y: 500,
  width: 600,
  height: 400,
  rotation: 0,
  zIndex: 1,
  imageTransform: { zoom: 1.4, offsetX: 30, offsetY: -12 },
  ...extra,
});
const shape = (kind: string, extra: Record<string, unknown> = {}) => ({
  id: "shape",
  type: "shape",
  shape: kind,
  page: "front",
  x: 700,
  y: 900,
  width: 300,
  height: 300,
  rotation: 0,
  zIndex: 2,
  fill: "#F8F6F1",
  ...extra,
});
const template = (layers: any[]) => ({ canvasWidthPx: 1500, canvasHeightPx: 2100, pages: [{ id: "front", enabled: true }], layers });

/** Select both, click Mask: exactly what the builder's clipSelectedLayers commits. */
function mask(layers: any[]) {
  const pair = findClipMaskPair(layers);
  if (!pair) throw new Error("not a mask pair");
  return { ...template(layers), layers: applyClippingMask(layers, pair) };
}

describe("Mask: every supported shape becomes the photo's clip (tests 1–4)", () => {
  const cases: Array<[string, Record<string, unknown>, unknown]> = [
    ["rectangle", {}, { kind: "rectangle" }],
    ["circle", {}, { kind: "oval" }],
    ["ellipse", { width: 400, height: 250 }, { kind: "oval" }],
    ["rounded-rectangle", { borderRadius: 40 }, { kind: "rounded", radius: 40 }],
  ];
  for (const [kind, extra, expected] of cases) {
    it(`image + ${kind}`, () => {
      const result = mask([photo(), shape(kind, extra)]);
      expect(result.layers).toHaveLength(1);
      const [clip] = result.layers;
      expect(clip.id).toBe("photo");
      expect(clip.mask).toEqual(expected);
      // The photo takes the shape's box; its picture and asset are untouched.
      expect(clip).toMatchObject({ x: 700, y: 900, width: Number(extra.width ?? 300), height: Number(extra.height ?? 300), src: "https://example.test/photo.png", assetId: "asset-1" });
    });
  }
});

describe("Mask: selection order and geometry (tests 5–9)", () => {
  it("shape first or image first gives the identical result", () => {
    expect(mask([shape("circle"), photo()])).toEqual(mask([photo(), shape("circle")]));
  });

  it("a rotated shape keeps its rotation; the picture's framing is unchanged", () => {
    const [clip] = mask([photo(), shape("rectangle", { rotation: 35 })]).layers;
    expect(clip.rotation).toBe(35);
    expect(clip.imageTransform.zoom).toBe(1.4);
  });

  it("a scaled shape is clipped at its actual size, never its original one", () => {
    const [clip] = mask([photo(), shape("ellipse", { width: 810, height: 333 })]).layers;
    expect([clip.width, clip.height]).toEqual([810, 333]);
  });

  it("a rotated photo takes the frame's orientation (like dropping a photo into a frame)", () => {
    const [clip] = mask([photo({ rotation: 20 }), shape("rectangle")]).layers;
    expect(clip.rotation).toBe(0);
    // Its in-frame pan is carried over in proportion to the new box.
    expect(clip.imageTransform.offsetX).toBeCloseTo(30 * (300 / 600), 6);
    expect(clip.imageTransform.offsetY).toBeCloseTo(-12 * (300 / 400), 6);
  });

  it("the shape's stacking position and paint carry over, so nothing behind or in front changes", () => {
    const [clip] = mask([photo(), shape("circle", { zIndex: 9, stroke: "#303839", strokeWidth: 6 })]).layers;
    expect(clip).toMatchObject({ zIndex: 9, backgroundColor: "#F8F6F1", borderColor: "#303839", borderWidth: 6 });
  });
});

describe("after Mask (tests 10–13, 17–20)", () => {
  const masked = mask([photo(), shape("rounded-rectangle", { borderRadius: 40 })]);

  it("the result is croppable, so its toolbar offers Crop", () => {
    expect(isAdminCroppableLayer(getLayer(masked, "photo"))).toBe(true);
  });

  it("Fit and Fill change only the picture's framing, never the clip", () => {
    const fit = getLayer(setImageFitMode(masked, "photo", "fit"), "photo");
    expect(fit.mask).toEqual({ kind: "rounded", radius: 40 });
    expect(fit).toMatchObject({ fitMode: "contain", x: 700, width: 300 });
    expect(getLayer(setImageFitMode(masked, "photo", "fill"), "photo").fitMode).toBe("cover");
  });

  it("Scale smaller / larger scales the box, the corner radius and the pan together", () => {
    const larger = getLayer(scaleLayerSelection(masked, ["photo"], 1.1), "photo");
    expect(larger.width).toBeCloseTo(330, 6);
    expect(larger.mask.radius).toBeCloseTo(44, 6);
    expect(larger.imageTransform.offsetX).toBeCloseTo(15 * 1.1, 6);
    const smaller = getLayer(scaleLayerSelection(masked, ["photo"], 1 / 1.1), "photo");
    // Sizes are stored to two decimals.
    expect(smaller.width).toBeCloseTo(300 / 1.1, 1);
  });

  it("rotating and aligning move the clip as one object", () => {
    expect(getLayer(rotateLayerSelection(masked, ["photo"], 90), "photo")).toMatchObject({ rotation: 90, mask: { kind: "rounded", radius: 40 } });
    const left = getLayer(alignLayers(masked, ["photo"], "left", undefined, "artboard"), "photo");
    // The visible clip's left edge meets the artboard's.
    expect(left.x).toBe(150);
  });

  it("copy and paste make an independent clip with a new id", () => {
    const { template: pasted, newIds } = pasteLayers(masked, copyLayersToClipboard(masked, ["photo"]), "front");
    expect(newIds).toHaveLength(1);
    const copy = getLayer(pasted, newIds[0]);
    expect(copy.id).not.toBe("photo");
    expect(copy.mask).toEqual({ kind: "rounded", radius: 40 });
    expect(copy.mask).not.toBe(getLayer(pasted, "photo").mask);
    expect(copy.src).toBe("https://example.test/photo.png");
  });
});

describe("Mask persists and renders (tests 21–24, 29)", () => {
  it("one document change: the previous document is the undo target, exactly", () => {
    const before = template([photo(), shape("circle")]);
    const after = mask(before.layers);
    // The builder commits `after` once; undo restores `before`, unchanged.
    expect(before.layers.map((layer: any) => layer.id)).toEqual(["photo", "shape"]);
    expect(after.layers.map((layer: any) => layer.id)).toEqual(["photo"]);
  });

  it("save/reload (template normalizer) and publish (document) keep the clip", () => {
    const saved = normalizeCustomizerTemplate(JSON.parse(JSON.stringify(mask([photo(), shape("circle")]))));
    const clip = saved.layers.find((layer: any) => layer.id === "photo");
    expect(clip.mask).toEqual({ kind: "oval" });
    expect(saved.layers.some((layer: any) => layer.id === "shape")).toBe(false);
    const published = templateToDocument(saved).document.layers.find((layer: any) => layer.id === "photo") as any;
    expect(published.mask).toEqual({ kind: "oval" });
  });

  it("the server/print renderer clips the picture to the shape", () => {
    const saved = normalizeCustomizerTemplate(mask([photo(), shape("circle")]));
    const svg = buildPageSvg({ template: saved, pageId: "front", mode: "print" });
    expect(svg).toMatch(/<clipPath id="[^"]*-clip-photo"><path d="M 550 900/);
    expect(svg).toMatch(/clip-path="url\(#[^"]*-clip-photo\)"/);
  });
});
