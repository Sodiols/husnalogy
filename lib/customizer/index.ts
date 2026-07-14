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
import { listFonts } from "@/lib/customizer/v2/fonts";
import { normalizeGridSlot } from "@/lib/customizer/v2/grids";

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

export const CUSTOMIZER_LAYER_TYPES = new Set(["text", "image", "frame", "grid", "group", "shape", "element", "background"]);
export const CUSTOMIZER_SHAPE_KINDS = new Set([
  "rectangle",
  "rounded-rectangle",
  "ellipse",
  "circle",
  "oval",
  "triangle",
  "polygon",
  "arch",
  "path",
  "line",
]);
export const CUSTOMIZER_MASK_SHAPES = new Set([
  "rectangle",
  "rounded",
  "circle",
  "oval",
  "arch", // legacy value — top arch
  "arch-top",
  "arch-bottom",
  "arch-full",
]);
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
  // Whether customers may add their own text layers (template-wide default;
  // individual pages can override via page.allowCustomerText).
  allowCustomerText: false,
  allowCustomerUploads: true,
  // Screenshot/copy deterrence on the customer customizer.
  protectedPreview: true,
  autosave: true,
  templateName: "",
  templateDescription: "",
  adminNotes: "",
};

// Fonts approved for template text and customer text. These render consistently
// in the live editor, exports, and previews (site-loaded webfonts + safe system
// fonts). Keep this list in sync with fonts actually available in the app.
export const CUSTOMIZER_APPROVED_FONTS = listFonts({ adminOnly: true }).map((font) => ({
  value: font.cssFamily,
  label: font.displayName,
  stack: font.cssStack,
}));

// Expanded permission keys remain in stored documents for server enforcement.
// The admin-facing source of truth is now the single customerEditable flag.
export const CUSTOMER_PERMISSION_KEYS = [
  "editContent",
  "editStyle",
  "changeFont",
  "changeFontSize",
  "changeColor",
  "changeAlignment",
  "changeLetterSpacing",
  "changeLineHeight",
  "move",
  "resize",
  "rotate",
  "duplicate",
  "delete",
  "replaceImage",
  "cropImage",
  "zoomImage",
  "repositionImage",
  "flipImage",
  "changeOpacity",
  "changeLayerOrder",
] as const;

// The admin builder exposes one Customer editable checkbox. Keep the expanded
// permission object for customer/server enforcement, but generate it as one
// complete bundle so administrators never enable every action by hand.
export function customerEditablePermissionBundle(editable: boolean): Record<string, boolean> {
  return Object.fromEntries(CUSTOMER_PERMISSION_KEYS.map((key) => [key, editable]));
}

export function defaultCustomerPermissions(layer: any = {}): Record<string, boolean> {
  return customerEditablePermissionBundle(Boolean(layer.customerEditable));
}

