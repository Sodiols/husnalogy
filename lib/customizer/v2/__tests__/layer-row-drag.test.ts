import { describe, expect, it } from "vitest";
import { planLayerRowDrag, resolveLayerRowDrop } from "../interaction/layer-row-drag";

// Rows 60px tall with a 6px gap: tops at 0, 66, 132, ...
const rect = (index: number) => ({ top: index * 66, bottom: index * 66 + 60 });
const row = (id: string, depth = 0, groupId?: string) => ({ layer: { id, groupId }, depth });

describe("layer row drag", () => {
  const rows = [row("a"), row("b"), row("c"), row("d")];
  const rects = { a: rect(0), b: rect(1), c: rect(2), d: rect(3) };

  it("does not move until the row's centre passes a neighbour's centre", () => {
    const plan = planLayerRowDrag(rows, "a", rects)!;
    const view = resolveLayerRowDrop(plan, 20);
    expect(view.targetId).toBeNull();
    expect(view.shifts).toEqual({});
  });

  it("slides the rows it passes up by one slot and targets the last one passed", () => {
    const plan = planLayerRowDrag(rows, "a", rects)!;
    const view = resolveLayerRowDrop(plan, 140);
    expect(view.targetId).toBe("c");
    expect(view.shifts).toEqual({ b: -66, c: -66 });
  });

  it("slides rows down when dragging upward", () => {
    const plan = planLayerRowDrag(rows, "d", rects)!;
    const view = resolveLayerRowDrop(plan, -200);
    expect(view.targetId).toBe("a");
    expect(view.shifts).toEqual({ a: 66, b: 66, c: 66 });
  });

  it("clamps the drag to half a row beyond the list ends", () => {
    const plan = planLayerRowDrag(rows, "b", rects)!;
    expect(resolveLayerRowDrop(plan, 5000).dy).toBe(258 - 126 + 30);
    expect(resolveLayerRowDrop(plan, -5000).dy).toBe(-66 - 30);
  });

  it("moves an open group together with its children, and only among its siblings", () => {
    const grouped = [row("g"), row("g1", 1, "g"), row("g2", 1, "g"), row("x")];
    const groupedRects = { g: rect(0), g1: rect(1), g2: rect(2), x: rect(3) };
    const plan = planLayerRowDrag(grouped, "g", groupedRects)!;
    expect(plan.block).toEqual(["g", "g1", "g2"]);
    const view = resolveLayerRowDrop(plan, 200);
    expect(view.targetId).toBe("x");
    expect(view.shifts).toEqual({ x: -(192 + 6) });
  });

  it("a child only reorders inside its group", () => {
    const grouped = [row("g"), row("g1", 1, "g"), row("g2", 1, "g"), row("x")];
    const groupedRects = { g: rect(0), g1: rect(1), g2: rect(2), x: rect(3) };
    const plan = planLayerRowDrag(grouped, "g1", groupedRects)!;
    expect(plan.blocks.map((block) => block.ownerId)).toEqual(["g1", "g2"]);
    expect(resolveLayerRowDrop(plan, 500).targetId).toBe("g2");
  });

  it("refuses a drag with nothing to reorder against", () => {
    expect(planLayerRowDrag([row("only")], "only", { only: rect(0) })).toBeNull();
  });
});
