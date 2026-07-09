// Shared, dependency-light normalization for the product customizer.
// Safe to import on both server and client (only pure helpers are used here).

import { createId } from "@/lib/core/id";
import {
  cleanOptionalString,
  cleanString,
  clampString,
  normalizeBoolean,
  normalizeStringArray,
} from "@/lib/validation";

export const CUSTOMIZER_ENGINES = new Set(["svg"]);
export const CUSTOMIZER_ORIENTATIONS = new Set(["portrait", "landscape", "square"]);

// Admin-facing field types (Part 3.5). Legacy product.customizationFields use a
// close-but-different vocabulary, so we map both onto this canonical set.
export const CUSTOMIZER_FIELD_TYPES = new Set([
  "text", // short text
  "textarea", // long text
  "date",
  "time",
  "number",
  "select",
  "checkbox",
  "image",
  "file",
]);

const LEGACY_FIELD_TYPE_MAP: Record<string, string> = {
  text: "text",
  short_text: "text",
  email: "text",
  tel: "text",
  color: "text",
  textarea: "textarea",
  long_text: "textarea",
  date: "date",
  time: "time",
  number: "number",
  select: "select",
  checkbox: "checkbox",
  image: "image",
  file: "file",
};

export const CUSTOMIZER_LAYER_TYPES = new Set(["text", "image", "shape"]);
export const CUSTOMIZER_SHAPE_KINDS = new Set(["rectangle", "ellipse", "line"]);
export const CUSTOMIZER_MASK_SHAPES = new Set(["rectangle", "rounded", "circle", "arch"]);
export const CUSTOMIZER_FIT_MODES = new Set(["cover", "contain"]);
export const CUSTOMIZER_TEXT_ALIGN = new Set(["left", "center", "right"]);

export const DEFAULT_SAFE_AREA = { top: 90, right: 90, bottom: 90, left: 90 };
export const DEFAULT_BLEED = { top: 45, right: 45, bottom: 45, left: 45 };

export const DEFAULT_CUSTOMIZER_SETTINGS = {
  showSafeArea: true,
  showBleed: false,
  allowCustomerPhotoCrop: true,
  allowCustomerTextMove: false,
  requireApprovalCheckbox: true,
};

export const DEFAULT_TEXT_STYLE = {
  fontFamily: "Cormorant Garamond",
  fontSize: 64,
  fontWeight: "400",
  color: "#303839",
  letterSpacing: 2,
  lineHeight: 1.15,
  textAlign: "center",
  uppercase: false,
  multiline: false,
};

