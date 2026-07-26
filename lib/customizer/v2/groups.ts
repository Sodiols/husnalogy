export type TransformLike = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
};

export type Bounds = { x: number; y: number; width: number; height: number; left: number; top: number; right: number; bottom: number };

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolveGroupBounds(layers: any[], layerIds?: string[]): Bounds | null {
  const ids = layerIds ? new Set(layerIds) : null;
  const selected = layers.filter((layer) => (!ids || ids.has(layer.id)) && !layer.hidden);
  if (!selected.length) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const layer of selected) {
    const halfWidth = Math.abs(number(layer.width)) / 2;
    const halfHeight = Math.abs(number(layer.height)) / 2;
    const radians = (number(layer.rotation) * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    for (const [dx, dy] of [[-halfWidth, -halfHeight], [halfWidth, -halfHeight], [halfWidth, halfHeight], [-halfWidth, halfHeight]]) {
      const x = number(layer.x) + dx * cos - dy * sin;
      const y = number(layer.y) + dx * sin + dy * cos;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  return { left, top, right, bottom, width, height, x: left + width / 2, y: top + height / 2 };
}

export function getDescendantIds(layers: any[], groupId: string): string[] {
  const result: string[] = [];
  const queue = [groupId];
  const visited = new Set<string>();
  while (queue.length) {
    const parent = queue.shift()!;
    if (visited.has(parent)) continue;
    visited.add(parent);
    for (const layer of layers) {
      if (layer.groupId !== parent) continue;
      result.push(layer.id);
      if (layer.type === "group") queue.push(layer.id);
    }
  }
  return result;
}

export function wouldCreateGroupCycle(layers: any[], groupId: string, parentGroupId: string): boolean {
  if (!groupId || !parentGroupId) return false;
  if (groupId === parentGroupId) return true;
  return getDescendantIds(layers, groupId).includes(parentGroupId);
}

export function getRelativeTransform(layer: TransformLike, group: TransformLike): TransformLike {
  const radians = (-number(group.rotation) * Math.PI) / 180;
  const dx = layer.x - group.x;
  const dy = layer.y - group.y;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
    width: layer.width,
    height: layer.height,
    rotation: number(layer.rotation) - number(group.rotation),
  };
}

export function getAbsoluteTransform(relative: TransformLike, group: TransformLike): TransformLike {
  const radians = (number(group.rotation) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: group.x + relative.x * cos - relative.y * sin,
    y: group.y + relative.x * sin + relative.y * cos,
    width: relative.width,
    height: relative.height,
    rotation: number(relative.rotation) + number(group.rotation),
  };
}

export function groupLayers(layers: any[], layerIds: string[], groupId: string, name = "Group"): any[] {
  const ids = new Set(layerIds);
  const selected = layers.filter((layer) => ids.has(layer.id));
  if (selected.length < 2) return layers;
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  for (const layer of selected) {
    let parentId = String(layer.groupId || "");
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      if (ids.has(parentId)) return layers;
      visited.add(parentId);
      parentId = String(byId.get(parentId)?.groupId || "");
    }
  }
  const page = selected[0]?.page ?? selected[0]?.pageId;
  if (selected.some((layer) => (layer.page ?? layer.pageId) !== page)) return layers;
  const bounds = resolveGroupBounds(layers, layerIds);
  if (!bounds) return layers;
  const parentIds = new Set(selected.map((layer) => String(layer.groupId || "")));
  const parentGroupId = parentIds.size === 1 ? String(selected[0].groupId || "") : "";
  if (selected.some((layer) => layer.id === groupId || wouldCreateGroupCycle(layers, layer.id, groupId))) return layers;
  const maxZ = Math.max(...selected.map((layer) => number(layer.zIndex, 1)));
  const group = {
    id: groupId,
    name,
    page,
    pageId: page,
    type: "group",
    childIds: selected.map((layer) => layer.id),
    groupId: parentGroupId,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    scale: 1,
    rotation: 0,
    opacity: 1,
    zIndex: maxZ,
    hidden: false,
    locked: false,
    adminEditable: true,
    customerEditable: false,
    customerPermissions: {},
    allowCustomerUngroup: false,
    childSelection: "children",
    fieldId: "",
    metadata: { createdAt: new Date().toISOString() },
  };
  return [
    ...layers.map((layer) => {
      if (ids.has(layer.id)) return { ...layer, groupId };
      if (layer.id === parentGroupId && layer.type === "group") {
        const children = (Array.isArray(layer.childIds) ? layer.childIds : []).filter((id: string) => !ids.has(id));
        return { ...layer, childIds: [...children, groupId] };
      }
      return layer;
    }),
    group,
  ];
}

