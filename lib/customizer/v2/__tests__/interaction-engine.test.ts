/**
 * The shared interaction engine (spec §7, §63).
 *
 * Before the Konva migration, the selection / transform / marquee behaviour of
 * both customizers lived inside two 1,200+ line React components and could only
 * be exercised through a real pointer, which neither vitest nor the available
 * e2e environment can produce. The rules are now pure modules, so this file
 * asserts the actual behaviour rather than matching source strings.
 */

import { describe, expect, it } from "vitest";

import {
  logicalMembers,
  resolveLayerCapabilities,
  resolveSelectionCapabilities,
} from "../interaction/capabilities";
import {
  MIN_OBJECT_SIZE,
  geometryPatch,
  isEmptyPatch,
  konvaNodePropsFromLayer,
  normalizeKonvaGeometry,
  normalizeRotation,
  normalizeTextScale,
  resetNodeScale,
} from "../interaction/konva-adapter";
import {
  CORNER_HANDLES,
  HANDLE_DEFINITIONS,
  handleFromKonvaAnchor,
  konvaAnchors,
  resolveHandleMetrics,
  resolveHitExtents,
  resolveVisibleHandles,
} from "../interaction/handles";
import {
  applySelectionDelta,
  clampBoxIntoBounds,
  fromSurfaceDelta,
  resolveMultiResize,
  resolveMultiRotate,
  resolveNudge,
  resolveResize,
  resolveRotation,
  rotatePoint,
  toLocalDelta,
} from "../interaction/gesture-math";
import { hitTestMarquee, hitTestPoint, isTargetable, resolveSelectionTarget } from "../interaction/hit-test";
import { gridSlotNodeId, layerNodeId, owningLayerId, parseNodeId } from "../interaction/node-identity";
import {
  INITIAL_TOOL_STATE,
  canvasOwnsKeyboard,
  isTransientMode,
  resolvePointerOwner,
  toolReducer,
} from "../interaction/tool-mode";
import {
  createFrameScheduler,
  transientTransformString,
} from "../interaction/transient-preview";

/* ========================================================================== */
/* Capabilities — the permission model both surfaces share (spec §41, §58)    */
/* ========================================================================== */

