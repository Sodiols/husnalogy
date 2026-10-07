import { SMALL_TEXT_MAX_POINT_SIZE, pointsToDocumentPx } from "../type-units";

/**
 * Selection chrome for the Design Studio: ONE place for its colour and sizes.
 *
 * The studio draws selections in a thin magenta outline with round corner
 * handles, pill side handles and a round rotate control BELOW the object
 * (its references); the customer editor keeps its own gold chrome, which is
 * what `CustomizerInteractionStage` uses when no theme is given.
 *
 * Every size is in SCREEN pixels, so the outline and controls look the same
 * at 50% and at 200% zoom. This is
 * selection UI only — it never touches the design: nothing here is written to
 * a layer or rendered by the print pipeline.
 */
export type SelectionTheme = {
  /** Outline, handle border and control accent. */
  color: string;
  handleFill: string;
  strokeScreenWidth: number;
  cornerHandleScreenSize: number;
  sideHandleScreenLength: number;
  sideHandleScreenThickness: number;
  rotateControlScreenSize: number;
  moveControlScreenSize: number;
  /** Gap between the object's box and the controls below it. */
  controlGapScreen: number;
  /** Invisible grab margin around every handle and control. */
  hitPaddingScreen: number;
  /**
   * Text this size or smaller (in DOCUMENT PX, after any text scale) gets the
   * compact small-text controls: two corner handles, and dedicated rotate and
   * move buttons beneath it. The rule is 10 pt (type-units.ts); the studio
   * converts it with the artboard's own DPI, the default assumes 300.
   */
  smallTextMaxFontSize: number;
};

export const STUDIO_SELECTION_THEME: SelectionTheme = {
  color: "#E8399E",
  handleFill: "#FFFFFF",
  strokeScreenWidth: 1.5,
  cornerHandleScreenSize: 11,
  sideHandleScreenLength: 13,
  sideHandleScreenThickness: 6,
  rotateControlScreenSize: 22,
  moveControlScreenSize: 22,
  controlGapScreen: 10,
  hitPaddingScreen: 8,
  smallTextMaxFontSize: pointsToDocumentPx(SMALL_TEXT_MAX_POINT_SIZE),
};

/**
 * Whether a selected text object gets the small-text controls.
 *
 * Decided from the committed font size rounded to hundredths, so floating
 * point noise (9.999999 vs 10.000001) can never flip the mode, and the stage
 * reads it only between gestures, so a live resize never swaps the handles
 * out from under the pointer.
 */
export function isSmallText(fontSize: unknown, theme: Pick<SelectionTheme, "smallTextMaxFontSize">): boolean {
  const size = Math.round((Number(fontSize) || 0) * 100) / 100;
  return size > 0 && size <= theme.smallTextMaxFontSize;
}
