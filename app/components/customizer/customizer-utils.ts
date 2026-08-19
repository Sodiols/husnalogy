// Pure client helpers shared by the admin setup preview and the customer
// customizer. No React, no network — just template + value math.

import {
  customerEditablePermissionBundle,
  normalizeEditorState,
  normalizeUserLayer,
} from "@/lib/customizer";
import { anyGridSlotGrantsPhotoEditing, mergeGridSlotOverrides } from "@/lib/customizer/v2/grids";
import { getRenderableLayers } from "@/lib/customizer/v2/groups";
import { normalizeImageFilters } from "@/lib/customizer/v2/image-filters";

export type CropRectValue = {
  cropX?: number;
  cropY?: number;
  cropWidth?: number;
  cropHeight?: number;
};

export type ImageValue = {
  assetId?: string;
  ownerId?: string;
  bucket?: string;
  originalPath?: string;
  assetReference?: Record<string, unknown>;
  url?: string;
  signedUrl?: string;
  path?: string;
  name?: string;
  zoom?: number;
  offsetX?: number;
  offsetY?: number;
  /** Crop rectangle in normalized frame units; honoured by both renderers. */
  crop?: CropRectValue;
  flipX?: boolean;
  flipY?: boolean;
  imageRotation?: number;
};

// V2 in-frame crop state (spec §11) — kept separate from frame geometry.
export type ImageTransformOverride = {
  zoom?: number;
  offsetX?: number;
  offsetY?: number;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
  fitMode?: "cover" | "contain";
};

export type EditorState = {
  layerOverrides: Record<
    string,
    {
      textStyle?: any;
      transform?: any;
      imageTransform?: ImageTransformOverride;
      imageFilters?: Record<string, unknown>;
      properties?: Record<string, unknown>;
      name?: string;
      hidden?: boolean;
      customerLocked?: boolean;
      gridSlots?: Record<string, { assetId?: string; ownerId?: string; src?: string; bucket?: string; path?: string; originalPath?: string; assetReference?: Record<string, unknown>; metadata?: Record<string, unknown>; transform?: ImageTransformOverride }>;
      // Lets a template layer join a customer-created group (spec §76/§98/§111).
      groupId?: string | null;
    }
  >;
  userLayers: any[];
};

export { normalizeEditorState, normalizeUserLayer };

/* ---- Customer permissions --------------------------------------------------
   Customer editable is the single admin control: checked unlocks the complete
   permission bundle, unchecked locks every customer action. */
export function getLayerPermissions(layer: any): Record<string, boolean> {
  const permissions = customerEditablePermissionBundle(Boolean(layer?.customerEditable));
  // The primary customer-editable checkbox intentionally unlocks the complete
  // bundle. Grids are the one advanced exception: their container may remain
  // fixed while independently editable slots inherit/override photo controls.
  if (layer?.type !== "grid" || !layer?.customerEditable || !layer?.customerPermissions || typeof layer.customerPermissions !== "object") return permissions;
  for (const [key, value] of Object.entries(layer.customerPermissions)) {
    if (typeof value === "boolean") permissions[key] = value;
  }
  return permissions;
}

