// Husnalogy Customizer V2 — canonical typed document model.
//
// The normalized CustomizerDocument is the single source of truth for every
// surface: admin studio, customer editor, thumbnails, review, server preview
// rendering, and print rendering. Scene/interaction layers must convert to and
// from this format via the adapters in ./document.ts — never persist a scene
// library's internal format.
//
// Schema versions:
//   1 — legacy flat template (product_customizer_templates row, pre-V2)
//   2 — this document model

import type { CustomerAssetReference } from "./asset-references";

export const CUSTOMIZER_SCHEMA_VERSION = 4;
export const CUSTOMIZER_ENGINE_VERSION = "husnalogy-2.2.0";

/* ---------------------------------------------------------------- geometry */

export type EdgeInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type CanvasDefinition = {
  widthPx: number;
  heightPx: number;
  widthIn: number;
  heightIn: number;
  dpi: number;
  orientation: "portrait" | "landscape" | "square";
};

/* ------------------------------------------------------------ permissions */

// Expanded per-layer customer permission set (spec §18). Superset of the V1
// keys — legacy flags (customerEditable/allowZoom/allowReposition) map onto
// these via defaults in lib/customizer/index.ts.
export type CustomerPermissions = {
  select: boolean;
  editContent: boolean;
  editStyle: boolean;
  group: boolean;
  ungroup: boolean;
  hide: boolean;
  lock: boolean;
  changeFont: boolean;
  changeFontSize: boolean;
  changeFontWeight: boolean;
  changeFontStyle: boolean;
  changeColor: boolean;
  changeTextColor: boolean;
  changeAlignment: boolean;
  changeLetterSpacing: boolean;
  changeLineHeight: boolean;
  move: boolean;
  resize: boolean;
  rotate: boolean;
  duplicate: boolean;
  delete: boolean;
  replaceImage: boolean;
  cropImage: boolean;
  zoomImage: boolean;
  repositionImage: boolean;
  flipImage: boolean;
  rotateImage: boolean;
  applyImageFilters: boolean;
  changeFill: boolean;
  changeBorder: boolean;
  editGrid: boolean;
  editGridLayout: boolean;
  moveGridPhotos: boolean;
  editQRCodeValue: boolean;
  editQRCodeStyle: boolean;
  changeOpacity: boolean;
  changeLayerOrder: boolean;
};

export const ALL_PERMISSION_KEYS: ReadonlyArray<keyof CustomerPermissions> = [
  "select",
  "editContent",
  "editStyle",
  "group",
  "ungroup",
  "hide",
  "lock",
  "changeFont",
  "changeFontSize",
  "changeFontWeight",
  "changeFontStyle",
  "changeColor",
  "changeTextColor",
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
  "rotateImage",
  "applyImageFilters",
  "changeFill",
  "changeBorder",
  "editGrid",
  "editGridLayout",
  "moveGridPhotos",
  "editQRCodeValue",
  "editQRCodeStyle",
  "changeOpacity",
  "changeLayerOrder",
];

/* ------------------------------------------------------------------ assets */

export type AssetReference = {
  id: string;
  bucket: string;
  path: string;
  // Public URL for public assets; private assets get fresh signed URLs at
  // request time — never persist an expiring signed URL as the only pointer.
  publicUrl?: string;
  mimeType: string;
  fileSizeBytes: number;
  width: number;
  height: number;
  checksum?: string;
  metadata?: Record<string, unknown>;
};

// Deterministic crop data (spec §11) — stored separately from frame geometry.
export type ImageTransform = {
  assetId: string;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  fitMode: "cover" | "contain";
};

export type ImageFilters = {
  brightness: number;
  contrast: number;
  saturation: number;
  grayscale: number;
  sepia: number;
  tintColor?: string;
  tintAmount: number;
};

export function defaultImageTransform(assetId = ""): ImageTransform {
  return {
    assetId,
    cropX: 0,
    cropY: 0,
    cropWidth: 0,
    cropHeight: 0,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    flipX: false,
    flipY: false,
    fitMode: "cover",
  };
}

/* ------------------------------------------------------------------- masks */

export type MaskShape =
  | { kind: "rectangle" }
  | { kind: "rounded"; radius: number }
  | { kind: "circle" }
  | { kind: "oval" }
  | { kind: "arch" } // full arch: rounded top + rounded bottom
  | { kind: "arch-top" } // rounded top, flat bottom
  | { kind: "arch-bottom" } // flat top, rounded bottom
  | { kind: "polygon"; points: Array<{ x: number; y: number }> } // normalized 0..1
  | { kind: "path"; d: string; viewBoxWidth: number; viewBoxHeight: number };

/* ------------------------------------------------------------------ layers */

