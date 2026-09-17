/**
 * Live resize/rotation preview.
 *
 * The editor used to preview a transform by SCALING the drawn result. That is
 * only faithful for a uniform corner drag: a side handle stretched glyphs and
 * squashed photos, so the customer watched a distorted object that snapped
 * back to something else on release. The preview now re-renders the affected
 * layers at their real in-progress geometry, through the same renderer that
 * produces the final artwork, so what is on screen mid-gesture is what lands.
 */

import { describe, expect, it } from "vitest";
import { applyGeometryOverrides } from "@/app/components/customizer/customizer-utils";

const layers = () => [
  {
    id: "photo",
    type: "image",
    x: 100,
    y: 100,
    width: 200,
    height: 200,
    imageTransform: { zoom: 1.5, offsetX: 12, offsetY: -8, flipX: true, fitMode: "cover", rotation: 90 },
  },
  { id: "title", type: "text", x: 50, y: 50, width: 300, height: 80, textStyle: { fontFamily: "Cormorant Garamond", fontSize: 48, color: "#303839" } },
  { id: "other", type: "shape", x: 10, y: 10, width: 20, height: 20 },
];

describe("applyGeometryOverrides", () => {
  it("returns the same array when there is nothing to preview", () => {
    const input = layers();
    expect(applyGeometryOverrides(input, null)).toBe(input);
    expect(applyGeometryOverrides(input, {})).toBe(input);
    expect(applyGeometryOverrides(input, undefined)).toBe(input);
  });

  it("replaces geometry for the object being transformed and leaves the rest alone", () => {
    const input = layers();
    const result = applyGeometryOverrides(input, { photo: { width: 340, height: 200, x: 170 } });
    const photo = result.find((layer) => layer.id === "photo")!;
    expect(photo).toMatchObject({ width: 340, height: 200, x: 170, y: 100 });
    // A non-uniform preview is expressed as real width/height, NOT as a scale,
    // which is what stops the photo from looking squashed mid-gesture.
    expect(photo).not.toHaveProperty("scaleX");
    // Untouched layers keep their identity so React skips re-rendering them.
    expect(result.find((layer) => layer.id === "other")).toBe(input[2]);
  });

  it("merges textStyle instead of replacing it", () => {
    // A font-size preview must not drop the family, colour or spacing.
    const result = applyGeometryOverrides(layers(), {
      title: { width: 420, height: 110, textStyle: { fontSize: 66 } },
    });
    const title = result.find((layer) => layer.id === "title")!;
    expect(title.textStyle).toEqual({
      fontFamily: "Cormorant Garamond",
      fontSize: 66,
      color: "#303839",
    });
    expect(title.width).toBe(420);
  });

  it("merges imageTransform instead of replacing it, so a crop keeps its flips and fit", () => {
    // A crop pan publishes ONLY the offsets it is changing. Replacing the whole
    // object would drop the flip, the in-frame rotation and the fit mode, and
    // the photo would jump on the first pointer move.
    const result = applyGeometryOverrides(layers(), {
      photo: { imageTransform: { offsetX: 40, offsetY: 25 } },
    });
    expect(result.find((layer) => layer.id === "photo")!.imageTransform).toEqual({
      zoom: 1.5,
      offsetX: 40,
      offsetY: 25,
      flipX: true,
      fitMode: "cover",
      rotation: 90,
    });
  });

  it("previews a crop zoom without disturbing the committed offsets", () => {
    const result = applyGeometryOverrides(layers(), { photo: { imageTransform: { zoom: 3.25 } } });
    const photo = result.find((layer) => layer.id === "photo")!;
    expect(photo.imageTransform.zoom).toBe(3.25);
    expect(photo.imageTransform.offsetX).toBe(12);
    expect(photo.imageTransform.offsetY).toBe(-8);
  });

  it("leaves imageTransform untouched when the preview is a plain geometry change", () => {
    const result = applyGeometryOverrides(layers(), { photo: { x: 180 } });
    const photo = result.find((layer) => layer.id === "photo")!;
    expect(photo.x).toBe(180);
    expect(photo.imageTransform).toEqual(layers()[0].imageTransform);
  });

  it("previews a grid slot crop by carrying the whole slots array", () => {
    // A slot's transform lives inside the grid layer, so the override replaces
    // `slots` wholesale with one slot's transform merged.
    const grid = [
      {
        id: "grid",
        type: "grid",
        slots: [
          { id: "a", transform: { zoom: 1, offsetX: 0, offsetY: 0, fitMode: "cover" } },
          { id: "b", transform: { zoom: 2, offsetX: 5, offsetY: 5, fitMode: "cover" } },
        ],
      },
    ];
    const slots = grid[0].slots.map((slot) =>
      slot.id === "b" ? { ...slot, transform: { ...slot.transform, offsetX: 60 } } : slot,
    );
    const result = applyGeometryOverrides(grid, { grid: { slots } });
    const out = result.find((layer) => layer.id === "grid")!;
    expect(out.slots[1].transform).toEqual({ zoom: 2, offsetX: 60, offsetY: 5, fitMode: "cover" });
    // The sibling slot must be untouched.
    expect(out.slots[0].transform).toEqual({ zoom: 1, offsetX: 0, offsetY: 0, fitMode: "cover" });
  });

  it("previews rotation", () => {
    const result = applyGeometryOverrides(layers(), { photo: { rotation: 42 } });
    expect(result.find((layer) => layer.id === "photo")!.rotation).toBe(42);
  });

  it("previews a whole multi-object transform at once", () => {
    const result = applyGeometryOverrides(layers(), {
      photo: { width: 250 },
      title: { width: 250 },
    });
    expect(result.find((layer) => layer.id === "photo")!.width).toBe(250);
    expect(result.find((layer) => layer.id === "title")!.width).toBe(250);
  });

  it("ignores overrides for layers that are not on this page", () => {
    const input = layers();
    const result = applyGeometryOverrides(input, { "not-here": { width: 999 } });
    expect(result.map((layer) => layer.width)).toEqual([200, 300, 20]);
  });

  it("never mutates the input, so the document is untouched by a preview", () => {
    const input = layers();
    const snapshot = JSON.parse(JSON.stringify(input));
    applyGeometryOverrides(input, { photo: { width: 999 }, title: { textStyle: { fontSize: 9 } } });
    expect(input).toEqual(snapshot);
  });
});
