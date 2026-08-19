/**
 * Drag-to-reorder, shared by both Layers panels.
 *
 * These replace the admin ▲/▼ buttons, so the rules they encode — who may move
 * what, and which drops are refused — are now the only thing standing between a
 * stray drag and a restacked design.
 */

import { describe, expect, it } from "vitest";
import {
  ADMIN_REORDER_POLICY,
  isValidLayerDrop,
  reorderLayersByDrop,
  resolveDropEdge,
} from "../interaction/layer-reorder";
import { reorderLayerByDrop } from "../customer-actions";

const OPEN = { canMove: () => true, canCross: () => true };

const stack = () => [
  { id: "a", zIndex: 1 },
  { id: "b", zIndex: 2 },
  { id: "c", zIndex: 3 },
  { id: "d", zIndex: 4 },
];

describe("reorderLayersByDrop", () => {
  it("moves a layer up the stack and renumbers densely", () => {
    const result = reorderLayersByDrop(stack(), "a", "c", OPEN);
    expect(result.map((layer) => layer.id)).toEqual(["b", "c", "a", "d"]);
    expect(result.map((layer) => layer.zIndex)).toEqual([1, 2, 3, 4]);
  });

  it("moves a layer down the stack", () => {
    expect(reorderLayersByDrop(stack(), "d", "b", OPEN).map((layer) => layer.id)).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
  });

  it("returns the ORIGINAL array when nothing moves, so no history is taken", () => {
    const layers = stack();
    expect(reorderLayersByDrop(layers, "a", "a", OPEN)).toBe(layers);
    expect(reorderLayersByDrop(layers, "a", "missing", OPEN)).toBe(layers);
    expect(reorderLayersByDrop(layers, "", "b", OPEN)).toBe(layers);
  });

  it("refuses to move a layer the policy will not pick up", () => {
    const layers = stack();
    const policy = { canMove: (layer: any) => layer.id !== "a", canCross: () => true };
    expect(reorderLayersByDrop(layers, "a", "c", policy)).toBe(layers);
  });

  it("refuses to JUMP a layer the policy will not reorder", () => {
    // Dropping `a` past a locked `b` would silently restack `b` too.
    const layers = stack();
    const policy = { canMove: () => true, canCross: (layer: any) => layer.id !== "b" };
    expect(reorderLayersByDrop(layers, "a", "c", policy)).toBe(layers);
    // A move that never crosses it is still fine.
    expect(reorderLayersByDrop(layers, "c", "d", policy).map((l) => l.id)).toEqual(["a", "b", "d", "c"]);
  });

  it("uses admin policy: locked and non-editable layers are immovable", () => {
    const layers = [
      { id: "a", zIndex: 1 },
      { id: "locked", zIndex: 2, locked: true },
      { id: "readonly", zIndex: 3, adminEditable: false },
    ];
    expect(reorderLayersByDrop(layers, "locked", "a", ADMIN_REORDER_POLICY)).toBe(layers);
    expect(reorderLayersByDrop(layers, "readonly", "a", ADMIN_REORDER_POLICY)).toBe(layers);
  });
});

describe("isValidLayerDrop", () => {
  const layers = [
    { id: "root1" },
    { id: "root2" },
    { id: "group", type: "group" },
    { id: "child1", groupId: "group" },
    { id: "child2", groupId: "group" },
  ];

  it("allows a drop between siblings", () => {
    expect(isValidLayerDrop(layers, "root1", "root2")).toBe(true);
    expect(isValidLayerDrop(layers, "child1", "child2")).toBe(true);
  });

  it("refuses a drop that would cross a group boundary", () => {
    // Re-parenting is a different operation with different geometry
    // consequences, so a plain drag must not half-perform it.
    expect(isValidLayerDrop(layers, "child1", "root1")).toBe(false);
    expect(isValidLayerDrop(layers, "root1", "child1")).toBe(false);
  });

  it("refuses dropping a group inside itself", () => {
    const nested = [
      { id: "outer", type: "group" },
      { id: "inner", type: "group", groupId: "outer" },
    ];
    expect(isValidLayerDrop(nested, "outer", "inner")).toBe(false);
  });

  it("refuses degenerate drops", () => {
    expect(isValidLayerDrop(layers, "root1", "root1")).toBe(false);
    expect(isValidLayerDrop(layers, "root1", "missing")).toBe(false);
    expect(isValidLayerDrop(layers, "", "root1")).toBe(false);
  });

  it("does not hang on a corrupt parent cycle", () => {
    const cyclic = [
      { id: "a", type: "group", groupId: "b" },
      { id: "b", type: "group", groupId: "a" },
    ];
    expect(() => isValidLayerDrop(cyclic, "a", "b")).not.toThrow();
  });
});

describe("resolveDropEdge", () => {
  it("reads the edge from where the pointer is inside the row", () => {
    expect(resolveDropEdge(105, 100, 40)).toBe("before");
    expect(resolveDropEdge(135, 100, 40)).toBe("after");
    // Exactly halfway counts as the lower half.
    expect(resolveDropEdge(120, 100, 40)).toBe("after");
  });

  it("degrades safely on a zero-height row", () => {
    expect(resolveDropEdge(10, 0, 0)).toBe("before");
  });
});

describe("customer reorder keeps its own permission rules", () => {
  it("moves a customer's own layer", () => {
    const layers = [
      { id: "a", zIndex: 1, isUserLayer: true },
      { id: "b", zIndex: 2, isUserLayer: true },
    ];
    expect(reorderLayerByDrop(layers, "a", "b").map((l) => l.id)).toEqual(["b", "a"]);
  });

  it("refuses a template layer the admin did not make reorderable", () => {
    const layers = [
      { id: "fixed", zIndex: 1 },
      { id: "mine", zIndex: 2, isUserLayer: true },
    ];
    expect(reorderLayerByDrop(layers, "fixed", "mine")).toBe(layers);
  });

  it("refuses to jump an interaction-disabled layer", () => {
    const layers = [
      { id: "a", zIndex: 1, isUserLayer: true },
      { id: "blocked", zIndex: 2, customerEditable: true, customerInteractionDisabled: true },
      { id: "c", zIndex: 3, isUserLayer: true },
    ];
    expect(reorderLayerByDrop(layers, "a", "c")).toBe(layers);
  });
});
