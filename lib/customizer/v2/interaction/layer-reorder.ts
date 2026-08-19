/**
 * Drag-to-reorder mathematics, shared by the customer Layers panel and the
 * admin Layers panel.
 *
 * Reordering used to exist twice: the customer had drag-and-drop, admin had a
 * pair of ▲/▼ buttons that walked one step at a time. Two implementations of
 * "what does this list mean" is exactly how the two surfaces drift apart, and
 * the arrow buttons were the slower way to do the same job — moving a layer
 * from the bottom of a long stack to the top meant a dozen clicks.
 *
 * The ordering rule itself is identical on both surfaces: `zIndex` ascending is
 * back-to-front. What differs is POLICY — who may move what — so that is
 * injected rather than baked in, and each surface keeps its own permission
 * model where it belongs.
 */

export type ReorderPolicy = {
  /** May this layer be picked up at all? */
  canMove: (layer: any) => boolean;
  /**
   * May the dragged layer pass over this one? A layer the surface must not
   * reorder also must not be jumped, or the drop would silently restack it.
   */
  canCross: (layer: any) => boolean;
};

export const ADMIN_REORDER_POLICY: ReorderPolicy = {
  canMove: (layer) => Boolean(layer) && !layer.locked && layer.adminEditable !== false,
  canCross: (layer) => Boolean(layer) && !layer.locked && layer.adminEditable !== false,
};

/**
 * Is this a drop the surface should accept?
 *
 * Group hierarchy is preserved by construction: a drag only reorders WITHIN one
 * parent. Dropping a layer onto a member of another group would have to splice
 * it into that group, which is a different operation (regrouping) with
 * different geometry consequences — so it is refused rather than half-done.
 */
export function isValidLayerDrop(layers: readonly any[], sourceId: string, targetId: string): boolean {
  if (!sourceId || !targetId || sourceId === targetId) return false;
  const source = layers.find((layer) => layer?.id === sourceId);
  const target = layers.find((layer) => layer?.id === targetId);
  if (!source || !target) return false;
  if (String(source.groupId || "") !== String(target.groupId || "")) return false;
  // A group may never be dropped inside itself.
  if (source.type === "group" && isDescendantOf(layers, target, sourceId)) return false;
  return true;
}

function isDescendantOf(layers: readonly any[], layer: any, ancestorId: string): boolean {
  const seen = new Set<string>();
  let current = layer;
  while (current?.groupId) {
    if (seen.has(current.id)) return false; // corrupt parent chain: stop
    seen.add(current.id);
    if (current.groupId === ancestorId) return true;
    current = layers.find((candidate) => candidate?.id === current.groupId);
  }
  return false;
}

/**
 * Move `sourceId` to `targetId`'s slot, renumbering `zIndex` densely.
 *
 * Returns the ORIGINAL array unchanged when the move is not allowed, so callers
 * can use identity to decide whether anything happened — and therefore whether
 * to take a history snapshot at all.
 */
export function reorderLayersByDrop(
  layers: readonly any[],
  sourceId: string,
  targetId: string,
  policy: ReorderPolicy,
): any[] {
  if (!sourceId || !targetId || sourceId === targetId) return layers as any[];
  const ordered = layers.slice().sort((a, b) => Number(a.zIndex || 0) - Number(b.zIndex || 0));
  const sourceIndex = ordered.findIndex((layer) => layer.id === sourceId);
  const targetIndex = ordered.findIndex((layer) => layer.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return layers as any[];

  const source = ordered[sourceIndex];
  if (!policy.canMove(source)) return layers as any[];

  const direction = targetIndex > sourceIndex ? 1 : -1;
  for (let index = sourceIndex + direction; direction > 0 ? index <= targetIndex : index >= targetIndex; index += direction) {
    if (!policy.canCross(ordered[index])) return layers as any[];
  }

  ordered.splice(sourceIndex, 1);
  ordered.splice(targetIndex, 0, source);
  return ordered.map((layer, index) => ({ ...layer, zIndex: index + 1 }));
}

/**
 * Where a drop would land relative to the row under the pointer.
 *
 * Taken from the pointer's position within the row rather than from which row
 * fired the event, so the indicator sits where the customer is actually
 * pointing and a drop never feels like it went to the wrong side.
 */
export function resolveDropEdge(pointerY: number, rectTop: number, rectHeight: number): "before" | "after" {
  if (!(rectHeight > 0)) return "before";
  return pointerY - rectTop < rectHeight / 2 ? "before" : "after";
}
