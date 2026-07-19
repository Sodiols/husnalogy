// Husnalogy Customizer V2 — document normalization, V1→V2 migration, and
// adapters (spec §5, §36).
//
// Storage compatibility: product_customizer_templates rows keep the V1 flat
// template shape (schemaVersion 1). V2 documents are produced in memory from
// V1 rows via migrateCustomizerDocument, and are persisted directly in
// customizer_template_versions snapshots and order_design_snapshots.

import {
  CUSTOMIZER_ENGINE_VERSION,
  CUSTOMIZER_SCHEMA_VERSION,
  ALL_PERMISSION_KEYS,
  type AssetReference,
  type CanvasDefinition,
  type CustomerEditorState,
  type CustomerPermissions,
  type CustomizerDocument,
  type CustomizerField,
  type CustomizerLayer,
  type CustomizerPage,
  type CustomizerSettings,
  type EdgeInsets,
  type ImageTransform,
  type LayerOverride,
  type TextLayer,
  type TextStyle,
  defaultImageTransform,
} from "./types";
import { maskShapeFromLegacy } from "./masks";
import { mergeGridSlotOverrides, normalizeGridSlot } from "./grids";
import { normalizeImageFilters } from "./image-filters";
import { normalizeQRCodeStyle } from "./qr";

/* ----------------------------------------------------------------- helpers */

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function posNum(value: unknown, fallback: number): number {
  const n = num(value, fallback);
  return n > 0 ? n : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return Boolean(value);
}

function str(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function clamp01(value: unknown, fallback = 1): number {
  const n = num(value, fallback);
  return Math.min(1, Math.max(0, n));
}

function edgeInsets(value: unknown, fallback: EdgeInsets): EdgeInsets {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    top: num(v.top, fallback.top),
    right: num(v.right, fallback.right),
    bottom: num(v.bottom, fallback.bottom),
    left: num(v.left, fallback.left),
  };
}

const ZERO_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/* -------------------------------------------------------------- permissions */

export function normalizePermissionsV2(
  _input: unknown,
  layer: { type?: string; customerEditable?: boolean; allowZoom?: boolean; allowReposition?: boolean } = {},
): CustomerPermissions {
  const editable = Boolean(layer.customerEditable);
  return Object.fromEntries(ALL_PERMISSION_KEYS.map((key) => [key, editable])) as CustomerPermissions;
}

/* ------------------------------------------------------------------- style */

export function normalizeTextStyleV2(input: unknown): TextStyle {
  const s = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const align = str(s.textAlign).toLowerCase();
  const vAlign = str(s.verticalAlign).toLowerCase();
  const fontSize = posNum(s.fontSize, 64);
  return {
    fontFamily: str(s.fontFamily) || "Cormorant Garamond",
    fontSize,
    minFontSize: posNum(s.minFontSize, Math.max(8, Math.round(fontSize * 0.4))),
    maxFontSize: posNum(s.maxFontSize, Math.round(fontSize * 2)),
    fontWeight: str(s.fontWeight) || "400",
    fontStyle: str(s.fontStyle) === "italic" ? "italic" : "normal",
    underline: bool(s.underline),
    color: str(s.color) || "#303839",
    letterSpacing: num(s.letterSpacing, 0),
    lineHeight: num(s.lineHeight, 1.15) || 1.15,
    textAlign: align === "left" || align === "right" ? (align as "left" | "right") : "center",
    verticalAlign: vAlign === "top" || vAlign === "bottom" ? (vAlign as "top" | "bottom") : "middle",
    uppercase: bool(s.uppercase),
    multiline: bool(s.multiline),
    fitMode: str(s.fitMode) === "shrink" ? "shrink" : "fixed",
  };
}

export function normalizeImageTransformV2(input: unknown, assetId = ""): ImageTransform {
  const t = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    assetId: str(t.assetId) || assetId,
    cropX: num(t.cropX, 0),
    cropY: num(t.cropY, 0),
    cropWidth: Math.max(0, num(t.cropWidth, 0)),
    cropHeight: Math.max(0, num(t.cropHeight, 0)),
    zoom: posNum(t.zoom, 1),
    offsetX: num(t.offsetX, 0),
    offsetY: num(t.offsetY, 0),
    rotation: num(t.rotation, 0),
    flipX: bool(t.flipX),
    flipY: bool(t.flipY),
    fitMode: str(t.fitMode) === "contain" ? "contain" : "cover",
  };
}

