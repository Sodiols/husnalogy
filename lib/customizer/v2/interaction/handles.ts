/**
 * Transform handle geometry and styling (spec §13).
 *
 * The handles are drawn on the Konva interaction layer, which lives INSIDE the
 * zoomed stage — so a handle authored at 12px would render at 3px when the
 * customer zooms out to 25% and at 48px when they zoom to 400%. Both are
 * unusable, and the second one covers the artwork it is supposed to be editing.
 *
 * Everything here therefore returns DOCUMENT-unit sizes computed from a target
 * SCREEN size divided by the current scale, which keeps a handle the same
 * physical size at every zoom level. Same reasoning for the snap tolerance and
 * the hit padding on thin objects.
 */

export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export type HandleDefinition = {
  id: HandleId;
  /** Normalised position inside the bounding box. */
  cx: number;
  cy: number;
  cursor: string;
};

export const HANDLE_DEFINITIONS: readonly HandleDefinition[] = [
  { id: "nw", cx: 0, cy: 0, cursor: "nwse-resize" },
  { id: "n", cx: 0.5, cy: 0, cursor: "ns-resize" },
  { id: "ne", cx: 1, cy: 0, cursor: "nesw-resize" },
  { id: "e", cx: 1, cy: 0.5, cursor: "ew-resize" },
  { id: "se", cx: 1, cy: 1, cursor: "nwse-resize" },
  { id: "s", cx: 0.5, cy: 1, cursor: "ns-resize" },
  { id: "sw", cx: 0, cy: 1, cursor: "nesw-resize" },
  { id: "w", cx: 0, cy: 0.5, cursor: "ew-resize" },
];

export const CORNER_HANDLES: ReadonlySet<HandleId> = new Set<HandleId>(["nw", "ne", "sw", "se"]);
export const SIDE_HANDLES: ReadonlySet<HandleId> = new Set<HandleId>(["n", "s", "e", "w"]);

/** Konva anchor names, which use `top-left` style rather than `nw`. */
const KONVA_ANCHOR_BY_HANDLE: Record<HandleId, string> = {
  nw: "top-left",
  n: "top-center",
  ne: "top-right",
  e: "middle-right",
  se: "bottom-right",
  s: "bottom-center",
  sw: "bottom-left",
  w: "middle-left",
};

export function konvaAnchors(handles: Iterable<HandleId>): string[] {
  return Array.from(handles, (handle) => KONVA_ANCHOR_BY_HANDLE[handle]).filter(Boolean);
}

export function handleFromKonvaAnchor(anchor: string): HandleId | null {
  const entry = (Object.entries(KONVA_ANCHOR_BY_HANDLE) as Array<[HandleId, string]>).find(
    ([, name]) => name === anchor,
  );
  return entry ? entry[0] : null;
}

/* ---------------------------------------------------------------------------
 * Zoom-independent sizing
 * ------------------------------------------------------------------------ */

/** Handle box drawn on screen, in CSS pixels. Comfortable with a mouse. */
export const HANDLE_SCREEN_SIZE = 10;
/** Larger square on touch, where the finger is the pointer (spec §38). */
export const HANDLE_SCREEN_SIZE_TOUCH = 16;
/** Invisible grab area around each handle, so near-misses still land. */
export const HANDLE_SCREEN_HIT_PADDING = 8;
export const HANDLE_SCREEN_HIT_PADDING_TOUCH = 14;
/** Distance from the top edge to the rotation handle. */
export const ROTATE_HANDLE_SCREEN_OFFSET = 28;
/** Selection outline weight. */
export const SELECTION_STROKE_SCREEN_WIDTH = 1.5;
/** Snap radius, in screen pixels — matches the legacy `SNAP_PX`. */
export const SNAP_SCREEN_TOLERANCE = 8;

export type HandleMetrics = {
  size: number;
  hitPadding: number;
  rotateOffset: number;
  strokeWidth: number;
  cornerRadius: number;
  snapTolerance: number;
};

/**
 * Document-unit metrics for the current scale.
 *
 * `scale` is document pixels -> CSS pixels, the same number both canvases
 * already compute for their overlay. Dividing by it converts a screen size the
 * designer chose into the document size Konva needs to draw.
 */
export function resolveHandleMetrics(scale: number, pointerType: "mouse" | "touch" = "mouse"): HandleMetrics {
  const safeScale = Math.max(Math.abs(Number(scale) || 0), 1e-6);
  const touch = pointerType === "touch";
  return {
    size: (touch ? HANDLE_SCREEN_SIZE_TOUCH : HANDLE_SCREEN_SIZE) / safeScale,
    hitPadding: (touch ? HANDLE_SCREEN_HIT_PADDING_TOUCH : HANDLE_SCREEN_HIT_PADDING) / safeScale,
    rotateOffset: ROTATE_HANDLE_SCREEN_OFFSET / safeScale,
    strokeWidth: SELECTION_STROKE_SCREEN_WIDTH / safeScale,
    cornerRadius: 2 / safeScale,
    snapTolerance: SNAP_SCREEN_TOLERANCE / safeScale,
  };
}

/**
 * Which handles an object should offer.
 *
 * Single-line auto-sized text has no independent height — its box is measured
 * from the glyphs — so the vertical handles would promise a resize that the
 * layout engine immediately discards. It gets the corners (type size) plus the
 * two horizontal sides (wrap width), which is the pre-existing behaviour.
 */
export function resolveVisibleHandles(options: {
  resizable: boolean;
  isText: boolean;
  singleLineAutoSize: boolean;
}): HandleId[] {
  if (!options.resizable) return [];
  if (options.isText && options.singleLineAutoSize) {
    return HANDLE_DEFINITIONS.filter(
      (handle) => handle.id === "w" || handle.id === "e" || CORNER_HANDLES.has(handle.id),
    ).map((handle) => handle.id);
  }
  return HANDLE_DEFINITIONS.map((handle) => handle.id);
}

/**
 * Very thin objects — a hairline rule is a legitimate design element — are
 * almost impossible to hit at their true size. They get a minimum SCREEN hit
 * height, which affects pointer targeting only and never the printed artwork
 * (spec §29).
 */
export const MIN_SCREEN_HIT_EXTENT = 12;

export function resolveHitExtents(
  width: number,
  height: number,
  scale: number,
): { width: number; height: number } {
  const safeScale = Math.max(Math.abs(Number(scale) || 0), 1e-6);
  const minimum = MIN_SCREEN_HIT_EXTENT / safeScale;
  return {
    width: Math.max(Math.abs(Number(width) || 0), minimum),
    height: Math.max(Math.abs(Number(height) || 0), minimum),
  };
}