describe("layer capabilities", () => {
  const editableText = {
    id: "t1",
    type: "text",
    customerEditable: true,
  };

  it("gives admin everything except on locked objects", () => {
    const open = resolveLayerCapabilities({ id: "a", type: "shape" }, { surface: "admin" });
    expect(open).toMatchObject({ movable: true, resizable: true, rotatable: true });

    const locked = resolveLayerCapabilities({ id: "a", type: "shape", locked: true }, { surface: "admin" });
    expect(locked.movable).toBe(false);
    expect(locked.resizable).toBe(false);
    // A locked object stays SELECTABLE, or admin could never click it to unlock.
    expect(locked.selectable).toBe(true);

    const readOnly = resolveLayerCapabilities(
      { id: "a", type: "shape", adminEditable: false },
      { surface: "admin" },
    );
    expect(readOnly.movable).toBe(false);
  });

  it("gates the customer on the template's permission bundle", () => {
    expect(resolveLayerCapabilities(editableText, { surface: "customer" })).toMatchObject({
      movable: true,
      resizable: true,
      editableText: true,
    });

    // Not customer-editable at all: visible, but never a transform target.
    const decorative = resolveLayerCapabilities({ id: "d", type: "shape" }, { surface: "customer" });
    expect(decorative.movable).toBe(false);
    expect(decorative.resizable).toBe(false);
    expect(decorative.rotatable).toBe(false);
    expect(decorative.editableText).toBe(false);
  });

  it("honours every customer transform lock", () => {
    for (const lock of ["customerLocked", "positionLocked", "customerInteractionDisabled"]) {
      const capabilities = resolveLayerCapabilities(
        { ...editableText, [lock]: true },
        { surface: "customer" },
      );
      expect(capabilities.movable, lock).toBe(false);
      expect(capabilities.resizable, lock).toBe(false);
      expect(capabilities.rotatable, lock).toBe(false);
    }
  });

  it("treats a customer's own object as theirs, and respects its own lock", () => {
    const own = resolveLayerCapabilities(
      { id: "u1", type: "text", isUserLayer: true },
      { surface: "customer" },
    );
    expect(own).toMatchObject({ movable: true, resizable: true, editableText: true, deletable: true });

    const lockedOwn = resolveLayerCapabilities(
      { id: "u1", type: "text", isUserLayer: true, locked: true },
      { surface: "customer" },
    );
    expect(lockedOwn.movable).toBe(false);
    expect(lockedOwn.deletable).toBe(false);
  });

  it("makes a group only as permissive as its least permissive member", () => {
    const layers = [
      { id: "g", type: "group" },
      { id: "a", type: "shape", groupId: "g", customerEditable: true },
      // One member the customer may not move sinks the whole group.
      { id: "b", type: "shape", groupId: "g", customerEditable: true, customerLocked: true },
    ];
    const capabilities = resolveLayerCapabilities(layers[0], { surface: "customer", layers });
    expect(capabilities.movable).toBe(false);
    // A group is never a text-edit target, whatever it contains.
    expect(capabilities.editableText).toBe(false);
  });

  it("collects a group's descendants", () => {
    const layers = [
      { id: "g", type: "group" },
      { id: "a", type: "shape", groupId: "g" },
      { id: "b", type: "shape", groupId: "g" },
      { id: "outside", type: "shape" },
    ];
    expect(logicalMembers(layers, layers[0]).map((layer) => layer.id).sort()).toEqual(["a", "b", "g"]);
    expect(logicalMembers(layers, layers[3])).toEqual([layers[3]]);
  });

  it("is all-or-nothing across a multi selection (spec §18)", () => {
    const layers = [
      { id: "a", type: "shape", customerEditable: true },
      { id: "b", type: "shape", customerEditable: true },
      { id: "c", type: "shape", customerEditable: true, customerLocked: true },
    ];
    expect(resolveSelectionCapabilities(["a", "b"], layers, "customer").movable).toBe(true);
    // One prohibited member makes the whole operation illegal, rather than
    // silently moving two of the three objects.
    expect(resolveSelectionCapabilities(["a", "b", "c"], layers, "customer").movable).toBe(false);
    // An id that is not on the page fails the set rather than being ignored.
    expect(resolveSelectionCapabilities(["a", "missing"], layers, "customer").movable).toBe(false);
    expect(resolveSelectionCapabilities([], layers, "customer").movable).toBe(false);
  });
});

/* ========================================================================== */
/* Konva adapter — the rule that keeps Konva out of the document (spec §8)    */
/* ========================================================================== */

