import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evaluateGroupAction,
  getDescendantIds,
  getRenderableLayers,
  groupLayers,
  resolveGroupBounds,
  transformGroupChildren,
  ungroupLayers,
  validateGroupRelationships,
} from "../groups";
import { buildLayerRows } from "@/app/admin/dashboard/design-builder/AdminLayersPanel";
import {
  alignLayers,
  duplicateLayer,
  moveLayers,
  removeLayer,
} from "@/app/admin/dashboard/design-builder/builder-utils";
import { planTextToolbar } from "../text-toolbar";

const read = (relative: string) => readFileSync(relative, "utf8");
const adminToolbar = read("app/admin/dashboard/design-builder/AdminContextToolbar.tsx");
const adminBuilder = read("app/admin/dashboard/design-builder/AdminDesignBuilder.tsx");
const layersPanel = read("app/admin/dashboard/design-builder/AdminLayersPanel.tsx");
const customerToolbar = read("app/components/customizer/CustomerGroupToolbar.tsx");
const customerClient = read("app/products/[slug]/personalize/personalize-client.tsx");

const box = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  type: "shape",
  page: "front",
  x,
  y,
  width: 100,
  height: 60,
  rotation: 0,
  opacity: 1,
  zIndex: 1,
  ...extra,
});

/** Only the properties a group operation must never touch. */
const visual = (layer: any) => ({
  id: layer.id,
  x: layer.x,
  y: layer.y,
  width: layer.width,
  height: layer.height,
  rotation: layer.rotation,
  opacity: layer.opacity,
});

/* ------------------------------------------------------ selection rules --- */

describe("grouping — when the action is offered", () => {
  it("enables Group for two or more compatible objects", () => {
    const layers = [box("a", 100, 100), box("b", 300, 100)];
    const state = evaluateGroupAction(layers, ["a", "b"]);
    expect(state.group.enabled).toBe(true);
    expect(state.group.reason).toContain("2");
  });

  it("does not enable Group for a single object, and explains why", () => {
    const layers = [box("a", 100, 100)];
    const state = evaluateGroupAction(layers, ["a"]);
    expect(state.group.enabled).toBe(false);
    expect(state.group.reason).toContain("at least two");
  });

  it("rejects objects that live on different pages", () => {
    const layers = [box("a", 100, 100), box("b", 300, 100, { page: "back" })];
    const state = evaluateGroupAction(layers, ["a", "b"]);
    expect(state.group.enabled).toBe(false);
    expect(state.group.reason).toContain("different pages");
    // The engine refuses too, so a bypassed button still cannot corrupt the doc.
    expect(groupLayers(layers, ["a", "b"], "g1")).toBe(layers);
  });

  it("rejects a locked object and names it", () => {
    const layers = [box("a", 100, 100), box("b", 300, 100, { locked: true, name: "Crest" })];
    const state = evaluateGroupAction(layers, ["a", "b"]);
    expect(state.group.enabled).toBe(false);
    expect(state.group.reason).toContain("Crest");
    expect(state.group.reason).toContain("locked");
  });

  it("rejects the page background", () => {
    const layers = [box("a", 100, 100), box("bg", 300, 100, { type: "background" })];
    expect(evaluateGroupAction(layers, ["a", "bg"]).group.enabled).toBe(false);
  });

  it("rejects a group selected together with its own child", () => {
    const layers = [box("child", 100, 100, { groupId: "g1" }), box("other", 300, 100), { ...box("g1", 200, 100), type: "group", childIds: ["child"] }];
    expect(evaluateGroupAction(layers, ["g1", "child"]).group.enabled).toBe(false);
  });

  it("honours a caller-supplied veto, such as a customer permission", () => {
    const layers = [box("a", 100, 100), box("b", 300, 100, { name: "Monogram" })];
    const state = evaluateGroupAction(layers, ["a", "b"], {
      blockedReason: (layer) => (layer.id === "b" ? `"${layer.name}" cannot be grouped in this design.` : null),
    });
    expect(state.group.enabled).toBe(false);
    expect(state.group.reason).toContain("Monogram");
  });

  it("hides grouping entirely when the template forbids it", () => {
    const layers = [box("a", 100, 100), box("b", 300, 100)];
    const state = evaluateGroupAction(layers, ["a", "b"], { groupingAllowed: false });
    expect(state.group.enabled).toBe(false);
    expect(state.group.reason).toContain("turned off");
  });

  it("enables Ungroup only for one selected group", () => {
    const layers = [box("child", 100, 100, { groupId: "g1" }), { ...box("g1", 100, 100), type: "group", name: "Crest", childIds: ["child"] }];
    expect(evaluateGroupAction(layers, ["g1"]).ungroup.enabled).toBe(true);
    expect(evaluateGroupAction(layers, ["child"]).ungroup.enabled).toBe(false);
    expect(evaluateGroupAction(layers, ["child"]).ungroup.reason).toContain("not a group");
    expect(evaluateGroupAction(layers, []).ungroup.reason).toContain("Select one group");
  });

  it("refuses to ungroup a locked group", () => {
    const layers = [box("child", 100, 100, { groupId: "g1" }), { ...box("g1", 100, 100), type: "group", name: "Crest", locked: true, childIds: ["child"] }];
    expect(evaluateGroupAction(layers, ["g1"]).ungroup.enabled).toBe(false);
  });
});