export function normalizeCustomerPermissions(_input: any, layer: any = {}): Record<string, boolean> {
  return defaultCustomerPermissions(layer);
}

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
  const verticalAlign = cleanString(input.verticalAlign).toLowerCase();
  return {
    fontFamily: cleanString(input.fontFamily) || DEFAULT_TEXT_STYLE.fontFamily,
    fontSize: toPositiveInt(input.fontSize, DEFAULT_TEXT_STYLE.fontSize),
    fontWeight: cleanString(input.fontWeight) || DEFAULT_TEXT_STYLE.fontWeight,
    fontStyle: cleanString(input.fontStyle) === "italic" ? "italic" : "normal",
    underline: normalizeBoolean(input.underline),
    color: cleanString(input.color) || DEFAULT_TEXT_STYLE.color,
    letterSpacing: toNumber(input.letterSpacing, DEFAULT_TEXT_STYLE.letterSpacing),
    lineHeight: toNumber(input.lineHeight, DEFAULT_TEXT_STYLE.lineHeight) || DEFAULT_TEXT_STYLE.lineHeight,
    textAlign: CUSTOMIZER_TEXT_ALIGN.has(textAlign) ? textAlign : DEFAULT_TEXT_STYLE.textAlign,
    verticalAlign: verticalAlign === "top" || verticalAlign === "bottom" ? verticalAlign : "middle",
    uppercase: normalizeBoolean(input.uppercase),
    multiline: normalizeBoolean(input.multiline),
    // V2 text box behaviour (spec §9): "shrink" reduces the size down to
    // minFontSize until the text fits its box.
    fitMode: cleanString(input.fitMode) === "shrink" ? "shrink" : "fixed",
    ...(input.minFontSize !== undefined ? { minFontSize: toPositiveInt(input.minFontSize, 8) } : {}),
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
    groupId: cleanString(input.groupId),
    scale: Math.max(0.0001, toNumber(input.scale, 1)),
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
  };

  // Normalized after the base so defaults can read customerEditable/type.
  const customerPermissions = normalizeCustomerPermissions(
    input.customerPermissions,
    { ...base, allowZoom: input.allowZoom, allowReposition: input.allowReposition },
  );
  (base as any).customerPermissions = customerPermissions;

  if (type === "image" || type === "frame") {
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
      // Frame styling (spec §12).
      borderColor: cleanOptionalString(input.borderColor),
      borderWidth: Math.max(0, toNumber(input.borderWidth, 0)),
      backgroundColor: cleanOptionalString(input.backgroundColor),
      ...(type === "frame" ? { defaultAssetId: cleanOptionalString(input.defaultAssetId), assetId: cleanOptionalString(input.assetId) } : {}),
    };
  }

  if (type === "grid") {
    return {
      ...base,
      columns: Math.max(1, toInt(input.columns, 2)),
      rows: Math.max(1, toInt(input.rows, 2)),
      slots: (Array.isArray(input.slots) ? input.slots : []).map((slot: any, index: number) => normalizeGridSlot(slot, index)),
      gap: Math.max(0, toNumber(input.gap, 12)),
      padding: Math.max(0, toNumber(input.padding, 0)),
      cornerRadius: Math.max(0, toNumber(input.cornerRadius, 0)),
      borderColor: cleanOptionalString(input.borderColor),
      borderWidth: Math.max(0, toNumber(input.borderWidth, 0)),
      backgroundColor: cleanOptionalString(input.backgroundColor),
    };
  }

  if (type === "group") {
    return {
      ...base,
      childIds: (Array.isArray(input.childIds) ? input.childIds : []).map(cleanString).filter(Boolean),
      allowCustomerUngroup: normalizeBoolean(input.allowCustomerUngroup),
      childSelection: input.childSelection === "group" || input.childSelection === "none" ? input.childSelection : "children",
    };
  }

  if (type === "background") {
    return {
      ...base,
      color: cleanString(input.color) || "#ffffff",
      assetId: cleanOptionalString(input.assetId),
      src: cleanOptionalString(input.src),
      fitMode: CUSTOMIZER_FIT_MODES.has(cleanString(input.fitMode)) ? cleanString(input.fitMode) : "cover",
    };
  }

  if (type === "element") {
    return {
      ...base,
      assetId: cleanOptionalString(input.assetId),
      src: cleanOptionalString(input.src),
      tintColor: cleanOptionalString(input.tintColor),
      flipX: normalizeBoolean(input.flipX),
      flipY: normalizeBoolean(input.flipY),
    };
  }

  if (type === "shape") {
    const kind = cleanString(input.shape || input.shapeKind).toLowerCase();
    return {
      ...base,
      shape: CUSTOMIZER_SHAPE_KINDS.has(kind) ? kind : "rectangle",
      fill: cleanString(input.fill) || "#F8F6F1",
      stroke: cleanOptionalString(input.stroke),
      strokeWidth: toNumber(input.strokeWidth, 0),
      borderRadius: toNumber(input.borderRadius, 0),
      points: Array.isArray(input.points)
        ? input.points
            .map((point: any) => ({ x: toNumber(point?.x, 0), y: toNumber(point?.y, 0) }))
            .filter((point: any) => Number.isFinite(point.x) && Number.isFinite(point.y))
        : [],
      path: clampString(input.path ?? input.d ?? "", 8000),
      lineStyle: ["solid", "dashed", "dotted"].includes(cleanString(input.lineStyle)) ? cleanString(input.lineStyle) : "solid",
      lineCap: ["butt", "round", "square"].includes(cleanString(input.lineCap)) ? cleanString(input.lineCap) : "round",
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
    // Tri-state: undefined inherits template settings.allowCustomerText.
    ...(input.allowCustomerText === undefined ? {} : { allowCustomerText: normalizeBoolean(input.allowCustomerText) }),
  };
}

/* ---- Customer editor state (Section 15) -----------------------------------
   Customer changes never mutate the template. They are stored as an
   editorState object inside the customization's renderData JSONB:
   layerOverrides keyed by template layer id (style/transform patches the admin
   allowed) plus userLayers (customer-added text). */

