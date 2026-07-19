import { groupLayers, resolveGroupBounds, ungroupLayers } from "./groups";

export type SelectionRect = { left: number; top: number; right: number; bottom: number };
export type ArrangeAction = "bringForward" | "sendBackward" | "bringToFront" | "sendToBack";
export type AlignAction = "alignLeft" | "alignCenter" | "alignRight" | "alignTop" | "alignMiddle" | "alignBottom" | "distributeHorizontal" | "distributeVertical";

function bounds(layer: any): SelectionRect {
  const halfW = Math.abs(Number(layer.width) || 0) / 2;
  const halfH = Math.abs(Number(layer.height) || 0) / 2;
  return { left: Number(layer.x) - halfW, top: Number(layer.y) - halfH, right: Number(layer.x) + halfW, bottom: Number(layer.y) + halfH };
}

export function layersInsideSelection(rect: SelectionRect, layers: any[]): string[] {
  const normalized = {
    left: Math.min(rect.left, rect.right),
    right: Math.max(rect.left, rect.right),
    top: Math.min(rect.top, rect.bottom),
    bottom: Math.max(rect.top, rect.bottom),
  };
  return layers.filter((layer) => {
    if (layer.hidden || layer.customerInteractionDisabled) return false;
    const box = bounds(layer);
    return box.left >= normalized.left && box.right <= normalized.right && box.top >= normalized.top && box.bottom <= normalized.bottom;
  }).map((layer) => layer.id);
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

export function selectionBounds(layers: any[], selectedIds: string[]) {
  return resolveGroupBounds(layers, selectedIds);
}

export function alignCustomerLayers(layers: any[], selectedIds: string[], action: AlignAction): Record<string, { x?: number; y?: number }> {
  const selected = layers.filter((layer) => selectedIds.includes(layer.id));
  if (selected.length < 2) return {};
  const box = resolveGroupBounds(selected);
  if (!box) return {};
  const patches: Record<string, { x?: number; y?: number }> = {};

  if (action === "distributeHorizontal" || action === "distributeVertical") {
    if (selected.length < 3) return {};
    const horizontal = action === "distributeHorizontal";
    const sorted = selected.slice().sort((a, b) => Number(horizontal ? a.x : a.y) - Number(horizontal ? b.x : b.y));
    const first = Number(horizontal ? sorted[0].x : sorted[0].y);
    const last = Number(horizontal ? sorted[sorted.length - 1].x : sorted[sorted.length - 1].y);
    const step = (last - first) / (sorted.length - 1);
    sorted.forEach((layer, index) => {
      patches[layer.id] = horizontal ? { x: first + step * index } : { y: first + step * index };
    });
    return patches;
  }

  for (const layer of selected) {
    const halfWidth = Math.abs(Number(layer.width) || 0) / 2;
    const halfHeight = Math.abs(Number(layer.height) || 0) / 2;
    if (action === "alignLeft") patches[layer.id] = { x: box.left + halfWidth };
    if (action === "alignCenter") patches[layer.id] = { x: box.x };
    if (action === "alignRight") patches[layer.id] = { x: box.right - halfWidth };
    if (action === "alignTop") patches[layer.id] = { y: box.top + halfHeight };
    if (action === "alignMiddle") patches[layer.id] = { y: box.y };
    if (action === "alignBottom") patches[layer.id] = { y: box.bottom - halfHeight };
  }
  return patches;
}
