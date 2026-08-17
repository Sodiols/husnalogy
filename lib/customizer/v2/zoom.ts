// Shared canvas zoom + fit maths for the customer customizer and the admin
// design builder (spec §9 "Actual zoom and fit behaviour").
//
// Fit used to be a hardcoded `setZoom(1)` on every surface, which is not a fit
// at all: zoom 1 means "as wide as the workspace allows, capped by
// maxCanvasWidth" and completely ignores the available HEIGHT. A portrait card
// in a short viewport (laptop with the properties panel open, phone landscape,
// tablet with the keyboard up) therefore overflowed vertically and the customer
// could not see the whole page without scrolling.
//
// These helpers are pure so the behaviour is testable without a DOM: the
// component measures its own content box and asks for a zoom factor.

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 0.1;

// Zoom levels the customer/admin can never miss the page at. Fit results are
// clamped into this range so a very tall page still lands somewhere usable.
export function clampZoom(zoom: unknown, min = ZOOM_MIN, max = ZOOM_MAX): number {
  const value = Number(zoom);
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(max, Math.max(min, value));
}

/**
 * What 100% MEANS on the customer surface (spec §35).
 *
 * The two surfaces answer this differently, on purpose, and both answers now
 * live in this file rather than as an inline expression inside a component:
 *
 *   admin    — zoom 1 is FIT: the whole page inside the measured workspace
 *              (`computeWorkspaceFit`). A template author works on the whole
 *              artboard, so that is the useful resting view.
 *   customer — zoom 1 is the READING SIZE: the product drawn as wide as the
 *              workspace allows, capped at `maxCanvasWidth`, so a card is
 *              presented at a comfortable, consistent size across devices
 *              instead of ballooning on a large monitor.
 *
 * Fit remains a separate, distinct action on both surfaces (`computeFitZoom`),
 * and 1:1 — true physical size — is a third (`actualSizeZoom`). Three rules,
 * three functions, none of them a hardcoded `setZoom(1)`.
 *
 * The lower clamp keeps the page usable in a very narrow column; the upper
 * clamp is what stops a 27" display from rendering a greetings card a foot
 * wide.
 */
export const CUSTOMER_MIN_BASE_WIDTH = 220;

export function resolveCustomerBaseWidth(input: {
  /** Measured workspace width, in CSS pixels. */
  availableWidth: number;
  /** Breathing room kept on each side. */
  padding?: number;
  /** Upper bound on the on-screen page width at 100%. */
  maxCanvasWidth: number;
}): number {
  const padding = Math.max(0, Number(input?.padding) || 0);
  const available = Number(input?.availableWidth);
  const maximum = Math.max(1, Number(input?.maxCanvasWidth) || 0);
  // Before the first measurement, fall back to a sensible width so the very
  // first frame is not zero-sized; the ResizeObserver replaces it immediately.
  const width = Number.isFinite(available) && available > 0 ? available : 480;
  return Math.min(Math.max(width - padding * 2, CUSTOMER_MIN_BASE_WIDTH), maximum);
}

export type FitInput = {
  /** Content-box width of the workspace, in CSS pixels. */
  availableWidth: number;
  /** Content-box height of the workspace, in CSS pixels. */
  availableHeight: number;
  /**
   * On-screen width of the page at zoom 1. The workspace already derives this
   * from the container width, its padding and maxCanvasWidth, so Fit stays
   * consistent with whatever the surface renders at 100%.
   */
  baseWidth: number;
  /** Document page dimensions (any unit — only the ratio is used). */
  canvasWidth: number;
  canvasHeight: number;
  /** Breathing room kept on each side, in CSS pixels. */
  padding?: number;
};

type Resolved = {
  usableWidth: number;
  usableHeight: number;
  baseWidth: number;
  aspect: number;
};

function resolve(input: FitInput): Resolved | null {
  const padding = Math.max(0, Number(input?.padding) || 0);
  const availableWidth = Number(input?.availableWidth);
  const availableHeight = Number(input?.availableHeight);
  const baseWidth = Number(input?.baseWidth);
  const canvasWidth = Number(input?.canvasWidth);
  const canvasHeight = Number(input?.canvasHeight);

  if (![availableWidth, availableHeight, baseWidth, canvasWidth, canvasHeight].every((value) => Number.isFinite(value))) {
    return null;
  }
  if (baseWidth <= 0 || canvasWidth <= 0 || canvasHeight <= 0) return null;

  const usableWidth = availableWidth - padding * 2;
  const usableHeight = availableHeight - padding * 2;
  if (usableWidth <= 0 || usableHeight <= 0) return null;

  return { usableWidth, usableHeight, baseWidth, aspect: canvasHeight / canvasWidth };
}

