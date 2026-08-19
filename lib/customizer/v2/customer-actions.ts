import { distributeAlongAxis, groupLayers, resolveGroupBounds, rotatedAxisHalfExtents, ungroupLayers } from "./groups";
import { reorderLayersByDrop } from "./interaction/layer-reorder";
import {
  marqueeSelectedLayerIds,
  selectionBounds as resolveSelectionBounds,
  type SelectionRect,
} from "./selection-geometry";

export type ArrangeAction = "bringForward" | "sendBackward" | "bringToFront" | "sendToBack";
export type AlignAction =
  | "alignLeft" | "alignCenter" | "alignRight" | "alignTop" | "alignMiddle" | "alignBottom"
  | "distributeHorizontal" | "distributeVertical"
  | "distributeHorizontalCenters" | "distributeVerticalCenters"
  | "centerOnCardHorizontal" | "centerOnCardVertical" | "centerOnCard";
export type CardSize = { width: number; height: number };
const CARD_ONLY_ACTIONS = new Set<AlignAction>(["centerOnCardHorizontal", "centerOnCardVertical", "centerOnCard"]);

export function layersInsideSelection(rect: SelectionRect, layers: any[]): string[] {
  return marqueeSelectedLayerIds(
    rect,
    layers.filter((layer) => !layer.customerInteractionDisabled),
  );
}

export function arrangeLayers(layers: any[], selectedIds: string[], action: ArrangeAction): any[] {
  const ids = new Set(selectedIds);
  if (!ids.size) return layers;
  const ordered = layers.slice().sort((a, b) => Number(a.zIndex || 0) - Number(b.zIndex || 0));
  const movable = (layer: any) => ids.has(layer.id) && (layer.isUserLayer || (layer.customerEditable && layer.customerPermissions?.changeLayerOrder !== false)) && !layer.customerInteractionDisabled;
  const protectedLayer = (layer: any) => !ids.has(layer.id) && (!layer.customerEditable || layer.customerInteractionDisabled);

  if (action === "bringForward") {
    for (let index = ordered.length - 2; index >= 0; index -= 1) {
      if (movable(ordered[index]) && !ids.has(ordered[index + 1].id) && !protectedLayer(ordered[index + 1])) [ordered[index], ordered[index + 1]] = [ordered[index + 1], ordered[index]];
    }
  } else if (action === "sendBackward") {
    for (let index = 1; index < ordered.length; index += 1) {
      if (movable(ordered[index]) && !ids.has(ordered[index - 1].id) && !protectedLayer(ordered[index - 1])) [ordered[index - 1], ordered[index]] = [ordered[index], ordered[index - 1]];
    }
  } else {
    const selected = ordered.filter(movable);
    const rest = ordered.filter((layer) => !ids.has(layer.id));
    const selectedMinZ = Math.min(...selected.map((layer) => Number(layer.zIndex) || 0));
    const selectedMaxZ = Math.max(...selected.map((layer) => Number(layer.zIndex) || 0));
    if (action === "bringToFront") {
      const firstProtectedAbove = rest.findIndex((layer) => protectedLayer(layer) && (Number(layer.zIndex) || 0) > selectedMaxZ);
      rest.splice(firstProtectedAbove < 0 ? rest.length : firstProtectedAbove, 0, ...selected);
    } else {
      const lastProtectedBelow = rest.reduce((last, layer, index) => protectedLayer(layer) && (Number(layer.zIndex) || 0) < selectedMinZ ? index : last, -1);
      rest.splice(lastProtectedBelow + 1, 0, ...selected);
    }
    ordered.splice(0, ordered.length, ...rest);
  }
  return ordered.map((layer, index) => ({ ...layer, zIndex: index + 1 }));
}

// Reorder a single layer from the layers panel without allowing it to cross an
// administrator-protected layer. The returned z-indexes remain deterministic,
// which keeps undo/redo and persisted customer overrides stable.
/**
 * Customer-side drop reorder. The maths lives in the shared reorder module —
 * admin uses the same function with its own policy — and only the PERMISSION
 * rule is customer-specific: a customer may move their own objects and any
 * template layer the admin marked reorderable, and may not jump a layer they
 * are not allowed to touch.
 */
export function reorderLayerByDrop(layers: any[], sourceId: string, targetId: string): any[] {
  return reorderLayersByDrop(layers, sourceId, targetId, {
    canMove: (layer) =>
      Boolean(
        (layer.isUserLayer || (layer.customerEditable && layer.customerPermissions?.changeLayerOrder !== false)) &&
          !layer.customerInteractionDisabled,
      ),
    canCross: (layer) =>
      Boolean((layer.isUserLayer || layer.customerEditable) && !layer.customerInteractionDisabled),
  });
}

export function groupCustomerLayers(layers: any[], selectedIds: string[], groupId: string): any[] {
  const selected = layers.filter((layer) => selectedIds.includes(layer.id));
  if (selected.length < 2 || selected.some((layer) => !layer.isUserLayer && !layer.customerPermissions?.group)) return layers;
  return groupLayers(layers, selectedIds, groupId, "Customer group").map((layer) => layer.id === groupId ? { ...layer, isUserLayer: true, customerEditable: true, allowCustomerUngroup: true } : layer);
}

export function ungroupCustomerLayers(layers: any[], groupId: string): any[] {
  const group = layers.find((layer) => layer.id === groupId && layer.type === "group");
  if (!group || (!group.isUserLayer && !group.allowCustomerUngroup)) return layers;
  return ungroupLayers(layers, groupId);
}