export function normalizeUserLayer(input: any = {}): any | null {
  if (!input || typeof input !== "object") return null;
  const id = cleanString(input.id) || createId("ulayer").replace(/[^a-z0-9_]+/gi, "_");

  // Customer-inserted element from the Husnalogy elements library.
  if (cleanString(input.type).toLowerCase() === "element") {
    return {
      id,
      type: "element",
      page: cleanString(input.page) || "front",
      assetId: cleanString(input.assetId),
      src: clampString(input.src ?? "", 4000),
      tintColor: cleanOptionalString(input.tintColor),
      x: toNumber(input.x, 0),
      y: toNumber(input.y, 0),
      width: toNumber(input.width, 300) || 300,
      height: toNumber(input.height, 300) || 300,
      rotation: toNumber(input.rotation, 0),
      opacity: clampOpacity(input.opacity === undefined ? 1 : input.opacity),
      flipX: normalizeBoolean(input.flipX),
      flipY: normalizeBoolean(input.flipY),
      zIndex: toInt(input.zIndex, 1000),
    };
  }

  const textAlign = cleanString(input.textStyle?.textAlign).toLowerCase();
  return {
    id,
    type: "text",
    page: cleanString(input.page) || "front",
    text: clampString(input.text ?? "", 500),
    x: toNumber(input.x, 0),
    y: toNumber(input.y, 0),
    width: toNumber(input.width, 600) || 600,
    height: toNumber(input.height, 90) || 90,
    rotation: toNumber(input.rotation, 0),
    zIndex: toInt(input.zIndex, 1000),
    textStyle: {
      fontFamily: cleanString(input.textStyle?.fontFamily) || DEFAULT_TEXT_STYLE.fontFamily,
      fontSize: toPositiveInt(input.textStyle?.fontSize, 48),
      fontWeight: cleanString(input.textStyle?.fontWeight) || "400",
      fontStyle: cleanString(input.textStyle?.fontStyle) === "italic" ? "italic" : "normal",
      color: cleanString(input.textStyle?.color) || DEFAULT_TEXT_STYLE.color,
      letterSpacing: toNumber(input.textStyle?.letterSpacing, 0),
      lineHeight: toNumber(input.textStyle?.lineHeight, 1.2) || 1.2,
      textAlign: CUSTOMIZER_TEXT_ALIGN.has(textAlign) ? textAlign : "center",
      uppercase: normalizeBoolean(input.textStyle?.uppercase),
      multiline: normalizeBoolean(input.textStyle?.multiline),
    },
  };
}

function normalizeLayerOverride(input: any = {}): any | null {
  if (!input || typeof input !== "object") return null;
  const out: any = {};
  if (input.textStyle && typeof input.textStyle === "object") {
    const style: any = {};
    const src = input.textStyle;
    if (src.fontFamily !== undefined) style.fontFamily = cleanString(src.fontFamily);
    if (src.fontSize !== undefined) style.fontSize = toPositiveInt(src.fontSize, 0) || undefined;
    if (src.fontWeight !== undefined) style.fontWeight = cleanString(src.fontWeight);
    if (src.fontStyle !== undefined) style.fontStyle = cleanString(src.fontStyle) === "italic" ? "italic" : "normal";
    if (src.color !== undefined) style.color = cleanString(src.color);
    if (src.letterSpacing !== undefined) style.letterSpacing = toNumber(src.letterSpacing, 0);
    if (src.textAlign !== undefined) {
      const align = cleanString(src.textAlign).toLowerCase();
      if (CUSTOMIZER_TEXT_ALIGN.has(align)) style.textAlign = align;
    }
    const cleaned = Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined && v !== ""));
    if (Object.keys(cleaned).length) out.textStyle = cleaned;
  }
  if (input.transform && typeof input.transform === "object") {
    const t = input.transform;
    const transform: any = {};
    if (t.x !== undefined) transform.x = toNumber(t.x, 0);
    if (t.y !== undefined) transform.y = toNumber(t.y, 0);
    if (t.width !== undefined) transform.width = toNumber(t.width, 0);
    if (t.height !== undefined) transform.height = toNumber(t.height, 0);
    if (t.rotation !== undefined) transform.rotation = toNumber(t.rotation, 0);
    if (t.opacity !== undefined) transform.opacity = clampOpacity(t.opacity);
    if (Object.keys(transform).length) out.transform = transform;
  }
  // V2 crop editor state for photo frames (zoom/pan/flip/rotate inside frame).
  if (input.imageTransform && typeof input.imageTransform === "object") {
    const t = input.imageTransform;
    const imageTransform: any = {};
    if (t.zoom !== undefined) imageTransform.zoom = Math.min(20, Math.max(0.05, toNumber(t.zoom, 1) || 1));
    if (t.offsetX !== undefined) imageTransform.offsetX = toNumber(t.offsetX, 0);
    if (t.offsetY !== undefined) imageTransform.offsetY = toNumber(t.offsetY, 0);
    if (t.rotation !== undefined) imageTransform.rotation = toNumber(t.rotation, 0);
    if (t.flipX !== undefined) imageTransform.flipX = normalizeBoolean(t.flipX);
    if (t.flipY !== undefined) imageTransform.flipY = normalizeBoolean(t.flipY);
    if (t.fitMode !== undefined) imageTransform.fitMode = cleanString(t.fitMode) === "contain" ? "contain" : "cover";
    if (Object.keys(imageTransform).length) out.imageTransform = imageTransform;
  }
  if (input.gridSlots && typeof input.gridSlots === "object") {
    const gridSlots: Record<string, any> = {};
    for (const [slotId, raw] of Object.entries(input.gridSlots as Record<string, any>)) {
      if (!raw || typeof raw !== "object") continue;
      const transform = raw.transform && typeof raw.transform === "object" ? raw.transform : {};
      gridSlots[cleanString(slotId)] = {
        assetId: cleanString(raw.assetId),
        src: clampString(raw.src ?? "", 4000),
        bucket: cleanString(raw.bucket),
        path: clampString(raw.path ?? "", 600),
        transform: {
          zoom: Math.min(20, Math.max(0.05, toNumber(transform.zoom, 1) || 1)),
          offsetX: toNumber(transform.offsetX, 0),
          offsetY: toNumber(transform.offsetY, 0),
          rotation: toNumber(transform.rotation, 0),
          flipX: normalizeBoolean(transform.flipX),
          flipY: normalizeBoolean(transform.flipY),
          fitMode: cleanString(transform.fitMode) === "contain" ? "contain" : "cover",
        },
      };
    }
    if (Object.keys(gridSlots).length) out.gridSlots = gridSlots;
  }
  return Object.keys(out).length ? out : null;
}