/* ------------------------------------------------------- V1 → V2 migration */

type MigrationWarning = { code: string; message: string };

function migrateLayerV1(raw: Record<string, any>, pageIdFallback: string): CustomizerLayer {
  const type = str(raw.type).toLowerCase();
  const base = {
    id: str(raw.id) || `layer_${Math.random().toString(36).slice(2, 10)}`,
    name: str(raw.name) || str(raw.id) || "Layer",
    pageId: str(raw.page || raw.pageId) || pageIdFallback,
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    width: Math.max(1, num(raw.width, 100)),
    height: Math.max(1, num(raw.height, 100)),
    scale: posNum(raw.scale, 1),
    rotation: num(raw.rotation, 0),
    opacity: clamp01(raw.opacity === undefined ? 1 : raw.opacity),
    hidden: bool(raw.hidden),
    zIndex: Math.round(num(raw.zIndex, 1)),
    locked: bool(raw.locked),
    positionLocked: bool(raw.positionLocked),
    customerInteractionDisabled: bool(raw.customerInteractionDisabled),
    adminEditable: raw.adminEditable === undefined ? true : bool(raw.adminEditable),
    customerEditable: bool(raw.customerEditable),
    customerPermissions: normalizePermissionsV2(raw.customerPermissions, raw),
    groupId: str(raw.groupId),
    fieldId: str(raw.fieldId),
    metadata: (raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {}) as Record<string, unknown>,
  };

  if (type === "image" || type === "frame") {
    const layer: any = {
      ...base,
      type: type === "frame" ? "frame" : "image",
      src: str(raw.src || raw.imageSrc),
      assetId: str(raw.assetId),
      placeholderImage: str(raw.placeholderImage),
      mask:
        raw.mask && typeof raw.mask === "object" && raw.mask.kind
          ? raw.mask
          : maskShapeFromLegacy(raw.maskShape, base.width, base.height),
      transform: normalizeImageTransformV2(raw.transform, str(raw.assetId)),
      filters: normalizeImageFilters(raw.filters || raw.imageFilters),
      borderColor: str(raw.borderColor),
      borderWidth: Math.max(0, num(raw.borderWidth, 0)),
      backgroundColor: str(raw.backgroundColor),
    };
    if (raw.fitMode && !raw.transform) layer.transform.fitMode = str(raw.fitMode) === "contain" ? "contain" : "cover";
    return layer as CustomizerLayer;
  }

  if (type === "shape") {
    const kind = str(raw.shape || raw.shapeKind).toLowerCase();
    const supported = ["rectangle", "rounded-rectangle", "ellipse", "circle", "oval", "triangle", "polygon", "arch", "path", "line"];
    return {
      ...base,
      type: "shape",
      shape: (supported.includes(kind) ? kind : "rectangle") as any,
      fill: str(raw.fill) || "#F8F6F1",
      stroke: str(raw.stroke),
      strokeWidth: Math.max(0, num(raw.strokeWidth, 0)),
      borderRadius: Math.max(0, num(raw.borderRadius, 0)),
      points: Array.isArray(raw.points) ? raw.points.map((point: any) => ({ x: num(point?.x), y: num(point?.y) })) : [],
      path: str(raw.path || raw.d),
      lineStyle: raw.lineStyle === "dashed" || raw.lineStyle === "dotted" ? raw.lineStyle : "solid",
      lineCap: raw.lineCap === "butt" || raw.lineCap === "square" ? raw.lineCap : "round",
      lineStartCap: raw.lineStartCap === "circle" || raw.lineStartCap === "arrow" ? raw.lineStartCap : "none",
      lineEndCap: raw.lineEndCap === "circle" || raw.lineEndCap === "arrow" ? raw.lineEndCap : "none",
    };
  }

  if (type === "grid") {
    return {
      ...base,
      type: "grid",
      presetId: str(raw.presetId),
      slots: Array.isArray(raw.slots)
        ? raw.slots.map((slot: any, index: number) =>
            normalizeGridSlot(
              {
                ...slot,
                transform: normalizeImageTransformV2(slot?.transform, str(slot?.assetId)),
                mask:
                  slot?.mask && typeof slot.mask === "object"
                    ? slot.mask
                    : maskShapeFromLegacy(slot?.maskShape, base.width, base.height),
              },
              index,
            ),
          )
        : [],
      columns: Math.max(1, Math.round(num(raw.columns, 1))),
      rows: Math.max(1, Math.round(num(raw.rows, 1))),
      gap: Math.max(0, num(raw.gap, 12)),
      padding: Math.max(0, num(raw.padding, 0)),
      cornerRadius: Math.max(0, num(raw.cornerRadius, 0)),
      borderColor: str(raw.borderColor),
      borderWidth: Math.max(0, num(raw.borderWidth, 0)),
      backgroundColor: str(raw.backgroundColor),
    };
  }

  if (type === "group") {
    return {
      ...base,
      type: "group",
      childIds: Array.isArray(raw.childIds) ? raw.childIds.map((id: unknown) => str(id)).filter(Boolean) : [],
      allowCustomerUngroup: bool(raw.allowCustomerUngroup),
      childSelection:
        raw.childSelection === "group" || raw.childSelection === "none" ? raw.childSelection : "children",
    };
  }

  if (type === "qrcode" || type === "qr-code" || type === "qr_code") {
    const qr = normalizeQRCodeStyle(raw);
    return { ...base, type: "qrCode", ...qr, required: bool(raw.required) };
  }

  if (type === "element") {
    return {
      ...base,
      type: "element",
      assetId: str(raw.assetId),
      src: str(raw.src),
      tintColor: str(raw.tintColor),
      flipX: bool(raw.flipX),
      flipY: bool(raw.flipY),
    };
  }

  if (type === "background") {
    return {
      ...base,
      type: "background",
      color: str(raw.color) || "#ffffff",
      assetId: str(raw.assetId),
      src: str(raw.src),
    };
  }

  // Default: text.
  const textLayer: TextLayer = {
    ...base,
    type: "text",
    text: str(raw.text),
    placeholder: str(raw.placeholder),
    maxChars: Math.max(0, Math.round(num(raw.maxChars, 0))),
    maxLines: Math.max(0, Math.round(num(raw.maxLines, 0))),
    required: bool(raw.required),
    textStyle: normalizeTextStyleV2(raw.textStyle),
  };
  return textLayer;
}