export function ungroupLayers(layers: any[], groupId: string): any[] {
  const group = layers.find((layer) => layer.id === groupId && layer.type === "group");
  if (!group) return layers;
  const parent = String(group.groupId || "");
  const childIds = layers.filter((layer) => layer.groupId === groupId).map((layer) => layer.id);
  return layers
    .filter((layer) => layer.id !== groupId)
    .map((layer) => {
      if (layer.groupId === groupId) return { ...layer, groupId: parent };
      if (layer.id === parent && layer.type === "group") {
        const children = (Array.isArray(layer.childIds) ? layer.childIds : []).filter((id: string) => id !== groupId);
        return { ...layer, childIds: [...children, ...childIds] };
      }
      return layer;
    });
}

export function transformGroupChildren(layers: any[], groupId: string, patch: Partial<TransformLike>): any[] {
  const group = layers.find((layer) => layer.id === groupId && layer.type === "group");
  if (!group) return layers;
  const oldWidth = Math.max(0.0001, number(group.width, 1));
  const oldHeight = Math.max(0.0001, number(group.height, 1));
  const proposed = { ...group, ...patch };
  const widthScale = Math.max(0.0001, number(proposed.width, oldWidth) / oldWidth);
  const heightScale = Math.max(0.0001, number(proposed.height, oldHeight) / oldHeight);
  const scale = patch.width !== undefined ? widthScale : patch.height !== undefined ? heightScale : 1;
  const next = patch.width !== undefined || patch.height !== undefined
    ? { ...proposed, width: oldWidth * scale, height: oldHeight * scale }
    : proposed;
  const scaleX = scale;
  const scaleY = scale;
  const rotationDelta = number(next.rotation) - number(group.rotation);
  const radians = (rotationDelta * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const descendants = new Set(getDescendantIds(layers, groupId));
  return layers.map((layer) => {
    if (layer.id === groupId) return next;
    if (!descendants.has(layer.id)) return layer;
    const dx = (number(layer.x) - number(group.x)) * scaleX;
    const dy = (number(layer.y) - number(group.y)) * scaleY;
    return {
      ...layer,
      x: number(next.x) + dx * cos - dy * sin,
      y: number(next.y) + dx * sin + dy * cos,
      width: Math.max(1, number(layer.width, 1) * scaleX),
      height: Math.max(1, number(layer.height, 1) * scaleY),
      rotation: number(layer.rotation) + rotationDelta,
    };
  });
}

export function validateGroupRelationships(layers: any[]): Array<{ groupId: string; code: string }> {
  const groups = new Map(layers.filter((layer) => layer.type === "group").map((layer) => [layer.id, layer]));
  const issues: Array<{ groupId: string; code: string }> = [];
  for (const layer of layers) {
    if (!layer.groupId) continue;
    if (!groups.has(layer.groupId)) issues.push({ groupId: layer.groupId, code: "GROUP_PARENT_MISSING" });
    if (layer.id === layer.groupId || wouldCreateGroupCycle(layers, layer.id, layer.groupId)) {
      issues.push({ groupId: layer.id, code: "INVALID_GROUP_CYCLE" });
    }
  }
  return issues;
}

export function getRenderableLayers(layers: any[], includeGroupContainers = true): any[] {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  return layers
    .filter((layer) => includeGroupContainers || layer.type !== "group")
    .map((layer) => {
      let opacity = number(layer.opacity, 1);
      let hidden = Boolean(layer.hidden);
      let parentId = String(layer.groupId || "");
      const visited = new Set<string>();
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        const parent = byId.get(parentId);
        if (!parent || parent.type !== "group") break;
        opacity *= number(parent.opacity, 1);
        hidden ||= Boolean(parent.hidden);
        parentId = String(parent.groupId || "");
      }
      return { ...layer, opacity: Math.min(1, Math.max(0, opacity)), hidden };
    })
    .sort((a, b) => number(a.zIndex) - number(b.zIndex));
}
