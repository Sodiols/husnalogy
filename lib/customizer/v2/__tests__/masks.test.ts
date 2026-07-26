import { describe, it, expect } from "vitest";
import { getMaskPath, getLegacyMaskPath, maskShapeFromLegacy } from "../masks";

const frame = { x: 100, y: 200, width: 400, height: 600 };

describe("mask path generator", () => {
  it("produces a rectangle path by default", () => {
    const { d } = getMaskPath({ kind: "rectangle" }, frame);
    expect(d).toContain("M 100 200");
    expect(d).toContain("H 500");
    expect(d).toContain("V 800");
  });

  it("produces a true arch-top path with an elliptical cap", () => {
    const { d } = getMaskPath({ kind: "arch-top" }, frame);
    // Arch cap = one elliptical arc across the full width.
    expect(d).toContain("A 200");
    // Flat bottom: closes through the bottom corners.
    expect(d).toContain("V");
    expect(d.startsWith("M 100")).toBe(true);
  });

  it("produces arcs for both caps on a full arch", () => {
    const { d } = getMaskPath({ kind: "arch" }, frame);
    const arcCount = (d.match(/A /g) || []).length;
    expect(arcCount).toBe(2);
  });

  it("clamps rounded radius to half the smaller side", () => {
    const { d } = getMaskPath({ kind: "rounded", radius: 9999 }, frame);
    expect(d).toContain("A 200 200");
  });

  it("maps legacy 'arch' string to arch-top", () => {
    expect(maskShapeFromLegacy("arch").kind).toBe("arch-top");
    expect(maskShapeFromLegacy("circle").kind).toBe("circle");
    expect(maskShapeFromLegacy(undefined).kind).toBe("rectangle");
  });

  it("legacy helper returns a usable arch path (regression: arch used to render as a rectangle)", () => {
    const rect = getLegacyMaskPath("rectangle", frame).d;
    const arch = getLegacyMaskPath("arch", frame).d;
    expect(arch).not.toEqual(rect);
    expect(arch).toContain("A ");
  });

  it("normalized polygon points scale into the frame", () => {
    const { d } = getMaskPath(
      { kind: "polygon", points: [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
      frame,
    );
    expect(d).toBe("M 300 200 L 500 800 L 100 800 Z");
  });

  it("custom path masks scale via transform", () => {
    const result = getMaskPath({ kind: "path", d: "M 0 0 L 10 10 Z", viewBoxWidth: 10, viewBoxHeight: 10 }, frame);
    expect(result.d).toBe("M 0 0 L 10 10 Z");
    expect(result.transform).toContain("translate(100 200)");
    expect(result.transform).toContain("scale(40 60)");
  });
});