// Migrate a legacy flat template (V1 — what templateFromRow returns) into a V2
// CustomizerDocument. Non-destructive: the input is not modified.
export function templateToDocument(template: Record<string, any>): { document: CustomizerDocument; warnings: MigrationWarning[] } {
  const t = template && typeof template === "object" ? template : {};
  const warnings: MigrationWarning[] = [];

  const canvas: CanvasDefinition = {
    widthPx: posNum(t.canvasWidthPx, 1500),
    heightPx: posNum(t.canvasHeightPx, 2100),
    widthIn: posNum(t.cardWidthIn, 5),
    heightIn: posNum(t.cardHeightIn, 7),
    dpi: posNum(t.dpi, 300),
    orientation: t.orientation === "landscape" || t.orientation === "square" ? t.orientation : "portrait",
  };

  const templateSafe = edgeInsets(t.safeArea, { top: 90, right: 90, bottom: 90, left: 90 });
  const templateBleed = edgeInsets(t.bleed, { top: 45, right: 45, bottom: 45, left: 45 });
  const settingsSrc = (t.settings && typeof t.settings === "object" ? t.settings : {}) as Record<string, unknown>;

  const pages: CustomizerPage[] = (Array.isArray(t.pages) ? t.pages : []).map((page: any, index: number) => ({
    id: str(page?.id) || (index === 0 ? "front" : index === 1 ? "back" : `page-${index + 1}`),
    name: str(page?.label || page?.name) || `Page ${index + 1}`,
    enabled: page?.enabled === undefined ? true : bool(page.enabled),
    widthPx: posNum(page?.widthPx, canvas.widthPx),
    heightPx: posNum(page?.heightPx, canvas.heightPx),
    widthIn: posNum(page?.widthIn, canvas.widthIn),
    heightIn: posNum(page?.heightIn, canvas.heightIn),
    dpi: posNum(page?.dpi, canvas.dpi),
    backgroundColor: str(page?.backgroundColor) || "#ffffff",
    backgroundAssetId: str(page?.backgroundAssetId) || undefined,
    backgroundImage: str(page?.backgroundImage) || undefined,
    thumbnail: str(page?.thumbnail) || undefined,
    safeArea: edgeInsets(page?.safeArea, templateSafe),
    bleed: edgeInsets(page?.bleed, templateBleed),
    allowCustomerText:
      page?.allowCustomerText === undefined ? bool(settingsSrc.allowCustomerText) : bool(page.allowCustomerText),
    allowCustomerUploads:
      page?.allowCustomerUploads === undefined
        ? settingsSrc.allowCustomerUploads === undefined
          ? true
          : bool(settingsSrc.allowCustomerUploads)
        : bool(page.allowCustomerUploads),
  }));

  if (!pages.length) {
    pages.push({
      id: "front",
      name: "Front",
      enabled: true,
      widthPx: canvas.widthPx,
      heightPx: canvas.heightPx,
      widthIn: canvas.widthIn,
      heightIn: canvas.heightIn,
      dpi: canvas.dpi,
      backgroundColor: "#ffffff",
      safeArea: templateSafe,
      bleed: templateBleed,
      allowCustomerText: bool(settingsSrc.allowCustomerText),
      allowCustomerUploads: true,
    });
    warnings.push({ code: "missing-pages", message: "Template had no pages; a default front page was created." });
  }

  const pageIds = new Set(pages.map((p) => p.id));
  const firstPageId = pages[0].id;

  const layers: CustomizerLayer[] = (Array.isArray(t.layers) ? t.layers : []).map((raw: any) => {
    const layer = migrateLayerV1(raw && typeof raw === "object" ? raw : {}, firstPageId);
    if (!pageIds.has(layer.pageId)) {
      warnings.push({ code: "layer-page", message: `Layer "${layer.name}" pointed at a missing page and was moved to "${firstPageId}".` });
      layer.pageId = firstPageId;
    }
    return layer;
  });

  const fields: CustomizerField[] = (Array.isArray(t.fields) ? t.fields : []).map((f: any) => ({
    id: str(f?.id),
    label: str(f?.label) || str(f?.id),
    type: (f?.type as CustomizerField["type"]) || "text",
    required: bool(f?.required),
    defaultValue: typeof f?.defaultValue === "boolean" ? f.defaultValue : str(f?.defaultValue),
    placeholder: str(f?.placeholder),
    helpText: str(f?.helpText),
    maxLength: Math.max(0, Math.round(num(f?.maxLength, 0))),
    options: Array.isArray(f?.options) ? f.options.map((o: unknown) => str(o)) : [],
    customerVisible: f?.customerVisible === undefined ? true : bool(f.customerVisible),
  }));

  const settings: CustomizerSettings = {
    showSafeArea: settingsSrc.showSafeArea === undefined ? true : bool(settingsSrc.showSafeArea),
    showBleed: bool(settingsSrc.showBleed),
    allowCustomerPhotoCrop: settingsSrc.allowCustomerPhotoCrop === undefined ? true : bool(settingsSrc.allowCustomerPhotoCrop),
    allowCustomerTextMove: bool(settingsSrc.allowCustomerTextMove),
    requireApprovalCheckbox: settingsSrc.requireApprovalCheckbox === undefined ? true : bool(settingsSrc.requireApprovalCheckbox),
    allowCustomerText: bool(settingsSrc.allowCustomerText),
    allowCustomerUploads: settingsSrc.allowCustomerUploads === undefined ? true : bool(settingsSrc.allowCustomerUploads),
    allowCustomerElements: bool(settingsSrc.allowCustomerElements),
    allowCustomerShapes: bool(settingsSrc.allowCustomerShapes),
    allowCustomerLines: bool(settingsSrc.allowCustomerLines),
    allowCustomerFrames: bool(settingsSrc.allowCustomerFrames),
    allowCustomerGrids: bool(settingsSrc.allowCustomerGrids),
    allowCustomerQRCodes: bool(settingsSrc.allowCustomerQRCodes),
    allowCustomerBackground: bool(settingsSrc.allowCustomerBackground),
    allowCustomerGrouping: bool(settingsSrc.allowCustomerGrouping),
    showCustomerLayers: bool(settingsSrc.showCustomerLayers),
    allowedCustomerFonts: Array.isArray(settingsSrc.allowedCustomerFonts) ? settingsSrc.allowedCustomerFonts.map((value: unknown) => str(value)).filter(Boolean) : [],
    allowedCustomerColors: Array.isArray(settingsSrc.allowedCustomerColors) ? settingsSrc.allowedCustomerColors.map((value: unknown) => str(value)).filter(Boolean) : [],
    allowedCustomerShapes: Array.isArray(settingsSrc.allowedCustomerShapes) ? settingsSrc.allowedCustomerShapes.map((value: unknown) => str(value)).filter(Boolean) : [],
    allowedCustomerElementIds: Array.isArray(settingsSrc.allowedCustomerElementIds) ? settingsSrc.allowedCustomerElementIds.map((value: unknown) => str(value)).filter(Boolean) : [],
    allowedCustomerFrameMasks: Array.isArray(settingsSrc.allowedCustomerFrameMasks) ? settingsSrc.allowedCustomerFrameMasks.map((value: unknown) => str(value)).filter(Boolean) : [],
    allowedCustomerGridPresets: Array.isArray(settingsSrc.allowedCustomerGridPresets) ? settingsSrc.allowedCustomerGridPresets.map((value: unknown) => str(value)).filter(Boolean) : [],
    allowedCustomerImageFilters: Array.isArray(settingsSrc.allowedCustomerImageFilters) ? settingsSrc.allowedCustomerImageFilters.map((value: unknown) => str(value)).filter(Boolean) : [],
    allowedCustomerPages: Array.isArray(settingsSrc.allowedCustomerPages) ? settingsSrc.allowedCustomerPages.map((value: unknown) => str(value)).filter(Boolean) : [],
    maxCustomerObjectsPerPage: Math.max(0, Math.round(num(settingsSrc.maxCustomerObjectsPerPage, 0))),
    customerObjectLimits: settingsSrc.customerObjectLimits && typeof settingsSrc.customerObjectLimits === "object"
      ? {
          minWidth: Math.max(0, num((settingsSrc.customerObjectLimits as any).minWidth, 0)),
          maxWidth: Math.max(0, num((settingsSrc.customerObjectLimits as any).maxWidth, 0)),
          minHeight: Math.max(0, num((settingsSrc.customerObjectLimits as any).minHeight, 0)),
          maxHeight: Math.max(0, num((settingsSrc.customerObjectLimits as any).maxHeight, 0)),
          minRotation: num((settingsSrc.customerObjectLimits as any).minRotation, -360),
          maxRotation: num((settingsSrc.customerObjectLimits as any).maxRotation, 360),
          insetLeft: Math.max(0, num((settingsSrc.customerObjectLimits as any).insetLeft, 0)),
          insetTop: Math.max(0, num((settingsSrc.customerObjectLimits as any).insetTop, 0)),
          insetRight: Math.max(0, num((settingsSrc.customerObjectLimits as any).insetRight, 0)),
          insetBottom: Math.max(0, num((settingsSrc.customerObjectLimits as any).insetBottom, 0)),
        }
      : {},
    protectedPreview: settingsSrc.protectedPreview === undefined ? true : bool(settingsSrc.protectedPreview),
    autosave: settingsSrc.autosave === undefined ? true : bool(settingsSrc.autosave),
    snapping: settingsSrc.snapping === undefined ? true : bool(settingsSrc.snapping),
    templateName: str(settingsSrc.templateName),
    templateDescription: str(settingsSrc.templateDescription),
    adminNotes: str(settingsSrc.adminNotes),
  };

  const assets: AssetReference[] = [];
  if (t.assets && typeof t.assets === "object" && !Array.isArray(t.assets)) {
    for (const [id, value] of Object.entries(t.assets as Record<string, any>)) {
      if (!value) continue;
      assets.push({
        id,
        bucket: str(value.bucket),
        path: str(value.path),
        publicUrl: str(value.publicUrl || value.url) || undefined,
        mimeType: str(value.mimeType || value.type),
        fileSizeBytes: num(value.fileSizeBytes || value.size, 0),
        width: num(value.width, 0),
        height: num(value.height, 0),
        checksum: str(value.checksum) || undefined,
        metadata: value.metadata && typeof value.metadata === "object" ? value.metadata : undefined,
      });
    }
  } else if (Array.isArray(t.assets)) {
    for (const value of t.assets) {
      if (value && typeof value === "object" && value.id) assets.push(value as AssetReference);
    }
  }

  const document: CustomizerDocument = {
    schemaVersion: CUSTOMIZER_SCHEMA_VERSION,
    templateId: str(t.id),
    templateVersion: posNum(t.version, 1),
    engineVersion: CUSTOMIZER_ENGINE_VERSION,
    canvas,
    pages,
    fields,
    layers,
    settings,
    assets,
    guides: (Array.isArray(t.guides) ? t.guides : []).map((guide: any, index: number) => ({
      id: str(guide?.id) || `guide_${index + 1}`,
      pageId: str(guide?.pageId || guide?.page) || firstPageId,
      axis: guide?.axis === "vertical" ? "vertical" : "horizontal",
      position: num(guide?.position, 0),
      locked: bool(guide?.locked),
      hidden: bool(guide?.hidden),
      customerVisible: bool(guide?.customerVisible),
    })),
  };

  return { document, warnings };
}

