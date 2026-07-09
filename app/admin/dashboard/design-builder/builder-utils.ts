"use client";

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
    name: "Shape",
    page: pageId,
    type: "shape",
    shape,
    fill: shape === "line" ? "none" : "#F4ECEC",
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
  };
}

/* ---------- template mutations ---------- */

export function addLayer(template: any, layer: any) {
  return { ...template, layers: [...(template.layers || []), layer] };
}

export function updateLayer(template: any, layerId: string, patch: any) {
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
  return { ...template, fields, layers: (template.layers || []).filter((l: any) => l.id !== layerId) };
}

export function duplicateLayer(template: any, layerId: string) {
  const layer = getLayer(template, layerId);
  if (!layer) return { template, newId: null };
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

  if (!editable) {
    const fields = (template.fields || []).filter((f: any) => f.id !== layer.fieldId);
    return { ...template, fields, layers: updateLayer(template, layerId, { customerEditable: false, fieldId: "" }).layers };
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
    layers: (template.layers || []).map((l: any) => (l.id === layerId ? { ...l, customerEditable: true, fieldId } : l)),
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

export async function uploadBuilderImage(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("folder", "product-images");
  formData.append("files", file);
  const res = await fetch("/api/admin/uploads", { method: "POST", body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data?.error || "Upload failed.");
  return Array.isArray(data.urls) ? data.urls[0] || "" : "";
}