describe("konva adapter", () => {
  it("folds scale into width and height and never leaks it", () => {
    const geometry = normalizeKonvaGeometry({
      x: 120.4,
      y: 240.6,
      width: 200,
      height: 100,
      rotation: 30.2,
      scaleX: 1.5,
      scaleY: 2,
    });
    expect(geometry).toEqual({ x: 120, y: 241, width: 300, height: 200, rotation: 30 });
    expect(geometry).not.toHaveProperty("scaleX");
    expect(geometry).not.toHaveProperty("scaleY");
  });

  it("never lets a transform collapse an object below the minimum", () => {
    const geometry = normalizeKonvaGeometry({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      scaleX: 0.001,
      scaleY: 0.001,
    });
    expect(geometry.width).toBe(MIN_OBJECT_SIZE);
    expect(geometry.height).toBe(MIN_OBJECT_SIZE);
  });

  it("treats a mirrored scale as a size, not a negative dimension", () => {
    const geometry = normalizeKonvaGeometry({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      scaleX: -1.5,
      scaleY: -1,
    });
    expect(geometry.width).toBe(300);
    expect(geometry.height).toBe(100);
  });

  it("folds rotation into 0-359", () => {
    expect(normalizeRotation(370)).toBe(10);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation("nonsense")).toBe(0);
  });

  it("resets a live node so no scale survives the gesture", () => {
    const applied: Record<string, number> = {};
    const node = {
      scaleX: (value?: number) => (applied.scaleX = value!),
      scaleY: (value?: number) => (applied.scaleY = value!),
      width: (value?: number) => (applied.width = value!),
      height: (value?: number) => (applied.height = value!),
    };
    resetNodeScale(node, { width: 300, height: 200 });
    expect(applied).toEqual({ scaleX: 1, scaleY: 1, width: 300, height: 200 });
  });

  it("centres a Konva node on the Husnalogy centre origin", () => {
    const props = konvaNodePropsFromLayer({ x: 500, y: 400, width: 200, height: 100, rotation: 45 });
    expect(props).toEqual({
      x: 500,
      y: 400,
      width: 200,
      height: 100,
      offsetX: 100,
      offsetY: 50,
      rotation: 45,
      scaleX: 1,
      scaleY: 1,
    });
  });

  it("emits only what changed, so an idle gesture writes nothing", () => {
    const before = { x: 10, y: 20, width: 100, height: 50, rotation: 0 };
    expect(isEmptyPatch(geometryPatch(before, { ...before }))).toBe(true);
    expect(geometryPatch(before, { ...before, x: 15 })).toEqual({ x: 15 });
    expect(geometryPatch(before, { ...before, rotation: 90 })).toEqual({ rotation: 90 });
    expect(isEmptyPatch(null)).toBe(true);
    expect(isEmptyPatch({})).toBe(true);
  });

  it("turns a text corner drag into a font size, never a stretched glyph", () => {
    const scaled = normalizeTextScale({
      node: { x: 0, y: 0, width: 400, height: 100, rotation: 0, scaleX: 0.5, scaleY: 0.5 },
      fontSize: 48,
      letterSpacing: 4,
    });
    expect(scaled.fontSize).toBe(24);
    expect(scaled.letterSpacing).toBe(2);
    expect(scaled.width).toBe(200);
    expect(scaled.height).toBe(50);
  });

  it("clamps a text scale to its configured font-size range", () => {
    const tiny = normalizeTextScale({
      node: { x: 0, y: 0, width: 100, height: 40, scaleX: 0.01, scaleY: 0.01 },
      fontSize: 40,
      minFontSize: 12,
    });
    expect(tiny.fontSize).toBe(12);
    // The box follows the CLAMPED factor, so it cannot shrink past the type.
    expect(tiny.width).toBe(30);
  });
});

/* ========================================================================== */
/* Handles — zoom-independent chrome (spec §13)                               */
/* ========================================================================== */

describe("handles", () => {
  it("keeps handles the same physical size at every zoom", () => {
    const zoomedOut = resolveHandleMetrics(0.25);
    const zoomedIn = resolveHandleMetrics(4);
    // Four times smaller on screen means four times larger in document units.
    expect(zoomedOut.size).toBeCloseTo(zoomedIn.size * 16, 6);
    // Multiplied back out by the scale, both land on the same screen size.
    expect(zoomedOut.size * 0.25).toBeCloseTo(zoomedIn.size * 4, 6);
    expect(zoomedOut.snapTolerance * 0.25).toBeCloseTo(zoomedIn.snapTolerance * 4, 6);
  });

  it("offers larger targets for touch", () => {
    expect(resolveHandleMetrics(1, "touch").size).toBeGreaterThan(resolveHandleMetrics(1, "mouse").size);
    expect(resolveHandleMetrics(1, "touch").hitPadding).toBeGreaterThan(
      resolveHandleMetrics(1, "mouse").hitPadding,
    );
  });

  it("never divides by a zero scale", () => {
    expect(Number.isFinite(resolveHandleMetrics(0).size)).toBe(true);
  });

  it("maps handles to Konva anchors both ways", () => {
    expect(konvaAnchors(["nw", "e"])).toEqual(["top-left", "middle-right"]);
    expect(handleFromKonvaAnchor("bottom-right")).toBe("se");
    expect(handleFromKonvaAnchor("nonsense")).toBeNull();
    // Every definition round-trips.
    for (const handle of HANDLE_DEFINITIONS) {
      expect(handleFromKonvaAnchor(konvaAnchors([handle.id])[0])).toBe(handle.id);
    }
  });

  it("drops the vertical handles on single-line auto-sized text", () => {
    const handles = resolveVisibleHandles({ resizable: true, isText: true, singleLineAutoSize: true });
    expect(handles).not.toContain("n");
    expect(handles).not.toContain("s");
    expect(handles).toContain("w");
    expect(handles).toContain("e");
    for (const corner of CORNER_HANDLES) expect(handles).toContain(corner);
  });

  it("gives a hairline object a usable pointer target without changing artwork", () => {
    // A 2px rule at 50% zoom is 1 screen pixel: unhittable in practice.
    const extents = resolveHitExtents(600, 2, 0.5);
    expect(extents.height).toBeGreaterThan(2);
    expect(extents.width).toBe(600);
    // A normal object is untouched.
    expect(resolveHitExtents(600, 400, 1)).toEqual({ width: 600, height: 400 });
  });
});