// Versioned migration entry point (spec §36). Version 1 is the legacy flat
// template; version 2 is CustomizerDocument.
export function migrateCustomizerDocument(
  document: Record<string, any>,
  fromVersion: number,
  toVersion: number = CUSTOMIZER_SCHEMA_VERSION,
): { document: CustomizerDocument; warnings: MigrationWarning[] } {
  if (fromVersion === toVersion && fromVersion === CUSTOMIZER_SCHEMA_VERSION) {
    // Re-normalize a V2 document (defensive against hand-edited JSON).
    return normalizeDocumentV2(document);
  }
  if ((fromVersion === 1 || fromVersion === 2 || fromVersion === 3) && toVersion === CUSTOMIZER_SCHEMA_VERSION) {
    if (fromVersion === 2 || fromVersion === 3) return normalizeDocumentV2(document);
    return templateToDocument(document);
  }
  throw new Error(`Unsupported customizer document migration: v${fromVersion} → v${toVersion}`);
}

// Normalize an already-V2 document (all fields typed and present).
export function normalizeDocumentV2(input: Record<string, any>): { document: CustomizerDocument; warnings: MigrationWarning[] } {
  // A V2 document round-trips through the V1 migration path by mapping its
  // shape into the flat template vocabulary first — the field names overlap
  // except pages/layers, which migrateLayerV1 already handles for both shapes.
  const flat = {
    id: input.templateId,
    version: input.templateVersion,
    canvasWidthPx: input.canvas?.widthPx,
    canvasHeightPx: input.canvas?.heightPx,
    cardWidthIn: input.canvas?.widthIn,
    cardHeightIn: input.canvas?.heightIn,
    dpi: input.canvas?.dpi,
    orientation: input.canvas?.orientation,
    pages: input.pages,
    fields: input.fields,
    layers: input.layers,
    settings: input.settings,
    assets: input.assets,
    guides: input.guides,
    safeArea: input.pages?.[0]?.safeArea,
    bleed: input.pages?.[0]?.bleed,
  };
  return templateToDocument(flat);
}