export type TextStyle = {
  fontFamily: string;
  fontSize: number;
  minFontSize: number;
  maxFontSize: number;
  fontWeight: string;
  fontStyle: "normal" | "italic";
  underline: boolean;
  color: string;
  letterSpacing: number;
  lineHeight: number;
  textAlign: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
  /**
   * Which edge holds still when the text gets taller (text-growth.ts). OPTIONAL:
   * absent keeps the behaviour the document was made with.
   */
  growthDirection?: "up" | "center" | "down";
  /**
   * Text curve, -100 (smile) … 100 (arch); see text-curve.ts. OPTIONAL: absent
   * or 0 is straight text, exactly as before the property existed.
   */
  curve?: number;
  uppercase: boolean;
  multiline: boolean;
  // "auto" shrinks to fit the box down to minFontSize; "fixed" keeps fontSize.
  fitMode: "fixed" | "shrink" | "auto-height";
  /**
   * Box sizing mode (see text-layout getTextAutoSizeMode). OPTIONAL on purpose:
   * an absent value means "use the stored box / legacy fitMode", which is how
   * documents published before this field existed keep rendering exactly as
   * they did. Present only when the template set it explicitly.
   */
  autoSizeMode?: "fixed" | "width" | "height" | "shrink" | "safe-width";
};

/**
 * Durable storage identity of an asset-bearing layer or page background.
 *
 * `src`/`backgroundImage` are delivery URLs and may be short-lived signed
 * URLs; they are stripped before persistence and re-signed on every read from
 * these fields (lib/customizer/server/admin-assets.ts). Production uses the
 * original path, editing uses the editor variant. All optional: older
 * documents never carried them and must still round-trip.
 */
export type StorageProvenance = {
  bucket?: string;
  path?: string;
  originalPath?: string;
  editorPath?: string;
  thumbnailPath?: string;
  originalFilename?: string;
  mimeType?: string;
  sourceWidth?: number;
  sourceHeight?: number;
};

/** Library asset behind a photo frame's empty-state placeholder. */
export type PlaceholderAssetReference = {
  placeholderAssetId?: string;
  placeholderAssetBucket?: string;
  placeholderAssetPath?: string;
  placeholderAssetEditorPath?: string;
  placeholderAssetThumbnailPath?: string;
};

type LayerBase = {
  id: string;
  name: string;
  pageId: string;
  x: number; // center X in canvas px
  y: number; // center Y in canvas px
  width: number;
  height: number;
  /**
   * INERT. Persisted for backwards compatibility and nothing else.
   *
   * No renderer, geometry helper, interaction path or server render reads this
   * — size is carried entirely by `width`/`height`, which every transform
   * normalises into (see `konva-adapter.normalizeKonvaGeometry`). It survives
   * only because it is already present inside the `document` JSONB of saved
   * templates and customizations; dropping it from the type would make those
   * documents fail to round-trip for no gain.
   *
   * Both normalisers force it to a finite positive number (defaulting to 1), so
   * a legacy value cannot become NaN and cannot influence output. If a layer is
   * ever found with a value other than 1, that is historical noise rather than
   * geometry: do NOT start applying it, or every existing design would resize.
   */
  scale: number;
  rotation: number;
  opacity: number;
  hidden: boolean;
  zIndex: number;
  locked: boolean; // admin lock (design builder)
  positionLocked: boolean;
  customerInteractionDisabled: boolean;
  adminEditable: boolean;
  customerEditable: boolean;
  customerPermissions: CustomerPermissions;
  groupId: string; // parent group layer id, "" when top-level
  fieldId: string; // connected customer field, "" when none
  metadata: Record<string, unknown>;
};

export type TextLayer = LayerBase & {
  type: "text";
  /** Mirrored in its own frame (absent = not mirrored). */
  flipX?: boolean;
  flipY?: boolean;
  text: string;
  placeholder: string;
  maxChars: number;
  maxLines: number;
  required: boolean;
  textStyle: TextStyle;
};

export type ImageLayer = LayerBase & StorageProvenance & PlaceholderAssetReference & {
  /** Non-destructive eraser strokes over the layer's own picture (erase-mask.ts); absent = none. */
  eraseMask?: import("./erase-mask").EraseMask;
  type: "image";
  src: string;
  assetId: string;
  placeholderImage: string;
  mask: MaskShape;
  transform: ImageTransform;
  filters: ImageFilters;
  borderColor: string;
  borderWidth: number;
  backgroundColor: string;
  assetReference?: CustomerAssetReference;
  /** Admin fit choice. Absent in documents published before it was carried. */
  fitMode?: "cover" | "contain";
};

