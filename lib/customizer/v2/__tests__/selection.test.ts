import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveMarqueeSelection,
  resolvePointerDownSelection,
  resolvePointerUpSelection,
  resolveSelection,
  sanitizeSelection,
  selectionPrimaryId,
  selectionsEqual,
  toggleSelection,
} from "../selection";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("click multi-selection (spec §2, §3, §4, §6)", () => {
  it("accumulates consecutive plain clicks without any modifier key", () => {
    let selection: string[] = [];
    for (const id of ["textA", "textB", "photoA"]) {
      selection = resolvePointerDownSelection({ current: selection, id }).selection;
    }
    expect(selection).toEqual(["textA", "textB", "photoA"]);
  });

  it("keeps the only selected object selected when it is clicked again", () => {
    // Its resize handles, contextual toolbar and inspector must survive the
    // click that starts a move — deselecting is empty canvas / Escape / modifier.
    const down = resolvePointerDownSelection({ current: ["photoA"], id: "photoA" });
    expect(down.selection).toEqual(["photoA"]);
    expect(down.toggleOnRelease).toBe(false);
    expect(down.allowDrag).toBe(true);
    expect(
      resolvePointerUpSelection({ current: ["photoA"], id: "photoA", moved: false, toggleOnRelease: false }),
    ).toBeNull();
    // A modifier click stays an explicit "take this one out" gesture.
    expect(resolvePointerDownSelection({ current: ["photoA"], id: "photoA", additive: true }).selection).toEqual([]);
  });

  it("removes only the clicked object when it is one of several selected", () => {
    const current = ["textA", "textB", "photoA"];
    const down = resolvePointerDownSelection({ current, id: "textB" });
    // The selection survives pointer down so the drag can move the whole set.
    expect(down.selection).toEqual(current);
    expect(down.toggleOnRelease).toBe(true);
    expect(
      resolvePointerUpSelection({ current, id: "textB", moved: false, toggleOnRelease: true }),
    ).toEqual(["textA", "photoA"]);
  });

  it("never changes the selection when the gesture turned into a drag", () => {
    const current = ["textA", "photoA"];
    expect(
      resolvePointerUpSelection({ current, id: "textA", moved: true, toggleOnRelease: true }),
    ).toBeNull();
    expect(
      resolvePointerUpSelection({ current, id: "textA", moved: false, toggleOnRelease: false }),
    ).toBeNull();
  });

  it("keeps a newly added object selected when the click does not move", () => {
    const down = resolvePointerDownSelection({ current: ["textA"], id: "shapeA" });
    expect(down.selection).toEqual(["textA", "shapeA"]);
    expect(down.toggleOnRelease).toBe(false);
    expect(
      resolvePointerUpSelection({
        current: down.selection,
        id: "shapeA",
        moved: false,
        toggleOnRelease: down.toggleOnRelease,
      }),
    ).toBeNull();
  });

  it("keeps Ctrl / Cmd / Shift working as an immediate toggle that never drags", () => {
    const additive = resolvePointerDownSelection({ current: ["a", "b"], id: "b", additive: true });
    expect(additive.selection).toEqual(["a"]);
    expect(additive.allowDrag).toBe(false);
    expect(resolvePointerDownSelection({ current: ["a"], id: "c", additive: true }).selection).toEqual(["a", "c"]);
  });

  it("clears on a background click and merges only an additive marquee", () => {
    expect(resolveMarqueeSelection({ original: ["a", "b"], found: [], moved: false })).toEqual([]);
    expect(resolveMarqueeSelection({ original: ["a"], found: [], moved: false, additive: true })).toEqual(["a"]);
    expect(resolveMarqueeSelection({ original: ["a"], found: ["b", "c"], moved: true })).toEqual(["b", "c"]);
    expect(
      resolveMarqueeSelection({ original: ["a"], found: ["a", "b"], moved: true, additive: true }),
    ).toEqual(["a", "b"]);
  });

  it("treats the last id as the primary object and sanitizes stale ids", () => {
    expect(selectionPrimaryId(["a", "b"])).toBe("b");
    expect(selectionPrimaryId([])).toBeNull();
    expect(sanitizeSelection(["a", "gone", "b", "a"], new Set(["a", "b"]))).toEqual(["a", "b"]);
    expect(selectionsEqual(["a", "b"], ["a", "b"])).toBe(true);
    expect(selectionsEqual(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("exposes explicit intents for panels and double click", () => {
    expect(resolveSelection(["a", "b"], "c", "replace")).toEqual(["c"]);
    expect(resolveSelection(["a"], "a", "toggle")).toEqual([]);
    expect(resolveSelection(["a"], "b", "add")).toEqual(["a", "b"]);
    expect(resolveSelection(["a", "b"], "a", "remove")).toEqual(["b"]);
    expect(resolveSelection(["a"], null)).toEqual([]);
    expect(toggleSelection(["a"], "b")).toEqual(["a", "b"]);
  });
});

describe("both customizers consume the one shared selection reducer (spec §20, §23)", () => {
  const adminCanvas = read("app/admin/dashboard/design-builder/AdminCanvas.tsx");
  const customerCanvas = read("app/components/customizer/CustomizerWorkspace.tsx");
  const builder = read("app/admin/dashboard/design-builder/AdminDesignBuilder.tsx");
  const personalize = read("app/products/[slug]/personalize/personalize-client.tsx");

  it("routes every canvas pointer gesture through lib/customizer/v2/selection", () => {
    for (const source of [adminCanvas, customerCanvas]) {
      expect(source).toContain('from "@/lib/customizer/v2/selection"');
      expect(source).toContain("resolvePointerDownSelection");
      expect(source).toContain("resolvePointerUpSelection");
      expect(source).toContain("resolveMarqueeSelection");
      // One entry point for a direct hit and for a hit through the combined
      // selection frame, so both behave identically.
      expect(source).toContain("const beginObjectInteraction");
      expect(source).toContain("beginObjectInteraction(e, target)");
    }
  });

  it("keeps the whole selection while dragging any member", () => {
    expect(adminCanvas).toContain("decision.selection.includes(layer.id) && decision.selection.length > 1");
    expect(customerCanvas).toContain("selected: selectedTargets.map((item: any) => ({ id: item.id, x: item.x, y: item.y }))");
  });

  it("feeds panel selection through the same reducer as the canvas", () => {
    expect(builder).toContain("resolveSelection(current, id, intent)");
    expect(personalize).toContain("additive && multiselectEnabled ? \"toggle\" : \"replace\"");
    expect(read("app/components/customizer/CustomerLayersPanel.tsx")).toContain("onSelectionChange(layer.id, true)");
    expect(read("app/admin/dashboard/design-builder/AdminLayersPanel.tsx")).toContain('onSelect(targetId, "toggle")');
  });
});

describe("insertion tools are one-shot commands (spec §10–§12, §35)", () => {
  const builder = read("app/admin/dashboard/design-builder/AdminDesignBuilder.tsx");
  const rail = read("app/admin/dashboard/design-builder/AdminToolRail.tsx");
  const personalize = read("app/products/[slug]/personalize/personalize-client.tsx");

  it("separates the canvas interaction mode from inspector panels in the admin builder", () => {
    expect(builder).toContain('useState<"select" | "pan">("select")');
    expect(builder).toContain('useState<"properties" | "text" | "uploads" | "elements">("properties")');
    expect(rail).toContain("activePanel");
  });

  it("returns the admin builder to Select after every insertion", () => {
    for (const action of ["const insertTextLayer", "const addPhotoArea", "const addShape", "const addQRCode", "const addBackground"]) {
      const body = builder.slice(builder.indexOf(action), builder.indexOf(action) + 900);
      expect(body).toContain('setActiveTool("select")');
    }
  });

  it("never leaves a text placement mode armed in either editor", () => {
    expect(builder).not.toContain('setActiveTool("text")');
    expect(personalize).not.toContain("textPlacementActive");
    expect(read("app/components/customizer/CustomizerWorkspace.tsx")).not.toContain("textPlacementActive");
    expect(read("app/admin/dashboard/design-builder/AdminCanvas.tsx")).not.toContain('activeTool === "text"');
  });
});

describe("bulk image upload (spec §1, §37)", () => {
  it("accepts many files at once in both libraries and reports batch progress", () => {
    const adminPanel = read("app/admin/dashboard/design-builder/AdminUploadsPanel.tsx");
    const customerPanel = read("app/components/customizer/CustomerUploadsPanel.tsx");
    for (const panel of [adminPanel, customerPanel]) {
      expect(panel).toContain("type=\"file\"");
      expect(panel).toContain("multiple");
      expect(panel).toContain("Uploading ${batch.index} of ${batch.total}");
    }
    // One failure must not cancel the files that already succeeded.
    expect(adminPanel).toContain("const failed:");
    expect(customerPanel).toContain("const failed:");
    // Replacing a single photo area stays a single-image action.
    expect(customerPanel).toContain('accept="image/jpeg,image/png,image/webp"\n                    className="sr-only"');
  });
});