/* --------------------------------------------- scene + customer resolution */

// The "scene" is the flat, per-page, z-ordered list of effective layers that
// interaction layers and renderers consume. The normalized document remains
// the source of truth (spec §6) — scenes are always derived, never stored.
export type SceneLayer = CustomizerLayer & { isUserLayer?: boolean };

export type Scene = {
  pageId: string;
  width: number;
  height: number;
  backgroundColor: string;
  backgroundImage?: string;
  layers: SceneLayer[];
};

export function documentToScene(document: CustomizerDocument, pageId: string, editorState?: CustomerEditorState | null): Scene {
  const page = document.pages.find((p) => p.id === pageId) || document.pages[0];
  const overrides = editorState?.layerOverrides || {};
  const layers: SceneLayer[] = document.layers
    .filter((layer) => layer.pageId === page.id)
    .map((layer) => applyOverrideV2(layer, overrides[layer.id]));

  const userLayers: SceneLayer[] = (editorState?.userLayers || [])
    .filter((raw) => raw && (raw as any).page === page.id)
    .map((raw) => ({ ...(migrateLayerV1(raw as Record<string, any>, page.id) as CustomizerLayer), isUserLayer: true }));

  return {
    pageId: page.id,
    width: page.widthPx,
    height: page.heightPx,
    backgroundColor: page.backgroundColor,
    backgroundImage: page.backgroundImage,
    layers: [...layers, ...userLayers].sort((a, b) => a.zIndex - b.zIndex),
  };
}

