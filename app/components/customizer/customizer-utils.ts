// Pure client helpers shared by the admin setup preview and the customer
// customizer. No React, no network — just template + value math.

import {
  defaultCustomerPermissions,
  normalizeEditorState,
  normalizeUserLayer,
} from "@/lib/customizer";

export type ImageValue = {
  url?: string;
  signedUrl?: string;
  path?: string;
  name?: string;
  zoom?: number;
  offsetX?: number;
  offsetY?: number;
};

export type EditorState = {
  layerOverrides: Record<string, { textStyle?: any; transform?: any }>;
  userLayers: any[];
};

export { normalizeEditorState, normalizeUserLayer };

/* ---- Customer permissions --------------------------------------------------
   Resolve a layer's effective customer permissions, falling back to defaults
   derived from the legacy flags for templates saved before permissions existed. */
export function getLayerPermissions(layer: any): Record<string, boolean> {
  const defaults = defaultCustomerPermissions(layer || {});
  const stored = layer?.customerPermissions;
  if (!stored || typeof stored !== "object") return defaults;
  return { ...defaults, ...stored };
}

// Whether the customer may interact with this template layer on the canvas.
export function isLayerCustomerInteractive(layer: any): boolean {
  if (!layer || layer.hidden) return false;
  if (!layer.customerEditable) return false;
  const permissions = getLayerPermissions(layer);
  if (layer.type === "text") {
    return [
      "editContent",
      "editStyle",
      "changeFont",
      "changeFontSize",
      "changeColor",
      "changeAlignment",
      "changeLetterSpacing",
      "move",
      "resize",
      "rotate",
      "duplicate",
      "delete",
    ].some((key) => permissions[key]);
  }
  if (layer.type === "image") {
    return ["replaceImage", "zoomImage", "repositionImage", "move", "resize", "rotate"].some(
      (key) => permissions[key],
    );
  }
  return false;
}

// Whether a page allows customer-added text (page overrides template setting).
export function pageAllowsCustomerText(template: any, pageId: string): boolean {
  const page = (template?.pages || []).find((p: any) => p.id === pageId);
  if (page && page.allowCustomerText !== undefined) return Boolean(page.allowCustomerText);
  return Boolean(template?.settings?.allowCustomerText);
}

/* ---- Editor-state aware layer resolution ---------------------------------- */

// Apply a customer's override (allowed style/transform changes) to a template
// layer without mutating the template.
export function applyLayerOverride(layer: any, override: any): any {
  if (!override) return layer;
  const next = { ...layer };
  if (override.transform && typeof override.transform === "object") {
    const t = override.transform;
    if (t.x !== undefined) next.x = Number(t.x);
    if (t.y !== undefined) next.y = Number(t.y);
    if (t.width !== undefined) next.width = Number(t.width);
    if (t.height !== undefined) next.height = Number(t.height);
    if (t.rotation !== undefined) next.rotation = Number(t.rotation);
  }
  if (override.textStyle && typeof override.textStyle === "object" && layer.type === "text") {
    next.textStyle = { ...(layer.textStyle || {}), ...override.textStyle };
  }
  return next;
}

// Template layers for a page with the customer's overrides applied, plus the
// customer's own added layers, in stacking order. This is what every surface
// (editor, thumbnails, review, export) renders.
export function getEffectiveLayersForPage(template: any, pageId: string, editorState?: EditorState | null): any[] {
  const overrides = editorState?.layerOverrides || {};
  const templateLayers = getLayersForPage(template, pageId).map((layer: any) =>
    applyLayerOverride(layer, overrides[layer.id]),
  );
  const userLayers = (editorState?.userLayers || [])
    .filter((layer: any) => layer && layer.page === pageId)
    .map((layer: any) => ({ ...layer, isUserLayer: true }));
  return [...templateLayers, ...userLayers].sort((a: any, b: any) => Number(a.zIndex || 0) - Number(b.zIndex || 0));
}

export function getEnabledPages(template: any): any[] {
  return (template?.pages || []).filter((page: any) => page && page.enabled !== false);
}

export function getPageById(template: any, pageId: string): any {
  return getEnabledPages(template).find((page: any) => page.id === pageId) || getEnabledPages(template)[0] || null;
}

export function getLayersForPage(template: any, pageId: string): any[] {
  return (template?.layers || [])
    .filter((layer: any) => layer.page === pageId)
    .slice()
    .sort((a: any, b: any) => Number(a.zIndex || 0) - Number(b.zIndex || 0));
}

export function getFieldById(template: any, fieldId: string): any {
  return (template?.fields || []).find((field: any) => field.id === fieldId) || null;
}

export function getFieldDefaultValue(field: any): any {
  if (!field) return "";
  if (field.type === "checkbox") return Boolean(field.defaultValue);
  if (field.type === "image" || field.type === "file") return null;
  return field.defaultValue ?? "";
}

export function buildInitialValues(template: any): Record<string, any> {
  const values: Record<string, any> = {};
  (template?.fields || []).forEach((field: any) => {
    // For text fields, pre-fill with the connected layer's current design text so
    // the form and preview share one source of truth (the layer), avoiding drift
    // when admin edits the design after creating the field.
    if (field.type !== "image" && field.type !== "file") {
      const layer = (template?.layers || []).find((l: any) => l.fieldId === field.id && l.customerEditable && l.type === "text");
      if (layer && layer.text) {
        values[field.id] = layer.text;
        return;
      }
    }
    values[field.id] = getFieldDefaultValue(field);
  });
  return values;
}

export function isImageValue(value: any): value is ImageValue {
  return Boolean(value) && typeof value === "object" && ("url" in value || "signedUrl" in value || "path" in value);
}