/* ========================================================================== */
/* Gesture mathematics (spec §14, §18, §19, §40)                              */
/* ========================================================================== */

describe("gesture mathematics", () => {
  const start = { x: 100, y: 100, width: 200, height: 100 };

  it("anchors a resize to the opposite edge", () => {
    // Dragging the east handle right by 50 must leave the west edge alone.
    const east = resolveResize({ handle: "e", start, dx: 50, dy: 0 });
    expect(east.width).toBe(250);
    expect(east.x - east.width / 2).toBe(0); // left edge unchanged

    const west = resolveResize({ handle: "w", start, dx: -50, dy: 0 });
    expect(west.width).toBe(250);
    expect(west.x + west.width / 2).toBe(200); // right edge unchanged
  });

  it("keeps the aspect ratio when asked", () => {
    const scaled = resolveResize({ handle: "se", start, dx: 100, dy: 0, preserveAspect: true });
    expect(scaled.width / scaled.height).toBeCloseTo(start.width / start.height, 5);
  });

  it("never resizes below the minimum", () => {
    const collapsed = resolveResize({ handle: "e", start, dx: -1000, dy: 0 });
    expect(collapsed.width).toBeGreaterThanOrEqual(MIN_OBJECT_SIZE);
  });

  it("resizes along the object's own axes when it is rotated", () => {
    // A 90-degree object dragged DOWN on screen is dragged along its own +x.
    const local = toLocalDelta(0, 50, 90);
    expect(local.dx).toBeCloseTo(50, 6);
    expect(local.dy).toBeCloseTo(0, 6);
    // Unrotated objects pass straight through.
    expect(toLocalDelta(10, -4, 0)).toEqual({ dx: 10, dy: -4 });
  });

  it("converts a delta measured on a rotated product surface", () => {
    // The surface is rotated +90, so undoing it rotates the delta by -90: a
    // rightward drag on screen is an upward move in the document. Same
    // convention as `clientPointToDocument`, which inverse-rotates the pointer.
    const converted = fromSurfaceDelta(10, 0, 90);
    expect(converted.dx).toBeCloseTo(0, 6);
    expect(converted.dy).toBeCloseTo(-10, 6);
    // An unrotated surface passes the delta straight through.
    expect(fromSurfaceDelta(10, -4, 0)).toEqual({ dx: 10, dy: -4 });
  });

  it("slides a box back inside bounds without shrinking it", () => {
    const bounds = { left: 0, top: 0, right: 100, bottom: 100 };
    expect(clampBoxIntoBounds({ left: -20, top: 10, right: 30, bottom: 60 }, bounds)).toEqual({
      left: 0,
      top: 10,
      right: 50,
      bottom: 60,
    });
    // A box wider than the bounds is left alone on that axis rather than being
    // silently shrunk — cropping artwork to fit would be the worse outcome.
    const oversized = clampBoxIntoBounds({ left: -50, top: 0, right: 200, bottom: 100 }, bounds);
    expect(oversized.right - oversized.left).toBe(250);
  });

  it("reads the rotation handle as 0 when it points straight up", () => {
    // The handle sits ABOVE the object.
    expect(resolveRotation({ pointerX: 0, pointerY: -100, pivotX: 0, pivotY: 0 })).toBe(0);
    expect(resolveRotation({ pointerX: 100, pointerY: 0, pivotX: 0, pivotY: 0 })).toBe(90);
  });

  it("snaps rotation to 15 degree steps unless free rotation is held", () => {
    // 2 degrees off a step: snaps.
    const nearly = resolveRotation({ pointerX: 100, pointerY: -3, pivotX: 0, pivotY: 0 });
    expect(nearly % 15).toBe(0);
    // Far from a step: left where it is.
    const free = resolveRotation({ pointerX: 100, pointerY: -100, pivotX: 0, pivotY: 0 });
    expect(free).toBe(45);
    const unsnapped = resolveRotation({
      pointerX: 100,
      pointerY: -3,
      pivotX: 0,
      pivotY: 0,
      freeRotation: true,
    });
    expect(unsnapped % 15).not.toBe(0);
  });

  it("rotates a point about a pivot", () => {
    const point = rotatePoint(10, 0, 0, 0, 90);
    expect(point.x).toBeCloseTo(0, 6);
    expect(point.y).toBeCloseTo(10, 6);
  });

  it("scales a multi selection about its combined box, preserving arrangement", () => {
    const members = [
      { id: "a", x: 100, y: 100, width: 100, height: 100 },
      { id: "b", x: 300, y: 100, width: 100, height: 100 },
    ];
    const result = resolveMultiResize({
      handle: "e",
      startBounds: { left: 50, top: 50, right: 350, bottom: 150, width: 300, height: 100 },
      dx: 300,
      dy: 0,
      members,
    });
    // The box doubled in width, so the gap between the two members doubled too.
    expect(result[1].x - result[0].x).toBe(400);
    expect(result[0].width).toBe(200);
    // The anchored (west) edge did not move.
    expect(result[0].x - result[0].width / 2).toBe(50);
  });

  it("lets the caller constrain each member during a multi resize", () => {
    const result = resolveMultiResize({
      handle: "e",
      startBounds: { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 },
      dx: -50,
      dy: 0,
      members: [{ id: "text", x: 50, y: 50, width: 100, height: 100 }],
      // Stand-in for the text engine's minimum wrap width.
      constrain: (_member, width, height) => ({ width: Math.max(80, width), height }),
    });
    expect(result[0].width).toBe(80);
  });

  it("rotates a multi selection as one rigid body", () => {
    const result = resolveMultiRotate({
      members: [
        { id: "a", x: 100, y: 0, width: 10, height: 10, rotation: 0 },
        { id: "b", x: 0, y: 100, width: 10, height: 10, rotation: 30 },
      ],
      pivotX: 0,
      pivotY: 0,
      deltaDegrees: 90,
      freeRotation: true,
    });
    // Each member orbits the pivot AND spins by the same delta.
    expect(result[0]).toMatchObject({ x: 0, y: 100, rotation: 90 });
    expect(result[1]).toMatchObject({ x: -100, y: 0, rotation: 120 });
  });

  it("moves followers by the SNAPPED delta so spacing cannot drift", () => {
    const members = [
      { id: "lead", x: 100, y: 100, width: 10, height: 10 },
      { id: "follower", x: 200, y: 100, width: 10, height: 10 },
    ];
    // The lead was dragged to 137 but snapped to 140.
    const result = applySelectionDelta(members, "lead", 140, 100, 100, 100);
    expect(result[0]).toEqual({ id: "lead", x: 140, y: 100 });
    // The follower takes +40, not the raw pointer delta — the gap stays 100.
    expect(result[1]).toEqual({ id: "follower", x: 240, y: 100 });
  });

  it("nudges with the arrow keys, further with Shift", () => {
    expect(resolveNudge("ArrowLeft", false)).toEqual({ dx: -1, dy: 0 });
    expect(resolveNudge("ArrowDown", true)).toEqual({ dx: 0, dy: 10 });
    expect(resolveNudge("Enter", false)).toBeNull();
  });
});

