import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { normalizeCustomizerTemplate, normalizeUserLayer } from "@/lib/customizer";
import { applyClippingMask, clipImageToShape, findClipMaskPair, isClipMaskContent, maskForShape } from "../clipping-mask";
import { templateToDocument } from "../document";
import { renderCustomizationPages } from "../server/render";
import { validateCustomerState } from "../validate";
import { installGoogleFontsHarness, resetGoogleFontsHarness } from "./google-fonts-test-harness";

/** A photo stand-in: solid red, so every pixel it covers is unambiguous. */
const RED_PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#ff0000"/></svg>',
)}`;

const shape = (overrides: Record<string, unknown> = {}) => ({
  id: "s1", type: "shape", page: "front", shape: "rectangle", x: 100, y: 100, width: 120, height: 80, rotation: 0, zIndex: 5,
  fill: "#00ff00", stroke: "", strokeWidth: 0, borderRadius: 0, ...overrides,
});
const photo = (overrides: Record<string, unknown> = {}) => ({
  id: "p1", type: "image", page: "front", src: RED_PHOTO, assetId: "asset-1", path: "uploads/a.png", originalPath: "uploads/a.png",
  x: 300, y: 300, width: 240, height: 160, rotation: 12, zIndex: 3, fitMode: "cover",
  imageTransform: { zoom: 1.5, offsetX: 24, offsetY: -16, flipX: true, cropX: 0.1, cropY: 0.1, cropWidth: 0.5, cropHeight: 0.5 },
  filters: { brightness: 1.1 },
  ...overrides,
});

describe("which shapes the shared mask engine can clip to", () => {
  it("maps every compatible shape to the mask that draws the same outline", () => {
    expect(maskForShape(shape())).toEqual({ kind: "rectangle" });
    expect(maskForShape(shape({ shape: "rounded-rectangle", borderRadius: 18 }))).toEqual({ kind: "rounded", radius: 18 });
    expect(maskForShape(shape({ borderRadius: 10 }))).toEqual({ kind: "rounded", radius: 10 });
    for (const kind of ["ellipse", "circle", "oval"]) expect(maskForShape(shape({ shape: kind }))).toEqual({ kind: "oval" });
    expect(maskForShape(shape({ shape: "arch" }))).toEqual({ kind: "arch" });
    expect(maskForShape(shape({ shape: "triangle" }))).toEqual({ kind: "polygon", points: [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] });
    const pentagon = [{ x: 0.5, y: 0 }, { x: 1, y: 0.38 }, { x: 0.82, y: 1 }, { x: 0.18, y: 1 }, { x: 0, y: 0.38 }];
    expect(maskForShape(shape({ shape: "polygon", points: pentagon }))).toEqual({ kind: "polygon", points: pentagon });
  });

  it("refuses geometry it cannot reproduce: lines, free paths, polygons outside the box, empty boxes", () => {
    expect(maskForShape(shape({ shape: "line" }))).toBeNull();
    expect(maskForShape(shape({ shape: "path", path: "M 0 0 L 10 10 Z" }))).toBeNull();
    expect(maskForShape(shape({ shape: "polygon", points: [{ x: 0, y: 0 }, { x: 1.4, y: 0 }, { x: 0, y: 1 }] }))).toBeNull();
    expect(maskForShape(shape({ shape: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }))).toBeNull();
    expect(maskForShape(shape({ width: 0 }))).toBeNull();
    expect(maskForShape(photo())).toBeNull();
  });
});

describe("which selections offer Clipping mask", () => {
  it("exactly one compatible shape plus one photo, on one page, in one group", () => {
    expect(findClipMaskPair([shape(), photo()])).toMatchObject({ shape: { id: "s1" }, image: { id: "p1" } });
    expect(findClipMaskPair([photo(), shape()])).toMatchObject({ shape: { id: "s1" }, image: { id: "p1" } });
    expect(findClipMaskPair([shape()])).toBeNull();
    expect(findClipMaskPair([shape(), photo(), shape({ id: "s2" })])).toBeNull();
    expect(findClipMaskPair([shape(), shape({ id: "s2" })])).toBeNull();
    expect(findClipMaskPair([shape({ shape: "line" }), photo()])).toBeNull();
    expect(findClipMaskPair([shape({ page: "back" }), photo()])).toBeNull();
    expect(findClipMaskPair([shape({ groupId: "g1" }), photo()])).toBeNull();
    expect(findClipMaskPair([shape({ groupId: "g1" }), photo({ groupId: "g1" })])).not.toBeNull();
  });

  it("a photo is an image or frame that shows a picture — an empty frame or a text is not", () => {
    expect(isClipMaskContent(photo())).toBe(true);
    expect(isClipMaskContent(photo({ type: "frame" }))).toBe(true);
    expect(isClipMaskContent({ type: "image", fieldId: "photo_1" })).toBe(true);
    expect(isClipMaskContent({ type: "frame", src: "" })).toBe(false);
    expect(isClipMaskContent({ type: "text", src: "x" })).toBe(false);
    expect(isClipMaskContent({ type: "element", src: "x" })).toBe(false);
  });
});

describe("creating the clip", () => {
  it("the photo keeps its id and every byte of image data, and takes the shape's geometry, stacking and paint", () => {
    const pair = findClipMaskPair([shape({ rotation: 30, stroke: "#0000ff", strokeWidth: 4 }), photo()])!;
    const clipped = clipImageToShape(pair);
    expect(clipped).toMatchObject({
      id: "p1", type: "image", src: RED_PHOTO, assetId: "asset-1", path: "uploads/a.png", originalPath: "uploads/a.png",
      filters: { brightness: 1.1 }, fitMode: "cover",
      x: 100, y: 100, width: 120, height: 80, rotation: 30, zIndex: 5,
      mask: { kind: "rectangle" }, maskShape: "rectangle",
      backgroundColor: "#00ff00", borderColor: "#0000ff", borderWidth: 4,
    });
    // Pan is rescaled to the new box (half the size here); everything relative carries over.
    expect(clipped.imageTransform).toEqual({ zoom: 1.5, offsetX: 12, offsetY: -8, flipX: true, cropX: 0.1, cropY: 0.1, cropWidth: 0.5, cropHeight: 0.5 });
    // Pure: neither input was touched.
    expect(pair.image.x).toBe(300);
    expect(pair.image.imageTransform.offsetX).toBe(24);
  });

  it("transparent fill and outline stay transparent", () => {
    const clipped = clipImageToShape(findClipMaskPair([shape({ fill: "none", stroke: "none", strokeWidth: 6 }), photo()])!);
    expect(clipped).toMatchObject({ backgroundColor: "", borderColor: "", borderWidth: 0 });
  });

  it("replaces the pair in one pass: no orphaned shape, photo or group entry", () => {
    const group = { id: "g1", type: "group", page: "front", childIds: ["s1", "p1", "t1"] };
    const text = { id: "t1", type: "text", page: "front", groupId: "g1" };
    const layers = [group, shape({ groupId: "g1" }), photo({ groupId: "g1" }), text];
    const pair = findClipMaskPair([layers[1], layers[2]])!;
    const next = applyClippingMask(layers, pair);
    expect(next.map((layer) => layer.id)).toEqual(["g1", "p1", "t1"]);
    expect(next[0].childIds).toEqual(["p1", "t1"]);
    expect(next[1]).toMatchObject({ groupId: "g1", mask: { kind: "rectangle" } });
    expect(layers).toHaveLength(4);
    // Deterministic: the same input always produces the same document.
    expect(JSON.stringify(applyClippingMask(layers, pair))).toBe(JSON.stringify(next));
    // A pair that is no longer in the document changes nothing.
    expect(applyClippingMask([text], pair)).toEqual([text]);
  });

  it("the mask survives the customer layer, the template and the published document", () => {
    const clipped = clipImageToShape(findClipMaskPair([shape({ shape: "triangle" }), photo({ type: "frame" })])!);
    expect(normalizeUserLayer(clipped)).toMatchObject({ type: "frame", mask: { kind: "polygon" }, width: 120, height: 80 });
    const template = normalizeCustomizerTemplate({ pages: [{ id: "front", enabled: true }], layers: [clipped] });
    expect(template.layers[0].mask).toEqual({ kind: "polygon", points: [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] });
    expect((templateToDocument(template).document.layers[0] as any).mask).toEqual(template.layers[0].mask);
  });
});

describe("server rendering draws the clip exactly where the shape was", () => {
  afterEach(() => {
    resetGoogleFontsHarness();
    vi.restoreAllMocks();
  });

  async function rasterOf(layer: Record<string, unknown>) {
    installGoogleFontsHarness();
    const template = normalizeCustomizerTemplate({
      id: "t", version: 1, canvasWidthPx: 200, canvasHeightPx: 200, cardWidthIn: 2, cardHeightIn: 2, dpi: 100,
      pages: [{ id: "front", label: "Front", enabled: true, backgroundColor: "#ffffff" }],
      layers: [layer],
    });
    const [page] = await renderCustomizationPages({ template, values: {}, editorState: null, mode: "print", pageIds: ["front"] });
    const { data, info } = await sharp(page.png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, info };
  }

  /** Pixels that are "painted" (not the white page). */
  function paintedMask(raster: { data: Buffer; info: { width: number; height: number; channels: number } }) {
    const mask: boolean[] = [];
    for (let index = 0; index < raster.info.width * raster.info.height; index += 1) {
      const offset = index * raster.info.channels;
      mask.push(raster.data[offset] < 250 || raster.data[offset + 1] < 250 || raster.data[offset + 2] < 250);
    }
    return mask;
  }

  const cases: Array<[string, Record<string, unknown>]> = [
    ["rectangle", {}],
    ["ellipse", { shape: "ellipse" }],
    ["circle", { shape: "circle", width: 120, height: 120 }],
    ["rounded rectangle", { shape: "rounded-rectangle", borderRadius: 24 }],
    ["rotated rectangle", { rotation: 35 }],
    ["scaled, rotated ellipse", { shape: "ellipse", width: 170, height: 60, rotation: -20 }],
    ["triangle", { shape: "triangle" }],
    ["arch", { shape: "arch", width: 90, height: 150 }],
  ];

  for (const [name, overrides] of cases) {
    it(`${name}: the clipped photo covers the same pixels the shape filled`, async () => {
      const source = shape({ x: 100, y: 100, fill: "#ff0000", ...overrides });
      const clipped = clipImageToShape(findClipMaskPair([source, photo({ imageTransform: undefined, filters: undefined })])!);
      const shapeMask = paintedMask(await rasterOf(source));
      const clipRaster = await rasterOf(clipped);
      const clipMask = paintedMask(clipRaster);
      const total = shapeMask.filter(Boolean).length;
      const differing = shapeMask.filter((value, index) => value !== clipMask[index]).length;
      expect(total).toBeGreaterThan(1500);
      // Only anti-aliased edge pixels may differ.
      expect(differing / total).toBeLessThan(0.02);
      // The photo — not the shape's fill — is what shows inside.
      const centre = (100 * clipRaster.info.width + 100) * clipRaster.info.channels;
      expect([clipRaster.data[centre], clipRaster.data[centre + 1], clipRaster.data[centre + 2]]).toEqual([255, 0, 0]);
    });
  }
});

describe("server validation of clipping masks", () => {
  const template = (settings: Record<string, unknown> = {}) =>
    normalizeCustomizerTemplate({
      pages: [{ id: "front", enabled: true }],
      layers: [],
      settings: { allowCustomerFrames: true, ...settings },
    });
  const frame = (mask: unknown, maskShape = "rectangle") => ({ id: "u1", type: "frame", page: "front", src: RED_PHOTO, x: 50, y: 50, width: 40, height: 40, mask, maskShape });

  it("a customer clip whose shape the template allows is kept as drawn", () => {
    const result = validateCustomerState(template(), { values: {}, editorState: { userLayers: [frame({ kind: "polygon", points: [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] })] } });
    expect(result.violations).toEqual([]);
    expect(result.sanitizedEditorState.userLayers[0].mask).toEqual({ kind: "polygon", points: [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] });
  });

  it("the mask actually drawn is what the frame-shape allowlist checks, not the legacy name beside it", () => {
    const result = validateCustomerState(template({ allowedCustomerFrameMasks: ["rectangle"] }), { values: {}, editorState: { userLayers: [frame({ kind: "oval" }, "rectangle")] } });
    expect(result.violations.map((violation) => violation.code)).toContain("user-frame-not-allowed-by-template");
    expect(result.sanitizedEditorState.userLayers).toEqual([]);
  });

  it("mask data that is not geometry never reaches a renderer", () => {
    const hostile = frame({ kind: "path", d: 'M0 0"/><image href="http://internal.test/x"/><path d="', viewBoxWidth: 10, viewBoxHeight: 10 });
    const result = validateCustomerState(template(), { values: {}, editorState: { userLayers: [hostile] } });
    expect(JSON.stringify(result.sanitizedEditorState.userLayers[0]?.mask ?? null)).not.toContain("internal.test");
    const unknownKind = validateCustomerState(template(), { values: {}, editorState: { userLayers: [frame({ kind: "<script>" })] } });
    expect(unknownKind.sanitizedEditorState.userLayers[0].mask).toEqual({ kind: "rectangle" });
  });
});