/* ---------------------------------------------------------- group create -- */

describe("grouping — creating a group", () => {
  const layers = [box("a", 100, 100), box("b", 400, 300, { rotation: 45 }), box("c", 250, 200)];

  it("creates exactly one group containing every selected object", () => {
    const grouped = groupLayers(layers, ["a", "b", "c"], "g1");
    const groups = grouped.filter((layer) => layer.type === "group");
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("g1");
    expect(groups[0].childIds).toEqual(["a", "b", "c"]);
    expect(getDescendantIds(grouped, "g1").sort()).toEqual(["a", "b", "c"]);
  });

  it("preserves every child identifier and its exact visual box", () => {
    const grouped = groupLayers(layers, ["a", "b", "c"], "g1");
    for (const original of layers) {
      const after = grouped.find((layer) => layer.id === original.id);
      expect(after).toBeDefined();
      expect(visual(after)).toEqual(visual(original));
    }
  });

  it("preserves child order, page ownership, styling and field bindings", () => {
    const rich = [
      box("t", 100, 100, { type: "text", text: "Hello", textStyle: { fontSize: 48, letterSpacing: 2 }, fieldId: "field_1", customerEditable: true, zIndex: 3 }),
      box("i", 300, 100, { type: "image", crop: { x: 0.1, y: 0.2, scale: 1.4 }, zIndex: 7 }),
    ];
    const grouped = groupLayers(rich, ["t", "i"], "g1");
    const text = grouped.find((layer) => layer.id === "t");
    const image = grouped.find((layer) => layer.id === "i");
    expect(text.textStyle).toEqual({ fontSize: 48, letterSpacing: 2 });
    expect(text.fieldId).toBe("field_1");
    expect(text.customerEditable).toBe(true);
    expect(image.crop).toEqual({ x: 0.1, y: 0.2, scale: 1.4 });
    expect(text.zIndex).toBe(3);
    expect(image.zIndex).toBe(7);
    expect(grouped.find((layer) => layer.id === "g1").page).toBe("front");
  });

  it("computes the bounding box from true rotated corners, not width and height", () => {
    const rotated = [box("a", 0, 0), box("b", 0, 0, { rotation: 90 })];
    const bounds = resolveGroupBounds(rotated, ["a", "b"])!;
    // "b" is rotated 90 degrees, so it contributes 60 wide by 100 tall.
    expect(bounds.width).toBeCloseTo(100, 5);
    expect(bounds.height).toBeCloseTo(100, 5);
  });

  it("counts a hidden member in the group box so showing it later moves nothing", () => {
    const withHidden = [box("a", 0, 0), box("b", 500, 0, { hidden: true })];
    const bounds = resolveGroupBounds(withHidden, ["a", "b"])!;
    expect(bounds.right).toBeCloseTo(550, 5);
    expect(bounds.width).toBeCloseTo(600, 5);
  });

  it("produces a document with no broken group relationships", () => {
    const grouped = groupLayers(layers, ["a", "b", "c"], "g1");
    expect(validateGroupRelationships(grouped)).toEqual([]);
  });
});

