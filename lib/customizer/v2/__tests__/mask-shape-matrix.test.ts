import { describe, expect, it } from "vitest";
import { applyClippingMask, findClipMaskPair } from "../clipping-mask";
import { SHAPE_LIBRARY_BY_ID, libraryShapeGeometry } from "../shape-library";
import { getMaskPath } from "../masks";
import { buildPageSvg } from "../svg";
import { normalizeCustomizerTemplate } from "../..";

// Task 11: every mask shape the brief names — rectangle, rounded rectangle,
// circle, ellipse, heart, arch, star — clips a photo in BOTH selection orders,
// with a transformed (rotated, non-square) shape and a cropped photo, and the
// saved document renders the same outline on the server.
const PHOTO = "data:image/png;base64,iVBORw0KGgo=";

function shapeLayer(kind: string): any {
  const base = { id: "shape", page: "front", type: "shape", x: 600, y: 900, zIndex: 5, rotation: 15, fill: "#d4af37" };
  switch (kind) {
    case "rectangle":
      return { ...base, shape: "rectangle", width: 420, height: 300 };
    case "rounded rectangle":
      return { ...base, shape: "rounded-rectangle", borderRadius: 40, width: 420, height: 300 };
    case "circle":
      return { ...base, shape: "circle", width: 320, height: 320 };
    case "ellipse":
      return { ...base, shape: "ellipse", width: 440, height: 260 };
    default: {
      const entry = SHAPE_LIBRARY_BY_ID.get(kind)!;
      expect(entry, kind).toBeTruthy();
      return { ...base, ...libraryShapeGeometry(entry, 420) };
    }
  }
}

const photo = () => ({
  id: "photo", page: "front", type: "image", src: PHOTO, x: 700, y: 1000, width: 500, height: 400, zIndex: 2,
  imageTransform: { zoom: 1.4, offsetX: 30, offsetY: -12, cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1 },
});

const KINDS = ["rectangle", "rounded rectangle", "circle", "ellipse", "heart", "arch-top", "star", "star-round"];

describe("clipping a photo with every mask shape", () => {
  for (const kind of KINDS) {
    for (const order of ["shape first", "photo first"] as const) {
      it(`${kind}, ${order}: one clipped photo in the shape's place, saved and rendered with the same outline`, () => {
        const shape = shapeLayer(kind);
        const image = photo();
        const selection = order === "shape first" ? [shape, image] : [image, shape];
        const pair = findClipMaskPair(selection);
        expect(pair, `${kind} must be offered as a mask`).not.toBeNull();
        const layers = applyClippingMask([shape, image], pair!);

        expect(layers).toHaveLength(1);
        const clipped: any = layers[0];
        expect(clipped).toMatchObject({ id: "photo", x: shape.x, y: shape.y, width: shape.width, height: shape.height, rotation: 15, zIndex: 5 });
        expect(clipped.mask).toEqual(pair!.mask);
        // The crop travels with the photo (offsets scaled to the new box), never lost.
        expect(clipped.imageTransform.zoom).toBe(1.4);

        // Saving keeps the mask; the server draws exactly that outline.
        const saved = normalizeCustomizerTemplate({ canvasWidthPx: 1500, canvasHeightPx: 2100, pages: [{ id: "front", label: "Front" }], layers, fields: [] });
        const stored = saved.layers.find((layer: any) => layer.id === "photo");
        expect(stored.mask).toEqual(clipped.mask);
        const svg = buildPageSvg({ template: saved, pageId: "front", mode: "print" });
        const frame = { x: shape.x - shape.width / 2, y: shape.y - shape.height / 2, width: shape.width, height: shape.height };
        const expected = getMaskPath(stored.mask, frame).d;
        const unescape = (text: string) => text.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
        const paths = [...svg.matchAll(/<clipPath[^>]*>\s*<path d="([^"]+)"/g)].map((match) => unescape(match[1]));
        expect(paths, `${kind}: server clip outline`).toContain(expected);
      });
    }
  }

  it("a line and a photo, or two photos, are never offered (no area to clip to)", () => {
    expect(findClipMaskPair([{ ...shapeLayer("rectangle"), shape: "line" }, photo()])).toBeNull();
    expect(findClipMaskPair([photo(), { ...photo(), id: "photo2" }])).toBeNull();
  });
});
