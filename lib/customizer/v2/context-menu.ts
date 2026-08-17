// Canvas context menu model for the customer customizer (spec §20).
//
// The customer canvas deliberately suppresses the browser's own context menu
// inside `[data-customizer-protected]` (see `useCustomizerProtection`), so a
// right click there previously did nothing at all. This module decides what a
// right click SHOULD offer, as a pure function of the current selection and the
// permissions the administrator granted.
//
// Two rules drive the shape of the result:
//
//   1. Forbidden actions are ABSENT, not disabled. §20 is explicit that the
//      menu must not expose actions the customer may not take, and a list of
//      greyed-out entries is exactly the "developer tooling" feel §1 warns
//      against. Every capability flag here is already computed by the editor
//      for its toolbars, so the menu can never disagree with them.
//   2. Items arrive pre-grouped so the renderer can draw separators without
//      knowing what any action means. Empty groups are dropped, so a menu never
//      opens with a stray divider or with nothing in it.

export type ContextMenuActionId =
  | "editText"
  | "replacePhoto"
  | "crop"
  | "enterGroup"
  | "duplicate"
  | "delete"
  | "bringToFront"
  | "bringForward"
  | "sendBackward"
  | "sendToBack"
  | "group"
  | "ungroup"
  | "hide"
  | "show"
  | "lock"
  | "unlock";

export type ContextMenuItem = {
  id: ContextMenuActionId;
  label: string;
  /** Platform-neutral accelerator; format for display with `formatShortcut`. */
  shortcut?: string;
  /** Destructive actions get a distinct treatment and never sit next to Edit. */
  danger?: boolean;
};

export type ContextMenuCapabilities = {
  selectionCount: number;
  /** Layer type of the primary selection, e.g. "text" | "image" | "grid". */
  primaryType?: string | null;
  canEditText?: boolean;
  canReplacePhoto?: boolean;
  canCrop?: boolean;
  canEnterGroup?: boolean;
  canDuplicate?: boolean;
  canDelete?: boolean;
  canArrange?: boolean;
  canGroup?: boolean;
  canUngroup?: boolean;
  canHide?: boolean;
  isHidden?: boolean;
  canLock?: boolean;
  isLocked?: boolean;
};

const on = (value: unknown) => value === true;

/**
 * The menu for the current selection, as groups of items. Returns an empty
 * array when nothing is permitted — callers treat that as "do not open a menu",
 * which also lets the browser keep its own menu off design-free areas.
 */
export function buildCustomerContextMenu(
  capabilities: ContextMenuCapabilities,
): ContextMenuItem[][] {
  const count = Number(capabilities?.selectionCount) || 0;
  if (count < 1) return [];
  const single = count === 1;

  // Primary action for the object under the cursor. Only ever one, and only
  // for a single selection — "Edit text" is meaningless for a mixed set.
  const primary: ContextMenuItem[] = [];
  if (single) {
    if (on(capabilities.canEditText)) {
      primary.push({ id: "editText", label: "Edit text", shortcut: "Enter" });
    }
    if (on(capabilities.canReplacePhoto)) {
      primary.push({ id: "replacePhoto", label: "Replace photo" });
    }
    if (on(capabilities.canCrop)) {
      primary.push({ id: "crop", label: "Crop photo" });
    }
    if (on(capabilities.canEnterGroup)) {
      primary.push({ id: "enterGroup", label: "Edit group contents" });
    }
  }

  const clipboard: ContextMenuItem[] = [];
  if (on(capabilities.canDuplicate)) {
    clipboard.push({ id: "duplicate", label: "Duplicate", shortcut: "Mod+D" });
  }

  const arrange: ContextMenuItem[] = [];
  if (on(capabilities.canArrange)) {
    arrange.push(
      { id: "bringToFront", label: "Bring to front" },
      { id: "bringForward", label: "Bring forward" },
      { id: "sendBackward", label: "Send backward" },
      { id: "sendToBack", label: "Send to back" },
    );
  }

  const grouping: ContextMenuItem[] = [];
  if (on(capabilities.canGroup)) {
    grouping.push({ id: "group", label: "Group", shortcut: "Mod+G" });
  }
  if (single && on(capabilities.canUngroup)) {
    grouping.push({ id: "ungroup", label: "Ungroup", shortcut: "Mod+Shift+G" });
  }

  const state: ContextMenuItem[] = [];
  if (single && on(capabilities.canHide)) {
    state.push(
      capabilities.isHidden
        ? { id: "show", label: "Show" }
        : { id: "hide", label: "Hide" },
    );
  }
  if (single && on(capabilities.canLock)) {
    state.push(
      capabilities.isLocked
        ? { id: "unlock", label: "Unlock" }
        : { id: "lock", label: "Lock" },
    );
  }

  const destructive: ContextMenuItem[] = [];
  if (on(capabilities.canDelete)) {
    destructive.push({ id: "delete", label: "Delete", shortcut: "Del", danger: true });
  }

  return [primary, clipboard, arrange, grouping, state, destructive].filter(
    (group) => group.length > 0,
  );
}

/** Flattened item list — handy for tests and for roving keyboard focus. */
export function flattenContextMenu(groups: ContextMenuItem[][]): ContextMenuItem[] {
  return groups.flat();
}

/**
 * Renders an accelerator for the current platform. `Mod` is the primary
 * modifier: Command on macOS, Control everywhere else.
 */
export function formatShortcut(shortcut: string | undefined, isMac = false): string {
  if (!shortcut) return "";
  return shortcut
    .split("+")
    .map((part) => {
      if (part === "Mod") return isMac ? "⌘" : "Ctrl";
      if (part === "Shift") return isMac ? "⇧" : "Shift";
      return part;
    })
    .join(isMac ? "" : "+");
}