export type ShapeLayer = LayerBase & {
  type: "shape";
  /** Mirrored in its own frame (absent = not mirrored). */
  flipX?: boolean;
  flipY?: boolean;
  shape: "rectangle" | "rounded-rectangle" | "ellipse" | "circle" | "oval" | "triangle" | "polygon" | "arch" | "path" | "line" | "custom";
  /** `custom` shapes: an outline of absolute M/L/C/Q/Z commands in a 100 x 100 box (shape-library.ts). */
  pathData?: string;
  /** The Shapes-library entry this shape was inserted from, for display only. */
  libraryShapeId?: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  borderRadius: number;
  points?: Array<{ x: number; y: number }>;
  path?: string;
  lineStyle?: "solid" | "dashed" | "dotted";
  lineCap?: "butt" | "round" | "square";
  lineStartCap?: "none" | "circle" | "arrow";
  lineEndCap?: "none" | "circle" | "arrow";
};

// A frame is an image placeholder with a mask, border, and replacement rules —
// it renders through the same path as ImageLayer but is authored as a frame.
export type FrameLayer = LayerBase & StorageProvenance & PlaceholderAssetReference & {
  /** Non-destructive eraser strokes over the layer's own picture (erase-mask.ts); absent = none. */
  eraseMask?: import("./erase-mask").EraseMask;
  type: "frame";
  mask: MaskShape;
  defaultAssetId: string;
  assetId: string;
  src: string;
  placeholderImage: string;
  transform: ImageTransform;
  filters: ImageFilters;
  borderColor: string;
  borderWidth: number;
  backgroundColor: string;
  assetReference?: CustomerAssetReference;
  fitMode?: "cover" | "contain";
};

export type GridSlot = {
  id: string;
  // slot rect relative to the grid box, normalized 0..1
  x: number;
  y: number;
  width: number;
  height: number;
  assetId: string;
  src: string;
  bucket?: string;
  path?: string;
  transform: ImageTransform;
  filters?: ImageFilters;
  permissions: Partial<CustomerPermissions>;
  required?: boolean;
  mask?: MaskShape;
  metadata?: Record<string, unknown>;
  assetReference?: CustomerAssetReference;
  originalPath?: string;
  ownerId?: string;
};

export type GridLayer = LayerBase & {
  type: "grid";
  presetId?: string;
  slots: GridSlot[];
  columns?: number;
  rows?: number;
  gap: number;
  padding: number;
  cornerRadius: number;
  borderColor: string;
  borderWidth: number;
  backgroundColor: string;
};

export type GroupLayer = LayerBase & {
  type: "group";
  childIds: string[];
  allowCustomerUngroup?: boolean;
  childSelection?: "group" | "children" | "none";
};

// A decorative element from the Husnalogy elements library (SVG/PNG asset).
export type ElementLayer = LayerBase & StorageProvenance & {
  type: "element";
  assetId: string;
  src: string;
  // For colour-editable single-colour SVG elements.
  tintColor: string;
  flipX: boolean;
  flipY: boolean;
};

export type BackgroundLayer = LayerBase & StorageProvenance & {
  type: "background";
  color: string;
  assetId: string;
  src: string;
  assetReference?: CustomerAssetReference;
  fitMode?: "cover" | "contain";
  filters?: ImageFilters;
};

export type QRCodeLayer = LayerBase & {
  type: "qrCode";
  value: string;
  foregroundColor: string;
  backgroundColor: string;
  errorCorrection: "L" | "M" | "Q" | "H";
  margin: number;
  moduleStyle: "square" | "rounded";
  required: boolean;
};

export type CustomizerLayer =
  | TextLayer
  | ImageLayer
  | ShapeLayer
  | FrameLayer
  | GridLayer
  | GroupLayer
  | ElementLayer
  | BackgroundLayer
  | QRCodeLayer;

/* ------------------------------------------------------------------- pages */

export type CustomizerPage = {
  id: string;
  name: string;
  enabled: boolean;
  widthPx: number;
  heightPx: number;
  widthIn: number;
  heightIn: number;
  dpi: number;
  backgroundColor: string;
  backgroundAssetId?: string;
  backgroundImage?: string;
  thumbnail?: string;
  /** Storage identity of the page background (re-signed on read). */
  bucket?: string;
  originalPath?: string;
  editorPath?: string;
  thumbnailPath?: string;
  safeArea: EdgeInsets;
  bleed: EdgeInsets;
  allowCustomerText: boolean;
  allowCustomerUploads: boolean;
};

export type GuideDefinition = {
  id: string;
  pageId: string;
  axis: "horizontal" | "vertical";
  position: number;
  locked: boolean;
  hidden: boolean;
  customerVisible: boolean;
};

/* ------------------------------------------------------------------ fields */

