import { describe, expect, it } from "vitest";
import {
  clientPointToDocument,
  fullyEnclosedLayerIds,
  pointerExceededDragThreshold,
  resolveLayerSelectionGeometry,
  transformedLayerBounds,
} from "../selection-geometry";

describe("shared multi-selection geometry", () => {
  it("uses full enclosure and transformed bounds for mixed rotated objects", () => {
    const layers = [
      { id: "text", type: "text", x: 50, y: 50, width: 40, height: 20, rotation: 0 },
      { id: "rotated-line", type: "shape", x: 90, y: 50, width: 60, height: 4, rotation: 90 },
      { id: "partial", type: "image", x: 115, y: 50, width: 40, height: 40, rotation: 0 },
      { id: "hidden", type: "frame", x: 40, y: 40, width: 10, height: 10, hidden: true },
    ];

    expect(transformedLayerBounds(layers[1])).toMatchObject({
      left: 88,
      right: 92,
      top: 20,
      bottom: 80,
    });
    expect(fullyEnclosedLayerIds({ left: 0, top: 0, right: 100, bottom: 100 }, layers)).toEqual([
      "text",
      "rotated-line",
    ]);
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
