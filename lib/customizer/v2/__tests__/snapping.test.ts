import { describe, expect, it } from "vitest";
import {
  buildSnapTargets,
  layerHalfExtents,
  snapBounds,
  snapMove,
  type SnapTargets,
} from "../snapping";

const PAGE = { pageWidth: 1500, pageHeight: 2100 };

// A 200x100 object centred at (x, y).
const box = (x: number, y: number, width = 200, height = 100) => ({
  left: x - width / 2,
  right: x + width / 2,
  top: y - height / 2,
  bottom: y + height / 2,
});

describe("buildSnapTargets", () => {
  it("offers page centre and both page edges on each axis", () => {
    const targets = buildSnapTargets(PAGE);
    const xs = targets.x.map((target) => target.position);
    const ys = targets.y.map((target) => target.position);
    expect(xs).toEqual(expect.arrayContaining([750, 0, 1500]));
    expect(ys).toEqual(expect.arrayContaining([1050, 0, 2100]));
  });

  it("converts safe-area insets into absolute edges", () => {
    const targets = buildSnapTargets({
      ...PAGE,
      safeArea: { left: 90, top: 90, right: 90, bottom: 120 },
    });
    const safeX = targets.x.filter((t) => t.kind === "safe-area").map((t) => t.position);
    const safeY = targets.y.filter((t) => t.kind === "safe-area").map((t) => t.position);
    expect(safeX).toEqual([90, 1410]);
    expect(safeY).toEqual([90, 1980]);
  });

  it("includes each neighbour's two edges and its centre", () => {
    const targets = buildSnapTargets({
      ...PAGE,
      objects: [{ id: "a", x: 400, y: 300, width: 200, height: 100 }],
    });
    const xs = targets.x.filter((t) => t.kind.startsWith("object")).map((t) => t.position);
    expect(xs).toEqual([300, 400, 500]);
    const ys = targets.y.filter((t) => t.kind.startsWith("object")).map((t) => t.position);
    expect(ys).toEqual([250, 300, 350]);
  });

  it("ignores hidden layers, excluded ids and full-page backgrounds", () => {
    const targets = buildSnapTargets({
      ...PAGE,
      objects: [
        { id: "dragged", x: 400, y: 300, width: 200, height: 100 },
        { id: "hidden", x: 700, y: 700, width: 200, height: 100, hidden: true },
        { id: "bg", x: 750, y: 1050, width: 1500, height: 2100, type: "background" },
      ],
      excludeIds: ["dragged"],
    });
    expect(targets.x.filter((t) => t.kind.startsWith("object"))).toHaveLength(0);
  });

  it("takes vertical and horizontal template guides, skipping hidden ones", () => {
    const targets = buildSnapTargets({
      ...PAGE,
      guides: [
        { axis: "vertical", position: 375 },
        { axis: "horizontal", position: 525 },
        { axis: "vertical", position: 999, hidden: true },
      ],
    });
    expect(targets.x.filter((t) => t.kind === "guide").map((t) => t.position)).toEqual([375]);
    expect(targets.y.filter((t) => t.kind === "guide").map((t) => t.position)).toEqual([525]);
  });

  it("keeps guides belonging to other pages out of the target list", () => {
    const targets = buildSnapTargets({
      ...PAGE,
      pageId: "front",
      guides: [
        { axis: "vertical", position: 375, pageId: "front" },
        { axis: "vertical", position: 400, pageId: "back" },
      ],
    });
    expect(targets.x.filter((t) => t.kind === "guide").map((t) => t.position)).toEqual([375]);
  });

  it("uses the rotated bounding box of a rotated neighbour", () => {
    // A 200x100 box rotated 90° occupies 100x200.
    const targets = buildSnapTargets({
      ...PAGE,
      objects: [{ id: "a", x: 400, y: 300, width: 200, height: 100, rotation: 90 }],
    });
    const xs = targets.x.filter((t) => t.kind.startsWith("object")).map((t) => Math.round(t.position));
    expect(xs).toEqual([350, 400, 450]);
  });
});

