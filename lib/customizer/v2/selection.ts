/**
 * Shared selection semantics for BOTH customizers (spec §2–§7, §20, §23).
 *
 * The admin builder and the customer editor each own exactly one selection
 * state — an ordered list of layer ids whose LAST entry is the primary object.
 * This module is the single place that decides how a pointer interaction turns
 * one list into the next, so canvas clicks, marquee drags, the layers panel and
 * every selection-dependent command (align, group, arrange, delete, duplicate)
 * can never disagree about what "selected" means.
 *
 * Interaction contract:
 *   - A plain click selects exactly ONE object. Clicking a second object does
 *     not add it — it replaces the selection, the way every editor behaves.
 *   - Ctrl / Cmd / Shift click is how a selection is built up and broken down:
 *     it toggles the clicked object in or out and never arms a drag.
 *   - A plain press on an object that is already part of a multi-selection
 *     KEEPS the whole selection, so the drag moves every selected object. If
 *     the gesture ends without movement it was a click after all, and the
 *     selection collapses to that one object.
 *   - A plain click on the only selected object leaves it selected. Clicking
 *     the object you are working on must never take its handles, contextual
 *     toolbar and inspector away — deselecting is done on empty canvas, with
 *     Escape, or with a modifier click.
 *   - A plain click on empty canvas clears the selection.
 *   - A marquee replaces the selection; an additive marquee merges into it.
 */

export type SelectionIntent = "toggle" | "replace" | "add" | "remove";

const unique = (ids: readonly string[]) => Array.from(new Set(ids.filter(Boolean)));

/** The object that drives handles, the properties panel and the toolbar. */
export function selectionPrimaryId(ids: readonly string[]): string | null {
  return ids.length ? ids[ids.length - 1] : null;
}

export function isSelected(ids: readonly string[], id: string | null | undefined): boolean {
  return Boolean(id) && ids.includes(String(id));
}

export function toggleSelection(current: readonly string[], id: string): string[] {
  return current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
}

export function resolveSelection(
  current: readonly string[],
  id: string | null,
  intent: SelectionIntent = "toggle",
): string[] {
  if (!id) return [];
  switch (intent) {
    case "replace":
      return [id];
    case "add":
      return current.includes(id) ? [...current] : [...current, id];
    case "remove":
      return current.filter((item) => item !== id);
    case "toggle":
    default:
      return toggleSelection(current, id);
  }
}

export type PointerDownSelection = {
  /** The selection to apply immediately, on pointer down. */
  selection: string[];
  /**
   * True when the object was already part of a MULTI-selection: the selection
   * is held intact so a drag moves the whole group, and only collapses to this
   * one object if the gesture ends up being a click.
   */
  collapseOnRelease: boolean;
  /** False for modifier clicks, which are selection toggles and never drags. */
  allowDrag: boolean;
};

/**
 * Pointer down on an object. A plain press selects that object alone, except
 * while it is part of a multi-selection, where the set is preserved so the
 * drag can move all of it.
 */
export function resolvePointerDownSelection({
  current,
  id,
  additive = false,
}: {
  current: readonly string[];
  id: string;
  additive?: boolean;
}): PointerDownSelection {
  if (additive) {
    return { selection: toggleSelection(current, id), collapseOnRelease: false, allowDrag: false };
  }
  if (current.includes(id)) {
    return { selection: [...current], collapseOnRelease: current.length > 1, allowDrag: true };
  }
  return { selection: [id], collapseOnRelease: false, allowDrag: true };
}

/**
 * Pointer up after pressing an object inside a multi-selection. Returns the
 * next selection, or null when nothing should change (the pointer moved, so
 * the gesture was a drag and the whole selection stays).
 */
export function resolvePointerUpSelection({
  current,
  id,
  moved,
  collapseOnRelease,
}: {
  current: readonly string[];
  id: string;
  moved: boolean;
  collapseOnRelease: boolean;
}): string[] | null {
  if (!collapseOnRelease || moved) return null;
  if (!current.includes(id)) return null;
  return [id];
}

/**
 * Pointer up after a marquee gesture on empty canvas. A gesture that never
 * moved is a plain background click, which clears the selection.
 */
export function resolveMarqueeSelection({
  original,
  found,
  additive = false,
  moved,
}: {
  original: readonly string[];
  found: readonly string[];
  additive?: boolean;
  moved: boolean;
}): string[] {
  if (!moved) return additive ? unique(original) : [];
  return additive ? unique([...original, ...found]) : unique(found);
}

/**
 * Drops ids that are no longer selectable (page switch, group scope change,
 * deletion) while preserving order and identity when nothing changed, so React
 * state updates stay no-ops.
 */
export function sanitizeSelection(ids: readonly string[], selectable: Iterable<string>): string[] {
  const allowed = selectable instanceof Set ? selectable : new Set(selectable);
  const seen = new Set<string>();
  const next: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id) || !allowed.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
}

export function selectionsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
