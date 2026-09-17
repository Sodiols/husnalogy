// A drag is a TRANSLATION — regression coverage for text creeping off target.
//
// The editor works in RESOLVED geometry: `resolveTextBox` measures the glyphs
// and re-anchors that box inside the authored box, so for auto-sized text the
// resolved centre is NOT the centre the document stores. The drag used to
// commit the resolved centre directly, which moved the layer by the difference
// between the two on every drag. Measured in the browser on the fixture's
// auto-width layer: a drag meant to move 161.5 document pixels moved 119.
//
// These tests model the full pipeline — document layer -> resolved interaction
// geometry -> gesture -> commit -> re-resolve — and assert the only thing that
// matters: what the customer SEES move must equal what the gesture applied, and
// the persisted origin must move by exactly the same amount.

import { describe, expect, it } from "vitest";

import { resolveDragCommits, applySelectionDelta } from "../interaction/gesture-math";
import { normalizeTextScale } from "../interaction/konva-adapter";
import { resolveLayerSelectionGeometry } from "../selection-geometry";
import { fallbackMeasure } from "../text-layout";

const safeBounds = { left: 90, top: 90, right: 1410, bottom: 2010 };

const resolve = (layer: any) =>
  resolveLayerSelectionGeometry(layer, { text: layer.text, measure: fallbackMeasure, safeBounds });

type Style = Record<string, unknown>;

function textLayer(style: Style = {}, overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    type: "text",
    page: "front",
    text: "Alex & Jordan",
    x: 750,
    y: 600,
    width: 900,
    height: 160,
    rotation: 0,
    textStyle: {
      fontFamily: "Cormorant Garamond",
      fontSize: 72,
      fontWeight: "600",
      fontStyle: "normal",
      color: "#303839",
      textAlign: "center",
      verticalAlign: "middle",
      lineHeight: 1.15,
      letterSpacing: 0,
      uppercase: false,
      multiline: false,
      ...style,
    },
    ...overrides,
  };
}

/**
 * One complete drag, exactly as the stage performs it.
 *
 * The interaction node is built from RESOLVED geometry; the gesture moves that
 * resolved box by `(dx, dy)`; the commit produces a document patch. Returns the
 * next document layer plus what the customer actually saw move.
 */
function drag(layer: any, dx: number, dy: number) {
  const before = resolve(layer);
  const member = {
    id: layer.id,
    x: before.x,
    y: before.y,
    documentX: layer.x,
    documentY: layer.y,
    width: before.width,
    height: before.height,
    rotation: 0,
  };
  // The gesture ends with the resolved box moved by the pointer delta.
  const moves = applySelectionDelta([member], layer.id, before.x + dx, before.y + dy, before.x, before.y);
  const [change] = resolveDragCommits([member], moves, layer.id);

  const next = { ...layer, ...(change ? change.patch : {}) };
  const after = resolve(next);
  return {
    next,
    renderedDx: after.x - before.x,
    renderedDy: after.y - before.y,
    documentDx: next.x - layer.x,
    documentDy: next.y - layer.y,
  };
}

/** A corner resize, exactly as the stage commits one (font-size scaling). */
function cornerResize(layer: any, factor: number) {
  const before = resolve(layer);
  const scaled = normalizeTextScale({
    node: {
      x: before.x,
      y: before.y,
      width: before.width,
      height: before.height,
      rotation: 0,
      scaleX: factor,
      scaleY: factor,
    },
    fontSize: Number(layer.textStyle.fontSize),
    letterSpacing: Number(layer.textStyle.letterSpacing) || 0,
    minFontSize: 4,
    maxFontSize: 500,
  });
  return {
    ...layer,
    x: scaled.x,
    y: scaled.y,
    width: scaled.width,
    height: scaled.height,
    textStyle: { ...layer.textStyle, fontSize: scaled.fontSize, letterSpacing: scaled.letterSpacing },
  };
}

/** Rounding to whole document pixels is the only tolerance allowed. */
const EXACT = 1;