// Write scene-level transform changes back into the document (admin editing).
export function sceneToDocument(document: CustomizerDocument, scene: Scene): CustomizerDocument {
  const byId = new Map(scene.layers.filter((l) => !l.isUserLayer).map((l) => [l.id, l]));
  return {
    ...document,
    layers: document.layers.map((layer) => {
      const updated = byId.get(layer.id);
      return updated ? ({ ...layer, ...updated } as CustomizerLayer) : layer;
    }),
  };
}

export function applyOverrideV2(layer: CustomizerLayer, override?: LayerOverride): CustomizerLayer {
  if (!override) return layer;
  let next: CustomizerLayer = { ...layer };
  if (override.transform) {
    const t = override.transform;
    if (t.x !== undefined) next.x = num(t.x, next.x);
    if (t.y !== undefined) next.y = num(t.y, next.y);
    if (t.width !== undefined) next.width = Math.max(1, num(t.width, next.width));
    if (t.height !== undefined) next.height = Math.max(1, num(t.height, next.height));
    if (t.rotation !== undefined) next.rotation = num(t.rotation, next.rotation);
    if (t.opacity !== undefined) next.opacity = clamp01(t.opacity, next.opacity);
    if (t.zIndex !== undefined) next.zIndex = Math.round(num(t.zIndex, next.zIndex));
  }
  if (override.textStyle && next.type === "text") {
    next = { ...next, textStyle: { ...next.textStyle, ...override.textStyle } };
  }
  if (override.imageFilters && (next.type === "image" || next.type === "frame")) {
    next = { ...next, filters: normalizeImageFilters({ ...next.filters, ...override.imageFilters }) };
  }
  if (override.properties) {
    const allowed = ["fill", "stroke", "strokeWidth", "borderRadius", "lineStyle", "lineCap", "lineStartCap", "lineEndCap", "foregroundColor", "backgroundColor", "margin", "errorCorrection", "moduleStyle", "value", "gap", "padding", "cornerRadius", "borderColor", "borderWidth"];
    const properties = Object.fromEntries(Object.entries(override.properties).filter(([key]) => allowed.includes(key)));
    next = { ...next, ...properties } as CustomizerLayer;
  }
  if (override.name !== undefined) next = { ...next, name: str(override.name).slice(0, 120) };
  if (override.hidden !== undefined) next = { ...next, hidden: bool(override.hidden) };
  if (override.customerLocked !== undefined) next = { ...next, metadata: { ...next.metadata, customerLocked: bool(override.customerLocked) } };
  if (override.imageTransform && (next.type === "image" || next.type === "frame")) {
    next = { ...next, transform: { ...next.transform, ...normalizePartialTransform(override.imageTransform, next.transform) } };
  }
  if (override.gridSlots && next.type === "grid") {
    next = { ...next, slots: mergeGridSlotOverrides(next.slots, override.gridSlots) };
  }
  return next;
}