export function normalizeEditorState(input: any = {}): any {
  const source = input && typeof input === "object" ? input : {};
  const layerOverrides: Record<string, any> = {};
  const rawOverrides = source.layerOverrides && typeof source.layerOverrides === "object" ? source.layerOverrides : {};
  Object.entries(rawOverrides).forEach(([layerId, override]) => {
    const cleanId = cleanString(layerId);
    const normalized = normalizeLayerOverride(override);
    if (cleanId && normalized) layerOverrides[cleanId] = normalized;
  });
  const userLayers = (Array.isArray(source.userLayers) ? source.userLayers : [])
    .map(normalizeUserLayer)
    .filter(Boolean);
  return { layerOverrides, userLayers };
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
    guides: (Array.isArray(source.guides) ? source.guides : Array.isArray(prev.guides) ? prev.guides : []).map((guide: any, index: number) => ({
      id: cleanString(guide?.id) || `guide_${index + 1}`,
      pageId: cleanString(guide?.pageId || guide?.page) || pages[0]?.id || "front",
      axis: guide?.axis === "vertical" ? "vertical" : "horizontal",
      position: toNumber(guide?.position, 0),
      locked: normalizeBoolean(guide?.locked),
      hidden: normalizeBoolean(guide?.hidden),
      customerVisible: normalizeBoolean(guide?.customerVisible),
    })),
    mockupTemplates: Array.isArray(source.mockupTemplates)
      ? source.mockupTemplates
      : Array.isArray(prev.mockupTemplates)
        ? prev.mockupTemplates
        : Array.isArray(source.settings?.mockupTemplates)
          ? source.settings.mockupTemplates
          : Array.isArray(prev.settings?.mockupTemplates)
            ? prev.settings.mockupTemplates
            : [],
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
    // Keep the admin's chosen field type (date, time, select, …) for text
    // layers; only derive it when nothing was configured yet.
    const priorTextType = !isImage && prior.type && prior.type !== "image" && prior.type !== "file" ? prior.type : "";
    nextFields.push({
      id: fieldId,
      label: prior.label || layer.name || "Editable field",
      type: isImage ? "image" : priorTextType || (layer.textStyle?.multiline ? "textarea" : "text"),
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
    if (layer.type === "grid" || layer.type === "group" || layer.type === "element") return;
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

// Detailed publish validation (Section 35): blocking errors vs. warnings the
// admin may acknowledge. Wraps the legacy validateCustomizerTemplate checks.
export function validateCustomizerTemplateDetailed(template: any = {}): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const t = template && typeof template === "object" ? template : {};

  const pages = Array.isArray(t.pages) ? t.pages : [];
  const enabledPages = pages.filter((page: any) => page.enabled !== false);
  const layers = Array.isArray(t.layers) ? t.layers : [];
  const fields = Array.isArray(t.fields) ? t.fields : [];

  if (!(t.canvasWidthPx > 0) || !(t.canvasHeightPx > 0)) {
    errors.push("Canvas width and height must be positive numbers.");
  }
  if (!enabledPages.length) errors.push("At least one enabled page is required.");

  // Unique page ids.
  const pageIds = pages.map((page: any) => page.id);
  if (new Set(pageIds).size !== pageIds.length) errors.push("Page IDs must be unique.");

  // Unique layer ids and valid page references.
  const layerIds = layers.map((layer: any) => layer.id);
  if (new Set(layerIds).size !== layerIds.length) errors.push("Layer IDs must be unique.");
  const pageIdSet = new Set(pageIds);
  layers.forEach((layer: any) => {
    if (!pageIdSet.has(layer.page)) errors.push(`Layer "${layer.name || layer.id}" points at a missing page.`);
  });

  // Unique field keys.
  const fieldIds = fields.map((field: any) => field.id);
  if (new Set(fieldIds).size !== fieldIds.length) errors.push("Field keys must be unique.");

  const fieldMap = new Map(fields.map((field: any) => [field.id, field]));
  const enabledPageIdSet = new Set(enabledPages.map((page: any) => page.id));
  const layersOnEnabledPages = layers.filter((layer: any) => enabledPageIdSet.has(layer.page));
  if (!layersOnEnabledPages.length) errors.push("Add at least one design layer to an enabled page.");

  layers.forEach((layer: any) => {
    if (!layer.customerEditable) return;
    const field: any = layer.fieldId ? fieldMap.get(layer.fieldId) : null;
    if (!field) {
      errors.push(`Editable layer "${layer.name || layer.id}" has no connected customer field.`);
      return;
    }
    if (!field.label) errors.push(`The field for layer "${layer.name || layer.id}" needs a customer label.`);
    if (layer.type === "image" && field.type !== "image" && field.type !== "file") {
      errors.push(`Photo area "${layer.name || layer.id}" must connect to an image upload field.`);
    }
    if (layer.hidden) warnings.push(`Editable layer "${layer.name || layer.id}" is hidden — customers will not see it.`);
    if (!enabledPageIdSet.has(layer.page)) {
      warnings.push(`Editable layer "${layer.name || layer.id}" sits on a disabled page.`);
    }
  });

  // Fonts must come from the approved list so every surface renders the same.
  const approvedFonts = new Set(CUSTOMIZER_APPROVED_FONTS.map((font) => font.value));
  const badFonts = new Set<string>();
  layers.forEach((layer: any) => {
    const font = layer?.textStyle?.fontFamily;
    if (layer.type === "text" && font && !approvedFonts.has(font)) badFonts.add(font);
  });
  badFonts.forEach((font) => warnings.push(`Font "${font}" is not in the approved list and may render inconsistently.`));

  // Safe area / bleed sanity.
  const safe = t.safeArea || {};
  const bleedVals = t.bleed || {};
  const insetTooBig =
    Number(safe.left || 0) + Number(safe.right || 0) >= Number(t.canvasWidthPx || 0) ||
    Number(safe.top || 0) + Number(safe.bottom || 0) >= Number(t.canvasHeightPx || 0);
  if (insetTooBig) errors.push("Safe area insets are larger than the canvas.");
  Object.values({ ...safe, ...bleedVals }).forEach((value: any) => {
    if (Number(value) < 0) errors.push("Safe area and bleed values cannot be negative.");
  });

  // Default page must exist and be enabled.
  if (t.defaultPage && !enabledPageIdSet.has(t.defaultPage)) {
    warnings.push("The default page is disabled — the first enabled page will be used instead.");
  }

  // Nothing editable at all is publishable but usually a mistake.
  if (!layers.some((layer: any) => layer.customerEditable) && !t.settings?.allowCustomerText) {
    warnings.push("No layer is customer-editable and customer text is off — customers will have nothing to personalize.");
  }

  return { errors, warnings };
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
      guides: row.settings?.guides,
      mockupTemplates: row.settings?.mockupTemplates,
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
    settings: { ...normalized.settings, guides: normalized.guides, mockupTemplates: normalized.mockupTemplates },
  };
}