/* ========================================================================== */
/* Hit testing (spec §29)                                                     */
/* ========================================================================== */

describe("hit testing", () => {
  const layers = [
    { id: "back", type: "shape", x: 100, y: 100, width: 200, height: 200 },
    { id: "front", type: "shape", x: 100, y: 100, width: 100, height: 100 },
    { id: "hidden", type: "shape", x: 100, y: 100, width: 400, height: 400, hidden: true },
  ];

  it("returns the object the eye sees, not the first in the array", () => {
    expect(hitTestPoint(100, 100, layers)?.id).toBe("front");
    // Outside the front object, the one behind it takes the click.
    expect(hitTestPoint(180, 180, layers)?.id).toBe("back");
    expect(hitTestPoint(1000, 1000, layers)).toBeNull();
  });

  it("never targets hidden or interaction-disabled objects", () => {
    expect(isTargetable({ id: "h", x: 0, y: 0, width: 10, height: 10, hidden: true })).toBe(false);
    expect(
      isTargetable({ id: "d", x: 0, y: 0, width: 10, height: 10, interactionDisabled: true }),
    ).toBe(false);
    expect(hitTestPoint(100, 100, layers)?.id).not.toBe("hidden");
  });

  it("restricts targeting to the entered group's members", () => {
    const grouped = [
      { id: "g", type: "group", x: 100, y: 100, width: 200, height: 200 },
      { id: "member", type: "shape", x: 100, y: 100, width: 50, height: 50, groupId: "g" },
    ];
    // Outside the group, the member is not a target; the group is.
    expect(isTargetable(grouped[1], { editingGroupId: null })).toBe(false);
    expect(isTargetable(grouped[0], { editingGroupId: null })).toBe(true);
    // Inside it, the roles swap.
    expect(isTargetable(grouped[1], { editingGroupId: "g" })).toBe(true);
    expect(isTargetable(grouped[0], { editingGroupId: "g" })).toBe(false);
  });

  it("resolves a click on a nested member to the outermost group not entered", () => {
    const nested = [
      { id: "outer", type: "group", x: 0, y: 0, width: 100, height: 100 },
      { id: "inner", type: "group", x: 0, y: 0, width: 50, height: 50, groupId: "outer" },
      { id: "leaf", type: "shape", x: 0, y: 0, width: 10, height: 10, groupId: "inner" },
    ];
    expect(resolveSelectionTarget("leaf", nested, null)).toBe("outer");
    expect(resolveSelectionTarget("leaf", nested, "outer")).toBe("inner");
    expect(resolveSelectionTarget("leaf", nested, "inner")).toBe("leaf");
    expect(resolveSelectionTarget("missing", nested, null)).toBeNull();
  });

  it("survives a corrupt parent cycle rather than hanging", () => {
    const cyclic = [
      { id: "a", type: "group", x: 0, y: 0, width: 10, height: 10, groupId: "b" },
      { id: "b", type: "group", x: 0, y: 0, width: 10, height: 10, groupId: "a" },
    ];
    expect(() => resolveSelectionTarget("a", cyclic, null)).not.toThrow();
  });

  it("applies the same targeting policy to a marquee as to a click", () => {
    const found = hitTestMarquee({ left: 0, top: 0, right: 400, bottom: 400 }, layers);
    expect(found).toContain("front");
    expect(found).toContain("back");
    expect(found).not.toContain("hidden");
  });
});