const MODES: Array<[string, Style]> = [
  ["fixed", {}],
  ["auto-width center/middle", { autoSizeMode: "width" }],
  ["auto-width left/top", { autoSizeMode: "width", textAlign: "left", verticalAlign: "top" }],
  ["auto-width right/bottom", { autoSizeMode: "width", textAlign: "right", verticalAlign: "bottom" }],
  ["auto-width left/bottom", { autoSizeMode: "width", textAlign: "left", verticalAlign: "bottom" }],
  ["shrink", { fitMode: "shrink" }],
];

describe("dragging text translates it exactly", () => {
  for (const [name, style] of MODES) {
    it(`${name}: a drag moves the rendered text by the gesture delta`, () => {
      const result = drag(textLayer(style), 137, -211);
      expect(Math.abs(result.renderedDx - 137), `${name} horizontal`).toBeLessThanOrEqual(EXACT);
      expect(Math.abs(result.renderedDy - -211), `${name} vertical`).toBeLessThanOrEqual(EXACT);
      // The persisted origin moves by the same delta — never to the resolved box.
      expect(Math.abs(result.documentDx - 137)).toBeLessThanOrEqual(EXACT);
      expect(Math.abs(result.documentDy - -211)).toBeLessThanOrEqual(EXACT);
    });
  }

  it("multiline auto-height text translates exactly", () => {
    const layer = textLayer({ autoSizeMode: "height", multiline: true }, { text: "Alex & Jordan\nsave the date" });
    const result = drag(layer, -80, 240);
    expect(Math.abs(result.renderedDx - -80)).toBeLessThanOrEqual(EXACT);
    expect(Math.abs(result.renderedDy - 240)).toBeLessThanOrEqual(EXACT);
  });
});

describe("resize then drag", () => {
  for (const [name, style] of MODES) {
    it(`${name}: enlarging then dragging is still exact`, () => {
      const enlarged = cornerResize(textLayer(style), 1.8);
      const result = drag(enlarged, 90, 150);
      expect(Math.abs(result.renderedDy - 150), `${name} after enlarging`).toBeLessThanOrEqual(EXACT);
      expect(Math.abs(result.renderedDx - 90), `${name} after enlarging`).toBeLessThanOrEqual(EXACT);
    });

    it(`${name}: shrinking then dragging is still exact`, () => {
      const shrunk = cornerResize(textLayer(style), 0.5);
      const result = drag(shrunk, -60, -120);
      expect(Math.abs(result.renderedDy - -120), `${name} after shrinking`).toBeLessThanOrEqual(EXACT);
      expect(Math.abs(result.renderedDx - -60), `${name} after shrinking`).toBeLessThanOrEqual(EXACT);
    });
  }

  it("never accumulates drift across repeated resize/drag cycles", () => {
    // The exact sequence from the report: enlarge, drag, enlarge, drag, shrink,
    // drag, shrink, drag. Each drag must land precisely, whatever came before.
    let layer: any = textLayer({ autoSizeMode: "width", textAlign: "left", verticalAlign: "top" });
    const factors = [1.6, 1.4, 0.6, 0.75];
    for (const factor of factors) {
      layer = cornerResize(layer, factor);
      const result = drag(layer, 40, 70);
      expect(Math.abs(result.renderedDy - 70), `after x${factor}`).toBeLessThanOrEqual(EXACT);
      expect(Math.abs(result.renderedDx - 40), `after x${factor}`).toBeLessThanOrEqual(EXACT);
      layer = result.next;
    }
  });

  it("ten consecutive drags land exactly where the tenth gesture asked", () => {
    let layer: any = cornerResize(
      textLayer({ autoSizeMode: "height", multiline: true }, { text: "Alex & Jordan\nsave the date" }),
      1.5,
    );
    const startY = layer.y;
    for (let round = 0; round < 10; round += 1) {
      layer = drag(layer, 0, 25).next;
    }
    // Ten 25px drags must move the persisted origin exactly 250px, not 250 plus
    // ten times the resolved-vs-stored offset.
    expect(Math.abs(layer.y - startY - 250)).toBeLessThanOrEqual(EXACT);
  });
});

