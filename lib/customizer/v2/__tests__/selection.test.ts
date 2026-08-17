import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INITIAL_TOOL_STATE, toolReducer } from "../interaction/tool-mode";
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

describe("click selection (spec §2, §3, §4, §6)", () => {
  it("selects exactly one object per plain click", () => {
    let selection: string[] = [];
    for (const id of ["textA", "textB", "photoA"]) {
      selection = resolvePointerDownSelection({ current: selection, id }).selection;
    }
    // Clicking a second object replaces the first — it never accumulates.
    expect(selection).toEqual(["photoA"]);
    expect(resolvePointerDownSelection({ current: ["textA"], id: "textB" }).selection).toEqual(["textB"]);
  });

  it("builds and breaks down a multi-selection with Ctrl / Cmd / Shift", () => {
    let selection: string[] = ["textA"];
    selection = resolvePointerDownSelection({ current: selection, id: "textB", additive: true }).selection;
    selection = resolvePointerDownSelection({ current: selection, id: "photoA", additive: true }).selection;
    expect(selection).toEqual(["textA", "textB", "photoA"]);

    const removal = resolvePointerDownSelection({ current: selection, id: "textB", additive: true });
    expect(removal.selection).toEqual(["textA", "photoA"]);
    // A modifier click is a toggle, never the start of a drag.
    expect(removal.allowDrag).toBe(false);
  });

  it("keeps the only selected object selected when it is clicked again", () => {
    // Its resize handles, contextual toolbar and inspector must survive the
    // click that starts a move — deselecting is empty canvas / Escape / modifier.
    const down = resolvePointerDownSelection({ current: ["photoA"], id: "photoA" });
    expect(down.selection).toEqual(["photoA"]);
    expect(down.collapseOnRelease).toBe(false);
    expect(down.allowDrag).toBe(true);
    expect(
      resolvePointerUpSelection({ current: ["photoA"], id: "photoA", moved: false, collapseOnRelease: false }),
    ).toBeNull();
    expect(resolvePointerDownSelection({ current: ["photoA"], id: "photoA", additive: true }).selection).toEqual([]);
  });

  it("holds a multi-selection through the press so a drag moves all of it", () => {
    const current = ["textA", "textB", "photoA"];
    const down = resolvePointerDownSelection({ current, id: "textB" });
    expect(down.selection).toEqual(current);
    expect(down.collapseOnRelease).toBe(true);
    // Dragged: every selected object moves and the selection is untouched.
    expect(
      resolvePointerUpSelection({ current, id: "textB", moved: true, collapseOnRelease: true }),
    ).toBeNull();
    // Released without moving: it was a click, so it collapses to that object.
    expect(
      resolvePointerUpSelection({ current, id: "textB", moved: false, collapseOnRelease: true }),
    ).toEqual(["textB"]);
  });

  it("never changes the selection when the gesture turned into a drag", () => {
    const current = ["textA", "photoA"];
    expect(
      resolvePointerUpSelection({ current, id: "textA", moved: true, collapseOnRelease: true }),
    ).toBeNull();
    expect(
      resolvePointerUpSelection({ current, id: "textA", moved: false, collapseOnRelease: false }),
    ).toBeNull();
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
const stage = read("app/components/customizer/interaction/CustomizerInteractionStage.tsx");
  const builder = read("app/admin/dashboard/design-builder/AdminDesignBuilder.tsx");
  const personalize = read("app/products/[slug]/personalize/personalize-client.tsx");

  it("routes every canvas pointer gesture through lib/customizer/v2/selection", () => {
    // Both canvases now mount the SAME interaction layer, so there is exactly
    // one pointer path to audit instead of two that happened to agree.
    for (const source of [adminCanvas, customerCanvas]) {
      expect(source).toContain("<InteractionStageClient");
      expect(source).toContain("onSelectionChange=");
    }
    expect(stage).toContain('from "@/lib/customizer/v2/selection"');
    expect(stage).toContain("resolvePointerDownSelection");
    expect(stage).toContain("resolvePointerUpSelection");
    expect(stage).toContain("resolveMarqueeSelection");
  });

  it("keeps the whole selection while dragging any member", () => {
    // The press decision is taken once, in the shared layer, and the whole
    // decided selection becomes the drag's members.
    expect(stage).toContain("const decision = resolvePointerDownSelection({");
    expect(stage).toContain("members: movable");
    expect(stage).toContain("collapseOnRelease: decision.collapseOnRelease");
    // Followers take the SNAPPED delta, so a snap cannot change their spacing.
    expect(stage).toContain("applySelectionDelta(session.members, session.leadId, snapped.x, snapped.y");
  });

  it("feeds panel selection through the same reducer as the canvas", () => {
    expect(builder).toContain("resolveSelection(current, id, intent)");
    expect(personalize).toContain("additive && multiselectEnabled ? \"toggle\" : \"replace\"");
    // Panel rows read the same modifier as the canvas: plain click replaces,
    // Ctrl / Cmd / Shift click toggles.
    expect(read("app/components/customizer/CustomerLayersPanel.tsx")).toContain(
      "onSelectionChange(layer.id, event.shiftKey || event.ctrlKey || event.metaKey)",
    );
    expect(read("app/admin/dashboard/design-builder/AdminLayersPanel.tsx")).toContain(
      'event.shiftKey || event.ctrlKey || event.metaKey ? "toggle" : "replace"',
    );
  });
});

describe("insertion tools are one-shot commands (spec §10–§12, §35)", () => {
  const builder = read("app/admin/dashboard/design-builder/AdminDesignBuilder.tsx");
  const rail = read("app/admin/dashboard/design-builder/AdminToolRail.tsx");
  const personalize = read("app/products/[slug]/personalize/personalize-client.tsx");

  it("separates the canvas interaction mode from inspector panels in the admin builder", () => {
    // The canvas mode is owned by the shared tool state machine; inspector
    // panels remain ordinary UI state, so opening a panel can never arm a
    // creation mode.
    expect(builder).toContain("useReducer(toolReducer, INITIAL_TOOL_STATE)");
    expect(builder).toContain('const activeTool: "select" | "pan" = toolState.mode === "pan" ? "pan" : "select";');
    expect(builder).toContain('useState<"properties" | "text" | "uploads" | "elements">("properties")');
    expect(rail).toContain("activePanel");
  });

  it("returns the admin builder to Select after every insertion", () => {
    for (const action of ["const insertTextLayer", "const addPhotoArea", "const addShape", "const addQRCode", "const addBackground"]) {
      const body = builder.slice(builder.indexOf(action), builder.indexOf(action) + 900);
      expect(body).toContain("finishInsertion()");
    }
    // And the machine, not the call site, is what enforces it.
    expect(builder).toContain('const finishInsertion = () => dispatchTool({ type: "objectCreated" });');
    let state = toolReducer(INITIAL_TOOL_STATE, { type: "requestTextCreate" });
    expect(state.mode).toBe("text-create");
    state = toolReducer(state, { type: "objectCreated" });
    expect(state.mode).toBe("select");
    // ...unless the tool was deliberately armed to persist.
    let sticky = toolReducer(INITIAL_TOOL_STATE, { type: "requestTextCreate", persistent: true });
    sticky = toolReducer(sticky, { type: "objectCreated" });
    expect(sticky.mode).toBe("text-create");
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
