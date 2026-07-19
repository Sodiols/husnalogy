"use client";

import { customerEditablePermissionBundle } from "@/lib/customizer";
import { createGridSlots } from "@/lib/customizer/v2/grids";
import {
  getDescendantIds,
  groupLayers as createPersistentGroup,
  transformGroupChildren,
  ungroupLayers as removePersistentGroup,
} from "@/lib/customizer/v2/groups";

// Shared helpers for the admin visual Design Builder. Pure functions that take a
// template and return a new template — the builder owns undo/redo on top.

export function genId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export function keyify(value: string) {
  return String(value || "")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export function getEnabledBuilderPages(template: any): any[] {
  return (template?.pages || []).filter((p: any) => p.enabled !== false);
}

export function layersForPage(template: any, pageId: string): any[] {
  return (template?.layers || [])
    .filter((l: any) => l.page === pageId)
    .slice()
    .sort((a: any, b: any) => Number(a.zIndex || 0) - Number(b.zIndex || 0));
}

export function getLayer(template: any, layerId: string): any {
  return (template?.layers || []).find((l: any) => l.id === layerId) || null;
}

export function getConnectedField(template: any, layer: any): any {
  if (!layer?.fieldId) return null;
  return (template?.fields || []).find((f: any) => f.id === layer.fieldId) || null;
}

function nextZIndex(template: any, pageId: string) {
  const zs = (template?.layers || []).filter((l: any) => l.page === pageId).map((l: any) => Number(l.zIndex || 0));
  return (zs.length ? Math.max(...zs) : 0) + 1;
}

/* ---------- layer factories ---------- */

export function newTextLayer(template: any, pageId: string) {
  const cx = Math.round((template?.canvasWidthPx || 1500) / 2);
  const cy = Math.round((template?.canvasHeightPx || 2100) / 2);
  return {
    id: genId("text"),
    name: "Text",
    page: pageId,
    type: "text",
    text: "Your text",
    fieldId: "",
    x: cx,
    y: cy,
    width: 1000,
    height: 120,
    rotation: 0,
    zIndex: nextZIndex(template, pageId),
    opacity: 1,
    hidden: false,
    locked: false,
    adminEditable: true,
    customerEditable: false,
    textStyle: {
      fontFamily: "Cormorant Garamond",
      fontSize: 72,
      fontWeight: "400",
      color: "#303839",
      letterSpacing: 2,
      lineHeight: 1.15,
      textAlign: "center",
      uppercase: false,
      multiline: false,
    },
  };
}

export function newImageLayer(template: any, pageId: string, src = "") {
  const cx = Math.round((template?.canvasWidthPx || 1500) / 2);
  const cy = Math.round((template?.canvasHeightPx || 2100) / 2);
  return {
    id: genId("image"),
    name: src ? "Image" : "Photo placeholder",
    page: pageId,
    type: "image",
    src,
    fieldId: "",
    x: cx,
    y: cy,
    width: 700,
    height: 700,
    rotation: 0,
    zIndex: nextZIndex(template, pageId),
    opacity: 1,
    hidden: false,
    locked: false,
    adminEditable: true,
    customerEditable: false,
    maskShape: "rectangle",
    fitMode: "cover",
    allowZoom: true,
    allowReposition: true,
  };
}

export function newShapeLayer(template: any, pageId: string, shape = "rectangle") {
  const cx = Math.round((template?.canvasWidthPx || 1500) / 2);
  const cy = Math.round((template?.canvasHeightPx || 2100) / 2);
  return {
    id: genId("shape"),
    name: shape === "line" ? "Line" : "Shape",
    page: pageId,
    type: "shape",
    shape,
    fill: shape === "line" ? "none" : "#F8F6F1",
    stroke: shape === "line" ? "#303839" : "",
    strokeWidth: shape === "line" ? 4 : 0,
    borderRadius: 0,
    fieldId: "",
    x: cx,
    y: cy,
    width: shape === "line" ? 900 : 500,
    height: shape === "line" ? 6 : 300,
    rotation: 0,
    zIndex: nextZIndex(template, pageId),
    opacity: 1,
    hidden: false,
    locked: false,
    adminEditable: true,
    customerEditable: false,
    lineStyle: "solid",
    lineCap: "round",
    lineStartCap: "none",
    lineEndCap: "none",
    points: shape === "polygon" ? [{ x: 0.5, y: 0 }, { x: 1, y: 0.38 }, { x: 0.82, y: 1 }, { x: 0.18, y: 1 }, { x: 0, y: 0.38 }] : [],
  };
}

export function newGridLayer(template: any, pageId: string, columns = 2, rows = 2) {
  const cx = Math.round((template?.canvasWidthPx || 1500) / 2);
  const cy = Math.round((template?.canvasHeightPx || 2100) / 2);
  return {
    id: genId("grid"),
    name: "Photo grid",
    page: pageId,
    type: "grid",
    columns,
    rows,
    slots: createGridSlots(columns, rows),
    x: cx,
    y: cy,
    width: Math.round((template?.canvasWidthPx || 1500) * 0.72),
    height: Math.round((template?.canvasHeightPx || 2100) * 0.48),
    rotation: 0,
    zIndex: nextZIndex(template, pageId),
    opacity: 1,
    gap: 18,
    padding: 0,
    cornerRadius: 0,
    borderColor: "",
    borderWidth: 0,
    backgroundColor: "#F8F6F1",
    hidden: false,
    locked: false,
    adminEditable: true,
    customerEditable: true,
    customerPermissions: customerEditablePermissionBundle(true),
    groupId: "",
    fieldId: "",
  };
}

export function newElementLayer(template: any, pageId: string, element: any) {
  const canvasW = Number(template?.canvasWidthPx) || 1500;
  const canvasH = Number(template?.canvasHeightPx) || 2100;
  const width = Math.round(canvasW * 0.25);
  const ratio = Number(element?.width) > 0 && Number(element?.height) > 0 ? Number(element.height) / Number(element.width) : 1;
  return {
    id: genId("element"),
    name: element?.name || "Element",
    page: pageId,
    type: "element",
    assetId: element?.id || "",
    src: element?.url || element?.src || "",
    tintColor: element?.tintable ? element?.defaultColor || "" : "",
    x: Math.round(canvasW / 2),
    y: Math.round(canvasH / 2),
    width,
    height: Math.max(24, Math.round(width * ratio)),
    rotation: 0,
    zIndex: nextZIndex(template, pageId),
    opacity: 1,
    flipX: false,
    flipY: false,
    hidden: false,
    locked: false,
    adminEditable: true,
    customerEditable: false,
    groupId: "",
    fieldId: "",
  };
}

export function newBackgroundLayer(template: any, pageId: string, src = "") {
  const width = Number(template?.canvasWidthPx) || 1500;
  const height = Number(template?.canvasHeightPx) || 2100;
  return {
    id: genId("background"),
    name: "Background",
    page: pageId,
    type: "background",
    color: "#ffffff",
    src,
    fitMode: "cover",
    x: width / 2,
    y: height / 2,
    width,
    height,
    rotation: 0,
    zIndex: Math.min(0, ...layersForPage(template, pageId).map((layer: any) => Number(layer.zIndex) || 0)) - 1,
    opacity: 1,
    hidden: false,
    locked: true,
    adminEditable: true,
    customerEditable: false,
    groupId: "",
    fieldId: "",
  };
}

export function newQRCodeLayer(template: any, pageId: string) {
  const size = Math.max(180, Math.round(Math.min(Number(template?.canvasWidthPx) || 1500, Number(template?.canvasHeightPx) || 2100) * 0.2));
  return {
    id: genId("qr"),
    name: "QR code",
    page: pageId,
    type: "qrCode",
    value: "https://husnalogy.com",
    foregroundColor: "#303839",
    backgroundColor: "#ffffff",
    errorCorrection: "M",
    margin: 4,
    moduleStyle: "square",
    required: false,
    x: Math.round((Number(template?.canvasWidthPx) || 1500) / 2),
    y: Math.round((Number(template?.canvasHeightPx) || 2100) / 2),
    width: size,
    height: size,
    rotation: 0,
    zIndex: nextZIndex(template, pageId),
    opacity: 1,
    hidden: false,
    locked: false,
    positionLocked: false,
    customerInteractionDisabled: false,
    adminEditable: true,
    customerEditable: false,
    groupId: "",
    fieldId: "",
  };
}

/* ---------- template mutations ---------- */

export function addLayer(template: any, layer: any) {
  return { ...template, layers: [...(template.layers || []), layer] };
}

export function updateLayer(template: any, layerId: string, patch: any) {
  const layer = getLayer(template, layerId);
  if (layer?.type === "group" && ["x", "y", "width", "height", "rotation"].some((key) => patch[key] !== undefined)) {
    return { ...template, layers: transformGroupChildren(template.layers || [], layerId, patch) };
  }
  return { ...template, layers: (template.layers || []).map((l: any) => (l.id === layerId ? { ...l, ...patch } : l)) };
}

export function updateLayerStyle(template: any, layerId: string, stylePatch: any) {
  return {
    ...template,
    layers: (template.layers || []).map((l: any) =>
      l.id === layerId ? { ...l, textStyle: { ...(l.textStyle || {}), ...stylePatch } } : l,
    ),
  };
}

export function removeLayer(template: any, layerId: string) {
  const layer = getLayer(template, layerId);
  let fields = template.fields || [];
  if (layer?.fieldId) fields = fields.filter((f: any) => f.id !== layer.fieldId);
  const removeIds = new Set([layerId, ...(layer?.type === "group" ? getDescendantIds(template.layers || [], layerId) : [])]);
  const removedFieldIds = new Set((template.layers || []).filter((item: any) => removeIds.has(item.id)).map((item: any) => item.fieldId).filter(Boolean));
  fields = fields.filter((field: any) => !removedFieldIds.has(field.id));
  return { ...template, fields, layers: (template.layers || []).filter((l: any) => !removeIds.has(l.id)) };
}

export function duplicateLayer(template: any, layerId: string) {
  const layer = getLayer(template, layerId);
  if (!layer) return { template, newId: null };
  if (layer.type === "group") {
    const sourceIds = [layerId, ...getDescendantIds(template.layers || [], layerId)];
    const idMap = new Map(sourceIds.map((id) => [id, genId(getLayer(template, id)?.type || "layer")]));
    const copies = (template.layers || [])
      .filter((item: any) => idMap.has(item.id))
      .map((item: any) => ({
        ...item,
        id: idMap.get(item.id),
        name: item.id === layerId ? `${item.name} copy` : item.name,
        x: Number(item.x || 0) + 40,
        y: Number(item.y || 0) + 40,
        groupId: item.groupId && idMap.has(item.groupId) ? idMap.get(item.groupId) : item.groupId,
        childIds: Array.isArray(item.childIds) ? item.childIds.map((id: string) => idMap.get(id) || id) : item.childIds,
        fieldId: "",
        customerEditable: false,
      }));
    const newId = idMap.get(layerId) || null;
    return { template: { ...template, layers: [...(template.layers || []), ...copies] }, newId };
  }
  const copy = {
    ...layer,
    id: genId(layer.type),
    name: `${layer.name} copy`,
    x: layer.x + 40,
    y: layer.y + 40,
    zIndex: nextZIndex(template, layer.page),
    // A duplicate should not double-bind to the same customer field.
    fieldId: "",
    customerEditable: false,
  };
  return { template: { ...template, layers: [...(template.layers || []), copy] }, newId: copy.id };
}

export function groupSelectedLayers(template: any, layerIds: string[]) {
  const groupId = genId("group");
  return { template: { ...template, layers: createPersistentGroup(template.layers || [], layerIds, groupId) }, groupId };
}

export function ungroupLayer(template: any, groupId: string) {
  return { ...template, layers: removePersistentGroup(template.layers || [], groupId) };
}

// Move a layer up/down in stacking order within its page.
export function reorderLayer(template: any, layerId: string, direction: "up" | "down") {
  const layer = getLayer(template, layerId);
  if (!layer) return template;
  const siblings = layersForPage(template, layer.page);
  const index = siblings.findIndex((l: any) => l.id === layerId);
  const swapWith = direction === "up" ? siblings[index + 1] : siblings[index - 1];
  if (!swapWith) return template;
  const z1 = layer.zIndex;
  const z2 = swapWith.zIndex;
  const swapped = {
    ...template,
    layers: (template.layers || []).map((l: any) => {
      if (l.id === layer.id) return { ...l, zIndex: z2 };
      if (l.id === swapWith.id) return { ...l, zIndex: z1 };
      return l;
    }),
  };
  return normalizeZIndexes(swapped, layer.page);
}

/* ---------- field <-> layer linking (the two-controls model) ---------- */

function defaultFieldType(layer: any) {
  if (layer.type === "image") return "image";
  if (layer.textStyle?.multiline) return "textarea";
  return "text";
}

// Turn customer-editing on/off for a layer, creating or removing its field.
export function setCustomerEditable(template: any, layerId: string, editable: boolean) {
  const layer = getLayer(template, layerId);
  if (!layer) return template;
  const customerPermissions = customerEditablePermissionBundle(editable);

  if (!editable) {
    const fields = (template.fields || []).filter((f: any) => f.id !== layer.fieldId);
    return {
      ...template,
      fields,
      layers: updateLayer(template, layerId, {
        customerEditable: false,
        customerPermissions,
        fieldId: "",
      }).layers,
    };
  }

  // Create a field if one is not already linked.
  let fields = template.fields || [];
  let fieldId = layer.fieldId;
  if (!fieldId || !fields.some((f: any) => f.id === fieldId)) {
    fieldId = keyify(layer.name) || genId("field");
    // Avoid key collisions.
    if (fields.some((f: any) => f.id === fieldId)) fieldId = `${fieldId}_${genId("f")}`;
    const field = {
      id: fieldId,
      label: layer.name || "Editable field",
      type: defaultFieldType(layer),
      required: false,
      defaultValue: layer.type === "image" ? "" : layer.text || "",
      placeholder: layer.type === "image" ? "" : layer.text || "",
      helpText: "",
      maxLength: 0,
      options: [],
      customerVisible: true,
    };
    fields = [...fields, field];
  }

  return {
    ...template,
    fields,
    layers: (template.layers || []).map((l: any) =>
      l.id === layerId
        ? { ...l, customerEditable: true, customerPermissions, fieldId }
        : l,
    ),
  };
}

// Update the connected field's props from the right panel. Changing the key
// cleans it, prevents duplicate ids, updates the layer's fieldId, and re-points
// any other layer that shared the old id — so no layer is ever left dangling.
export function updateConnectedField(template: any, layerId: string, patch: any) {
  let working = template;
  let layer = getLayer(working, layerId);
  if (!layer) return template;

  if (!layer.fieldId || !(working.fields || []).some((f: any) => f.id === layer.fieldId)) {
    working = setCustomerEditable(working, layerId, true);
    layer = getLayer(working, layerId);
  }
  if (!layer?.fieldId) return working;

  const currentId = layer.fieldId;
  const currentField = (working.fields || []).find((f: any) => f.id === currentId);
  if (!currentField) return working;

  let nextFieldId = currentId;
  const fieldPatch = { ...patch };
  delete fieldPatch.key;

  if (patch.key !== undefined) {
    const otherIds = new Set((working.fields || []).filter((f: any) => f.id !== currentId).map((f: any) => f.id));
    let desired = keyify(patch.key) || currentId;
    if (otherIds.has(desired)) {
      let i = 2;
      while (otherIds.has(`${desired}_${i}`)) i += 1;
      desired = `${desired}_${i}`;
    }
    nextFieldId = desired;
  }

  const sharedWithOtherLayer = (working.layers || []).some((l: any) => l.id !== layerId && l.fieldId === currentId);

  if (patch.key !== undefined && nextFieldId !== currentId && sharedWithOtherLayer) {
    const fields = [
      ...(working.fields || []),
      {
        ...currentField,
        ...fieldPatch,
        id: nextFieldId,
      },
    ];
    const layers = (working.layers || []).map((l: any) => (l.id === layerId ? { ...l, fieldId: nextFieldId } : l));
    return { ...working, fields, layers };
  }

  const fields = (working.fields || []).map((f: any) =>
    f.id === currentId
      ? {
          ...f,
          ...fieldPatch,
          id: nextFieldId,
        }
      : f,
  );

  const layers = (working.layers || []).map((l: any) => (l.id === layerId ? { ...l, fieldId: nextFieldId } : l));
  return { ...working, fields, layers };
}

/* ---------- layer stacking (arrange) ---------- */

// Renumber a page's layers to clean 1..n by their current stacking order.
export function normalizeZIndexes(template: any, pageId: string) {
  const ordered = layersForPage(template, pageId); // ascending
  const idToZ = new Map(ordered.map((l: any, i: number) => [l.id, i + 1]));
  return {
    ...template,
    layers: (template.layers || []).map((l: any) => (l.page === pageId && idToZ.has(l.id) ? { ...l, zIndex: idToZ.get(l.id) } : l)),
  };
}

export function bringLayerToFront(template: any, layerId: string) {
  const layer = getLayer(template, layerId);
  if (!layer) return template;
  const maxZ = Math.max(0, ...layersForPage(template, layer.page).map((l: any) => l.zIndex || 0));
  return normalizeZIndexes(updateLayer(template, layerId, { zIndex: maxZ + 1 }), layer.page);
}

export function sendLayerToBack(template: any, layerId: string) {
  const layer = getLayer(template, layerId);
  if (!layer) return template;
  const minZ = Math.min(0, ...layersForPage(template, layer.page).map((l: any) => l.zIndex || 0));
  return normalizeZIndexes(updateLayer(template, layerId, { zIndex: minZ - 1 }), layer.page);
}

/* ---------- alignment & distribution (spec §8) ---------- */

export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";

// Align layers. One layer aligns to the canvas; several align to their
// combined bounding box.
export function alignLayers(template: any, layerIds: string[], mode: AlignMode) {
  const layers = layerIds.map((id) => getLayer(template, id)).filter(Boolean);
  if (!layers.length) return template;

  const canvasW = Number(template.canvasWidthPx) || 1500;
  const canvasH = Number(template.canvasHeightPx) || 2100;
  let left: number, right: number, top: number, bottom: number;
  if (layers.length === 1) {
    left = 0;
    right = canvasW;
    top = 0;
    bottom = canvasH;
  } else {
    left = Math.min(...layers.map((l: any) => l.x - l.width / 2));
    right = Math.max(...layers.map((l: any) => l.x + l.width / 2));
    top = Math.min(...layers.map((l: any) => l.y - l.height / 2));
    bottom = Math.max(...layers.map((l: any) => l.y + l.height / 2));
  }

  const patchFor = (layer: any) => {
    switch (mode) {
      case "left":
        return { x: Math.round(left + layer.width / 2) };
      case "center":
        return { x: Math.round((left + right) / 2) };
      case "right":
        return { x: Math.round(right - layer.width / 2) };
      case "top":
        return { y: Math.round(top + layer.height / 2) };
      case "middle":
        return { y: Math.round((top + bottom) / 2) };
      case "bottom":
        return { y: Math.round(bottom - layer.height / 2) };
      default:
        return {};
    }
  };

  const idSet = new Set(layerIds);
  return {
    ...template,
    layers: (template.layers || []).map((l: any) => (idSet.has(l.id) ? { ...l, ...patchFor(l) } : l)),
  };
}

// Distribute 3+ layers with equal spacing between their centres.
export function distributeLayers(template: any, layerIds: string[], axis: "horizontal" | "vertical") {
  const layers = layerIds.map((id) => getLayer(template, id)).filter(Boolean);
  if (layers.length < 3) return template;

  const key = axis === "horizontal" ? "x" : "y";
  const sorted = [...layers].sort((a: any, b: any) => a[key] - b[key]);
  const first = sorted[0][key];
  const last = sorted[sorted.length - 1][key];
  const step = (last - first) / (sorted.length - 1);

  const positions = new Map(sorted.map((l: any, i: number) => [l.id, Math.round(first + step * i)]));
  return {
    ...template,
    layers: (template.layers || []).map((l: any) =>
      positions.has(l.id) ? { ...l, [key]: positions.get(l.id) } : l,
    ),
  };
}

// Match dimensions to the first-selected (reference) layer.
export function matchLayerSize(template: any, layerIds: string[], dimension: "width" | "height" | "both") {
  const layers = layerIds.map((id) => getLayer(template, id)).filter(Boolean);
  if (layers.length < 2) return template;
  const reference = layers[0];
  const idSet = new Set(layerIds.slice(1));
  return {
    ...template,
    layers: (template.layers || []).map((l: any) => {
      if (!idSet.has(l.id)) return l;
      const patch: any = {};
      if (dimension === "width" || dimension === "both") patch.width = reference.width;
      if (dimension === "height" || dimension === "both") patch.height = reference.height;
      return { ...l, ...patch };
    }),
  };
}

// Move several layers by the same delta (multiselect drag).
export function moveLayers(template: any, layerIds: string[], dx: number, dy: number) {
  let layers = template.layers || [];
  const groupIds = new Set(layerIds.filter((id) => getLayer(template, id)?.type === "group"));
  const descendants = new Set([...groupIds].flatMap((id) => getDescendantIds(layers, id)));
  for (const id of groupIds) {
    const group = layers.find((layer: any) => layer.id === id);
    if (group) layers = transformGroupChildren(layers, id, { x: Math.round(group.x + dx), y: Math.round(group.y + dy) });
  }
  const idSet = new Set(layerIds.filter((id) => !groupIds.has(id) && !descendants.has(id)));
  layers = layers.map((layer: any) =>
    idSet.has(layer.id) ? { ...layer, x: Math.round(layer.x + dx), y: Math.round(layer.y + dy) } : layer,
  );
  return { ...template, layers };
}

/* ---------- page management (Section 27) ---------- */

function pageIdFromLabel(template: any, label: string) {
  const base = keyify(label) || "page";
  const taken = new Set((template.pages || []).map((p: any) => p.id));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

export function addPage(template: any, label = "") {
  const count = (template.pages || []).length;
  const finalLabel = label || `Page ${count + 1}`;
  const page = {
    id: pageIdFromLabel(template, finalLabel),
    label: finalLabel,
    enabled: true,
    backgroundColor: "#ffffff",
    backgroundImage: "",
  };
  return { template: { ...template, pages: [...(template.pages || []), page] }, pageId: page.id };
}

export function duplicatePage(template: any, pageId: string) {
  const pages = template.pages || [];
  const index = pages.findIndex((p: any) => p.id === pageId);
  if (index === -1) return { template, pageId: null };
  const source = pages[index];
  const copy = { ...source, id: pageIdFromLabel(template, `${source.label} copy`), label: `${source.label} copy` };
  const nextPages = [...pages.slice(0, index + 1), copy, ...pages.slice(index + 1)];

  // Copy the page's layers too. Duplicated editable layers lose their field
  // binding so field keys stay unique (admin reconnects what they need).
  const copiedLayers = (template.layers || [])
    .filter((l: any) => l.page === pageId)
    .map((l: any) => ({ ...l, id: genId(l.type), page: copy.id, fieldId: "", customerEditable: false }));

  return {
    template: { ...template, pages: nextPages, layers: [...(template.layers || []), ...copiedLayers] },
    pageId: copy.id,
  };
}

export function renamePage(template: any, pageId: string, label: string) {
  return {
    ...template,
    pages: (template.pages || []).map((p: any) => (p.id === pageId ? { ...p, label: label || p.label } : p)),
  };
}

export function patchPage(template: any, pageId: string, patch: any) {
  return {
    ...template,
    pages: (template.pages || []).map((p: any) => (p.id === pageId ? { ...p, ...patch } : p)),
  };
}

export function movePage(template: any, pageId: string, direction: "up" | "down") {
  const pages = [...(template.pages || [])];
  const index = pages.findIndex((p: any) => p.id === pageId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= pages.length) return template;
  [pages[index], pages[target]] = [pages[target], pages[index]];
  return { ...template, pages };
}

// Deleting a page removes its layers and their connected fields. The caller
// must confirm first and must not allow deleting the only page.
export function deletePage(template: any, pageId: string) {
  const pages = template.pages || [];
  if (pages.length <= 1) return template;
  const removedLayerFieldIds = new Set(
    (template.layers || []).filter((l: any) => l.page === pageId && l.fieldId).map((l: any) => l.fieldId),
  );
  const layers = (template.layers || []).filter((l: any) => l.page !== pageId);
  // Only drop fields that no remaining layer references.
  const stillUsed = new Set(layers.map((l: any) => l.fieldId).filter(Boolean));
  const fields = (template.fields || []).filter((f: any) => !removedLayerFieldIds.has(f.id) || stillUsed.has(f.id));
  const nextPages = pages.filter((p: any) => p.id !== pageId);
  const defaultPage = template.defaultPage === pageId ? nextPages[0]?.id || "front" : template.defaultPage;
  return { ...template, pages: nextPages, layers, fields, defaultPage };
}

export async function uploadBuilderImage(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("folder", "product-images");
  formData.append("files", file);
  const res = await fetch("/api/admin/uploads", { method: "POST", body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data?.error || "Upload failed.");
  return Array.isArray(data.urls) ? data.urls[0] || "" : "";
}
