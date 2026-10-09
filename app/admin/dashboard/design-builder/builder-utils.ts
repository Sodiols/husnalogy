"use client";

import { SHAPE_LIBRARY_BY_ID, libraryShapeGeometry } from "@/lib/customizer/v2/shape-library";
import { assetIdentityOf } from "@/lib/customizer/v2/asset-identity";
import { DEFAULT_FONT_FAMILY } from "@/lib/customizer/v2/google-fonts";
import {
  customerEditablePermissionBundle,
  customerFieldKindForLayer,
  isFieldCompatibleWithLayer,
} from "@/lib/customizer";
import {
  ADMIN_REORDER_POLICY,
  isValidLayerDrop,
  reorderLayersByDrop,
} from "@/lib/customizer/v2/interaction/layer-reorder";
import { distributeAlongAxis, getDescendantIds, rotatedAxisHalfExtents, transformGroupChildren } from "@/lib/customizer/v2/groups";
import { clonedIdsFor, expandCloneSelection, relinkClones } from "@/lib/customizer/v2/clipboard";
import { marqueeSelectedLayerIds, type SelectionRect } from "@/lib/customizer/v2/selection-geometry";
import { getTextPlacementStyle, type TextPlacementPreset } from "@/lib/customizer/v2/text-editing";
import { DEFAULT_LETTER_SPACING, DEFAULT_LINE_HEIGHT } from "@/lib/customizer/v2/text-layout";
import { scaleLayerContent } from "@/lib/customizer/v2/artboard";
import { AssetUploadError, describeUploadFailure } from "@/lib/customizer/v2/upload-failure";

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
  // Standard text unless a style preset was chosen: one line, auto width,
  // 17 pt (type-units.ts), centred — the box hugs the words.
  const preset = getTextPlacementStyle(
    options.preset || "text",
    Number(template?.canvasWidthPx) || 1500,
    Number(template?.canvasHeightPx) || 2100,
    template?.dpi,
  );
  return {
    id: genId("text"),
    name: preset.name,
    page: pageId,
    type: "text",
    text: options.text ?? (placed ? "" : "Your text"),
    fieldId: "",
    x: placed ? Number(options.x) : cx,
    y: placed ? Number(options.y) : cy,
    width: preset.width,
    height: preset.height,
    rotation: 0,
    zIndex: nextZIndex(template, pageId),
    opacity: 1,
    hidden: false,
    locked: false,
    adminEditable: true,
    customerEditable: false,
    textStyle: {
      fontFamily: DEFAULT_FONT_FAMILY,
      fontSize: preset.fontSize,
      fontWeight: "400",
      color: "#303839",
      letterSpacing: preset.letterSpacing,
      lineHeight: preset.lineHeight,
      textAlign: preset.textAlign,
      verticalAlign: "middle",
      // Paragraphs grow downward, single lines from the centre — what they
      // did before the property existed, now explicit and rotation-aware.
      growthDirection: preset.multiline ? "down" : "center",
      uppercase: false,
      multiline: preset.multiline,
      autoSizeMode: preset.autoSizeMode,
      fitMode: preset.autoSizeMode === "height" ? "auto-height" : "fixed",
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

/**
 * A shape from the Shapes library (shape-library.ts) — or, for a plain kind
 * such as "circle", the native shape itself. Library shapes are inserted at a
 * third of the artboard's shorter side, centred, in their own proportions.
 */
export function newLibraryShapeLayer(template: any, pageId: string, shapeId: string) {
  const entry = SHAPE_LIBRARY_BY_ID.get(shapeId);
  if (!entry) return newShapeLayer(template, pageId, shapeId);
  const longest = Math.round(Math.min(Number(template?.canvasWidthPx) || 1500, Number(template?.canvasHeightPx) || 2100) / 3);
  return { ...newShapeLayer(template, pageId, entry.shape), ...libraryShapeGeometry(entry, longest) };
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
    mimeType: element?.mimeType || "",
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

/**
 * Apply one canvas gesture's patches to the template as ONE value.
 *
 * However many objects the gesture touched — and whether or not a patch carries
 * a `textStyle` from text corner scaling — the result is a single template the
 * builder applies once: one history step, one dirty transition. Groups move
 * their members through `updateLayer`.
 */
/**
 * True when applying `patches` would change at least one value. A click that
 * lands without moving, or a gesture that snaps back to where it started,
 * produces patches equal to the current geometry; those must not create an
 * undo step or mark the document unsaved.
 */
export function canvasPatchesChangeTemplate(template: any, patches: Record<string, any>): boolean {
  for (const [id, patch] of Object.entries(patches || {})) {
    const layer = getLayer(template, id);
    if (!layer) continue;
    const { textStyle, ...geometry } = patch || {};
    for (const [key, value] of Object.entries(geometry)) {
      if (!Object.is(layer[key], value)) return true;
    }
    if (textStyle && typeof textStyle === "object") {
      const current = layer.textStyle || {};
      for (const [key, value] of Object.entries(textStyle)) {
        if (!Object.is(current[key], value)) return true;
      }
    }
  }
  return false;
}

export function applyCanvasLayerPatches(template: any, patches: Record<string, any>) {
  let next = template;
  for (const [id, patch] of Object.entries(patches || {})) {
    const { textStyle, ...layerPatch } = patch || {};
    if (Object.keys(layerPatch).length) next = updateLayer(next, id, layerPatch);
    if (textStyle && typeof textStyle === "object") next = updateLayerStyle(next, id, textStyle);
  }
  return next;
}

/**
 * Drop field definitions that the removed layers referenced, but ONLY when no
 * remaining layer still binds them. A linked field (the couple's names on
 * Front and Back) must outlive the deletion of one of its layers.
 */
function pruneFieldsAfterRemoval(template: any, removedLayers: any[], remainingLayers: any[]) {
  const removedFieldIds = new Set(removedLayers.map((item: any) => item.fieldId).filter(Boolean));
  if (!removedFieldIds.size) return template.fields || [];
  const stillUsed = new Set(remainingLayers.map((item: any) => item.fieldId).filter(Boolean));
  return (template.fields || []).filter((field: any) => !removedFieldIds.has(field.id) || stillUsed.has(field.id));
}

export function removeLayer(template: any, layerId: string) {
  const layer = getLayer(template, layerId);
  if (!layer) return template;
  const removeIds = new Set([layerId, ...(layer.type === "group" ? getDescendantIds(template.layers || [], layerId) : [])]);
  const removed = (template.layers || []).filter((item: any) => removeIds.has(item.id));
  const layers = (template.layers || []).filter((item: any) => !removeIds.has(item.id));
  return { ...template, fields: pruneFieldsAfterRemoval(template, removed, layers), layers };
}

/* ---------------------------------------------------- clone / clipboard ----
 * Duplicate, Copy, Cut and Paste all mean the same thing to the document: take
 * a set of layers, give them fresh identities, point them at each other rather
 * than at their originals, and stack the result on top. That single operation
 * lives here so the four commands cannot drift apart — which is exactly how the
 * customer editor ended up pasting groups whose children belonged to the group
 * they were copied from.
 * ------------------------------------------------------------------------- */

/** A fresh id that cannot collide with anything already in the template. */
function freshId(template: any, type: string, taken: Set<string>): string {
  const existing = new Set((template?.layers || []).map((layer: any) => String(layer.id)));
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = genId(type || "layer");
    if (!existing.has(candidate) && !taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  // `genId` is 6 random base-36 characters; 50 collisions in a row is not
  // chance, so fall back to something that cannot repeat rather than looping.
  const unique = `${type || "layer"}_${Date.now().toString(36)}_${taken.size}`;
  taken.add(unique);
  return unique;
}

export type LayerClipboard = { rootIds: string[]; layers: any[] };

/**
 * Clone `sources` onto `pageId` as one contiguous z-block above everything
 * already there, with every internal relationship rewritten to the copies.
 *
 * `sources` must already include the descendants of any group among them —
 * `expandCloneSelection` is what works that out.
 */
function cloneLayersInto(
  template: any,
  sources: readonly any[],
  requestedIds: readonly string[],
  pageId: string,
  { offset = 40, rename = true }: { offset?: number; rename?: boolean } = {},
): { template: any; newIds: string[] } {
  if (!sources.length) return { template, newIds: [] };

  const baseZ = nextZIndex(template, pageId);
  // Preserve the sources' relative stacking inside the block, so a copied
  // arrangement still looks like the arrangement that was copied.
  const stackOrder = sources
    .slice()
    .sort((a: any, b: any) => Number(a.zIndex || 0) - Number(b.zIndex || 0))
    .map((layer: any) => layer.id);
  const zBySourceId = new Map(stackOrder.map((id: string, index: number) => [id, baseZ + index]));

  const taken = new Set<string>();
  const clones = sources.map((source: any) => ({
    ...source,
    id: freshId(template, source.type, taken),
    name: rename ? `${source.name || "Layer"} copy` : source.name,
    page: pageId,
    x: Number(source.x || 0) + offset,
    y: Number(source.y || 0) + offset,
    zIndex: zBySourceId.get(source.id) ?? baseZ,
    // A copy must never inherit the original's binding to a customer field, and
    // must never arrive locked — an object you cannot select is a poor thing to
    // hand someone as the result of a paste.
    fieldId: "",
    customerEditable: false,
    customerPermissions: customerEditablePermissionBundle(false),
    locked: false,
  }));

  const relinked = relinkClones(sources, clones);
  return {
    template: { ...template, layers: [...(template.layers || []), ...relinked] },
    newIds: clonedIdsFor(sources, relinked, requestedIds),
  };
}

/**
 * Snapshot a selection for the clipboard: the requested layers PLUS every
 * descendant, deep-copied so a later delete cannot empty the clipboard.
 */
export function copyLayersToClipboard(template: any, layerIds: readonly string[]): LayerClipboard {
  const rootIds = [...new Set(layerIds.filter(Boolean).map(String))];
  const layers = expandCloneSelection(template?.layers || [], rootIds).map((layer: any) =>
    JSON.parse(JSON.stringify(layer)),
  );
  return { rootIds, layers };
}

/** Paste a clipboard onto `pageId`. Returns the template unchanged when empty. */
export function pasteLayers(
  template: any,
  clipboard: LayerClipboard | null | undefined,
  pageId: string,
): { template: any; newIds: string[] } {
  if (!clipboard?.layers?.length) return { template, newIds: [] };
  return cloneLayersInto(template, clipboard.layers, clipboard.rootIds, pageId);
}

/**
 * Cut: copy, then remove. Locked layers (and anything marked non-editable) are
 * COPIED but not removed — the same rule Delete already follows — so a cut that
 * includes one does not silently destroy it.
 */
export function cutLayers(
  template: any,
  layerIds: readonly string[],
): { template: any; clipboard: LayerClipboard; removedIds: string[] } {
  const clipboard = copyLayersToClipboard(template, layerIds);
  const removedIds: string[] = [];
  let next = template;
  for (const id of clipboard.rootIds) {
    const layer = getLayer(next, id);
    if (!layer || layer.locked || layer.adminEditable === false) continue;
    next = removeLayer(next, id);
    removedIds.push(id);
  }
  return { template: next, clipboard, removedIds };
}

export function duplicateLayer(template: any, layerId: string) {
  const layer = getLayer(template, layerId);
  if (!layer) return { template, newId: null };
  if (layer.type === "group") {
    const sourceIds = [layerId, ...getDescendantIds(template.layers || [], layerId)];
    const idMap = new Map(sourceIds.map((id) => [id, genId(getLayer(template, id)?.type || "layer")]));
    // The copy must sit ABOVE everything already on the page, as one contiguous
    // block. Carrying each source's own zIndex across would tie every copied
    // member with the member it was cloned from: `layersForPage` sorts by
    // zIndex and JS sort is stable, so the two groups would interleave and the
    // duplicate would inherit the original's place in the stack instead of
    // landing on top of it.
    const baseZ = nextZIndex(template, layer.page);
    const stackOrder = (template.layers || [])
      .filter((item: any) => idMap.has(item.id))
      .slice()
      .sort((a: any, b: any) => Number(a.zIndex || 0) - Number(b.zIndex || 0))
      .map((item: any) => item.id);
    const zBySourceId = new Map(stackOrder.map((id: string, index: number) => [id, baseZ + index]));
    const copies = (template.layers || [])
      .filter((item: any) => idMap.has(item.id))
      .map((item: any) => ({
        ...item,
        id: idMap.get(item.id),
        name: item.id === layerId ? `${item.name} copy` : item.name,
        x: Number(item.x || 0) + 40,
        y: Number(item.y || 0) + 40,
        zIndex: zBySourceId.get(item.id) ?? baseZ,
        groupId: item.groupId && idMap.has(item.groupId) ? idMap.get(item.groupId) : item.groupId,
        childIds: Array.isArray(item.childIds) ? item.childIds.map((id: string) => idMap.get(id) || id) : item.childIds,
        fieldId: "",
        customerEditable: false,
        customerPermissions: customerEditablePermissionBundle(false),
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
    // A duplicate should not double-bind to the same customer field; linking
    // is an explicit action (linkLayerToField).
    fieldId: "",
    customerEditable: false,
    customerPermissions: customerEditablePermissionBundle(false),
  };
  // A copy made inside a group stays in that group (`groupId` is the authority
  // for membership). `childIds` is a derived mirror of the same relationship,
  // so it has to learn about the copy too or it drifts out of agreement with
  // the document it describes.
  const withCopy = (template.layers || []).map((item: any) =>
    copy.groupId && item.id === copy.groupId && item.type === "group"
      ? { ...item, childIds: [...(Array.isArray(item.childIds) ? item.childIds : []), copy.id] }
      : item,
  );
  return { template: { ...template, layers: [...withCopy, copy] }, newId: copy.id };
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

  // Only text and photo layers carry a customer field. Grids, groups, shapes,
  // elements, QR codes and backgrounds are edited on the canvas through their
  // permissions alone.
  if (!customerFieldKindForLayer(layer)) {
    return {
      ...template,
      layers: (template.layers || []).map((l: any) =>
        l.id === layerId ? { ...l, customerEditable: true, customerPermissions } : l,
      ),
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

/** Every layer bound to `fieldId` (a shared/linked field has several). */
export function layersForField(template: any, fieldId: string): any[] {
  if (!fieldId) return [];
  return (template?.layers || []).filter((layer: any) => layer.fieldId === fieldId);
}

// Update the connected field's props from the right panel.
//
// The field is ONE definition even when several layers share it, so every
// property patch (label, type, required, placeholder, helper text, choices,
// visibility, max length) applies to all linked layers at once.
//
// Changing the key (`patch.key`) RENAMES the shared field: the id is cleaned,
// suffixed only if it would collide with a DIFFERENT field, and every layer
// that used the old id is re-pointed to the new one — the link is kept and no
// layer is left dangling. Renaming never links to another field; that is
// `linkLayerToField`, and leaving a link is `unlinkLayerFromField`.
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
  delete fieldPatch.id;

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

  const fields = (working.fields || []).map((f: any) =>
    f.id === currentId ? { ...f, ...fieldPatch, id: nextFieldId } : f,
  );
  const layers = nextFieldId === currentId
    ? working.layers || []
    : (working.layers || []).map((l: any) => (l.fieldId === currentId ? { ...l, fieldId: nextFieldId } : l));
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
//
// Only COMPATIBLE layers may share a field: text layers share text fields and
// photo layers (image/frame) share image fields. An incompatible request is
// refused (the template is returned unchanged) rather than silently changing
// the shared field's type under its other layers.
export function linkLayerToField(template: any, layerId: string, targetFieldId: string) {
  const layer = getLayer(template, layerId);
  if (!layer || !targetFieldId) return template;
  if (layer.fieldId === targetFieldId) return template;
  const targetField = (template.fields || []).find((f: any) => f.id === targetFieldId);
  if (!targetField) return template;
  if (!isFieldCompatibleWithLayer(targetField, layer)) return template;

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

/**
 * Leave a shared field: the layer gets its OWN field, initialised from the
 * shared definition (label, type, required, placeholder, helper text, choices,
 * visibility), while every other linked layer keeps the shared field. A layer
 * that is the field's only user is already unlinked, so nothing changes.
 */
export function unlinkLayerFromField(template: any, layerId: string) {
  const layer = getLayer(template, layerId);
  if (!layer?.fieldId) return template;
  const shared = (template.fields || []).find((f: any) => f.id === layer.fieldId);
  if (!shared || layersForField(template, layer.fieldId).length < 2) return template;
  const taken = new Set((template.fields || []).map((f: any) => f.id));
  let id = keyify(layer.name) || `${shared.id}_copy`;
  if (taken.has(id)) {
    let i = 2;
    while (taken.has(`${id}_${i}`)) i += 1;
    id = `${id}_${i}`;
  }
  const own = {
    ...shared,
    id,
    label: layer.name && layer.name !== shared.label ? layer.name : shared.label,
    options: Array.isArray(shared.options) ? shared.options.slice() : [],
  };
  // The new field sits right after the shared one in the customer's list.
  const index = (template.fields || []).findIndex((f: any) => f.id === shared.id);
  const fields = (template.fields || []).slice();
  fields.splice(index + 1, 0, own);
  return {
    ...template,
    fields,
    layers: (template.layers || []).map((l: any) => (l.id === layerId ? { ...l, fieldId: id } : l)),
  };
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
/**
 * Where an alignment measures from: the selection's combined bounds, or the
 * artboard. Without one, a single object aligns to the artboard and several
 * align to each other — the long-standing behaviour.
 */
export type AlignTarget = "selection" | "artboard";

export function alignLayers(template: any, layerIds: string[], mode: AlignMode, geometryLayers?: any[], target?: AlignTarget) {
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
  // Artboard: every object aligns to the card on its own. Selection: to the
  // selection's combined (rotation-aware) bounds — meaningless for one object.
  const toArtboard = target ? target === "artboard" || layers.length === 1 : layers.length === 1;
  if (toArtboard) {
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
  target: AlignTarget = "selection",
) {
  const geometryById = new Map((geometryLayers || []).map((layer: any) => [layer.id, layer]));
  const layers = layerIds
    .map((id) => geometryById.get(id) || getLayer(template, id))
    .filter(Boolean);
  if (target === "artboard") return distributeAcrossArtboard(template, layers, axis);
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
  // "_" not "-": stored page ids are keyified, so this id survives saving
  // unchanged (a "-" id was renamed on save and its layers lost their page).
  while (taken.has(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
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

  // Copy the page's layers too, with fresh ids. Every internal relationship
  // (a child's groupId, a group's childIds) is rewritten to point at the
  // COPIES, so a duplicated group owns its duplicated children instead of the
  // originals on the source page. Duplicated editable layers lose their field
  // binding so field keys stay unique (admin reconnects or links what they
  // need).
  const sources = (template.layers || []).filter((l: any) => l.page === pageId);
  const taken = new Set<string>();
  const idMap = new Map<string, string>(sources.map((l: any) => [l.id, freshId(template, l.type, taken)]));
  const copiedLayers = sources.map((l: any) => ({
    ...l,
    id: idMap.get(l.id),
    page: copy.id,
    groupId: l.groupId && idMap.has(l.groupId) ? idMap.get(l.groupId) : "",
    ...(Array.isArray(l.childIds)
      ? { childIds: l.childIds.map((id: string) => idMap.get(id)).filter(Boolean) }
      : {}),
    fieldId: "",
    customerEditable: false,
    customerPermissions: customerEditablePermissionBundle(false),
  }));

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
  const { src, ...source } = imageSourcePatch(asset);
  return {
    ...newImageLayer(template, pageId, src),
    name: asset.title || asset.originalFilename || "Uploaded image",
    ...source,
    width: Math.max(24, Math.round(width)),
    height: Math.max(24, Math.round(height)),
  };
}

/**
 * The layer fields an uploaded picture sets — its canvas source and its durable
 * storage identity. Shared by Add, the inspector's Replace and the toolbar's
 * Change image, so every route records the same thing.
 */
export function imageSourcePatch(asset: BuilderAsset) {
  // Canvas source priority: editor variant, then the full-quality original.
  // Never the thumbnail — a 480px tile stretched across the artboard is the
  // blur this ordering exists to prevent.
  return {
    src: asset.editorUrl || asset.originalUrl || asset.url,
    assetId: asset.id,
    bucket: asset.bucket,
    path: asset.originalPath,
    originalPath: asset.originalPath,
    editorPath: asset.editorPath || asset.originalPath,
    thumbnailPath: asset.thumbnailPath || asset.editorPath || asset.originalPath,
    originalFilename: asset.originalFilename || "",
    sourceWidth: Math.max(0, Number(asset.width) || 0),
    sourceHeight: Math.max(0, Number(asset.height) || 0),
    mimeType: asset.mimeType || "",
  };
}

/**
 * Put a new picture in an existing photo layer. The layer's box, rotation,
 * mask, frame paint, flips and fit mode are kept — a masked or framed photo
 * stays masked — while the pan, zoom, crop rectangle and eraser marks, which
 * described the OLD picture, start fresh.
 */
export function replaceLayerImage(template: any, layerId: string, asset: BuilderAsset) {
  const layer = getLayer(template, layerId);
  if (!layer || (layer.type !== "image" && layer.type !== "frame")) return template;
  const transform = layer.imageTransform && typeof layer.imageTransform === "object" ? layer.imageTransform : {};
  const kept = Object.fromEntries(Object.entries(transform).filter(([key]) => ["flipX", "flipY", "fitMode"].includes(key)));
  const next = updateLayer(template, layerId, {
    ...imageSourcePatch(asset),
    imageTransform: { ...kept, zoom: 1, offsetX: 0, offsetY: 0 },
  });
  return removeLayerKeys(next, layerId, ["eraseMask"]);
}

function removeLayerKeys(template: any, layerId: string, keys: string[]) {
  return {
    ...template,
    layers: (template.layers || []).map((layer: any) => {
      if (layer.id !== layerId || !keys.some((key) => key in layer)) return layer;
      const copy = { ...layer };
      for (const key of keys) delete copy[key];
      return copy;
    }),
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
        reject(new AssetUploadError(describeUploadFailure({ status: request.status, serverMessage: payload?.error })));
        return;
      }
      resolve(payload);
    });
    request.addEventListener("error", () => reject(new AssetUploadError(describeUploadFailure({ status: 0 }))));
    request.addEventListener("abort", () => reject(new AssetUploadError(describeUploadFailure({ status: 0, aborted: true }))));
    options.onProgress?.(0);
    request.send(formData);
  });
  if (!data.asset?.id || !(data.asset?.editorUrl || data.asset?.url)) {
    throw new AssetUploadError({ kind: "server", message: "The asset was saved but could not be opened. Try again.", retryable: true });
  }
  options.onProgress?.(100);
  return {
    ...data.asset,
    duplicate: Boolean(data.duplicate),
    message: String(data.message || ""),
  } as BuilderAsset;
}

/**
 * Whether the studio can crop this layer: one photo (image or frame) that
 * actually shows a picture and that the builder may edit. The canvas
 * (double-click), the selection toolbar's Crop button and the object menu all
 * ask this one question, so they can never disagree.
 */
export function isAdminCroppableLayer(layer: any): boolean {
  return Boolean(
    layer &&
      (layer.type === "image" || layer.type === "frame") &&
      layerHasPicture(layer) &&
      !layer.locked &&
      layer.adminEditable !== false,
  );
}

/**
 * Whether a photo layer shows a picture of its own: a URL, or a durable asset
 * identity the canvas resolver signs a URL from (a recovered design stores no
 * URLs, only identities).
 */
export function layerHasPicture(layer: any): boolean {
  return Boolean(layer?.src || assetIdentityOf(layer));
}

/* ---------- selection transforms: distribute to artboard, scale, flip, rotate, fit ---------- */
// Every command below is ONE pure template change — the caller commits it as
// one undo step — and treats a group as its container plus everything inside.

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Equal gaps between the objects AND the artboard edges along one axis (2+ objects). */
function distributeAcrossArtboard(template: any, layers: any[], axis: "horizontal" | "vertical") {
  if (layers.length < 2) return template;
  const key = axis === "horizontal" ? "x" : "y";
  const span = axis === "horizontal" ? Number(template.canvasWidthPx) || 1500 : Number(template.canvasHeightPx) || 2100;
  const extent = (layer: any) => {
    const { halfW, halfH } = rotatedAxisHalfExtents(layer);
    return axis === "horizontal" ? halfW * 2 : halfH * 2;
  };
  const sorted = layers.slice().sort((a: any, b: any) => Number(a[key] || 0) - Number(b[key] || 0));
  const gap = (span - sorted.reduce((total: number, layer: any) => total + extent(layer), 0)) / (sorted.length + 1);
  let cursor = gap;
  let next = template;
  for (const layer of sorted) {
    const centre = cursor + extent(layer) / 2;
    cursor += extent(layer) + gap;
    const actual = getLayer(template, layer.id);
    if (!actual) continue;
    next = updateLayer(next, layer.id, { [key]: Math.round(Number(actual[key] || 0) + centre - Number(layer[key] || 0)) });
  }
  return next;
}

/** The selected ids plus everything inside any selected group, each once. */
function withDescendants(template: any, layerIds: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const id of layerIds) {
    ids.add(id);
    if (getLayer(template, id)?.type === "group") getDescendantIds(template.layers || [], id).forEach((child) => ids.add(child));
  }
  return [...ids];
}

/** Centre of the selection's rotation-aware bounds, from the geometry the canvas shows. */
function selectionCentre(layers: any[]): { x: number; y: number } {
  const left = Math.min(...layers.map((l: any) => l.x - rotatedAxisHalfExtents(l).halfW));
  const right = Math.max(...layers.map((l: any) => l.x + rotatedAxisHalfExtents(l).halfW));
  const top = Math.min(...layers.map((l: any) => l.y - rotatedAxisHalfExtents(l).halfH));
  const bottom = Math.max(...layers.map((l: any) => l.y + rotatedAxisHalfExtents(l).halfH));
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

function geometryLookup(template: any, geometryLayers?: any[]) {
  const byId = new Map((geometryLayers || []).map((layer: any) => [layer.id, layer]));
  return (id: string) => byId.get(id) || getLayer(template, id);
}

/** Patch layers directly — callers already include every descendant, so no group propagation. */
function replaceLayers(template: any, patches: Map<string, Record<string, unknown>>) {
  if (!patches.size) return template;
  return {
    ...template,
    layers: (template.layers || []).map((layer: any) => (patches.has(layer.id) ? { ...layer, ...patches.get(layer.id) } : layer)),
  };
}

const MIN_SCALED_SIZE = 4;
const MAX_SCALED_SIZE = 50000;

/**
 * Scale a selection as ONE composition about its combined centre: positions,
 * box sizes and size-bearing content (font size, letter spacing, strokes, radii,
 * in-frame pan) all scale by `factor`, so relative layout, rotation and aspect
 * ratios are preserved. Refused (template unchanged) if any object would become
 * smaller than a few pixels or absurdly large.
 */
export function scaleLayerSelection(template: any, layerIds: string[], factor: number, geometryLayers?: any[]) {
  if (!layerIds.length || !(factor > 0) || factor === 1) return template;
  const geometry = geometryLookup(template, geometryLayers);
  const roots = layerIds.map(geometry).filter(Boolean);
  if (!roots.length) return template;
  const centre = selectionCentre(roots);
  const patches = new Map<string, Record<string, unknown>>();
  for (const id of withDescendants(template, layerIds)) {
    const actual = getLayer(template, id);
    if (!actual || actual.type === "background") continue;
    const seen = geometry(id) || actual;
    const width = Number(actual.width) * factor;
    const height = Number(actual.height) * factor;
    const isLine = actual.type === "shape" && actual.shape === "line";
    if (width < MIN_SCALED_SIZE || (!isLine && height < MIN_SCALED_SIZE) || width > MAX_SCALED_SIZE || height > MAX_SCALED_SIZE) return template;
    const movedX = centre.x + (Number(seen.x) - centre.x) * factor;
    const movedY = centre.y + (Number(seen.y) - centre.y) * factor;
    patches.set(id, {
      ...scaleLayerContent(actual, factor),
      x: round2(Number(actual.x) + movedX - Number(seen.x)),
      y: round2(Number(actual.y) + movedY - Number(seen.y)),
      width: round2(width),
      // A line's box height is its hit area, not its look; its weight scales.
      height: round2(isLine ? Number(actual.height) : height),
    });
  }
  return replaceLayers(template, patches);
}

const FLIPPABLE_ARTWORK = new Set(["text", "shape", "element"]);

/** Whether flipping mirrors this layer's own artwork (positions always mirror). */
export function canFlipLayer(layer: any): boolean {
  if (!layer) return false;
  if (FLIPPABLE_ARTWORK.has(layer.type) || layer.type === "group") return true;
  return (layer.type === "image" || layer.type === "frame") && Boolean(layerHasPicture(layer) || layer.fieldId);
}

function mirrorMask(mask: any, axis: "horizontal" | "vertical") {
  if (!mask || typeof mask !== "object") return mask;
  if (mask.kind === "polygon" && Array.isArray(mask.points)) {
    return {
      ...mask,
      points: mask.points.map((point: any) =>
        axis === "horizontal" ? { x: round2(1 - Number(point.x)), y: Number(point.y) } : { x: Number(point.x), y: round2(1 - Number(point.y)) },
      ),
    };
  }
  if (axis === "vertical" && (mask.kind === "arch-top" || mask.kind === "arch-bottom")) {
    return { ...mask, kind: mask.kind === "arch-top" ? "arch-bottom" : "arch-top" };
  }
  return mask;
}

/**
 * Flip a selection as a mirror in WORLD space across its own centre line:
 * positions mirror across the selection's centre, each object's rotation is
 * negated, and its artwork is mirrored in its own frame — text and shapes by
 * their flip flags, decorative elements by theirs, photos by their in-frame
 * flip with their mask mirrored alongside (crop is kept). QR codes and photo
 * grids move but are never mirrored: a mirrored QR code no longer scans.
 */
export function flipLayerSelection(template: any, layerIds: string[], axis: "horizontal" | "vertical", geometryLayers?: any[]) {
  if (!layerIds.length) return template;
  const geometry = geometryLookup(template, geometryLayers);
  const roots = layerIds.map(geometry).filter(Boolean);
  if (!roots.length) return template;
  const centre = selectionCentre(roots);
  const flag = axis === "horizontal" ? "flipX" : "flipY";
  const patches = new Map<string, Record<string, unknown>>();
  for (const id of withDescendants(template, layerIds)) {
    const actual = getLayer(template, id);
    if (!actual || actual.type === "background") continue;
    const seen = geometry(id) || actual;
    const patch: Record<string, unknown> = {};
    if (axis === "horizontal") patch.x = round2(Number(actual.x) + 2 * (centre.x - Number(seen.x)));
    else patch.y = round2(Number(actual.y) + 2 * (centre.y - Number(seen.y)));
    if (canFlipLayer(actual)) {
      patch.rotation = normalizeDegrees(-(Number(actual.rotation) || 0));
      if (FLIPPABLE_ARTWORK.has(actual.type)) patch[flag] = !actual[flag];
      if (actual.type === "image" || actual.type === "frame") {
        const transform = actual.imageTransform && typeof actual.imageTransform === "object" ? actual.imageTransform : {};
        patch.imageTransform = { ...transform, [flag]: !transform[flag] };
        if (actual.mask) patch.mask = mirrorMask(actual.mask, axis);
        if (axis === "vertical" && ["arch", "arch-top", "arch-bottom"].includes(actual.maskShape)) {
          patch.maskShape = actual.maskShape === "arch-bottom" ? "arch" : "arch-bottom";
        }
      }
    }
    patches.set(id, patch);
  }
  return replaceLayers(template, patches);
}

/** Degrees in (-180, 180], to 0.01°. */
export function normalizeDegrees(degrees: number): number {
  let value = (((Number(degrees) || 0) % 360) + 360) % 360;
  if (value > 180) value -= 360;
  return round2(value) + 0;
}

/**
 * Rotate a selection rigidly by `degrees` about its combined centre: every
 * object's centre turns about that point and its own rotation grows by the same
 * amount, so the arrangement turns as one piece. One object turns in place.
 */
export function rotateLayerSelection(template: any, layerIds: string[], degrees: number, geometryLayers?: any[]) {
  if (!layerIds.length || !Number.isFinite(degrees) || degrees % 360 === 0) return template;
  const geometry = geometryLookup(template, geometryLayers);
  const roots = layerIds.map(geometry).filter(Boolean);
  if (!roots.length) return template;
  const centre = selectionCentre(roots);
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const patches = new Map<string, Record<string, unknown>>();
  for (const id of withDescendants(template, layerIds)) {
    const actual = getLayer(template, id);
    if (!actual || actual.type === "background") continue;
    const seen = geometry(id) || actual;
    const dx = Number(seen.x) - centre.x;
    const dy = Number(seen.y) - centre.y;
    patches.set(id, {
      x: round2(Number(actual.x) + centre.x + dx * cos - dy * sin - Number(seen.x)),
      y: round2(Number(actual.y) + centre.y + dx * sin + dy * cos - Number(seen.y)),
      rotation: normalizeDegrees((Number(actual.rotation) || 0) + degrees),
    });
  }
  return replaceLayers(template, patches);
}

/**
 * Size an object to the artboard, keeping its proportions: "fit" makes the
 * whole (rotation-aware) object fit inside the card, "fill" makes it cover the
 * card. It is centred on the card either way. Nothing is stretched.
 */
export function fitLayerToArtboard(template: any, layerId: string, mode: "fit" | "fill", geometryLayers?: any[]) {
  const geometry = geometryLookup(template, geometryLayers);
  const seen = geometry(layerId);
  if (!seen) return template;
  const { halfW, halfH } = rotatedAxisHalfExtents(seen);
  if (!(halfW > 0) || !(halfH > 0)) return template;
  const canvasW = Number(template.canvasWidthPx) || 1500;
  const canvasH = Number(template.canvasHeightPx) || 2100;
  const ratios = [canvasW / (halfW * 2), canvasH / (halfH * 2)];
  const factor = mode === "fit" ? Math.min(...ratios) : Math.max(...ratios);
  const unchangedSize = Math.abs(factor - 1) < 1e-9;
  const scaled = unchangedSize ? template : scaleLayerSelection(template, [layerId], factor, geometryLayers);
  if (!unchangedSize && scaled === template) return template;
  const actual = getLayer(scaled, layerId);
  // Scaling about the object's own centre leaves that centre in place, so the
  // offset that centres the seen geometry also centres the stored one.
  return updateLayer(scaled, layerId, {
    x: round2(Number(actual.x) + canvasW / 2 - Number(seen.x)),
    y: round2(Number(actual.y) + canvasH / 2 - Number(seen.y)),
  });
}

/**
 * A photo's framing inside its own box: "fit" shows the whole picture
 * (letterboxed where the proportions differ), "fill" covers the box (cropping
 * the overflow). The pan, zoom and crop rectangle start fresh; flips, in-frame
 * rotation, the box, the mask and any eraser marks are kept.
 */
export function setImageFitMode(template: any, layerId: string, mode: "fit" | "fill") {
  const layer = getLayer(template, layerId);
  if (!layer || (layer.type !== "image" && layer.type !== "frame")) return template;
  const transform = layer.imageTransform && typeof layer.imageTransform === "object" ? layer.imageTransform : {};
  const kept = Object.fromEntries(Object.entries(transform).filter(([key]) => !["cropX", "cropY", "cropWidth", "cropHeight"].includes(key)));
  const fitMode = mode === "fit" ? "contain" : "cover";
  return updateLayer(template, layerId, { fitMode, imageTransform: { ...kept, zoom: 1, offsetX: 0, offsetY: 0, fitMode } });
}
