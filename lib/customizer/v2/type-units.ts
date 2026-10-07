// Typography units: ONE rule for what a font-size number means.
//
//   STORED  — `textStyle.fontSize` is in DOCUMENT PIXELS: the artboard's own
//             pixels at its DPI (a 5 x 7 in card at 300 DPI is 1500 x 2100).
//             Every renderer — the browser canvas, the inline editor, the
//             selection geometry, the customer editor, the server/print SVG —
//             draws in these units. This is unchanged, so every saved
//             template, customer design and order renders exactly as before.
//
//   SHOWN   — every font-size control (studio toolbar and inspector, customer
//             toolbar) shows and accepts POINTS, 1/72 of an inch: the unit
//             print tools use, and the one the reference editor's "17" is in.
//             On a 300 DPI card, 17 pt = 17 x 300 / 72 = 70.83 document px.
//
// The two meet only here. Nothing else may multiply or divide a font size by
// a magic factor.

export const POINTS_PER_INCH = 72;
export const DEFAULT_ARTBOARD_DPI = 300;

/** Every NEW standard text object starts at this size, in points. */
export const DEFAULT_NEW_TEXT_POINT_SIZE = 17;

/** The studio's compact small-text controls apply at or below this size, in points. */
export const SMALL_TEXT_MAX_POINT_SIZE = 10;

/** Font-size control limits, in points (stored limits: FONT_SIZE_RULES, in document px). */
export const FONT_SIZE_POINT_RULES = { minimum: 1, maximum: 120, step: 1, largeStep: 5 } as const;

const safeDpi = (dpi: unknown) => (Number(dpi) > 0 ? Number(dpi) : DEFAULT_ARTBOARD_DPI);

/** Points -> stored document pixels (to hundredths, so a round trip is exact at one decimal). */
export function pointsToDocumentPx(points: number, dpi?: unknown): number {
  return Math.round(((Number(points) || 0) * safeDpi(dpi) * 100) / POINTS_PER_INCH) / 100;
}

/** Stored document pixels -> points, as shown in every font-size control (one decimal). */
export function documentPxToPoints(px: number, dpi?: unknown): number {
  return Math.round(((Number(px) || 0) * POINTS_PER_INCH * 10) / safeDpi(dpi)) / 10;
}

/** The stored font size of new standard text: 17 pt on this artboard. */
export function newTextFontSize(dpi?: unknown): number {
  return pointsToDocumentPx(DEFAULT_NEW_TEXT_POINT_SIZE, dpi);
}

/** A stored [minimum, maximum] font-size window, as points for a control. */
export function fontSizeBoundsInPoints(bounds: { minimum: number; maximum: number }, dpi?: unknown): { minimum: number; maximum: number } {
  return {
    minimum: Math.max(FONT_SIZE_POINT_RULES.minimum, Math.ceil(documentPxToPoints(bounds.minimum, dpi) * 10) / 10),
    maximum: Math.max(FONT_SIZE_POINT_RULES.minimum, Math.floor(documentPxToPoints(bounds.maximum, dpi) * 10) / 10),
  };
}