function normalizePartialTransform(patch: Partial<ImageTransform>, current: ImageTransform): Partial<ImageTransform> {
  const out: Partial<ImageTransform> = {};
  if (patch.assetId !== undefined) out.assetId = str(patch.assetId);
  if (patch.zoom !== undefined) out.zoom = posNum(patch.zoom, current.zoom);
  if (patch.offsetX !== undefined) out.offsetX = num(patch.offsetX, current.offsetX);
  if (patch.offsetY !== undefined) out.offsetY = num(patch.offsetY, current.offsetY);
  if (patch.rotation !== undefined) out.rotation = num(patch.rotation, current.rotation);
  if (patch.flipX !== undefined) out.flipX = bool(patch.flipX);
  if (patch.flipY !== undefined) out.flipY = bool(patch.flipY);
  if (patch.fitMode !== undefined) out.fitMode = patch.fitMode === "contain" ? "contain" : "cover";
  if (patch.cropX !== undefined) out.cropX = num(patch.cropX, current.cropX);
  if (patch.cropY !== undefined) out.cropY = num(patch.cropY, current.cropY);
  if (patch.cropWidth !== undefined) out.cropWidth = Math.max(0, num(patch.cropWidth, current.cropWidth));
  if (patch.cropHeight !== undefined) out.cropHeight = Math.max(0, num(patch.cropHeight, current.cropHeight));
  return out;
}

