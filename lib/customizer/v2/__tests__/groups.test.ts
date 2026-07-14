import { describe, expect, it } from "vitest";
import { getAbsoluteTransform, getRelativeTransform, groupLayers, resolveGroupBounds, transformGroupChildren, ungroupLayers, validateGroupRelationships } from "../groups";
import { buildPageSvg } from "../svg";

const layer = (id: string, x: number, y: number, width = 100, height = 80) => ({ id, name: id, page: "front", pageId: "front", type: "shape", shape: "rectangle", x, y, width, height, rotation: 0, opacity: 1, zIndex: 2, fill: "#303839", hidden: false });

describe("persistent grouping engine", () => {
  it("groups and ungroups without changing apparent child coordinates", () => {
    const original = [layer("a", 100, 120), layer("b", 300, 260)];
    const grouped = groupLayers(original, ["a", "b"], "g1");
    const group: any = grouped.find((item) => item.id === "g1");
    expect(group.childIds).toEqual(["a", "b"]);
    expect(grouped.find((item) => item.id === "a")?.x).toBe(100);
    const restored = ungroupLayers(grouped, "g1");
    expect(restored.map((item) => [item.id, item.x, item.y])).toEqual(original.map((item) => [item.id, item.x, item.y]));
  });

  it("supports nested groups and transforms every descendant proportionally", () => {
    let layers: any[] = groupLayers([layer("a", 100, 100), layer("b", 300, 100), layer("c", 500, 300)], ["a", "b"], "inner");
    layers = groupLayers(layers, ["inner", "c"], "outer");
    expect(layers.find((item) => item.id === "inner")?.groupId).toBe("outer");
    const outer: any = layers.find((item) => item.id === "outer");
    const beforeA: any = layers.find((item) => item.id === "a");
    const moved = transformGroupChildren(layers, "outer", { x: outer.x + 50, y: outer.y + 20, width: outer.width * 2, rotation: 90 });
    const afterA: any = moved.find((item) => item.id === "a");
    expect(afterA.width).toBeCloseTo(beforeA.width * 2);
    expect(afterA.rotation).toBe(90);
    expect(afterA.x).not.toBe(beforeA.x);
    expect((moved.find((item) => item.id === "outer") as any).height).toBeCloseTo(outer.height * 2);
  });

  it("converts between group-local and canvas coordinates", () => {
    const group = { x: 500, y: 400, width: 300, height: 300, rotation: 35 };
    const child = { x: 610, y: 460, width: 90, height: 50, rotation: 70 };
    const relative = getRelativeTransform(child, group);
    const absolute = getAbsoluteTransform(relative, group);
    expect(absolute.x).toBeCloseTo(child.x, 6);
    expect(absolute.y).toBeCloseTo(child.y, 6);
    expect(absolute.rotation).toBeCloseTo(child.rotation, 6);
  });

  it("uses rotated bounds and prevents recursive relationships", () => {
    const bounds = resolveGroupBounds([{ ...layer("a", 200, 200, 100, 40), rotation: 90 }]);
    expect(bounds?.width).toBeCloseTo(40);
    expect(bounds?.height).toBeCloseTo(100);
    const cyclic: any[] = [{ id: "g1", type: "group", groupId: "g2" }, { id: "g2", type: "group", groupId: "g1" }];
    expect(validateGroupRelationships(cyclic).map((issue) => issue.code)).toContain("INVALID_GROUP_CYCLE");
  });

  it("applies parent visibility and opacity while preserving child render order", () => {
    const template = {
      canvasWidthPx: 600, canvasHeightPx: 400, defaultPage: "front", pages: [{ id: "front", label: "Front", enabled: true }], fields: [], settings: {},
      layers: [
        { id: "g", name: "Group", page: "front", type: "group", childIds: ["a"], x: 200, y: 200, width: 100, height: 80, opacity: 0.5, zIndex: 1 },
        { ...layer("a", 200, 200), groupId: "g", opacity: 0.8, zIndex: 2 },
      ],
    };
    const svg = buildPageSvg({ template, values: {}, editorState: null, pageId: "front", mode: "print" });
    expect(svg).toContain('opacity="0.4"');
    expect(svg).toContain("<rect");
  });
});
