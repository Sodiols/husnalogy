"use client";

import { customerEditablePermissionBundle } from "@/lib/customizer";
import {
  ADMIN_REORDER_POLICY,
  isValidLayerDrop,
  reorderLayersByDrop,
} from "@/lib/customizer/v2/interaction/layer-reorder";
import { distributeAlongAxis, getDescendantIds, rotatedAxisHalfExtents, transformGroupChildren } from "@/lib/customizer/v2/groups";
import { marqueeSelectedLayerIds, type SelectionRect } from "@/lib/customizer/v2/selection-geometry";
import { getTextPlacementStyle, type TextPlacementPreset } from "@/lib/customizer/v2/text-editing";
import { DEFAULT_LETTER_SPACING, DEFAULT_LINE_HEIGHT } from "@/lib/customizer/v2/text-layout";

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

// The admin selects logical top-level objects. Children remain individually
// editable after Ungroup, but while grouped only the group container receives
// canvas interaction. Hidden groups also hide their descendants from marquee
// selection and Select All.
export function selectableLayersForPage(template: any, pageId: string, editingGroupId: string | null = null): any[] {
  const pageLayers = layersForPage(template, pageId);
  const byId = new Map(pageLayers.map((layer: any) => [layer.id, layer]));
  return pageLayers.filter((layer: any) => {
    if (layer.hidden || layer.adminEditable === false) return false;
    if (editingGroupId && layer.id === editingGroupId) return false;
    let parentId = String(layer.groupId || "");
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      if (editingGroupId && parentId === editingGroupId) {
        return String(layer.groupId || "") === editingGroupId;
      }
      // A valid ancestor means the ancestor is the logical selectable object.
      return false;
    }
    return true;
  });
}