/* ------------------------------------------------------ transformations --- */

describe("grouping — moving, resizing and rotating", () => {
  const base = () => groupLayers([box("a", 100, 100), box("b", 400, 100)], ["a", "b"], "g1");

  it("moves every child together and preserves the spacing between them", () => {
    const layers = base();
    const moved = transformGroupChildren(layers, "g1", { x: 350, y: 250 });
    const a = moved.find((layer) => layer.id === "a");
    const b = moved.find((layer) => layer.id === "b");
    expect(b.x - a.x).toBe(300);
    expect(a.y).toBe(250);
    expect(b.y).toBe(250);
    expect(a.width).toBe(100);
  });

  it("moves a whole group through the shared keyboard move helper", () => {
    const template = { layers: base() };
    const moved = moveLayers(template, ["g1"], 25, -10);
    const group = moved.layers.find((layer: any) => layer.id === "g1");
    const a = moved.layers.find((layer: any) => layer.id === "a");
    const b = moved.layers.find((layer: any) => layer.id === "b");
    expect(group.x).toBe(275);
    expect(a.x).toBe(125);
    expect(b.x).toBe(425);
    expect(a.y).toBe(90);
    expect(b.x - a.x).toBe(300);
  });

  it("scales children proportionally and never to an invalid size", () => {
    const layers = base();
    const group = layers.find((layer) => layer.id === "g1")!;
    const resized = transformGroupChildren(layers, "g1", { width: group.width * 2 });
    const a = resized.find((layer) => layer.id === "a");
    const b = resized.find((layer) => layer.id === "b");
    expect(a.width).toBe(200);
    expect(a.height).toBe(120);
    // Relative arrangement is preserved: the gap scales with the group.
    expect(b.x - a.x).toBeCloseTo(600, 5);
    const collapsed = transformGroupChildren(layers, "g1", { width: -50 });
    for (const layer of collapsed) expect(layer.width).toBeGreaterThan(0);
  });

  it("rotates children around the group centre and keeps their relationship", () => {
    const layers = base();
    const rotated = transformGroupChildren(layers, "g1", { rotation: 90 });
    const a = rotated.find((layer) => layer.id === "a");
    const b = rotated.find((layer) => layer.id === "b");
    const group = rotated.find((layer) => layer.id === "g1");
    // Each child keeps the group's rotation added to its own.
    expect(a.rotation).toBe(90);
    expect(b.rotation).toBe(90);
    // 150px left/right of centre becomes 150px above/below it.
    expect(a.x).toBeCloseTo(group.x, 5);
    expect(b.x).toBeCloseTo(group.x, 5);
    expect(Math.abs(b.y - a.y)).toBeCloseTo(300, 5);
  });

  it("treats a group as one object for alignment and card centring", () => {
    const template = { canvasWidthPx: 1000, canvasHeightPx: 2000, layers: base() };
    const centred = alignLayers(template, ["g1"], "centerOnCard");
    const group = centred.layers.find((layer: any) => layer.id === "g1");
    expect(group.x).toBe(500);
    expect(group.y).toBe(1000);
  });
});

/* --------------------------------------------------------------- ungroup -- */

