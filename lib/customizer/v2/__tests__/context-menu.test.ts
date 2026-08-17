import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCustomerContextMenu,
  flattenContextMenu,
  formatShortcut,
  type ContextMenuCapabilities,
} from "../context-menu";

const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");
const workspaceSource = read("app/components/customizer/CustomizerWorkspace.tsx");
const menuSource = read("app/components/customizer/CustomerCanvasContextMenu.tsx");
const stageSource = read("app/components/customizer/interaction/CustomizerInteractionStage.tsx");
const personalizeSource = read("app/products/[slug]/personalize/personalize-client.tsx");

const ids = (capabilities: ContextMenuCapabilities) =>
  flattenContextMenu(buildCustomerContextMenu(capabilities)).map((item) => item.id);

describe("buildCustomerContextMenu", () => {
  it("offers nothing when there is no selection", () => {
    expect(buildCustomerContextMenu({ selectionCount: 0 })).toEqual([]);
    expect(buildCustomerContextMenu({ selectionCount: 0, canDuplicate: true })).toEqual([]);
  });

  it("offers nothing when the selection grants no permitted action", () => {
    // A selected but fully locked object must not open an empty menu.
    expect(buildCustomerContextMenu({ selectionCount: 1, primaryType: "text" })).toEqual([]);
  });

  it("omits forbidden actions rather than disabling them", () => {
    const menu = ids({ selectionCount: 1, primaryType: "text", canDuplicate: true });
    expect(menu).toEqual(["duplicate"]);
    expect(menu).not.toContain("delete");
    expect(menu).not.toContain("bringToFront");
  });

  it("builds the full single-object text menu", () => {
    expect(
      ids({
        selectionCount: 1,
        primaryType: "text",
        canEditText: true,
        canDuplicate: true,
        canDelete: true,
        canArrange: true,
        canHide: true,
        canLock: true,
      }),
    ).toEqual([
      "editText",
      "duplicate",
      "bringToFront",
      "bringForward",
      "sendBackward",
      "sendToBack",
      "hide",
      "lock",
      "delete",
    ]);
  });

  it("offers photo actions for an image", () => {
    const menu = ids({
      selectionCount: 1,
      primaryType: "image",
      canReplacePhoto: true,
      canCrop: true,
    });
    expect(menu).toEqual(["replacePhoto", "crop"]);
  });

  it("drops single-object actions for a multi selection", () => {
    const menu = ids({
      selectionCount: 3,
      canEditText: true,
      canReplacePhoto: true,
      canCrop: true,
      canEnterGroup: true,
      canHide: true,
      canLock: true,
      canUngroup: true,
      canDuplicate: true,
      canGroup: true,
    });
    expect(menu).toEqual(["duplicate", "group"]);
  });

  it("shows Group only for a multi selection and Ungroup only for one group", () => {
    expect(ids({ selectionCount: 2, canGroup: true })).toContain("group");
    expect(ids({ selectionCount: 1, primaryType: "group", canUngroup: true })).toContain("ungroup");
    // canGroup is computed by the editor as multi-only; the menu must not
    // invent a Group entry for a lone object even if the flag is set.
    expect(ids({ selectionCount: 1, canUngroup: true, canGroup: true })).toEqual(["group", "ungroup"]);
  });

  it("reflects current hidden and locked state in the labels", () => {
    expect(ids({ selectionCount: 1, canHide: true, isHidden: false })).toEqual(["hide"]);
    expect(ids({ selectionCount: 1, canHide: true, isHidden: true })).toEqual(["show"]);
    expect(ids({ selectionCount: 1, canLock: true, isLocked: false })).toEqual(["lock"]);
    expect(ids({ selectionCount: 1, canLock: true, isLocked: true })).toEqual(["unlock"]);
  });

  it("keeps Delete last, separated, and marked destructive", () => {
    const groups = buildCustomerContextMenu({
      selectionCount: 1,
      canEditText: true,
      canDelete: true,
    });
    const last = groups[groups.length - 1];
    expect(last).toHaveLength(1);
    expect(last[0]).toMatchObject({ id: "delete", danger: true });
  });

  it("never returns an empty group, so the renderer cannot draw a stray divider", () => {
    const groups = buildCustomerContextMenu({
      selectionCount: 1,
      canEditText: true,
      canDelete: true,
    });
    expect(groups.every((group) => group.length > 0)).toBe(true);
  });

  it("offers group entry only for a single group the customer may open", () => {
    expect(ids({ selectionCount: 1, primaryType: "group", canEnterGroup: true })).toEqual(["enterGroup"]);
    expect(ids({ selectionCount: 2, canEnterGroup: true })).toEqual([]);
  });
});