// Whether the customer may interact with this template layer on the canvas.
export function isLayerCustomerInteractive(layer: any): boolean {
  if (!layer || layer.hidden) return false;
  if (layer.customerInteractionDisabled) return false;
  // A photo grid whose container is deliberately fixed can still expose
  // individually editable slots (spec §17). This is checked BEFORE the
  // container's own customerEditable gate, which would otherwise hide the whole
  // grid — and with it the slot buttons — even though `applyGridSlotAsset` and
  // the save validator both accept the per-slot permissions the admin set.
  if (layer.type === "grid" && anyGridSlotGrantsPhotoEditing(layer)) return true;
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
  if (layer.type === "image" || layer.type === "frame") {
    return ["replaceImage", "zoomImage", "repositionImage", "move", "resize", "rotate"].some(
      (key) => permissions[key],
    );
  }
  if (layer.type === "grid") {
    return ["replaceImage", "cropImage", "zoomImage", "repositionImage", "move", "resize", "rotate"].some(
      (key) => permissions[key],
    );
  }
  if (layer.type === "group") return Boolean(permissions.select || permissions.move || permissions.resize || permissions.rotate);
  if (["shape", "element", "background", "qrCode"].includes(layer.type)) {
    return ["select", "editContent", "editStyle", "move", "resize", "rotate", "changeOpacity", "changeFill", "changeBorder", "editQRCodeValue", "editQRCodeStyle"].some((key) => permissions[key]);
  }
  return Boolean(permissions.select);
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
  let next = { ...layer };
  if (override.transform && typeof override.transform === "object") {
    const t = override.transform;
    if (t.x !== undefined) next.x = Number(t.x);
    if (t.y !== undefined) next.y = Number(t.y);
    if (t.width !== undefined) next.width = Number(t.width);
    if (t.height !== undefined) next.height = Number(t.height);
    if (t.rotation !== undefined) next.rotation = Number(t.rotation);
    if (t.opacity !== undefined) next.opacity = Number(t.opacity);
    if (t.zIndex !== undefined) next.zIndex = Number(t.zIndex);
  }
  if (override.textStyle && typeof override.textStyle === "object" && layer.type === "text") {
    next.textStyle = { ...(layer.textStyle || {}), ...override.textStyle };
  }
  // Crop-mode state for photo frames. Carried on the layer so every renderer
  // (editor, thumbnails, review, server) applies the same crop.
  if (override.imageTransform && typeof override.imageTransform === "object" && (layer.type === "image" || layer.type === "frame")) {
    next.imageTransform = { ...(layer.imageTransform || {}), ...override.imageTransform };
  }
  if (override.imageFilters && typeof override.imageFilters === "object" && (layer.type === "image" || layer.type === "frame")) {
    next.filters = normalizeImageFilters({ ...(layer.filters || {}), ...override.imageFilters });
  }
  if (override.properties && typeof override.properties === "object") next = { ...next, ...override.properties };
  if (override.name !== undefined) next.name = String(override.name).slice(0, 120);
  if (override.hidden !== undefined) next.hidden = Boolean(override.hidden);
  if (override.customerLocked !== undefined) next.customerLocked = Boolean(override.customerLocked);
  // Lets a template layer join a customer-created group (spec §76/§98/§111).
  // The group itself always lives in userLayers - this override only ever
  // changes which group id a TEMPLATE layer points at.
  if (override.groupId !== undefined) next.groupId = override.groupId || "";
  if (override.gridSlots && typeof override.gridSlots === "object" && layer.type === "grid") {
    next.slots = mergeGridSlotOverrides(Array.isArray(layer.slots) ? layer.slots : [], override.gridSlots);
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
  return getRenderableLayers([...templateLayers, ...userLayers]);
}

/**
 * Merge transient gesture geometry over resolved layers.
 *
 * Used to preview a live resize or rotation: the affected layers are re-rendered
 * at their real in-progress values so text re-wraps and photos re-fit exactly as
 * they will once committed. Applied LAST, so an in-flight gesture always wins
 * over the persisted value it is replacing, and `textStyle` is merged rather
 * than replaced so a font-size preview does not drop the layer's font family.
 *
 * Pure and override-shaped so both canvases share it and it stays testable.
 */
export function applyGeometryOverrides(
  layers: any[],
  overrides?: Record<string, Record<string, any>> | null,
): any[] {
  if (!overrides) return layers;
  const ids = Object.keys(overrides);
  if (!ids.length) return layers;
  return layers.map((layer: any) => {
    const override = layer?.id ? overrides[layer.id] : null;
    if (!override) return layer;
    const { textStyle, ...geometry } = override;
    return {
      ...layer,
      ...geometry,
      ...(textStyle ? { textStyle: { ...(layer.textStyle || {}), ...textStyle } } : {}),
    };
  });
}

export function getEnabledPages(template: any): any[] {
  return (template?.pages || []).filter((page: any) => page && page.enabled !== false);
}

export function getPageById(template: any, pageId: string): any {
  return getEnabledPages(template).find((page: any) => page.id === pageId) || getEnabledPages(template)[0] || null;
}

export function getLayersForPage(template: any, pageId: string): any[] {
  return (template?.layers || [])
    .filter((layer: any) => (layer.page ?? layer.pageId) === pageId)
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
  // Whitespace is content in a text editor. Only the truly empty string falls
  // back to design/default text; trimming here would make the renderer read a
  // different value from the textarea and persisted document.
  if (
    raw !== undefined &&
    raw !== null &&
    typeof raw !== "object" &&
    (typeof raw !== "string" || raw.length > 0)
  ) {
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

/** The crop rectangle from the editor override, falling back to the value. */
function pickCropRect(
  override: Record<string, any> | null | undefined,
  fallback: Record<string, any> = {},
): CropRectValue | undefined {
  const source = [override, fallback].find(
    (candidate) => candidate && Number(candidate.cropWidth) > 0 && Number(candidate.cropHeight) > 0,
  );
  if (!source) return undefined;
  return {
    cropX: Number(source.cropX) || 0,
    cropY: Number(source.cropY) || 0,
    cropWidth: Number(source.cropWidth),
    cropHeight: Number(source.cropHeight),
  };
}

export function resolveLayerImage(layer: any, field: any, values: Record<string, any>): ImageValue | null {
  const editable = Boolean(layer?.customerEditable && field);
  const raw = editable ? values[field.id] : undefined;
  const url = getImageUrl(raw);
  // Crop-mode override (editorState) wins over legacy per-value zoom/offset.
  const crop: ImageTransformOverride = layer?.imageTransform || {};
  if (url) {
    const meta = isImageValue(raw) ? raw : {};
    return {
      url,
      signedUrl: isImageValue(raw) ? raw.signedUrl : undefined,
      zoom: Number(crop.zoom) > 0 ? Number(crop.zoom) : Number(meta.zoom) > 0 ? Number(meta.zoom) : 1,
      offsetX: crop.offsetX !== undefined ? Number(crop.offsetX) : Number(meta.offsetX) || 0,
      offsetY: crop.offsetY !== undefined ? Number(crop.offsetY) : Number(meta.offsetY) || 0,
      flipX: crop.flipX !== undefined ? Boolean(crop.flipX) : Boolean(meta.flipX),
      flipY: crop.flipY !== undefined ? Boolean(crop.flipY) : Boolean(meta.flipY),
      imageRotation: crop.rotation !== undefined ? Number(crop.rotation) : Number(meta.imageRotation) || 0,
      // The crop rectangle used to be dropped here, which is why nothing ever
      // rendered it even though it was stored and validated.
      crop: pickCropRect(crop, meta),
    };
  }
  // Admin-provided image content for the layer, else a placeholder frame.
  const base = { zoom: 1, offsetX: 0, offsetY: 0, flipX: false, flipY: false, imageRotation: 0 };
  const withCrop = {
    ...base,
    zoom: Number(crop.zoom) > 0 ? Number(crop.zoom) : 1,
    offsetX: Number(crop.offsetX) || 0,
    offsetY: Number(crop.offsetY) || 0,
    flipX: Boolean(crop.flipX),
    flipY: Boolean(crop.flipY),
    imageRotation: Number(crop.rotation) || 0,
    crop: pickCropRect(crop),
  };
  if (layer?.src) return { url: layer.src, ...withCrop };
  if (layer?.placeholderImage) return { url: layer.placeholderImage, ...base };
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
         return layer.type === "image" || layer.type === "frame" ? permissions.replaceImage : permissions.editContent;
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

export type ReviewIssue = {
  fieldId: string;
  message: string;
  /** The object the customer has to fix, when the field drives one. */
  layerId: string | null;
  /** The page that object sits on, so review can navigate straight there. */
  pageId: string | null;
  pageLabel: string;
};

/**
 * Turns the flat `fieldId -> message` validation map into something the review
 * step can act on (spec §28: "Allow navigation directly to the relevant page or
 * object where practical").
 *
 * The messages were previously rendered as inert list items, which told the
 * customer what was wrong but not where it was — on a multi-page product that
 * means hunting. Each issue is resolved to its layer and page here so the
 * review step can offer a jump instead.
 *
 * Issues whose field drives no visible layer keep a null target and stay plain
 * text, so nothing ever offers a jump that goes nowhere.
 */
export function resolveReviewIssues(
  template: any,
  errors: Record<string, string>,
): ReviewIssue[] {
  const pages = getEnabledPages(template);
  const pageById = new Map(pages.map((page: any) => [page.id, page]));
  const layers = (template?.layers || []) as any[];
  return Object.entries(errors || {}).map(([fieldId, message]) => {
    const layer = layers.find(
      (candidate: any) =>
        candidate?.fieldId === fieldId && !candidate.hidden && pageById.has(candidate.page),
    );
    const page = layer ? pageById.get(layer.page) : null;
    return {
      fieldId,
      message: String(message),
      layerId: layer?.id ?? null,
      pageId: layer?.page ?? null,
      pageLabel: String((page as any)?.label || (page as any)?.name || ""),
    };
  });
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
        layer.type === "image" || layer.type === "frame"
          ? { resolvedImage: resolveLayerImage(layer, field, values) }
          : layer.type === "grid"
            ? { resolvedSlots: layer.slots || [] }
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