describe("grouping — ungrouping", () => {
  it("removes only the container and leaves every child exactly where it was", () => {
    const originals = [box("a", 100, 100, { rotation: 30 }), box("b", 400, 250)];
    const grouped = groupLayers(originals, ["a", "b"], "g1");
    const ungrouped = ungroupLayers(grouped, "g1");

    expect(ungrouped.find((layer) => layer.id === "g1")).toBeUndefined();
    expect(ungrouped).toHaveLength(2);
    for (const original of originals) {
      const after = ungrouped.find((layer) => layer.id === original.id);
      expect(visual(after)).toEqual(visual(original));
      expect(after.groupId).toBe("");
    }
  });

  it("preserves text, image, permission and field properties", () => {
    const rich = [
      box("t", 100, 100, { type: "text", textStyle: { fontSize: 64 }, fieldId: "field_1", customerEditable: true }),
      box("i", 300, 100, { type: "image", crop: { scale: 2 } }),
    ];
    const ungrouped = ungroupLayers(groupLayers(rich, ["t", "i"], "g1"), "g1");
    expect(ungrouped.find((layer) => layer.id === "t").textStyle).toEqual({ fontSize: 64 });
    expect(ungrouped.find((layer) => layer.id === "t").fieldId).toBe("field_1");
    expect(ungrouped.find((layer) => layer.id === "i").crop).toEqual({ scale: 2 });
  });

  it("returns children to the parent group when the group was nested", () => {
    const layers = [box("a", 100, 100), box("b", 300, 100), box("c", 500, 100)];
    const inner = groupLayers(layers, ["a", "b"], "inner");
    const outer = groupLayers(inner, ["inner", "c"], "outer");
    const ungrouped = ungroupLayers(outer, "inner");
    expect(ungrouped.find((layer) => layer.id === "a").groupId).toBe("outer");
    expect(ungrouped.find((layer) => layer.id === "b").groupId).toBe("outer");
    expect(validateGroupRelationships(ungrouped)).toEqual([]);
  });

  it("does not drift after repeated group and ungroup cycles", () => {
    const originals = [box("a", 137, 211, { rotation: 17 }), box("b", 402, 96, { rotation: -33 }), box("c", 260, 355)];
    let layers: any[] = originals;
    for (let round = 0; round < 12; round += 1) {
      layers = groupLayers(layers, ["a", "b", "c"], `g${round}`);
      layers = ungroupLayers(layers, `g${round}`);
    }
    for (const original of originals) {
      expect(visual(layers.find((layer) => layer.id === original.id))).toEqual(visual(original));
    }
  });
});

/* --------------------------------------------- duplicate, delete, render -- */

describe("grouping — duplicate, delete and rendering", () => {
  const template = () => ({ layers: groupLayers([box("a", 100, 100), box("b", 400, 100)], ["a", "b"], "g1") });

  it("duplicates the group and every child with fresh identifiers", () => {
    const { template: next, newId } = duplicateLayer(template(), "g1");
    expect(newId).toBeTruthy();
    expect(newId).not.toBe("g1");
    const copy = next.layers.find((layer: any) => layer.id === newId);
    const children = next.layers.filter((layer: any) => layer.groupId === newId);
    expect(copy.type).toBe("group");
    expect(children).toHaveLength(2);
    // Fresh ids throughout, and the internal relationships point at the copy.
    for (const child of children) expect(["a", "b"]).not.toContain(child.id);
    expect(copy.childIds.sort()).toEqual(children.map((child: any) => child.id).sort());
    // The original is untouched and the copy is visibly offset.
    expect(next.layers.find((layer: any) => layer.id === "a")).toBeDefined();
    expect(copy.x).toBe(250 + 40);
    expect(validateGroupRelationships(next.layers)).toEqual([]);
  });

  it("deletes a group together with its children", () => {
    const next = removeLayer(template(), "g1");
    expect(next.layers).toHaveLength(0);
  });

  it("renders children with the group's opacity and visibility applied", () => {
    const layers = template().layers.map((layer: any) =>
      layer.id === "g1" ? { ...layer, opacity: 0.5 } : layer,
    );
    const renderable = getRenderableLayers(layers);
    expect(renderable.find((layer) => layer.id === "a").opacity).toBeCloseTo(0.5, 5);

    const hiddenGroup = layers.map((layer: any) => (layer.id === "g1" ? { ...layer, hidden: true } : layer));
    for (const layer of getRenderableLayers(hiddenGroup)) expect(layer.hidden).toBe(true);
  });

  it("keeps the group structure through a JSON save and restore round trip", () => {
    const saved = JSON.parse(JSON.stringify(template()));
    expect(validateGroupRelationships(saved.layers)).toEqual([]);
    expect(getDescendantIds(saved.layers, "g1").sort()).toEqual(["a", "b"]);
    const group = saved.layers.find((layer: any) => layer.id === "g1");
    expect(group.width).toBeGreaterThan(0);
    expect(group.height).toBeGreaterThan(0);
  });
});

/* ---------------------------------------------------------- layers panel -- */