export function getImageUrl(value: any): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (isImageValue(value)) return value.signedUrl || value.url || "";
  return "";
}

export function isValueEmpty(value: any): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "boolean") return false;
  if (typeof value === "string") return value.trim().length === 0;
  if (isImageValue(value)) return !getImageUrl(value);
  return false;
}

// The text a text layer should show. The customer's value overrides the design
// only when the layer is customer-editable and connected to a field; otherwise
// the admin's design text (layer.text) is shown as-is. Applies uppercase.
export function resolveLayerText(layer: any, field: any, values: Record<string, any>): string {
  const editable = Boolean(layer?.customerEditable && field);
  const raw = editable ? values[field.id] : undefined;
  let text = "";
  if (!isValueEmpty(raw) && typeof raw !== "object") {
    text = String(raw);
  } else if (layer?.text) {
    text = String(layer.text);
  } else if (field && field.defaultValue) {
    text = String(field.defaultValue);
  } else if (editable) {
    text = field.placeholder || field.label || "";
  }
  if (layer?.textStyle?.uppercase) text = text.toUpperCase();
  return text;
}

export function resolveLayerImage(layer: any, field: any, values: Record<string, any>): ImageValue | null {
  const editable = Boolean(layer?.customerEditable && field);
  const raw = editable ? values[field.id] : undefined;
  const url = getImageUrl(raw);
  if (url) {
    const meta = isImageValue(raw) ? raw : {};
    return {
      url,
      signedUrl: isImageValue(raw) ? raw.signedUrl : undefined,
      zoom: Number(meta.zoom) > 0 ? Number(meta.zoom) : 1,
      offsetX: Number(meta.offsetX) || 0,
      offsetY: Number(meta.offsetY) || 0,
    };
  }
  // Admin-provided image content for the layer, else a placeholder frame.
  if (layer?.src) return { url: layer.src, zoom: 1, offsetX: 0, offsetY: 0 };
  if (layer?.placeholderImage) return { url: layer.placeholderImage, zoom: 1, offsetX: 0, offsetY: 0 };
  return null;
}

// Part 15 customer validation.
export function validateCustomerValues(
  template: any,
  values: Record<string, any>,
): { errors: Record<string, string>; missingRequired: string[]; ok: boolean } {
  const errors: Record<string, string> = {};
  const missingRequired: string[] = [];
  const enabledPageIds = new Set(getEnabledPages(template).map((page: any) => page.id));
  const editableFieldIds = new Set(
    (template?.layers || [])
      .filter((layer: any) => {
        if (!layer?.fieldId || layer.hidden || !enabledPageIds.has(layer.page)) return false;
        const permissions = getLayerPermissions(layer);
        return layer.type === "image" ? permissions.replaceImage : permissions.editContent;
      })
      .map((layer: any) => layer.fieldId),
  );

  (template?.fields || []).forEach((field: any) => {
    if (field.customerVisible === false || !editableFieldIds.has(field.id)) return;
    const value = values[field.id];
    if (field.required && isValueEmpty(value)) {
      errors[field.id] = `${field.label} is required.`;
      missingRequired.push(field.id);
      return;
    }
    if (field.maxLength && typeof value === "string" && value.length > field.maxLength) {
      errors[field.id] = `${field.label} must be ${field.maxLength} characters or fewer.`;
    }
  });

  return { errors, missingRequired, ok: Object.keys(errors).length === 0 };
}

// Part 11: a serializable snapshot that can recreate the final design exactly.
// editorState (customer overrides + added layers) is stored alongside the
// resolved layers so old readers keep working and new readers can rebuild the
// exact edited design.
export function buildRenderData(
  template: any,
  values: Record<string, any>,
  selectedOptions: Record<string, any> = {},
  editorState?: EditorState | null,
): any {
  const overrides = editorState?.layerOverrides || {};
  const userLayers = editorState?.userLayers || [];
  return {
    templateVersion: template?.version || 1,
    engine: template?.engine || "svg",
    canvas: { width: template?.canvasWidthPx || 0, height: template?.canvasHeightPx || 0 },
    orientation: template?.orientation || "portrait",
    safeArea: template?.safeArea || {},
    bleed: template?.bleed || {},
    pages: getEnabledPages(template).map((page: any) => ({
      id: page.id,
      label: page.label,
      backgroundImage: page.backgroundImage || "",
    })),
    layers: (template?.layers || []).map((raw: any) => {
      const layer = applyLayerOverride(raw, overrides[raw.id]);
      const field = layer.fieldId ? getFieldById(template, layer.fieldId) : null;
      const resolved =
        layer.type === "image"
          ? { resolvedImage: resolveLayerImage(layer, field, values) }
          : { resolvedText: resolveLayerText(layer, field, values) };
      return { ...layer, ...resolved };
    }),
    userLayers,
    editorState: {
      layerOverrides: overrides,
      userLayers,
    },
    values,
    selectedOptions,
    generatedAt: new Date().toISOString(),
  };
}

// Part 11: export an SVG string to a PNG data URL on the client (for cart
// thumbnails and preview images). Returns "" if rendering fails.
export function svgToPngDataUrl(svgString: string, width: number, height: number): Promise<string> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !svgString) {
      resolve("");
      return;
    }
    try {
      const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => {
        try {
          const scale = Math.min(1, 1000 / Math.max(width, height, 1));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve("");
            return;
          }
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/png"));
        } catch {
          resolve("");
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        resolve("");
      };
      image.src = url;
    } catch {
      resolve("");
    }
  });
}