describe("the resolved box and the persisted origin are not the same thing", () => {
  it("proves they genuinely differ, so the tests above are not vacuous", () => {
    // If these ever became equal the regression tests would pass for the wrong
    // reason, so the premise is asserted explicitly.
    const layer = textLayer({ autoSizeMode: "width", textAlign: "left", verticalAlign: "top" });
    const resolved = resolve(layer);
    expect(Math.abs(resolved.x - layer.x)).toBeGreaterThan(5);
    expect(Math.abs(resolved.y - layer.y)).toBeGreaterThan(5);
  });

  it("commits the delta, not the resolved position", () => {
    // Directly pins the rule: a member whose resolved centre is far from its
    // stored centre must still commit stored + delta.
    const changes = resolveDragCommits(
      [{ id: "t1", x: 100, y: 200, documentX: 750, documentY: 600 }],
      [{ id: "t1", x: 130, y: 250 }],
    );
    expect(changes).toEqual([{ id: "t1", patch: { x: 780, y: 650 } }]);
  });

  it("falls back to the resolved centre when no document origin is supplied", () => {
    const changes = resolveDragCommits(
      [{ id: "s1", x: 100, y: 200 } as any],
      [{ id: "s1", x: 130, y: 250 }],
    );
    expect(changes).toEqual([{ id: "s1", patch: { x: 130, y: 250 } }]);
  });

  it("emits nothing for a gesture that ended where it started", () => {
    expect(
      resolveDragCommits(
        [{ id: "t1", x: 100, y: 200, documentX: 750, documentY: 600 }],
        [{ id: "t1", x: 100, y: 200 }],
      ),
    ).toEqual([]);
  });
});

describe("multi-selection and grouped text", () => {
  it("moves text and a shape by the identical delta, preserving their spacing", () => {
    // A text layer whose resolved centre is offset, dragged together with an
    // ordinary object whose resolved centre is not.
    const text = textLayer({ autoSizeMode: "width", textAlign: "left", verticalAlign: "top" });
    const shape = { id: "s1", type: "shape", x: 300, y: 300, width: 200, height: 100, rotation: 0 };

    const textResolved = resolve(text);
    const members = [
      { id: text.id, x: textResolved.x, y: textResolved.y, documentX: text.x, documentY: text.y },
      { id: shape.id, x: shape.x, y: shape.y, documentX: shape.x, documentY: shape.y },
    ];
    // The lead is the shape; the text follows by the same effective delta.
    const moves = applySelectionDelta(
      members.map((member) => ({ ...member, width: 10, height: 10 })),
      shape.id,
      shape.x + 120,
      shape.y + 45,
      shape.x,
      shape.y,
    );
    const changes = resolveDragCommits(members, moves, shape.id);
    const byId = new Map(changes.map((change) => [change.id, change.patch]));

    expect(byId.get("s1")).toEqual({ x: 420, y: 345 });
    // The text's DOCUMENT origin moves by the same 120/45, not to its resolved box.
    expect(byId.get("t1")).toEqual({ x: text.x + 120, y: text.y + 45 });

    const spacingBefore = { x: text.x - shape.x, y: text.y - shape.y };
    const spacingAfter = {
      x: (byId.get("t1") as any).x - (byId.get("s1") as any).x,
      y: (byId.get("t1") as any).y - (byId.get("s1") as any).y,
    };
    expect(spacingAfter).toEqual(spacingBefore);
  });

  it("applies the same rule to grouped text, which travels the same path", () => {
    const child = textLayer({ autoSizeMode: "width", verticalAlign: "top" }, { id: "c1", groupId: "g1" });
    const resolved = resolve(child);
    const changes = resolveDragCommits(
      [{ id: child.id, x: resolved.x, y: resolved.y, documentX: child.x, documentY: child.y }],
      [{ id: child.id, x: resolved.x + 33, y: resolved.y + 77 }],
    );
    expect(changes[0].patch).toEqual({ x: child.x + 33, y: child.y + 77 });
  });
});