/* ========================================================================== */
/* Node identity (spec §51)                                                   */
/* ========================================================================== */

describe("node identity", () => {
  it("keys interaction nodes on the Husnalogy layer id", () => {
    expect(layerNodeId("layer_7")).toBe("layer_7");
    expect(parseNodeId("layer_7")).toEqual({ kind: "layer", layerId: "layer_7" });
  });

  it("gives grid slots a deterministic composite id", () => {
    const id = gridSlotNodeId("grid_1", "slot_3");
    expect(parseNodeId(id)).toEqual({ kind: "grid-slot", layerId: "grid_1", slotId: "slot_3" });
    expect(owningLayerId(id)).toBe("grid_1");
    // Stable across calls, so React keys and Konva nodes stay attached.
    expect(gridSlotNodeId("grid_1", "slot_3")).toBe(id);
  });

  it("rejects malformed ids instead of inventing an object", () => {
    expect(parseNodeId("")).toBeNull();
    expect(parseNodeId("::slot")).toBeNull();
    expect(parseNodeId("grid::")).toBeNull();
    expect(owningLayerId("")).toBeNull();
  });
});

/* ========================================================================== */
/* Tool modes and pointer priority (spec §37, §44)                            */
/* ========================================================================== */

describe("tool state machine", () => {
  it("returns to Select after a one-shot creation (spec §22)", () => {
    let state = toolReducer(INITIAL_TOOL_STATE, { type: "requestTextCreate" });
    expect(state.mode).toBe("text-create");
    state = toolReducer(state, { type: "objectCreated" });
    expect(state.mode).toBe("select");
    // Clicking elsewhere therefore cannot create a second object.
    expect(toolReducer(state, { type: "objectCreated" }).mode).toBe("select");
  });

  it("keeps a deliberately persistent creation tool armed", () => {
    let state = toolReducer(INITIAL_TOOL_STATE, { type: "requestTextCreate", persistent: true });
    state = toolReducer(state, { type: "objectCreated" });
    expect(state.mode).toBe("text-create");
  });

  it("resumes crop after a transform that started inside it", () => {
    let state = toolReducer(INITIAL_TOOL_STATE, { type: "beginCrop" });
    state = toolReducer(state, { type: "beginTransform" });
    expect(state.mode).toBe("transform");
    state = toolReducer(state, { type: "gestureEnd" });
    // Back to crop, not to Select: the customer never left crop mode.
    expect(state.mode).toBe("crop");
    expect(toolReducer(state, { type: "endCrop" }).mode).toBe("select");
  });

  it("restores the interrupted mode when pan is released", () => {
    const panned = toolReducer(INITIAL_TOOL_STATE, { type: "setPan", active: true });
    expect(panned.mode).toBe("pan");
    expect(toolReducer(panned, { type: "setPan", active: false }).mode).toBe("select");
    // Toggling is symmetric.
    expect(toolReducer(toolReducer(INITIAL_TOOL_STATE, { type: "togglePan" }), { type: "togglePan" }).mode)
      .toBe("select");
  });

  it("only starts a marquee from the resting mode", () => {
    expect(toolReducer(INITIAL_TOOL_STATE, { type: "beginMarquee" }).mode).toBe("marquee");
    const cropping = toolReducer(INITIAL_TOOL_STATE, { type: "beginCrop" });
    expect(toolReducer(cropping, { type: "beginMarquee" }).mode).toBe("crop");
  });

  it("escapes to the resting state and disarms any creation tool", () => {
    const armed = toolReducer(INITIAL_TOOL_STATE, { type: "requestTextCreate", persistent: true });
    const escaped = toolReducer(armed, { type: "escape" });
    expect(escaped.mode).toBe("select");
    expect(escaped.persistentCreate).toBe(false);
  });

  it("knows which modes are live gestures", () => {
    expect(isTransientMode("marquee")).toBe(true);
    expect(isTransientMode("transform")).toBe(true);
    expect(isTransientMode("select")).toBe(false);
    expect(isTransientMode("crop")).toBe(false);
  });
});