export type CustomizerFieldType =
  | "text"
  | "textarea"
  | "date"
  | "time"
  | "number"
  | "select"
  | "checkbox"
  | "image"
  | "file";

export type CustomizerField = {
  id: string;
  label: string;
  type: CustomizerFieldType;
  required: boolean;
  defaultValue: string | boolean;
  placeholder: string;
  helpText: string;
  maxLength: number;
  options: string[];
  customerVisible: boolean;
};

/* ---------------------------------------------------------------- settings */

export type CustomizerSettings = {
  showSafeArea: boolean;
  showBleed: boolean;
  allowCustomerPhotoCrop: boolean;
  allowCustomerTextMove: boolean;
  requireApprovalCheckbox: boolean;
  allowCustomerText: boolean;
  allowCustomerUploads: boolean;
  allowCustomerElements: boolean;
  allowCustomerShapes?: boolean;
  allowCustomerLines?: boolean;
  allowCustomerFrames?: boolean;
  allowCustomerGrids?: boolean;
  allowCustomerQRCodes?: boolean;
  allowCustomerBackground?: boolean;
  allowCustomerGrouping?: boolean;
  showCustomerLayers?: boolean;
  allowedCustomerFonts?: string[];
  allowedCustomerColors?: string[];
  allowedCustomerShapes?: string[];
  allowedCustomerElementIds?: string[];
  allowedCustomerFrameMasks?: string[];
  allowedCustomerGridPresets?: string[];
  allowedCustomerImageFilters?: string[];
  allowedCustomerPages?: string[];
  maxCustomerObjectsPerPage?: number;
  customerObjectLimits?: {
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    minRotation?: number;
    maxRotation?: number;
    insetLeft?: number;
    insetTop?: number;
    insetRight?: number;
    insetBottom?: number;
  };
  protectedPreview: boolean;
  autosave: boolean;
  snapping: boolean;
  templateName: string;
  templateDescription: string;
  adminNotes: string;
  /** Product print-quality thresholds for placed photos (print-resolution.ts). */
  printQuality?: import("./print-resolution").PrintQualitySettings;
};

/* --------------------------------------------------------------- document */

export type CustomizerDocument = {
  schemaVersion: number;
  templateId: string;
  templateVersion: number;
  engineVersion: string;
  canvas: CanvasDefinition;
  pages: CustomizerPage[];
  fields: CustomizerField[];
  layers: CustomizerLayer[];
  settings: CustomizerSettings;
  assets: AssetReference[];
  guides?: GuideDefinition[];
  /**
   * The page a new customer session opens on. Optional: documents published
   * before it was carried fall back to the first enabled page.
   */
  defaultPageId?: string;
};

/* --------------------------------------------------- customer editor state */

// Customer changes never mutate the template. Overrides are keyed by template
// layer id; userLayers are customer-added layers (text/elements).
export type LayerOverride = {
  textStyle?: Partial<TextStyle>;
  transform?: Partial<{ x: number; y: number; width: number; height: number; rotation: number; opacity: number; zIndex: number }>;
  imageTransform?: Partial<ImageTransform>;
  imageFilters?: Partial<ImageFilters>;
  properties?: Record<string, unknown>;
  name?: string;
  hidden?: boolean;
  customerLocked?: boolean;
  gridSlots?: Record<
    string,
    {
      assetId?: string;
      src?: string;
      bucket?: string;
      path?: string;
      originalPath?: string;
      ownerId?: string;
      assetReference?: CustomerAssetReference;
      metadata?: Record<string, unknown>;
      transform?: Partial<ImageTransform>;
    }
  >;
};

export type CustomerEditorState = {
  layerOverrides: Record<string, LayerOverride>;
  userLayers: Array<Record<string, unknown>>;
};

/* --------------------------------------------------------------- preflight */

export type PreflightSeverity = "error" | "warning";

export type PreflightIssue = {
  code: string;
  severity: PreflightSeverity;
  message: string;
  pageId?: string;
  layerId?: string;
  fieldId?: string;
};

export type PreflightResult = {
  ok: boolean;
  blocking: boolean;
  issues: PreflightIssue[];
  checkedAt: string;
};

/* ------------------------------------------------------------ render jobs */

export type RenderJobType =
  | "preview"
  | "admin_preview"
  | "thumbnail"
  | "cart_thumbnail"
  | "print_png"
  | "print_pdf"
  | "mockup";

export type RenderOutput = {
  pageId: string;
  format: "png" | "webp" | "pdf" | "svg";
  bucket: string;
  path: string;
  widthPx: number;
  heightPx: number;
  dpi: number;
  fileSizeBytes: number;
  checksum: string;
  renderEngineVersion?: string;
  templateVersion?: number;
  createdAt?: string;
};
