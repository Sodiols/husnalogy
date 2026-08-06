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
