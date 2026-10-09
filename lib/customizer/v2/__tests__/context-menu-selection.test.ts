import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveContextMenuSelection, resolveSelectionTarget } from "../interaction/hit-test";

const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");
const node = (id: string, groupId: string | null = null) => ({ id, x: 0, y: 0, width: 10, height: 10, groupId });
// Outer group G holds inner group H (nested) and a shape; H holds two shapes.
const nodes = [node("A"), node("G"), node("H", "G"), node("h1", "H"), node("h2", "H"), node("g1", "G")];

describe("right click resolves exactly like left click", () => {
  it("a member resolves to its outermost group unless a group is entered", () => {
    for (const hit of ["h1", "h2", "g1", "H", "G"]) {
      expect(resolveContextMenuSelection(hit, nodes, []).targetId).toBe(resolveSelectionTarget(hit, nodes, null));
      expect(resolveContextMenuSelection(hit, nodes, []).targetId).toBe("G");
    }
    // Inside G: the nested group H is the target for its members.
    expect(resolveContextMenuSelection("h1", nodes, [], "G").targetId).toBe("H");
    // Inside H: the member itself.
    expect(resolveContextMenuSelection("h1", nodes, [], "H").targetId).toBe("h1");
    expect(resolveContextMenuSelection("A", nodes, []).targetId).toBe("A");
  });

  it("a target already selected keeps the whole selection; anything else becomes the selection", () => {
    expect(resolveContextMenuSelection("h2", nodes, ["A", "G"]).selection).toEqual(["A", "G"]);
    expect(resolveContextMenuSelection("A", nodes, ["A", "G"]).selection).toEqual(["A", "G"]);
    // The raw member is NOT what is selected (the reported defect).
    expect(resolveContextMenuSelection("h2", nodes, ["A"]).selection).toEqual(["G"]);
    expect(resolveContextMenuSelection("h2", nodes, ["h2"], "H").selection).toEqual(["h2"]);
  });

  it("an unknown or orphaned id falls back to itself", () => {
    expect(resolveContextMenuSelection("ghost", nodes, []).targetId).toBe("ghost");
    expect(resolveContextMenuSelection("x", [node("x", "missing")], []).targetId).toBe("x");
  });

  it("the shared stage uses it for both the right-button press and the menu event", () => {
    const stage = read("app/components/customizer/interaction/CustomizerInteractionStage.tsx");
    expect(stage).toContain("const next = resolveContextMenuSelection(node.id, nodes, selection, editingGroupId);");
    expect(stage).toContain("const { targetId } = resolveContextMenuSelection(node.id, nodes, selection, editingGroupId);");
    expect(stage).toContain("onContextMenuNode?.(targetId,");
    expect(stage).not.toContain("onContextMenuNode?.(node.id,");
    expect(stage).not.toMatch(/if \(!selection\.includes\(node\.id\)\) onSelectionChange\(\[node\.id\]\)/);
  });
});