function toNumber(value: any, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toInt(value: any, fallback = 0): number {
  const num = Math.round(Number(value));
  return Number.isFinite(num) ? num : fallback;
}

function toPositiveInt(value: any, fallback: number): number {
  const num = toInt(value, fallback);
  return num > 0 ? num : fallback;
}

function keyify(value: string): string {
  return cleanString(value)
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function normalizeEdgeInset(value: any, fallback: any): { top: number; right: number; bottom: number; left: number } {
  const source = value && typeof value === "object" ? value : {};
  return {
    top: toNumber(source.top ?? fallback.top, fallback.top),
    right: toNumber(source.right ?? fallback.right, fallback.right),
    bottom: toNumber(source.bottom ?? fallback.bottom, fallback.bottom),
    left: toNumber(source.left ?? fallback.left, fallback.left),
  };
}

export function normalizeCustomizerField(input: any = {}): any {
  const label = clampString(input.label ?? input.name ?? "", 120);
  const rawType = cleanString(input.type).toLowerCase();
  const type = CUSTOMIZER_FIELD_TYPES.has(rawType) ? rawType : LEGACY_FIELD_TYPE_MAP[rawType] || "text";
  const id = keyify(input.id || input.key || input.name || label);

  return {
    id,
    label: label || id,
    type,
    required: normalizeBoolean(input.required),
    defaultValue:
      type === "checkbox"
        ? normalizeBoolean(input.defaultValue)
        : clampString(input.defaultValue ?? "", 2000),
    placeholder: clampString(input.placeholder ?? "", 200),
    helpText: clampString(input.helpText ?? input.helper ?? input.help ?? "", 300),
    maxLength: input.maxLength ? toPositiveInt(input.maxLength, 0) : 0,
    options: normalizeStringArray(input.options),
    customerVisible: input.customerVisible === undefined ? true : normalizeBoolean(input.customerVisible),
  };
}

function normalizeTextStyle(input: any = {}): any {
  const textAlign = cleanString(input.textAlign).toLowerCase();
  return {
    fontFamily: cleanString(input.fontFamily) || DEFAULT_TEXT_STYLE.fontFamily,
    fontSize: toPositiveInt(input.fontSize, DEFAULT_TEXT_STYLE.fontSize),
    fontWeight: cleanString(input.fontWeight) || DEFAULT_TEXT_STYLE.fontWeight,
    color: cleanString(input.color) || DEFAULT_TEXT_STYLE.color,
    letterSpacing: toNumber(input.letterSpacing, DEFAULT_TEXT_STYLE.letterSpacing),
    lineHeight: toNumber(input.lineHeight, DEFAULT_TEXT_STYLE.lineHeight) || DEFAULT_TEXT_STYLE.lineHeight,
    textAlign: CUSTOMIZER_TEXT_ALIGN.has(textAlign) ? textAlign : DEFAULT_TEXT_STYLE.textAlign,
    uppercase: normalizeBoolean(input.uppercase),
    multiline: normalizeBoolean(input.multiline),
  };
}

function clampOpacity(value: any): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1;
  return Math.min(1, Math.max(0, num));
}

export function normalizeCustomizerLayer(input: any = {}): any {
  const rawType = cleanString(input.type).toLowerCase();
  const type = CUSTOMIZER_LAYER_TYPES.has(rawType) ? rawType : "text";
  const id = keyify(input.id || input.name || "") || createId("layer").replace(/[^a-z0-9]+/gi, "_");

  const base = {
    id,
    name: clampString(input.name ?? input.label ?? id, 120) || id,
    page: cleanString(input.page) || "front",
    type,
    fieldId: keyify(input.fieldId || input.field || ""),
    x: toNumber(input.x, 0),
    y: toNumber(input.y, 0),
    width: toNumber(input.width, 0),
    height: toNumber(input.height, 0),
    rotation: toNumber(input.rotation, 0),
    zIndex: toInt(input.zIndex, 1),
    opacity: clampOpacity(input.opacity === undefined ? 1 : input.opacity),
    hidden: normalizeBoolean(input.hidden),
    // Two independent controls (spec): whether admin can move/edit the layer in
    // the builder, and whether the customer may edit it in the customizer.
    locked: normalizeBoolean(input.locked),
    adminEditable: input.adminEditable === undefined ? true : normalizeBoolean(input.adminEditable),
    customerEditable: normalizeBoolean(input.customerEditable),
  };

  if (type === "image") {
    const maskShape = cleanString(input.maskShape).toLowerCase();
    const fitMode = cleanString(input.fitMode).toLowerCase();
    return {
      ...base,
      // Admin-provided image content for this layer (design art / photo frame).
      src: cleanOptionalString(input.src || input.imageSrc),
      maskShape: CUSTOMIZER_MASK_SHAPES.has(maskShape) ? maskShape : "rectangle",
      fitMode: CUSTOMIZER_FIT_MODES.has(fitMode) ? fitMode : "cover",
      allowZoom: input.allowZoom === undefined ? true : normalizeBoolean(input.allowZoom),
      allowReposition: input.allowReposition === undefined ? true : normalizeBoolean(input.allowReposition),
      placeholderImage: cleanOptionalString(input.placeholderImage),
    };
  }

  if (type === "shape") {
    const kind = cleanString(input.shape || input.shapeKind).toLowerCase();
    return {
      ...base,
      shape: CUSTOMIZER_SHAPE_KINDS.has(kind) ? kind : "rectangle",
      fill: cleanString(input.fill) || "#F4ECEC",
      stroke: cleanOptionalString(input.stroke),
      strokeWidth: toNumber(input.strokeWidth, 0),
      borderRadius: toNumber(input.borderRadius, 0),
    };
  }

  return {
    ...base,
    // The design text the admin typed. The customer's value overrides it only
    // when the layer is customer-editable and connected to a field.
    text: clampString(input.text ?? "", 2000),
    textStyle: normalizeTextStyle(input.textStyle),
  };
}

export function normalizeCustomizerPage(input: any = {}, index = 0): any {
  const fallbackId = index === 0 ? "front" : index === 1 ? "back" : `page-${index + 1}`;
  const id = keyify(input.id || "") || fallbackId;
  return {
    id,
    label: clampString(input.label ?? "", 80) || (id === "front" ? "Front" : id === "back" ? "Back" : `Page ${index + 1}`),
    enabled: input.enabled === undefined ? true : normalizeBoolean(input.enabled),
    backgroundImage: cleanOptionalString(input.backgroundImage),
    backgroundColor: cleanOptionalString(input.backgroundColor) || "#ffffff",
    thumbnail: cleanOptionalString(input.thumbnail) || cleanOptionalString(input.backgroundImage),
  };
}

export function normalizeCustomizerTemplate(input: any = {}, existing: any = {}): any {
  const source = input && typeof input === "object" ? input : {};
  const prev = existing && typeof existing === "object" ? existing : {};

  const engine = cleanString(source.engine ?? prev.engine).toLowerCase();
  const orientation = cleanString(source.orientation ?? prev.orientation).toLowerCase();

  const rawPages = Array.isArray(source.pages) ? source.pages : Array.isArray(prev.pages) ? prev.pages : [];
  const pages = rawPages.map((page: any, index: number) => normalizeCustomizerPage(page, index));
  const pageIds = new Set(pages.map((page: any) => page.id));

  const rawFields = Array.isArray(source.fields) ? source.fields : Array.isArray(prev.fields) ? prev.fields : [];
  const fields = rawFields.map(normalizeCustomizerField).filter((field: any) => field.id);

  const rawLayers = Array.isArray(source.layers) ? source.layers : Array.isArray(prev.layers) ? prev.layers : [];
  const layers = rawLayers
    .map(normalizeCustomizerLayer)
    .map((layer: any) => ({ ...layer, page: pageIds.has(layer.page) ? layer.page : pages[0]?.id || "front" }));

  const defaultPage = cleanString(source.defaultPage ?? prev.defaultPage);

  return {
    enabled: normalizeBoolean(source.enabled ?? prev.enabled),
    version: toPositiveInt(source.version ?? prev.version, 1),
    engine: CUSTOMIZER_ENGINES.has(engine) ? engine : "svg",
    canvasWidthPx: toPositiveInt(source.canvasWidthPx ?? prev.canvasWidthPx, 1500),
    canvasHeightPx: toPositiveInt(source.canvasHeightPx ?? prev.canvasHeightPx, 2100),
    cardWidthIn: toNumber(source.cardWidthIn ?? prev.cardWidthIn, 5) || 5,
    cardHeightIn: toNumber(source.cardHeightIn ?? prev.cardHeightIn, 7) || 7,
    dpi: toPositiveInt(source.dpi ?? prev.dpi, 300),
    orientation: CUSTOMIZER_ORIENTATIONS.has(orientation) ? orientation : "portrait",
    defaultPage: pageIds.has(defaultPage) ? defaultPage : pages[0]?.id || "front",
    pages,
    fields,
    layers,
    safeArea: normalizeEdgeInset(source.safeArea ?? prev.safeArea, DEFAULT_SAFE_AREA),
    bleed: normalizeEdgeInset(source.bleed ?? prev.bleed, DEFAULT_BLEED),
    assets: source.assets && typeof source.assets === "object" ? source.assets : prev.assets || {},
    settings: {
      ...DEFAULT_CUSTOMIZER_SETTINGS,
      ...(prev.settings && typeof prev.settings === "object" ? prev.settings : {}),
      ...(source.settings && typeof source.settings === "object" ? source.settings : {}),
    },
  };
}

// A BLANK starting template. The customizer is off by default and the canvas is
// empty — admin designs the whole product manually in the Design Builder.
export function createDefaultCustomizerTemplate(): any {
  return normalizeCustomizerTemplate({
    enabled: false,
    version: 1,
    engine: "svg",
    canvasWidthPx: 1500,
    canvasHeightPx: 2100,
    cardWidthIn: 5,
    cardHeightIn: 7,
    dpi: 300,
    orientation: "portrait",
    defaultPage: "front",
    pages: [
      { id: "front", label: "Front", enabled: true, backgroundColor: "#ffffff" },
      { id: "back", label: "Back", enabled: false, backgroundColor: "#ffffff" },
    ],
    fields: [],
    layers: [],
  });
}

// Reconcile fields against layers before validation/save. This is the single
// source of truth for the layer<->field connection: it (re)builds template.fields
// purely from the customer-editable layers, so newly-added editable layers always
// get a field, orphan/deleted/hidden fields are dropped, ids stay unique, and
// text defaults track the layer text. Non-editable layers lose any dangling field.
export function prepareCustomizerTemplateForSave(template: any = {}): any {
  const t = template && typeof template === "object" ? template : {};
  const priorFields = new Map((Array.isArray(t.fields) ? t.fields : []).map((f: any) => [f.id, f]));
  const usedIds = new Set<string>();
  const nextFields: any[] = [];

  const layers = (Array.isArray(t.layers) ? t.layers : []).map((raw: any) => {
    const layer = { ...raw };
    const canEdit = layer.customerEditable && (layer.type === "text" || layer.type === "image");

    if (!canEdit) {
      // A non-editable layer must never keep a field reference.
      if (layer.fieldId) layer.fieldId = "";
      return layer;
    }

    // Prefer the layer's current connection, then its name, then a generated id.
    const originalId = keyify(layer.fieldId) || keyify(layer.name);
    let fieldId = originalId || `field_${Math.random().toString(36).slice(2, 8)}`;
    if (usedIds.has(fieldId)) {
      let i = 2;
      while (usedIds.has(`${fieldId}_${i}`)) i += 1;
      fieldId = `${fieldId}_${i}`;
    }
    usedIds.add(fieldId);
    layer.fieldId = fieldId;

    const prior: any = priorFields.get(originalId) || priorFields.get(fieldId) || {};
    const isImage = layer.type === "image";
    nextFields.push({
      id: fieldId,
      label: prior.label || layer.name || "Editable field",
      type: isImage ? "image" : layer.textStyle?.multiline ? "textarea" : "text",
      required: Boolean(prior.required),
      // Text defaults track the layer's design text; images keep any prior default.
      defaultValue: isImage ? prior.defaultValue || "" : layer.text || prior.defaultValue || "",
      placeholder: prior.placeholder || (isImage ? "" : layer.text || ""),
      helpText: prior.helpText || "",
      maxLength: prior.maxLength || 0,
      options: prior.options || [],
      customerVisible: true,
    });

    return layer;
  });

  return { ...t, layers, fields: nextFields };
}

// Part 14: build a simple template from legacy product.customizationFields so
// products that only have the old field list still get a working customizer.
export function buildFallbackTemplateFromFields(product: any = {}): any {
  const legacyFields = Array.isArray(product.customizationFields) ? product.customizationFields : [];
  const background = product.thumbnail || product.images?.[0] || product.mockups?.[0] || "";

  const fields = legacyFields.map((field: any) => normalizeCustomizerField(field));
  const layers = fields
    .filter((field: any) => field.type === "text" || field.type === "textarea" || field.type === "image")
    .map((field: any, index: number) => {
      const isImage = field.type === "image";
      return {
        id: `${field.id}_layer`,
        name: field.label,
        page: "front",
        type: isImage ? "image" : "text",
        fieldId: field.id,
        customerEditable: true,
        x: 750,
        y: 400 + index * 180,
        width: isImage ? 700 : 1100,
        height: isImage ? 700 : 110,
        zIndex: 10 + index,
        ...(isImage
          ? {}
          : { text: field.defaultValue || field.label, textStyle: { fontFamily: "Cormorant Garamond", fontSize: 64, textAlign: "center", color: "#303839" } }),
      };
    });

  return normalizeCustomizerTemplate({
    enabled: Boolean(legacyFields.length),
    version: 1,
    pages: [{ id: "front", label: "Front", enabled: true, backgroundImage: background }],
    fields,
    layers,
    settings: { ...DEFAULT_CUSTOMIZER_SETTINGS, requireApprovalCheckbox: true },
  });
}

// Admin-side publish validation. Returns an object of field -> message.
export function validateCustomizerTemplate(template: any = {}): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!template || !template.enabled) return errors;

  // Canvas must exist and have a size.
  if (!(template.canvasWidthPx > 0) || !(template.canvasHeightPx > 0)) {
    errors.canvas = "Canvas width and height are required.";
  }

  const pages = template.pages || [];
  const enabledPages = pages.filter((page: any) => page.enabled);
  const frontPage = pages.find((page: any) => page.id === "front" && page.enabled);
  if (!enabledPages.length || !frontPage) {
    errors.pages = "A front page is required.";
  }

  const layers = template.layers || [];
  const layersOnEnabledPages = layers.filter((layer: any) => enabledPages.some((page: any) => page.id === layer.page));
  if (!layersOnEnabledPages.length) {
    errors.layers = "Add at least one design layer.";
  }

  const fieldMap = new Map((template.fields || []).map((field: any) => [field.id, field]));

  // Customer-editable layers must be connected to a labelled field.
  layers.forEach((layer: any) => {
    if (!layer.customerEditable) return;
    const field: any = layer.fieldId ? fieldMap.get(layer.fieldId) : null;
    if (!field || !field.label) {
      errors.editable = "Every customer-editable layer needs a field label.";
    }
    if (field && !field.id) {
      errors.editable = "Every customer-editable field needs a key.";
    }
    // Photo placeholders must connect to an upload field.
    if (layer.type === "image" && field && field.type !== "image" && field.type !== "file") {
      errors.photo = "Editable photo placeholders must connect to an image upload field.";
    }
  });

  // Required fields must have a key.
  (template.fields || []).forEach((field: any) => {
    if (field.required && !field.id) errors.fields = "Required fields must have a key.";
  });

  return errors;
}

