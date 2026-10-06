import { describe, expect, it } from "vitest";
import { selectionTargetAt } from "../interaction/hit-test";

const nodes = [
  { id: "background", x: 500, y: 500, width: 1000, height: 1000, capabilities: { selectable: false } },
  { id: "title", x: 500, y: 200, width: 600, height: 100, capabilities: { selectable: true } },
  { id: "badge", x: 500, y: 220, width: 100, height: 100, capabilities: { selectable: true } },
  { id: "group", x: 500, y: 700, width: 400, height: 200, type: "group", capabilities: { selectable: true } },
  { id: "member", x: 400, y: 700, width: 100, height: 100, groupId: "group", capabilities: { selectable: true } },
  { id: "ghost", x: 900, y: 900, width: 100, height: 100, hidden: true, capabilities: { selectable: true } },
];

describe("selectionTargetAt — what a press selects while the stage is not listening", () => {
  it("returns the top-most selectable object (later = drawn on top)", () => {
    expect(selectionTargetAt(500, 220, nodes)).toBe("badge");
    expect(selectionTargetAt(300, 200, nodes)).toBe("title");
  });

  it("never returns an object that is not selectable or hidden — that is empty canvas", () => {
    expect(selectionTargetAt(50, 50, nodes)).toBeNull();
    expect(selectionTargetAt(900, 900, nodes)).toBeNull();
  });

  it("resolves a group member to its group, unless the group has been entered", () => {
    expect(selectionTargetAt(400, 700, nodes)).toBe("group");
    expect(selectionTargetAt(400, 700, nodes, { editingGroupId: "group" })).toBe("member");
  });

  it("respects rotation", () => {
    const rotated = [{ id: "bar", x: 500, y: 500, width: 400, height: 40, rotation: 90, capabilities: { selectable: true } }];
    expect(selectionTargetAt(500, 680, rotated)).toBe("bar");
    expect(selectionTargetAt(680, 500, rotated)).toBeNull();
  });
});
