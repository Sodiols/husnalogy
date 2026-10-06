import { describe, it, expect } from "vitest";
import { frameMaskAllowlistNames, getMaskPath, getLegacyMaskPath, maskShapeFromLegacy, normalizeMaskShape } from "../masks";

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

describe("canonical stored masks", () => {
  it("keeps real geometry exactly", () => {
    expect(normalizeMaskShape({ kind: "oval" })).toEqual({ kind: "oval" });
    expect(normalizeMaskShape({ kind: "rounded", radius: 24 })).toEqual({ kind: "rounded", radius: 24 });
    expect(normalizeMaskShape({ kind: "polygon", points: [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] })).toEqual({ kind: "polygon", points: [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] });
    expect(normalizeMaskShape({ kind: "path", d: "M 0 0 L 10 10 Z", viewBoxWidth: 10, viewBoxHeight: 10 })).toEqual({ kind: "path", d: "M 0 0 L 10 10 Z", viewBoxWidth: 10, viewBoxHeight: 10 });
  });

  it("turns anything that is not geometry into a plain rectangle", () => {
    expect(normalizeMaskShape({ kind: "heart" })).toEqual({ kind: "rectangle" });
    expect(normalizeMaskShape(null)).toEqual({ kind: "rectangle" });
    expect(normalizeMaskShape({ kind: "path", d: 'M0 0"/><image href="x"/>', viewBoxWidth: 10, viewBoxHeight: 10 })).toEqual({ kind: "rectangle" });
    expect(normalizeMaskShape({ kind: "path", d: "M 0 0 L 1 1", viewBoxWidth: 0, viewBoxHeight: 10 })).toEqual({ kind: "rectangle" });
    expect(normalizeMaskShape({ kind: "polygon", points: [{ x: 0, y: 0 }, { x: "a", y: 1 }] })).toEqual({ kind: "rectangle" });
    expect(normalizeMaskShape({ kind: "rounded", radius: "x" })).toEqual({ kind: "rounded", radius: 0 });
  });

  it("clamps polygon points into the box and drops extra fields", () => {
    expect(normalizeMaskShape({ kind: "polygon", points: [{ x: -1, y: 0, z: 9 }, { x: 2, y: 0 }, { x: 0.5, y: 3 }], extra: "<x>" })).toEqual({
      kind: "polygon",
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }],
    });
  });

  it("names the drawn outline for the frame-shape allowlist", () => {
    expect(frameMaskAllowlistNames({ maskShape: "circle" })).toEqual(["circle"]);
    expect(frameMaskAllowlistNames({ maskShape: "rectangle", mask: { kind: "oval" } })).toEqual(["oval"]);
    expect(frameMaskAllowlistNames({ mask: { kind: "arch" } })).toEqual(["arch-full"]);
    expect(frameMaskAllowlistNames({ mask: { kind: "arch-top" } })).toEqual(["arch-top", "arch"]);
    expect(frameMaskAllowlistNames({ maskShape: "arch" })).toEqual(["arch-top", "arch"]);
    expect(frameMaskAllowlistNames({ mask: { kind: "polygon", points: [] } })).toEqual(["polygon"]);
  });
});