describe("pointer priority", () => {
  it("gives a pinch the pointer over everything else", () => {
    expect(resolvePointerOwner({ tool: "select", pinching: true, onObject: true, onHandle: true })).toBe(
      "pinch",
    );
  });

  it("orders the modal editing sessions above plain objects", () => {
    expect(resolvePointerOwner({ tool: "text-edit", onObject: true })).toBe("text-editor");
    expect(resolvePointerOwner({ tool: "crop", onObject: true })).toBe("crop");
    expect(resolvePointerOwner({ tool: "grid-slot-edit", onObject: true })).toBe("grid-slot");
    expect(resolvePointerOwner({ tool: "select", panModifier: true, onObject: true })).toBe("pan");
  });

  it("puts transform handles above the object underneath them", () => {
    expect(resolvePointerOwner({ tool: "select", onHandle: true, onObject: true })).toBe("transform");
  });

  it("starts a marquee only from empty design space", () => {
    expect(resolvePointerOwner({ tool: "select" })).toBe("marquee");
    expect(resolvePointerOwner({ tool: "select", onObject: true })).toBe("object");
    // Never from inside a modal session.
    expect(resolvePointerOwner({ tool: "crop" })).toBe("crop");
  });

  it("hands the keyboard to the text editor while it is open", () => {
    expect(canvasOwnsKeyboard("select", false)).toBe(true);
    expect(canvasOwnsKeyboard("select", true)).toBe(false);
    expect(canvasOwnsKeyboard("text-edit", false)).toBe(false);
  });
});

/* ========================================================================== */
/* Transient preview (spec §9, §49)                                           */
/* ========================================================================== */