// Resolve a document against customer values + editor state into a trusted,
// fully-resolved document for rendering (spec §21). Values fill text/image
// content; overrides apply only transform/style patches already validated by
// the server validation service.
export function resolveCustomerDocument(
  document: CustomizerDocument,
  values: Record<string, unknown>,
  editorState?: CustomerEditorState | null,
): CustomizerDocument {
  const overrides = editorState?.layerOverrides || {};
  const layers = document.layers.map((layer) => {
    let next = applyOverrideV2(layer, overrides[layer.id]);
    if (next.type === "text" && next.customerEditable && next.fieldId) {
      const value = values[next.fieldId];
      if (value !== undefined && value !== null && String(value).trim() !== "" && typeof value !== "object") {
        next = { ...next, text: String(value) };
      }
    }
    if ((next.type === "image" || next.type === "frame") && next.customerEditable && next.fieldId) {
      const value = values[next.fieldId] as Record<string, unknown> | undefined;
      const url = value && typeof value === "object" ? str(value.signedUrl || value.url) : "";
      if (url) {
        next = {
          ...next,
          src: url,
          assetId: str(value?.assetId || (value?.assetReference as any)?.assetId),
          bucket: str(value?.bucket || (value?.assetReference as any)?.bucket),
          path: str(value?.originalPath || (value?.assetReference as any)?.storagePath || value?.path),
          assetReference: value?.assetReference as any,
          transform: {
            ...next.transform,
            zoom: posNum(value?.zoom, next.transform.zoom),
            offsetX: num(value?.offsetX, next.transform.offsetX),
            offsetY: num(value?.offsetY, next.transform.offsetY),
            flipX: value?.flipX === undefined ? next.transform.flipX : bool(value.flipX),
            flipY: value?.flipY === undefined ? next.transform.flipY : bool(value.flipY),
            rotation: value?.imageRotation === undefined ? next.transform.rotation : num(value.imageRotation, 0),
          },
        } as CustomizerLayer;
      }
    }
    return next;
  });

  const userLayers = (editorState?.userLayers || []).map((raw, index) => {
    const layer = migrateLayerV1(raw as Record<string, any>, document.pages[0]?.id || "front");
    layer.zIndex = layer.zIndex || 1000 + index;
    (layer.metadata as Record<string, unknown>).isUserLayer = true;
    return layer;
  });

  return { ...document, layers: [...layers, ...userLayers] };
}

// Serializable render payload for the server pipeline: the resolved document
// plus everything the renderer needs, nothing it must look up client-side.
export function documentToRenderPayload(
  document: CustomizerDocument,
  values: Record<string, unknown>,
  editorState: CustomerEditorState | null,
  selectedOptions: Record<string, unknown> = {},
): Record<string, unknown> {
  const resolved = resolveCustomerDocument(document, values, editorState);
  return {
    schemaVersion: resolved.schemaVersion,
    engineVersion: resolved.engineVersion,
    templateId: resolved.templateId,
    templateVersion: resolved.templateVersion,
    document: resolved,
    values,
    editorState: editorState || { layerOverrides: {}, userLayers: [] },
    selectedOptions,
    generatedAt: new Date().toISOString(),
  };
}
