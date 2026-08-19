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
  { id: "photo", type: "image", x: 100, y: 100, width: 200, height: 200 },
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