describe("transient gesture preview", () => {
  it("expresses a drag as a plain translation", () => {
    expect(transientTransformString({ dx: 10, dy: -5 })).toBe("translate(10 -5)");
    // A no-op gesture produces no attribute at all.
    expect(transientTransformString({ dx: 0, dy: 0 })).toBe("");
    expect(transientTransformString({})).toBe("");
  });

  it("replaces the rotation the renderer already baked in, never doubling it", () => {
    // The layer is drawn at 30 degrees; previewing 45 must add only 15.
    expect(transientTransformString({ rotation: 45, baseRotation: 30, pivotX: 100, pivotY: 200 })).toBe(
      "rotate(15 100 200)",
    );
    // Previewing the angle it already has changes nothing.
    expect(transientTransformString({ rotation: 30, baseRotation: 30 })).toBe("");
  });

  it("composes translation and rotation in one attribute", () => {
    expect(transientTransformString({ dx: 5, dy: 5, rotation: 90, baseRotation: 0, pivotX: 0, pivotY: 0 }))
      .toBe("translate(5 5) rotate(90 0 0)");
  });

  it("coalesces gesture work to one call per frame", async () => {
    const scheduler = createFrameScheduler();
    let runs = 0;
    // Three events inside one frame must do the work once, with the LAST value.
    let seen = 0;
    for (const value of [1, 2, 3]) {
      scheduler.schedule(() => {
        runs += 1;
        seen = value;
      });
    }
    scheduler.flush();
    expect(runs).toBe(1);
    expect(seen).toBe(3);
  });

  it("drops queued work when a gesture is cancelled", () => {
    const scheduler = createFrameScheduler();
    let ran = false;
    scheduler.schedule(() => {
      ran = true;
    });
    scheduler.cancel();
    scheduler.flush();
    expect(ran).toBe(false);
  });
});

/* ========================================================================== */
/* Transient resize preview (spec §4)                                         */
/* ========================================================================== */

describe("transient resize preview", () => {
  it("scales about the object's centre", () => {
    // An unrotated box scaled 2x horizontally about (100, 50).
    expect(
      transientTransformString({ scaleX: 2, scaleY: 1, pivotX: 100, pivotY: 50 }),
    ).toBe("translate(100 50) scale(2 1) translate(-100 -50)");
  });

  it("un-rotates before scaling so a rotated box resizes along its OWN axes", () => {
    // The renderer has already baked the layer's 30 degrees into its children.
    // Scaling on top of that would shear the object; the sandwich removes the
    // rotation, scales in the object's frame, then puts the rotation back.
    const result = transientTransformString({
      scaleX: 1.5,
      scaleY: 1,
      pivotX: 0,
      pivotY: 0,
      baseRotation: 30,
    });
    expect(result).toBe("rotate(30 0 0) translate(0 0) scale(1.5 1) translate(0 0) rotate(-30 0 0)");
  });

  it("carries the new angle when a rotation happens during the same gesture", () => {
    const result = transientTransformString({
      scaleX: 2,
      scaleY: 2,
      rotation: 45,
      baseRotation: 30,
      pivotX: 10,
      pivotY: 20,
    });
    // The outer rotation is the ABSOLUTE new angle (45), not the delta, because
    // the inner term has already removed the base.
    expect(result.startsWith("rotate(45 10 20)")).toBe(true);
    expect(result.endsWith("rotate(-30 10 20)")).toBe(true);
  });

  it("treats a scale of 1 as no scale at all, so a pure drag stays one term", () => {
    expect(transientTransformString({ dx: 5, dy: 5, scaleX: 1, scaleY: 1 })).toBe("translate(5 5)");
    // Floating-point noise from a pointer must not produce a scale term either.
    expect(transientTransformString({ dx: 0, dy: 0, scaleX: 1.00001, scaleY: 0.99999 })).toBe("");
  });

  it("composes translation with a resize", () => {
    const result = transientTransformString({ dx: 7, dy: -3, scaleX: 2, scaleY: 2, pivotX: 0, pivotY: 0 });
    expect(result.startsWith("translate(7 -3)")).toBe(true);
    expect(result).toContain("scale(2 2)");
  });
});