// Part 13: bump the version when the editable structure (not just default text)
// changes, so already-placed customizations can detect drift.
export function shouldBumpTemplateVersion(existing: any, next: any): boolean {
  if (!existing) return false;
  const structural = (template: any) => ({
    pages: (template.pages || []).map((page: any) => ({ id: page.id, enabled: page.enabled })),
    fields: (template.fields || []).map((field: any) => ({ id: field.id, type: field.type, required: field.required })),
    layers: (template.layers || []).map((layer: any) => ({
      id: layer.id,
      page: layer.page,
      type: layer.type,
      fieldId: layer.fieldId,
    })),
    canvasWidthPx: template.canvasWidthPx,
    canvasHeightPx: template.canvasHeightPx,
  });
  return JSON.stringify(structural(existing)) !== JSON.stringify(structural(next));
}

// ---- DB row <-> template mapping ------------------------------------------

export function templateFromRow(row: any = {}): any {
  if (!row || typeof row !== "object") return null;
  return {
    id: row.id,
    productId: row.product_id,
    ...normalizeCustomizerTemplate({
      enabled: row.enabled,
      version: row.version,
      engine: row.engine,
      canvasWidthPx: row.canvas_width_px,
      canvasHeightPx: row.canvas_height_px,
      cardWidthIn: row.card_width_in,
      cardHeightIn: row.card_height_in,
      dpi: row.dpi,
      orientation: row.orientation,
      defaultPage: row.default_page,
      pages: row.pages,
      fields: row.fields,
      layers: row.layers,
      safeArea: row.safe_area,
      bleed: row.bleed,
      assets: row.assets,
      settings: row.settings,
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function templateToRow(productId: string, template: any = {}): any {
  const normalized = normalizeCustomizerTemplate(template);
  return {
    product_id: productId,
    enabled: normalized.enabled,
    version: normalized.version,
    engine: normalized.engine,
    canvas_width_px: normalized.canvasWidthPx,
    canvas_height_px: normalized.canvasHeightPx,
    card_width_in: normalized.cardWidthIn,
    card_height_in: normalized.cardHeightIn,
    dpi: normalized.dpi,
    orientation: normalized.orientation,
    default_page: normalized.defaultPage,
    pages: normalized.pages,
    fields: normalized.fields,
    layers: normalized.layers,
    safe_area: normalized.safeArea,
    bleed: normalized.bleed,
    assets: normalized.assets,
    settings: normalized.settings,
  };
}