/**
 * Zoom that makes the whole page visible: constrained by width AND height, so
 * the page never overflows the workspace on either axis. Returns `null` when
 * the workspace has not been measured yet, so callers can leave zoom untouched
 * instead of snapping to a wrong value during the first paint.
 */
export function computeFitZoom(input: FitInput, min = ZOOM_MIN, max = ZOOM_MAX): number | null {
  const resolved = resolve(input);
  if (!resolved) return null;
  const { usableWidth, usableHeight, baseWidth, aspect } = resolved;
  const widthZoom = usableWidth / baseWidth;
  const heightZoom = usableHeight / (baseWidth * aspect);
  return clampZoom(Math.min(widthZoom, heightZoom), min, max);
}

/**
 * Zoom that fills the workspace width, letting the page scroll vertically.
 * Useful for tall stationery where reading the type matters more than seeing
 * the whole page at once.
 */
export function computeFitWidthZoom(input: FitInput, min = ZOOM_MIN, max = ZOOM_MAX): number | null {
  const resolved = resolve(input);
  if (!resolved) return null;
  return clampZoom(resolved.usableWidth / resolved.baseWidth, min, max);
}

/**
 * Keep the visual centre fixed while zooming: the point of the document under
 * the workspace centre must stay under the workspace centre afterwards. Returns
 * the pan offset (screen px) that preserves it.
 */
export function panForZoomChange(
  pan: { panX: number; panY: number },
  previousZoom: number,
  nextZoom: number,
): { panX: number; panY: number } {
  const from = Number(previousZoom);
  const to = Number(nextZoom);
  const panX = Number(pan?.panX) || 0;
  const panY = Number(pan?.panY) || 0;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0) return { panX, panY };
  const ratio = to / from;
  return { panX: panX * ratio, panY: panY * ratio };
}

/**
 * One zoom step in or out. Multiplicative so each press feels the same at every
 * zoom level, unlike a fixed +0.1 which is huge at 25% and tiny at 400%.
 */
export function stepZoom(zoom: number, direction: 1 | -1, min = ZOOM_MIN, max = ZOOM_MAX): number {
  const current = clampZoom(zoom, min, max);
  const factor = direction > 0 ? 1.2 : 1 / 1.2;
  return clampZoom(Number((current * factor).toFixed(4)), min, max);
}

/* ==========================================================================
 * Workspace-relative zoom (admin design builder)
 *
 * The builder used to define zoom 1 as "the page drawn at a width-derived base
 * size, capped at 900px". That is not a zoom convention at all: it ignores the
 * available HEIGHT, so a 5x7 portrait card at "100%" was 1260px tall and could
 * not be seen end to end in any normal workspace — the whole card only appeared
 * around 70%.
 *
 * Here, zoom 1 means "the complete page fitted inside the measured workspace".
 * Everything else follows from that: below 100% the page is smaller than the
 * fitted view, above 100% it grows and pans, and 1:1 stays a separate physical
 * scale derived from the document DPI.
 * ========================================================================== */

/** CSS reference pixels per inch. Fixed by the CSS specification. */
export const SCREEN_CSS_DPI = 96;

export type WorkspacePadding = { top: number; right: number; bottom: number; left: number };

/**
 * Breathing room kept between the page and the workspace edges.
 *
 * The bottom is deliberately larger than the rest: the floating zoom controls
 * sit there, and the card must never slide underneath them. Values scale with
 * the workspace and are clamped to the ranges the design calls for.
 */
export function resolveWorkspacePadding(availableWidth: number, availableHeight: number): WorkspacePadding {
  const width = Math.max(0, Number(availableWidth) || 0);
  const height = Math.max(0, Number(availableHeight) || 0);
  const side = Math.round(Math.min(40, Math.max(24, width * 0.03)));
  const top = Math.round(Math.min(40, Math.max(24, height * 0.035)));
  const bottom = Math.round(Math.min(80, Math.max(56, height * 0.085)));
  return { top, right: side, bottom, left: side };
}