describe("grouping — layers panel", () => {
  const layers = groupLayers([box("a", 100, 100), box("b", 400, 100)], ["a", "b"], "g1").concat(box("loose", 700, 100));

  it("shows a group as one expandable row with its children indented beneath it", () => {
    const rows = buildLayerRows(layers, new Set());
    const ids = rows.map((row) => row.layer.id);
    // Children follow their own container; ungrouped layers keep their place.
    expect(ids).toEqual(["g1", "a", "b", "loose"]);
    expect(rows.find((row) => row.layer.id === "g1")!.hasChildren).toBe(true);
    expect(rows.find((row) => row.layer.id === "a")!.depth).toBe(1);
    expect(rows.find((row) => row.layer.id === "loose")!.depth).toBe(0);
  });

  it("hides the children when the group is collapsed", () => {
    const rows = buildLayerRows(layers, new Set(["g1"]));
    expect(rows.map((row) => row.layer.id)).toEqual(["g1", "loose"]);
  });

  it("lists every layer exactly once", () => {
    const ids = buildLayerRows(layers, new Set()).map((row) => row.layer.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(layers.length);
  });

  it("inherits hidden and locked state down the tree", () => {
    const locked = layers.map((layer: any) => (layer.id === "g1" ? { ...layer, hidden: true, locked: true } : layer));
    const rows = buildLayerRows(locked, new Set());
    expect(rows.find((row) => row.layer.id === "a")!.hidden).toBe(true);
    expect(rows.find((row) => row.layer.id === "a")!.locked).toBe(true);
    expect(rows.find((row) => row.layer.id === "loose")!.hidden).toBe(false);
  });

  it("survives a corrupt cycle without hanging", () => {
    const cyclic = [box("x", 0, 0, { groupId: "y", type: "group" }), box("y", 0, 0, { groupId: "x", type: "group" })];
    expect(() => buildLayerRows(cyclic, new Set())).not.toThrow();
  });
});

/* ------------------------------------------------------------ toolbar ----- */

describe("grouping — toolbar surface", () => {
  it("keeps Group visible in the toolbar ahead of lower-priority actions", () => {
    const plan = planTextToolbar({
      availableWidth: 900,
      showTextControls: false,
      selectionCount: 2,
      showGrouping: true,
    });
    expect(plan.inline).toContain("grouping");
    // Grouping outranks every other optional control.
    expect(plan.overflow).not.toContain("grouping");
  });

  it("never shows the grouping control when it cannot apply", () => {
    const plan = planTextToolbar({ availableWidth: 1200, showTextControls: true, selectionCount: 1 });
    expect(plan.inline).not.toContain("grouping");
    expect(plan.overflow).not.toContain("grouping");
  });

  it("places Group into More rather than dropping it when space runs out", () => {
    const plan = planTextToolbar({
      availableWidth: 420,
      showTextControls: true,
      selectionCount: 2,
      showGrouping: true,
    });
    expect([...plan.inline, ...plan.overflow]).toContain("grouping");
  });

  it("renders Group and Ungroup as one control with the shared toolbar style", () => {
    expect(adminToolbar).toContain('aria-label={ungroupMode ? "Ungroup" : "Group"}');
    expect(adminToolbar).toContain("const ungroupMode = isGroup");
    // Same shell, height and states as every other toolbar control.
    expect(adminToolbar).toContain("${CONTROL_BASE} w-full ${plan.showFieldLabels ? \"gap-1.5 px-2\" : \"\"}");
    expect(adminToolbar).toContain("style={{ height: CONTROL_HEIGHT[density] }}");
    // Label on wide layouts, icon plus tooltip when compact.
    expect(adminToolbar).toContain('{plan.showFieldLabels && <span>{ungroupMode ? "Ungroup" : "Group"}</span>}');
    expect(adminToolbar).toContain("title={state.reason}");
  });

  it("offers grouping from the Layout menu and the More menu as well", () => {
    expect(adminToolbar).toContain('label="Group objects"');
    expect(adminToolbar).toContain('label="Ungroup"');
    expect(adminToolbar).toContain('label="Edit group"');
    expect(adminToolbar).toContain('plan.overflow.includes("grouping")');
  });
});

/* --------------------------------------------------------- wiring rules --- */

describe("grouping — builder and customer wiring", () => {
  it("evaluates the admin rules once and shares them with the toolbar", () => {
    expect(adminBuilder).toContain("const groupActionState = (ids = selectedLayerIds) =>");
    expect(adminBuilder).toContain("evaluateGroupAction");
    expect(adminBuilder).toContain("groupAction={groupActionState()}");
    expect(adminBuilder).toContain("if (!groupActionState().group.enabled) return;");
    expect(adminBuilder).toContain("if (!groupActionState().ungroup.enabled) return;");
  });

  it("commits group and ungroup as one history entry each", () => {
    // One commit() per operation is one undo entry and one autosave.
    const groupBody = adminBuilder.slice(
      adminBuilder.indexOf("const groupSelectedLayers"),
      adminBuilder.indexOf("const ungroupSelectedLayer"),
    );
    expect(groupBody.match(/commit\(/g) || []).toHaveLength(1);
    const ungroupBody = adminBuilder.slice(
      adminBuilder.indexOf("const ungroupSelectedLayer"),
      adminBuilder.indexOf("const duplicateSelectedLayers"),
    );
    expect(ungroupBody.match(/commit\(/g) || []).toHaveLength(1);
    // Ungroup selects the former children from the document, not a stale list.
    expect(ungroupBody).toContain("layer.groupId === group.id");
  });

  it("binds Ctrl/Cmd+G and Ctrl/Cmd+Shift+G on both surfaces", () => {
    for (const source of [adminBuilder, customerClient]) {
      expect(source).toMatch(/(k|key) === "g"/);
      expect(source).toContain("shiftKey");
    }
    // metaKey covers Command on macOS; typing is excluded on both surfaces.
    expect(adminBuilder).toContain("(e.ctrlKey || e.metaKey) && !typing");
    expect(adminBuilder).toContain("if (e.shiftKey) ungroupSelectedLayer();");
    expect(customerClient).toContain("if (event.shiftKey) ungroupSelection();");
    expect(customerClient).toContain("else groupSelection();");
  });

  it("opens group editing with Enter and leaves it with Escape", () => {
    expect(adminBuilder).toContain('if (e.key === "Enter" && selectedLayerIds.length === 1)');
    expect(adminBuilder).toContain("enterAdminGroup(only.id)");
    expect(adminBuilder).toContain('e.key === "Escape" && editingGroupIdRef.current');
    expect(customerClient).toContain('event.key === "Enter" && selectedLayers.length === 1 && selectedLayers[0]?.type === "group"');
    expect(customerClient).toContain("else if (editingGroupId) exitGroup();");
  });

  it("hides customer grouping completely when the template forbids it", () => {
    // Not merely disabled: the toolbar is not rendered at all.
    expect(customerClient).toContain("customerGroupingEnabled && multiselectEnabled && selectedLayers.length > 1");
    expect(customerToolbar).toContain("const showGroup = groupingAllowed && !isGroup && selectionCount > 1");
    expect(customerToolbar).toContain("const showUngroup = ungroupingAllowed && isGroup");
    expect(customerToolbar).toContain("if (!showGroup && !showUngroup && !onDuplicate && !onDelete) return null;");
  });

  it("enforces customer permissions in the document logic, not only the UI", () => {
    expect(customerClient).toContain("const groupSelection = () => {");
    expect(customerClient).toContain("if (!canGroupSelection) return;");
    expect(customerClient).toContain("if (!canUngroupSelection || !group) return;");
    expect(customerClient).toContain("getLayerPermissions(layer).group");
  });

  it("marks the customer grouping toolbar as safe for inline text editing", () => {
    expect(customerToolbar).toContain("data-customizer-text-interaction");
  });

  it("keeps the layers panel hierarchy exported and used", () => {
    expect(layersPanel).toContain("export function buildLayerRows");
    expect(layersPanel).toContain("const rows = buildLayerRows(layers, collapsed)");
    expect(layersPanel).toContain('aria-expanded={!isCollapsed}');
    expect(layersPanel).toContain("onEnterGroup?.(layer.id)");
  });
});