// Delete customer-created objects as one structural operation. Removing a
// group removes every descendant; removing individual children also unwraps
// groups that no longer contain enough objects to remain useful.
export function removeCustomerLayers(layers: any[], selectedIds: string[]): any[] {
  const removeIds = new Set(selectedIds.filter(Boolean));
  if (!removeIds.size) return layers;

  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const layer of layers) {
      if (!removeIds.has(String(layer.groupId || ""))) continue;
      if (!removeIds.has(layer.id)) {
        removeIds.add(layer.id);
        expanded = true;
      }
    }
  }

  let remaining = layers.filter((layer) => !removeIds.has(layer.id));
  let unwrapped = true;
  while (unwrapped) {
    unwrapped = false;
    const sparseGroups = new Map<string, string>();
    for (const group of remaining.filter((layer) => layer.type === "group")) {
      const childCount = remaining.filter((layer) => layer.groupId === group.id).length;
      if (childCount < 2) sparseGroups.set(group.id, String(group.groupId || ""));
    }
    if (!sparseGroups.size) break;
    remaining = remaining
      .filter((layer) => !sparseGroups.has(layer.id))
      .map((layer) => sparseGroups.has(String(layer.groupId || ""))
        ? { ...layer, groupId: sparseGroups.get(String(layer.groupId || "")) || "" }
        : layer);
    unwrapped = true;
  }

  const remainingIds = new Set(remaining.map((layer) => layer.id));
  return remaining.map((layer) => layer.type === "group" && Array.isArray(layer.childIds)
    ? { ...layer, childIds: layer.childIds.filter((id: string) => remainingIds.has(id)) }
    : layer);
}

export function selectionBounds(layers: any[], selectedIds: string[]) {
  return resolveSelectionBounds(layers, selectedIds);
}

// Distinct from aligning objects to EACH OTHER (spec §29): translates the
// whole selection as one block onto the card, preserving relative layout.
// Works for a single selected object too - "centre this one photo" is a
// normal single-object action, unlike align-to-each-other which needs 2+.
function centerSelectionOnCard(
  selected: any[],
  action: "centerOnCardHorizontal" | "centerOnCardVertical" | "centerOnCard",
  card: CardSize,
): Record<string, { x?: number; y?: number }> {
  const box = resolveGroupBounds(selected);
  if (!box) return {};
  const deltaX = card.width / 2 - box.x;
  const deltaY = card.height / 2 - box.y;
  const patches: Record<string, { x?: number; y?: number }> = {};
  for (const layer of selected) {
    const patch: { x?: number; y?: number } = {};
    if (action === "centerOnCardHorizontal" || action === "centerOnCard") patch.x = Number(layer.x) + deltaX;
    if (action === "centerOnCardVertical" || action === "centerOnCard") patch.y = Number(layer.y) + deltaY;
    patches[layer.id] = patch;
  }
  return patches;
}

export function alignCustomerLayers(
  layers: any[],
  selectedIds: string[],
  action: AlignAction,
  card?: CardSize,
): Record<string, { x?: number; y?: number }> {
  const selected = layers.filter((layer) => selectedIds.includes(layer.id));
  if (!selected.length) return {};
  if (CARD_ONLY_ACTIONS.has(action)) {
    if (!card || !(card.width > 0) || !(card.height > 0)) return {};
    return centerSelectionOnCard(selected, action as "centerOnCardHorizontal" | "centerOnCardVertical" | "centerOnCard", card);
  }
  if (selected.length < 2) return {};
  const box = resolveGroupBounds(selected);
  if (!box) return {};
  const patches: Record<string, { x?: number; y?: number }> = {};

  if (
    action === "distributeHorizontal" ||
    action === "distributeVertical" ||
    action === "distributeHorizontalCenters" ||
    action === "distributeVerticalCenters"
  ) {
    if (selected.length < 3) return {};
    const axis =
      action === "distributeHorizontal" || action === "distributeHorizontalCenters"
        ? "x"
        : "y";
    const positions =
      action === "distributeHorizontalCenters" || action === "distributeVerticalCenters"
        ? (() => {
            const sorted = selected.slice().sort((a, b) => Number(a[axis] || 0) - Number(b[axis] || 0));
            const first = Number(sorted[0][axis] || 0);
            const last = Number(sorted[sorted.length - 1][axis] || 0);
            const step = (last - first) / (sorted.length - 1);
            return sorted.map((layer, index) => ({ id: layer.id, center: first + step * index }));
          })()
        : distributeAlongAxis(selected, axis);
    for (const position of positions) {
      patches[position.id] = axis === "x" ? { x: position.center } : { y: position.center };
    }
    return patches;
  }

  for (const layer of selected) {
    const { halfW, halfH } = rotatedAxisHalfExtents(layer);
    if (action === "alignLeft") patches[layer.id] = { x: box.left + halfW };
    if (action === "alignCenter") patches[layer.id] = { x: box.x };
    if (action === "alignRight") patches[layer.id] = { x: box.right - halfW };
    if (action === "alignTop") patches[layer.id] = { y: box.top + halfH };
    if (action === "alignMiddle") patches[layer.id] = { y: box.y };
    if (action === "alignBottom") patches[layer.id] = { y: box.bottom - halfH };
  }
  return patches;
}