export type WorkspaceFitInput = {
  /** Measured width of the workspace box, in CSS pixels. */
  availableWidth: number;
  /** Measured height of the workspace box, in CSS pixels. */
  availableHeight: number;
  /** Document page size, in document pixels. Only the ratio and scale matter. */
  canvasWidth: number;
  canvasHeight: number;
  /** Override the responsive padding, e.g. in tests. */
  padding?: Partial<WorkspacePadding>;
};

export type WorkspaceFit = {
  /** Document pixels -> CSS pixels at 100% zoom. */
  fitScale: number;
  /** On-screen page size at 100% zoom, in CSS pixels. */
  baseWidth: number;
  baseHeight: number;
  /** Space reserved around the page. */
  padding: WorkspacePadding;
  /** Workspace box minus the padding. */
  usableWidth: number;
  usableHeight: number;
};

/**
 * The base scale for 100% zoom: the largest scale at which the complete page,
 * plus its padding, fits the workspace on BOTH axes.
 *
 * Returns null when the workspace has not been measured yet, so callers can
 * hold off rather than snapping to a wrong scale during the first paint.
 */
export function computeWorkspaceFit(input: WorkspaceFitInput): WorkspaceFit | null {
  const availableWidth = Number(input?.availableWidth);
  const availableHeight = Number(input?.availableHeight);
  const canvasWidth = Number(input?.canvasWidth);
  const canvasHeight = Number(input?.canvasHeight);
  if (![availableWidth, availableHeight, canvasWidth, canvasHeight].every((value) => Number.isFinite(value))) return null;
  if (availableWidth <= 0 || availableHeight <= 0 || canvasWidth <= 0 || canvasHeight <= 0) return null;

  const base = resolveWorkspacePadding(availableWidth, availableHeight);
  const padding: WorkspacePadding = {
    top: Math.max(0, Number(input.padding?.top ?? base.top)),
    right: Math.max(0, Number(input.padding?.right ?? base.right)),
    bottom: Math.max(0, Number(input.padding?.bottom ?? base.bottom)),
    left: Math.max(0, Number(input.padding?.left ?? base.left)),
  };

  const usableWidth = availableWidth - padding.left - padding.right;
  const usableHeight = availableHeight - padding.top - padding.bottom;
  if (usableWidth <= 0 || usableHeight <= 0) return null;

  const widthScale = usableWidth / canvasWidth;
  const heightScale = usableHeight / canvasHeight;
  // The tighter axis wins, so the page never overflows either direction.
  const fitScale = Math.min(widthScale, heightScale);
  if (!Number.isFinite(fitScale) || fitScale <= 0) return null;

  return {
    fitScale,
    baseWidth: canvasWidth * fitScale,
    baseHeight: canvasHeight * fitScale,
    padding,
    usableWidth,
    usableHeight,
  };
}

/**
 * The zoom value that renders the page at its true physical size — what the
 * 1:1 control means. A 300 DPI document shown on a 96 DPI screen is drawn at
 * 96/300 document-pixels-per-CSS-pixel; expressed against the fitted base that
 * becomes `physicalScale / fitScale`, so 1:1 and 100% stay distinct actions.
 */
export function actualSizeZoom(fitScale: number, documentDpi: number, screenDpi = SCREEN_CSS_DPI): number {
  const fit = Number(fitScale);
  const dpi = Number(documentDpi);
  const screen = Number(screenDpi);
  if (!Number.isFinite(fit) || fit <= 0 || !Number.isFinite(dpi) || dpi <= 0 || !Number.isFinite(screen) || screen <= 0) {
    return 1;
  }
  return clampZoom(screen / dpi / fit);
}

/** Zoom stops the controls step through. 1 is always present — it is Fit. */
export const ZOOM_PRESETS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

/** Next preset in a direction; falls back to the nearest end of the list. */
export function nextZoomPreset(zoom: number, direction: 1 | -1, presets = ZOOM_PRESETS): number {
  const current = Number(zoom);
  if (!Number.isFinite(current)) return 1;
  const epsilon = 0.001;
  if (direction > 0) {
    return presets.find((preset) => preset > current + epsilon) ?? presets[presets.length - 1];
  }
  return [...presets].reverse().find((preset) => preset < current - epsilon) ?? presets[0];
}
