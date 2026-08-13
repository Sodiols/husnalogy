import { describe, expect, it } from "vitest";
import {
  clientPointToDocument,
  marqueeSelectedLayerIds,
  pointerExceededDragThreshold,
  rectIntersectsTransformedLayer,
  resolveLayerSelectionGeometry,
  transformedLayerBounds,
} from "../selection-geometry";

describe("shared multi-selection geometry", () => {
  it("selects every object the marquee touches, using transformed bounds", () => {
    const layers = [
      { id: "text", type: "text", x: 50, y: 50, width: 40, height: 20, rotation: 0 },
      { id: "rotated-line", type: "shape", x: 90, y: 50, width: 60, height: 4, rotation: 90 },
      { id: "partial", type: "image", x: 115, y: 50, width: 40, height: 40, rotation: 0 },
      { id: "far", type: "image", x: 400, y: 400, width: 40, height: 40, rotation: 0 },
      { id: "hidden", type: "frame", x: 40, y: 40, width: 10, height: 10, hidden: true },
      { id: "page", type: "background", x: 50, y: 50, width: 1500, height: 2100 },
    ];

    expect(transformedLayerBounds(layers[1])).toMatchObject({
      left: 88,
      right: 92,
      top: 20,
      bottom: 80,
    });
    // "partial" is only clipped by the box, not swallowed by it — touch is enough.
    expect(marqueeSelectedLayerIds({ left: 0, top: 0, right: 100, bottom: 100 }, layers)).toEqual([
      "text",
      "rotated-line",
      "partial",
    ]);
    // Hidden objects and the full-page background never join a marquee.
    expect(marqueeSelectedLayerIds({ left: 0, top: 0, right: 2000, bottom: 2000 }, layers)).not.toContain("hidden");
    expect(marqueeSelectedLayerIds({ left: 0, top: 0, right: 2000, bottom: 2000 }, layers)).not.toContain("page");
  });

  it("is direction independent and exact for rotated objects", () => {
    const layers = [{ id: "text", type: "text", x: 50, y: 50, width: 40, height: 20, rotation: 0 }];
    // Dragged up-left instead of down-right: same result.
    expect(marqueeSelectedLayerIds({ left: 100, top: 100, right: 0, bottom: 0 }, layers)).toEqual(["text"]);

    // A 45° square: the world AABB reaches the corner, the real object does not.
    const diamond = { id: "diamond", type: "shape", x: 100, y: 100, width: 40, height: 40, rotation: 45 };
    expect(transformedLayerBounds(diamond).left).toBeCloseTo(100 - Math.SQRT2 * 20);
    expect(rectIntersectsTransformedLayer({ left: 70, top: 70, right: 76, bottom: 76 }, diamond)).toBe(false);
    expect(rectIntersectsTransformedLayer({ left: 70, top: 95, right: 76, bottom: 105 }, diamond)).toBe(true);
  });

  it("converts zoomed and rotated screen pointers back into document coordinates", () => {
    const rect = { left: 10, top: 20, width: 100, height: 200 };
    expect(clientPointToDocument(60, 120, rect, 200, 100, 2, 90)).toEqual({ x: 50, y: 25 });
    const topLeft = clientPointToDocument(110, 20, rect, 200, 100, 2, 90);
    expect(topLeft.x).toBeCloseTo(0);
    expect(topLeft.y).toBeCloseTo(0);
  });

  it("does not begin selection or movement for sub-threshold pointer jitter", () => {
    expect(pointerExceededDragThreshold(10, 10, 12, 12)).toBe(false);
    expect(pointerExceededDragThreshold(10, 10, 14, 10)).toBe(true);
  });

  it("resolves auto-width text before calculating selection geometry", () => {
    const layer = {
      id: "name",
      type: "text",
      x: 100,
      y: 100,
      width: 20,
      height: 20,
      textStyle: {
        fontFamily: "serif",
        fontSize: 20,
        fontWeight: "400",
        lineHeight: 1,
        multiline: false,
        autoSizeMode: "width",
        textAlign: "left",
      },
    };
    const resolved = resolveLayerSelectionGeometry(layer, {
      text: "MADISON",
      measure: (text, style) => text.length * style.fontSize,
      safeBounds: { left: 0, top: 0, right: 500, bottom: 500 },
    });
    expect(resolved.width).toBeGreaterThan(layer.width);
    expect(resolved.resolvedText).toBe("MADISON");
  });
});