describe("canvas wiring", () => {
  it("opens on right click over an object and suppresses the browser menu", () => {
    // The right click is resolved by the shared interaction layer, which hands
    // the workspace the object that was hit plus the screen position.
    expect(stageSource).toContain("onContextMenu={(event) => {");
    expect(stageSource).toContain("event.evt.preventDefault();");
    expect(stageSource).toContain("onContextMenuNode?.(node.id, { x: source.clientX, y: source.clientY });");
    expect(workspaceSource).toContain("onLayerContextMenu?.(layerId, position);");
  });

  it("does not open in preview mode or while editing text", () => {
    expect(workspaceSource).toContain("if (previewMode || editingTextId) return;");
  });

  it("selects the right-clicked object when it is outside the current selection", () => {
    expect(workspaceSource).toContain(
      "if (!activeSelection.includes(layerId)) applySelection([layerId]);",
    );
    // The interaction layer does the same on its side, so a right click never
    // acts on an object the customer cannot see is selected.
    expect(stageSource).toContain("if (!selection.includes(node.id)) onSelectionChange([node.id]);");
  });

  it("closes when the page, selection or preview state changes", () => {
    expect(personalizeSource).toContain("}, [activePage, selectedLayerIds, previewMode]);");
  });

  it("renders nothing when no action is permitted", () => {
    expect(personalizeSource).toContain("contextMenu && contextMenuGroups.length ?");
  });
});

describe("menu accessibility", () => {
  it("is a real menu for assistive technology", () => {
    expect(menuSource).toContain('role="menu"');
    expect(menuSource).toContain('role="menuitem"');
    expect(menuSource).toContain('aria-label="Object actions"');
  });

  it("implements roving focus and Escape", () => {
    expect(menuSource).toContain('tabIndex={itemIndex === activeIndex ? 0 : -1}');
    expect(menuSource).toContain('if (event.key === "ArrowDown")');
    expect(menuSource).toContain('if (event.key === "Escape")');
  });

  it("clamps itself inside the viewport", () => {
    expect(menuSource).toContain("const maxLeft = window.innerWidth - rect.width - EDGE_PADDING;");
    expect(menuSource).toContain("const maxTop = window.innerHeight - rect.height - EDGE_PADDING;");
  });

  it("marks accelerators decorative so screen readers read the label only", () => {
    expect(menuSource).toContain('<span aria-hidden className="text-[10px]');
  });
});

describe("formatShortcut", () => {
  it("uses Ctrl on non-mac and the command glyph on mac", () => {
    expect(formatShortcut("Mod+D")).toBe("Ctrl+D");
    expect(formatShortcut("Mod+D", true)).toBe("⌘D");
  });

  it("formats a multi-modifier accelerator", () => {
    expect(formatShortcut("Mod+Shift+G")).toBe("Ctrl+Shift+G");
    expect(formatShortcut("Mod+Shift+G", true)).toBe("⌘⇧G");
  });

  it("passes plain keys through and tolerates nothing", () => {
    expect(formatShortcut("Enter")).toBe("Enter");
    expect(formatShortcut(undefined)).toBe("");
  });
});
