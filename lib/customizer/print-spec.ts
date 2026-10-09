// A product's print specification, from its template (docs/PRINT_QUALITY_AUDIT.md D6).
//
// The physical card (inches) is the truth; the canvas is that card in
// document pixels at the template DPI; bleed is stored in document pixels.
// Every physical number the production output needs — raster size, bleed in
// inches, PDF page size in points — is derived HERE, so the raster renderer and
// the PDF builder cannot disagree. Example (the brief's): a 5 × 7 in card at
// 300 DPI is a 1500 × 2100 px trim; with 0.125 in (37.5 px) bleed on every
// edge the full-bleed raster is 1575 × 2175 px and the PDF page 5.25 × 7.25 in.

import { artboardOf } from "@/lib/customizer/v2/artboard";

export type Edges = { top: number; right: number; bottom: number; left: number };

export type PrintSpec = {
  trimWidthIn: number;
  trimHeightIn: number;
  /** The DPI the template declares. */
  dpi: number;
  canvasWidthPx: number;
  canvasHeightPx: number;
  /** Document pixels per printed inch, measured from the canvas and the card. */
  pxPerInchX: number;
  pxPerInchY: number;
  bleedPx: Edges;
  bleedIn: Edges;
  /** Trim + bleed, in document pixels (what production rasterizes). */
  rasterWidthPx: number;
  rasterHeightPx: number;
  /** Trim + bleed, in PDF points (1/72 in). */
  pageWidthPt: number;
  pageHeightPt: number;
};

const nonNegative = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

export function printSpec(template: Record<string, any>): PrintSpec {
  const board = artboardOf(template);
  const bleedPx: Edges = {
    top: nonNegative(template?.bleed?.top),
    right: nonNegative(template?.bleed?.right),
    bottom: nonNegative(template?.bleed?.bottom),
    left: nonNegative(template?.bleed?.left),
  };
  const pxPerInchX = board.widthPx / board.widthIn;
  const pxPerInchY = board.heightPx / board.heightIn;
  const bleedIn: Edges = {
    top: bleedPx.top / pxPerInchY,
    right: bleedPx.right / pxPerInchX,
    bottom: bleedPx.bottom / pxPerInchY,
    left: bleedPx.left / pxPerInchX,
  };
  return {
    trimWidthIn: board.widthIn,
    trimHeightIn: board.heightIn,
    dpi: board.dpi,
    canvasWidthPx: board.widthPx,
    canvasHeightPx: board.heightPx,
    pxPerInchX,
    pxPerInchY,
    bleedPx,
    bleedIn,
    rasterWidthPx: board.widthPx + bleedPx.left + bleedPx.right,
    rasterHeightPx: board.heightPx + bleedPx.top + bleedPx.bottom,
    pageWidthPt: (board.widthIn + bleedIn.left + bleedIn.right) * 72,
    pageHeightPt: (board.heightIn + bleedIn.top + bleedIn.bottom) * 72,
  };
}

/** Canvas shapes differing from the card's by more than this would visibly stretch. */
const ASPECT_TOLERANCE = 0.005;
/** Pixel density differing from the declared DPI by more than this is reported. */
const DENSITY_TOLERANCE = 0.01;

/**
 * Publish checks for the physical size. Only templates that state their card
 * size are checked (older templates without one keep the 5 × 7 default).
 */
export function printSpecIssues(template: Record<string, any>): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!(Number(template?.cardWidthIn) > 0) || !(Number(template?.cardHeightIn) > 0)) return { errors, warnings };
  if (!(Number(template?.canvasWidthPx) > 0) || !(Number(template?.canvasHeightPx) > 0)) return { errors, warnings };
  const spec = printSpec(template);
  const canvasAspect = spec.canvasWidthPx / spec.canvasHeightPx;
  const cardAspect = spec.trimWidthIn / spec.trimHeightIn;
  if (Math.abs(canvasAspect - cardAspect) / cardAspect > ASPECT_TOLERANCE) {
    errors.push(
      `The canvas (${spec.canvasWidthPx} × ${spec.canvasHeightPx} px) is not the shape of the printed card (${spec.trimWidthIn} × ${spec.trimHeightIn} in), so the print would be stretched. Set the size again in Template settings.`,
    );
  } else if (Math.abs(spec.pxPerInchX - spec.dpi) / spec.dpi > DENSITY_TOLERANCE) {
    warnings.push(
      `The canvas prints at ${Math.round(spec.pxPerInchX)} pixels per inch, not the ${spec.dpi} DPI the template declares. Set the size again in Template settings.`,
    );
  }
  return { errors, warnings };
}