describe("snapBounds — edge alignment", () => {
  // The defect this module replaces: only the dragged object's CENTRE was ever
  // compared, so left-edge-to-left-edge alignment was unreachable.
  it("aligns the moving left edge to a neighbour's left edge", () => {
    // The neighbour is deliberately WIDER than the moving box, so aligning the
    // left edges is a different result from aligning the centres. With a
    // same-width neighbour the two are indistinguishable and the test would
    // pass even against the centre-only behaviour this module replaces.
    const targets = buildSnapTargets({
      ...PAGE,
      objects: [{ id: "a", x: 1000, y: 900, width: 300, height: 100 }],
      excludeIds: ["moving"],
    });
    // Neighbour lines: 850 / 1000 / 1150. The moving box is 200 wide centred at
    // 954, so its lines are 854 / 954 / 1054. Only one pair is within range —
    // left edge 854 to left edge 850 — so the assertion cannot be satisfied by
    // a centre snap, which is what the replaced implementation would have done.
    const result = snapBounds({ bounds: box(954, 500), targets, tolerance: 8 });
    expect(result.dx).toBe(-4);
    const guide = result.guides.find((g) => g.type === "v")!;
    expect(guide.at).toBe(850);
    expect(guide.kind).toBe("object-edge");
  });

  it("aligns the moving right edge to a neighbour's right edge", () => {
    const targets = buildSnapTargets({
      ...PAGE,
      objects: [{ id: "a", x: 1000, y: 900, width: 300, height: 100 }],
    });
    // Neighbour lines 850 / 1000 / 1150; moving lines 946 / 1046 / 1146. The
    // only pair in range is right edge to right edge.
    const result = snapBounds({ bounds: box(1046, 500), targets, tolerance: 8 });
    expect(result.dx).toBe(4);
    const guide = result.guides.find((g) => g.type === "v")!;
    expect(guide.at).toBe(1150);
    expect(guide.kind).toBe("object-edge");
  });

  it("puts a page-edge snap flush against the page, not half off it", () => {
    const targets = buildSnapTargets(PAGE);
    // Left edge at 4 — the old code moved the CENTRE to 0, pushing half the
    // object off the page. The edge must land on 0 instead.
    const result = snapBounds({ bounds: box(104, 500), targets, tolerance: 8 });
    expect(result.dx).toBe(-4);
    const snapped = box(104 + result.dx, 500);
    expect(snapped.left).toBe(0);
  });

  it("puts a safe-area snap flush against the margin", () => {
    const targets = buildSnapTargets({ ...PAGE, safeArea: { left: 90, top: 90, right: 90, bottom: 90 } });
    const result = snapBounds({ bounds: box(195, 500), targets, tolerance: 8 });
    const snapped = box(195 + result.dx, 500);
    expect(snapped.left).toBe(90);
  });

  it("still snaps centre to centre", () => {
    const targets = buildSnapTargets(PAGE);
    const result = snapBounds({ bounds: box(746, 1050), targets, tolerance: 8 });
    expect(result.dx).toBe(4);
    expect(result.guides.find((g) => g.type === "v")?.kind).toBe("page-center");
  });

  it("snaps both axes in one gesture", () => {
    const targets = buildSnapTargets(PAGE);
    const result = snapBounds({ bounds: box(747, 1047), targets, tolerance: 8 });
    expect(result.dx).toBe(3);
    expect(result.dy).toBe(3);
    expect(result.guides).toHaveLength(2);
  });

  it("does nothing when every candidate is outside the tolerance", () => {
    const targets = buildSnapTargets(PAGE);
    const result = snapBounds({ bounds: box(400, 400), targets, tolerance: 8 });
    expect(result).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it("prefers a centre alignment over an edge at the same distance", () => {
    const targets: SnapTargets = {
      x: [
        { position: 100, kind: "object-edge" },
        { position: 200, kind: "object-center" },
      ],
      y: [],
    };
    // Moving box 200 wide centred at 195: left edge 95 is 5 from the edge
    // target, centre 195 is 5 from the centre target. The centre wins.
    const result = snapBounds({ bounds: box(195, 500), targets, tolerance: 8 });
    expect(result.dx).toBe(5);
    expect(result.guides[0].kind).toBe("object-center");
  });

  it("chooses the nearest candidate when several are in range", () => {
    const targets: SnapTargets = {
      x: [
        { position: 300, kind: "object-edge" },
        { position: 302, kind: "object-edge" },
      ],
      y: [],
    };
    const result = snapBounds({ bounds: box(405, 500), targets, tolerance: 8 });
    // Left edge 305 -> nearest is 302.
    expect(result.dx).toBe(-3);
  });

  it("draws a guide segment spanning both the target and the moved box", () => {
    const targets = buildSnapTargets({
      ...PAGE,
      objects: [{ id: "a", x: 1000, y: 900, width: 300, height: 100 }],
    });
    const result = snapBounds({ bounds: box(954, 500), targets, tolerance: 8 });
    const guide = result.guides.find((g) => g.type === "v")!;
    // Neighbour spans y 850..950, the moving box spans 450..550, so the guide
    // reaches from the top of the moving box to the bottom of the neighbour.
    expect(guide.start).toBe(450);
    expect(guide.end).toBe(950);
  });
});

describe("snapMove", () => {
  it("returns a rounded centre and passes through when disabled", () => {
    const targets = buildSnapTargets(PAGE);
    const off = snapMove({
      x: 746.4,
      y: 1050,
      halfWidth: 100,
      halfHeight: 50,
      targets,
      tolerance: 8,
      enabled: false,
    });
    expect(off).toEqual({ x: 746, y: 1050, guides: [] });

    const on = snapMove({ x: 746.4, y: 1050, halfWidth: 100, halfHeight: 50, targets, tolerance: 8 });
    expect(on.x).toBe(750);
  });

  it("snaps a wide object's edge rather than dragging its centre to the margin", () => {
    const targets = buildSnapTargets({ ...PAGE, safeArea: { left: 90, top: 90, right: 90, bottom: 90 } });
    const result = snapMove({ x: 194, y: 1050, halfWidth: 100, halfHeight: 50, targets, tolerance: 8 });
    expect(result.x).toBe(190); // left edge 90, centre 190 — not centre 90.
  });
});

describe("layerHalfExtents", () => {
  it("reports half the axis-aligned size for an unrotated layer", () => {
    expect(layerHalfExtents({ x: 0, y: 0, width: 200, height: 100 })).toEqual({
      halfWidth: 100,
      halfHeight: 50,
    });
  });

  it("swaps the extents for a quarter-turn rotation", () => {
    const extents = layerHalfExtents({ x: 0, y: 0, width: 200, height: 100, rotation: 90 });
    expect(Math.round(extents.halfWidth)).toBe(50);
    expect(Math.round(extents.halfHeight)).toBe(100);
  });
});