export function marqueeLayerIdsForSelection(rect: SelectionRect, layers: any[]): string[] {
  return marqueeSelectedLayerIds(rect, layers);
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

export function newTextLayer(
  template: any,
  pageId: string,
  options: { x?: number; y?: number; text?: string; preset?: TextPlacementPreset } = {},
) {
  const cx = Math.round((template?.canvasWidthPx || 1500) / 2);
  const cy = Math.round((template?.canvasHeightPx || 2100) / 2);
  const placed = Number.isFinite(options.x) && Number.isFinite(options.y);
  const preset = getTextPlacementStyle(
    options.preset || "body",
    Number(template?.canvasWidthPx) || 1500,
    Number(template?.canvasHeightPx) || 2100,
  );
  return {
    id: genId("text"),
    name: placed ? preset.name : "Text",
    page: pageId,
    type: "text",
    text: options.text ?? (placed ? "" : "Your text"),
    fieldId: "",
    x: placed ? Number(options.x) : cx,
    y: placed ? Number(options.y) : cy,
    width: placed ? preset.width : 1000,
    height: placed ? preset.height : 120,
    rotation: 0,
    zIndex: nextZIndex(template, pageId),
    opacity: 1,
    hidden: false,
    locked: false,
    adminEditable: true,
    customerEditable: false,
    textStyle: {
      fontFamily: "Cormorant Garamond",
      fontSize: placed ? preset.fontSize : 72,
      fontWeight: "400",
      color: "#303839",
      letterSpacing: placed ? preset.letterSpacing : DEFAULT_LETTER_SPACING,
      lineHeight: placed ? preset.lineHeight : DEFAULT_LINE_HEIGHT,
      textAlign: placed ? preset.textAlign : "center",
      verticalAlign: "middle",
      uppercase: false,
      multiline: placed ? preset.multiline : false,
      autoSizeMode: placed ? (preset.multiline ? "height" : "width") : "fixed",
      fitMode: placed && preset.multiline ? "auto-height" : "fixed",
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

export function newElementLayer(template: any, pageId: string, element: any) {
  const canvasW = Number(template?.canvasWidthPx) || 1500;
  const canvasH = Number(template?.canvasHeightPx) || 2100;
  const width = Math.round(canvasW * 0.25);
  const ratio = Number(element?.width) > 0 && Number(element?.height) > 0 ? Number(element.height) / Number(element.width) : 1;
  return {
    id: genId("element"),
    name: element?.title || element?.name || "Element",
    page: pageId,
    type: "element",
    assetId: element?.id || "",
    bucket: element?.bucket || "customizer-elements",
    path: element?.originalPath || element?.path || "",
    originalPath: element?.originalPath || element?.path || "",
    editorPath: element?.editorPath || "",
    thumbnailPath: element?.thumbnailPath || "",
    originalFilename: element?.originalFilename || "",
    src: element?.editorUrl || element?.url || element?.src || "",
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

/**
 * Drop one layer onto another's slot (drag reorder in the Layers panel).
 *
 * Shares its maths with the customer panel through `reorderLayersByDrop`; only
 * the policy differs — admin may reorder anything that is not locked or marked
 * non-editable. Returns the template unchanged when the move is refused, so the
 * caller can skip the history snapshot entirely.
 */
export function reorderLayerToTarget(template: any, sourceId: string, targetId: string) {
  const source = getLayer(template, sourceId);
  const target = getLayer(template, targetId);
  if (!source || !target || source.page !== target.page) return template;

  const siblings = layersForPage(template, source.page);
  if (!isValidLayerDrop(siblings, sourceId, targetId)) return template;

  const reordered = reorderLayersByDrop(siblings, sourceId, targetId, ADMIN_REORDER_POLICY);
  if (reordered === siblings) return template;

  const zById = new Map(reordered.map((layer: any) => [layer.id, Number(layer.zIndex) || 0]));
  const next = {
    ...template,
    layers: (template.layers || []).map((layer: any) =>
      zById.has(layer.id) ? { ...layer, zIndex: zById.get(layer.id) } : layer,
    ),
  };
  return normalizeZIndexes(next, source.page);
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
    // Spec §15 "Linked Wedding Fields": several layers can share one fieldId
    // (e.g. the couple's names repeated on Front and Back). Only delete the
    // field definition once THIS is the last layer using it - otherwise
    // turning off one linked instance would silently delete the shared field
    // and orphan its siblings, losing their label/placeholder/config and any
    // customer value already saved under that key.
    const stillLinkedElsewhere = (template.layers || []).some(
      (l: any) => l.id !== layerId && l.fieldId === layer.fieldId,
    );
    const fields = stillLinkedElsewhere
      ? template.fields || []
      : (template.fields || []).filter((f: any) => f.id !== layer.fieldId);
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

// Link a layer to an EXISTING field (spec §15 "Linked Wedding Fields"): e.g.
// the bride's name appears once on the Front and again on the Back, and the
// customer should only have to type it once. `resolveLayerText`/
// `resolveLayerImage` already key off `values[field.id]`, so any number of
// layers sharing one fieldId automatically stay in sync - this just gives
// the admin an explicit, safe way to create that link (typing an existing
// key into "Field key" only renames-with-collision-suffix; it can never
// point a layer at another layer's field).
export function linkLayerToField(template: any, layerId: string, targetFieldId: string) {
  const layer = getLayer(template, layerId);
  if (!layer || !targetFieldId) return template;
  if (layer.fieldId === targetFieldId) return template;
  const targetField = (template.fields || []).find((f: any) => f.id === targetFieldId);
  if (!targetField) return template;

  const previousFieldId = layer.fieldId;
  const customerPermissions = customerEditablePermissionBundle(true);
  const layers = (template.layers || []).map((l: any) =>
    l.id === layerId ? { ...l, customerEditable: true, customerPermissions, fieldId: targetFieldId } : l,
  );

  // Clean up the layer's previous field if nothing else still uses it, so it
  // doesn't linger as an orphan flagged for removal on save.
  const previousStillUsed = previousFieldId && layers.some((l: any) => l.id !== layerId && l.fieldId === previousFieldId);
  const fields = previousStillUsed || !previousFieldId
    ? template.fields || []
    : (template.fields || []).filter((f: any) => f.id !== previousFieldId);

  return { ...template, fields, layers };
}

// Reorder a field within `template.fields` (spec §5 "Display order in Easy
// Personalize"). This is deliberately independent of layer z-order: moving a
// field up or down only changes where it appears in the customer's Your
// Details / Photos list, never anything on the canvas.
//
// Swaps are computed against the subsequence of fields actually connected to
// a customer-editable layer (matching what AdminFieldsPanel and
// mapCustomerFields display), so an orphan field sitting between two
// connected ones can never silently absorb a swap and leave the visible
// order unchanged.
export function moveConnectedField(template: any, layerId: string, direction: "up" | "down") {
  const layer = getLayer(template, layerId);
  if (!layer?.fieldId) return template;
  const fields = template.fields || [];
  const layers = template.layers || [];
  const connectedIds = fields
    .map((f: any) => f.id)
    .filter((id: string) => layers.some((l: any) => l.customerEditable && l.fieldId === id));

  const pos = connectedIds.indexOf(layer.fieldId);
  const targetPos = direction === "up" ? pos - 1 : pos + 1;
  if (pos === -1 || targetPos < 0 || targetPos >= connectedIds.length) return template;

  const currentIndex = fields.findIndex((f: any) => f.id === connectedIds[pos]);
  const targetIndex = fields.findIndex((f: any) => f.id === connectedIds[targetPos]);
  const reordered = fields.slice();
  [reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[currentIndex]];
  return { ...template, fields: reordered };
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

export type AlignMode =
  | "left" | "center" | "right" | "top" | "middle" | "bottom"
  | "centerOnCardHorizontal" | "centerOnCardVertical" | "centerOnCard";

const CARD_ONLY_MODES = new Set<AlignMode>(["centerOnCardHorizontal", "centerOnCardVertical", "centerOnCard"]);

// Align layers. One layer aligns to the canvas; several align to their
// combined bounding box. The explicit "centerOnCard*" modes are distinct
// from the above (spec §29): they translate the whole selection as one
// block onto the canvas centre, preserving relative layout, regardless of
// how many objects are selected - not to be confused with the single-layer
// "align to canvas" behaviour above, which aligns objects to EACH OTHER's
// combined bounds (or the canvas, only as a degenerate single-object case).
export function alignLayers(template: any, layerIds: string[], mode: AlignMode, geometryLayers?: any[]) {
  const geometryById = new Map((geometryLayers || []).map((layer: any) => [layer.id, layer]));
  const layers = layerIds
    .map((id) => geometryById.get(id) || getLayer(template, id))
    .filter(Boolean);
  if (!layers.length) return template;

  const canvasW = Number(template.canvasWidthPx) || 1500;
  const canvasH = Number(template.canvasHeightPx) || 2100;

  if (CARD_ONLY_MODES.has(mode)) {
    const boxLeft = Math.min(...layers.map((l: any) => l.x - rotatedAxisHalfExtents(l).halfW));
    const boxRight = Math.max(...layers.map((l: any) => l.x + rotatedAxisHalfExtents(l).halfW));
    const boxTop = Math.min(...layers.map((l: any) => l.y - rotatedAxisHalfExtents(l).halfH));
    const boxBottom = Math.max(...layers.map((l: any) => l.y + rotatedAxisHalfExtents(l).halfH));
    const deltaX = canvasW / 2 - (boxLeft + boxRight) / 2;
    const deltaY = canvasH / 2 - (boxTop + boxBottom) / 2;
    let next = template;
    for (const layer of layers) {
      const patch: any = {};
      const actual = getLayer(template, layer.id) || layer;
      if (mode === "centerOnCardHorizontal" || mode === "centerOnCard") patch.x = Math.round(actual.x + deltaX);
      if (mode === "centerOnCardVertical" || mode === "centerOnCard") patch.y = Math.round(actual.y + deltaY);
      next = updateLayer(next, layer.id, patch);
    }
    return next;
  }

  let left: number, right: number, top: number, bottom: number;
  if (layers.length === 1) {
    left = 0;
    right = canvasW;
    top = 0;
    bottom = canvasH;
  } else {
    left = Math.min(...layers.map((l: any) => l.x - rotatedAxisHalfExtents(l).halfW));
    right = Math.max(...layers.map((l: any) => l.x + rotatedAxisHalfExtents(l).halfW));
    top = Math.min(...layers.map((l: any) => l.y - rotatedAxisHalfExtents(l).halfH));
    bottom = Math.max(...layers.map((l: any) => l.y + rotatedAxisHalfExtents(l).halfH));
  }

  const patchFor = (layer: any) => {
    const { halfW, halfH } = rotatedAxisHalfExtents(layer);
    switch (mode) {
      case "left":
        return { x: Math.round(left + halfW) };
      case "center":
        return { x: Math.round((left + right) / 2) };
      case "right":
        return { x: Math.round(right - halfW) };
      case "top":
        return { y: Math.round(top + halfH) };
      case "middle":
        return { y: Math.round((top + bottom) / 2) };
      case "bottom":
        return { y: Math.round(bottom - halfH) };
      default:
        return {};
    }
  };

  let next = template;
  for (const layer of layers) {
    const geometryPatch = patchFor(layer);
    const actual = getLayer(template, layer.id) || layer;
    const patch = {
      ...(geometryPatch.x === undefined ? {} : { x: Math.round(Number(actual.x) + Number(geometryPatch.x) - Number(layer.x)) }),
      ...(geometryPatch.y === undefined ? {} : { y: Math.round(Number(actual.y) + Number(geometryPatch.y) - Number(layer.y)) }),
    };
    next = updateLayer(next, layer.id, patch);
  }
  return next;
}

// Distribute 3+ layers with equal spacing between their true (rotation-aware)
// edges. The first and last objects (by position) stay in place; only the
// interior objects move so gaps become equal (spec §10).
export type DistributionMode = "centers" | "spacing";

export function distributeLayers(
  template: any,
  layerIds: string[],
  axis: "horizontal" | "vertical",
  mode: DistributionMode = "spacing",
  geometryLayers?: any[],
) {
  const geometryById = new Map((geometryLayers || []).map((layer: any) => [layer.id, layer]));
  const layers = layerIds
    .map((id) => geometryById.get(id) || getLayer(template, id))
    .filter(Boolean);
  if (layers.length < 3) return template;

  const key = axis === "horizontal" ? "x" : "y";
  const positions = mode === "centers"
    ? (() => {
        const sorted = layers.slice().sort((a: any, b: any) => Number(a[key] || 0) - Number(b[key] || 0));
        const first = Number(sorted[0][key] || 0);
        const last = Number(sorted[sorted.length - 1][key] || 0);
        const step = (last - first) / (sorted.length - 1);
        return new Map(sorted.map((layer: any, index: number) => [layer.id, Math.round(first + step * index)]));
      })()
    : new Map(distributeAlongAxis(layers, key).map((position) => [position.id, Math.round(position.center)]));

  let next = template;
  for (const id of layerIds) {
    if (positions.has(id)) {
      const geometry = geometryById.get(id) || getLayer(template, id);
      const actual = getLayer(template, id);
      if (geometry && actual) {
        const delta = Number(positions.get(id)) - Number(geometry[key] || 0);
        next = updateLayer(next, id, { [key]: Math.round(Number(actual[key] || 0) + delta) });
      }
    }
  }
  return next;
}

export type LayerArrangeMode = "bringToFront" | "bringForward" | "sendBackward" | "sendToBack";

// Arrange the selected logical objects as a block. Descendants are expanded so
// moving a group through the stack also moves its rendered children.
export function arrangeLayerSelection(template: any, layerIds: string[], action: LayerArrangeMode) {
  if (!layerIds.length) return template;
  const first = getLayer(template, layerIds[0]);
  if (!first) return template;
  const pageId = first.page;
  const ordered = layersForPage(template, pageId);
  const selected = new Set<string>();
  for (const id of layerIds) {
    selected.add(id);
    const layer = getLayer(template, id);
    if (layer?.type === "group") {
      for (const descendantId of getDescendantIds(template.layers || [], id)) selected.add(descendantId);
    }
  }
  if (!selected.size) return template;

  if (action === "bringToFront") {
    ordered.splice(0, ordered.length, ...ordered.filter((layer) => !selected.has(layer.id)), ...ordered.filter((layer) => selected.has(layer.id)));
  } else if (action === "sendToBack") {
    ordered.splice(0, ordered.length, ...ordered.filter((layer) => selected.has(layer.id)), ...ordered.filter((layer) => !selected.has(layer.id)));
  } else if (action === "bringForward") {
    for (let index = ordered.length - 2; index >= 0; index -= 1) {
      if (selected.has(ordered[index].id) && !selected.has(ordered[index + 1].id)) {
        [ordered[index], ordered[index + 1]] = [ordered[index + 1], ordered[index]];
      }
    }
  } else {
    for (let index = 1; index < ordered.length; index += 1) {
      if (selected.has(ordered[index].id) && !selected.has(ordered[index - 1].id)) {
        [ordered[index - 1], ordered[index]] = [ordered[index], ordered[index - 1]];
      }
    }
  }

  const zById = new Map(ordered.map((layer, index) => [layer.id, index + 1]));
  return {
    ...template,
    layers: (template.layers || []).map((layer: any) =>
      layer.page === pageId && zById.has(layer.id) ? { ...layer, zIndex: zById.get(layer.id) } : layer,
    ),
  };
}

// Match dimensions to the first-selected (reference) layer.
export function matchLayerSize(template: any, layerIds: string[], dimension: "width" | "height" | "both") {
  const layers = layerIds.map((id) => getLayer(template, id)).filter(Boolean);
  if (layers.length < 2) return template;
  const reference = layers[0];
  let next = template;
  for (const layer of layers.slice(1)) {
    const patch: any = {};
    if (dimension === "width" || dimension === "both") patch.width = reference.width;
    if (dimension === "height" || dimension === "both") patch.height = reference.height;
    next = updateLayer(next, layer.id, patch);
  }
  return next;
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

export type BuilderAsset = {
  id: string;
  title: string;
  assetType?: string;
  /** Ambiguous legacy field; prefer the explicit variants below. */
  url: string;
  /** Full-quality source. Canvas fallback and high-quality render source. */
  originalUrl?: string;
  /** Interactive canvas source (max ~2400px). */
  editorUrl?: string;
  /** Library tiles only — never a canvas source. */
  thumbnailUrl?: string;
  bucket: string;
  originalPath: string;
  editorPath?: string;
  thumbnailPath?: string;
  originalFilename?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  checksum?: string;
  duplicate?: boolean;
  message?: string;
};

export function newImageLayerFromAdminAsset(template: any, pageId: string, asset: BuilderAsset) {
  const canvasWidth = Number(template?.canvasWidthPx) || 1500;
  const canvasHeight = Number(template?.canvasHeightPx) || 2100;
  const sourceWidth = Math.max(0, Number(asset.width) || 0);
  const sourceHeight = Math.max(0, Number(asset.height) || 0);
  const ratio = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 1;
  const maxWidth = Math.max(120, canvasWidth * 0.55);
  const maxHeight = Math.max(120, canvasHeight * 0.55);
  let width = maxWidth;
  let height = width / ratio;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * ratio;
  }
  // Canvas source priority: editor variant, then the full-quality original.
  // Never the thumbnail — a 480px tile stretched across the artboard is the
  // blur this ordering exists to prevent.
  const previewUrl = asset.editorUrl || asset.originalUrl || asset.url;
  return {
    ...newImageLayer(template, pageId, previewUrl),
    name: asset.title || asset.originalFilename || "Uploaded image",
    assetId: asset.id,
    bucket: asset.bucket,
    path: asset.originalPath,
    originalPath: asset.originalPath,
    editorPath: asset.editorPath || asset.originalPath,
    thumbnailPath: asset.thumbnailPath || asset.editorPath || asset.originalPath,
    originalFilename: asset.originalFilename || "",
    sourceWidth,
    sourceHeight,
    mimeType: asset.mimeType || "",
    width: Math.max(24, Math.round(width)),
    height: Math.max(24, Math.round(height)),
  };
}

export async function uploadBuilderImage(
  file: File,
  assetType = "image",
  options: { customerAvailable?: boolean; onProgress?: (progress: number) => void } = {},
): Promise<BuilderAsset> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("title", file.name.replace(/\.[^.]+$/, ""));
  formData.append("assetType", assetType);
  formData.append("customerAvailable", String(options.customerAvailable === true));
  formData.append("adminAvailable", "true");
  const data = await new Promise<any>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/admin/customizer/assets");
    request.responseType = "json";
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) options.onProgress?.(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    });
    request.addEventListener("load", () => {
      const payload = request.response || {};
      if (request.status < 200 || request.status >= 300 || payload.ok === false) {
        reject(new Error(payload?.error || "Upload failed."));
        return;
      }
      resolve(payload);
    });
    request.addEventListener("error", () => reject(new Error("Upload failed. Check your connection and try again.")));
    request.addEventListener("abort", () => reject(new Error("Upload cancelled.")));
    options.onProgress?.(0);
    request.send(formData);
  });
  if (!data.asset?.id || !(data.asset?.editorUrl || data.asset?.url)) throw new Error("The asset was saved but could not be opened.");
  options.onProgress?.(100);
  return {
    ...data.asset,
    duplicate: Boolean(data.duplicate),
    message: String(data.message || ""),
  } as BuilderAsset;
}
