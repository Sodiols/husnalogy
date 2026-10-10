// Text curve (curved single-line text): ONE geometry for the studio canvas,
// the customer editor, previews, thumbnails, the server preview and the print
// renderer, so a curve looks the same everywhere it is drawn.
//
// The text is laid along a circular arc with an SVG <textPath>. The browser and
// resvg (production PNG, and the PDF that embeds it) both shape the WHOLE run —
// kerning, ligatures and connected script letterforms intact — and then place
// each glyph on the path, rotated to its tangent. Nothing is rotated letter by
// letter here, and nothing is rasterised: the curve is stored as one number.
//
// Mapping (documented, linear in curvature):
//   curve  c ∈ [-100, 100], integer, 0 = straight
//   sweep  θ = |c| / 100 × TEXT_CURVE_MAX_SWEEP_DEG   (the arc the text covers)
//   radius R = L / θ                                   (L = the text's advance)
//   c > 0 bends the text upward into an arch (centre of the circle below it),
//   c < 0 downward into a smile (centre above it).
// Two safety limits keep extreme values well behaved: the sweep never exceeds
// 330° (the ends never meet), and the radius never drops below the font size
// (so very short words at strong curves do not fold glyphs into each other).

import { autoWidthPadding, DEFAULT_LINE_HEIGHT, layoutText, resolvedTextLayoutMode, type MeasureFn } from "./text-layout";

export const TEXT_CURVE_MIN = -100;
export const TEXT_CURVE_MAX = 100;
export const TEXT_CURVE_STEP = 1;
/** The arc the text covers at |curve| = 100. */
export const TEXT_CURVE_MAX_SWEEP_DEG = 330;
/** The smallest radius, in font sizes: below it glyphs would fold into each other. */
export const TEXT_CURVE_MIN_RADIUS_EM = 1;
/** Each half of the drawn path: almost a full circle, so the text can never run off its end. */
const PATH_HALF_SPAN_DEG = 179.5;

/** A stored curve value: an integer in [-100, 100]; anything else is straight (0). */
export function normalizeTextCurve(value: unknown): number {
  const number = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
  if (!Number.isFinite(number)) return 0;
  const rounded = Math.round(number);
  return Math.min(TEXT_CURVE_MAX, Math.max(TEXT_CURVE_MIN, rounded)) || 0;
}

/**
 * Curvature applies to genuine single-line text only. Multiline text (the
 * Multiline option, or a typed line break) keeps rendering straight — its
 * curve value is kept, not destroyed, and comes back if it becomes one line.
 */
export function textCurveApplies(style: Record<string, any> | null | undefined, text: unknown): boolean {
  if (!normalizeTextCurve(style?.curve)) return false;
  if (style?.multiline) return false;
  return !String(text ?? "").replace(/\r\n?/g, "\n").includes("\n");
}

export type TextCurveGeometry = {
  curve: number;
  /** +1 arch (bends upward), -1 smile (bends downward). */
  direction: 1 | -1;
  radius: number;
  /** The arc the text covers, radians (after the safety limits). */
  sweep: number;
  /** Size of the curved text's bounds, padding included. */
  width: number;
  height: number;
  /** The circle's centre and the arc's apex, relative to the bounds' centre. */
  centerDy: number;
  apexDy: number;
};

/**
 * The arc for a run of text with the given advance. Pure and total: returns
 * null for straight or empty text, never NaN or an infinite radius.
 */
export function textCurveGeometry(input: {
  curve: unknown;
  /** The text's advance along the line, px. */
  advance: number;
  fontSize: number;
  lineHeight?: number;
}): TextCurveGeometry | null {
  const curve = normalizeTextCurve(input.curve);
  const advance = Number(input.advance);
  const fontSize = Number(input.fontSize);
  if (!curve || !(advance > 0) || !(fontSize > 0)) return null;
  const requested = (Math.abs(curve) / 100) * ((TEXT_CURVE_MAX_SWEEP_DEG * Math.PI) / 180);
  const minRadius = fontSize * TEXT_CURVE_MIN_RADIUS_EM;
  const sweep = Math.min(requested, advance / minRadius);
  if (!(sweep > 1e-6)) return null;
  const radius = advance / sweep;
  const direction: 1 | -1 = curve > 0 ? 1 : -1;

  // The text occupies an annular sector: radii R ± half the line box, angles
  // centred on the apex (straight up for an arch, straight down for a smile).
  const lineHeight = Number(input.lineHeight) > 0 ? Number(input.lineHeight) : DEFAULT_LINE_HEIGHT;
  const halfBand = (fontSize * Math.max(1, lineHeight)) / 2;
  const inner = Math.max(0, radius - halfBand);
  const outer = radius + halfBand;
  const mid = direction > 0 ? -Math.PI / 2 : Math.PI / 2;
  const half = sweep / 2;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const angle of [mid - half, mid + half]) {
    for (const r of [inner, outer]) {
      xs.push(r * Math.cos(angle));
      ys.push(r * Math.sin(angle));
    }
  }
  // Any compass point the sector passes through is an extreme of the outer edge.
  for (const axis of [-Math.PI / 2, 0, Math.PI / 2, Math.PI]) {
    const delta = Math.atan2(Math.sin(axis - mid), Math.cos(axis - mid));
    if (Math.abs(delta) <= half) {
      xs.push(outer * Math.cos(axis));
      ys.push(outer * Math.sin(axis));
    }
  }
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const padding = autoWidthPadding(fontSize);
  const boundsCenterY = (minY + maxY) / 2;
  return {
    curve,
    direction,
    radius,
    sweep,
    width: maxX - minX + padding,
    height: maxY - minY + padding,
    centerDy: -boundsCenterY,
    apexDy: direction * -radius - boundsCenterY,
  };
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * The SVG path the text follows: a near-full circle through the apex, drawn in
 * reading direction, with the apex at exactly 50% of its length — so
 * `text-anchor="middle"` with `startOffset="50%"` centres the text on the apex.
 */
export function textCurvePathD(centerX: number, centerY: number, geometry: Pick<TextCurveGeometry, "radius" | "direction">): string {
  const r = geometry.radius;
  const span = (PATH_HALF_SPAN_DEG * Math.PI) / 180;
  const apex = geometry.direction > 0 ? -Math.PI / 2 : Math.PI / 2;
  // An arch runs clockwise over the top, a smile anticlockwise along the bottom:
  // both read left to right at the apex, glyphs upright.
  const turn = geometry.direction > 0 ? 1 : -1;
  const point = (angle: number) => `${round3(centerX + r * Math.cos(angle))} ${round3(centerY + r * Math.sin(angle))}`;
  const sweepFlag = geometry.direction > 0 ? 1 : 0;
  const radius = round3(r);
  return (
    `M ${point(apex - turn * span)}` +
    ` A ${radius} ${radius} 0 0 ${sweepFlag} ${point(apex)}` +
    ` A ${radius} ${radius} 0 0 ${sweepFlag} ${point(apex + turn * span)}`
  );
}

export type CurvedTextLayout = {
  /** The line exactly as drawn (uppercase already applied). */
  text: string;
  fontSize: number;
  geometry: TextCurveGeometry;
  /** Centre of the curved text's own bounds, document px, unrotated. */
  centerX: number;
  centerY: number;
  /** The arc's circle centre and the path the text follows. */
  circleX: number;
  circleY: number;
  pathD: string;
  /**
   * The selection frame: the curved bounds, made symmetric about the layer's
   * box centre, so the frame, the rotation pivot and the drag origin stay the
   * one point every other text object uses.
   */
  frame: { x: number; y: number; width: number; height: number };
};

export type CurvedTextInput = {
  /** The RESOLVED straight text box (resolveTextBox). */
  box: { x: number; y: number; width: number; height: number; clampedBySafeArea?: boolean };
  text: string;
  style: Record<string, any>;
  measure: MeasureFn;
  maxLines?: number;
};

/**
 * Lay out curved text, or return null to render it straight.
 *
 * Continuity is the rule: the curved run uses the SAME font size and the SAME
 * centre the straight line has in its box, so moving the slider off 0 bends the
 * text in place — it never jumps, resizes or re-wraps.
 */
export function layoutCurvedText(input: CurvedTextInput): CurvedTextLayout | null {
  const { box, style } = input;
  if (!textCurveApplies(style, input.text)) return null;
  const fontFamily = style.fontFamily || "Cormorant Garamond";
  const letterSpacing = Number(style.letterSpacing) || 0;
  const lineHeight = Number(style.lineHeight) || DEFAULT_LINE_HEIGHT;
  const layout = layoutText(
    {
      text: String(input.text),
      width: Math.max(1, box.width),
      height: Math.max(1, box.height),
      fontFamily,
      fontSize: Number(style.fontSize) || 48,
      minFontSize: Number(style.minFontSize) || undefined,
      fontWeight: style.fontWeight || "400",
      fontStyle: style.fontStyle === "italic" ? "italic" : "normal",
      letterSpacing,
      lineHeight,
      textAlign: style.textAlign || "center",
      verticalAlign: style.verticalAlign || "middle",
      uppercase: Boolean(style.uppercase),
      ...resolvedTextLayoutMode(style, Boolean(box.clampedBySafeArea)),
      // One run along the arc: a curve never wraps.
      multiline: false,
      maxLines: input.maxLines,
    },
    input.measure,
  );
  const line = layout.lines[0];
  if (!line || !line.text.trim()) return null;
  // Renderers space after every glyph, the last included: that is the advance drawn.
  const advance = line.width + Math.max(0, letterSpacing);
  const geometry = textCurveGeometry({ curve: style.curve, advance, fontSize: layout.fontSize, lineHeight });
  if (!geometry) return null;

  const boxLeft = box.x - box.width / 2;
  const boxTop = box.y - box.height / 2;
  // The straight line's own centre in its box (alignment honoured).
  const centerX =
    layout.anchor === "start" ? boxLeft + line.x + advance / 2 : layout.anchor === "end" ? boxLeft + line.x - advance / 2 : boxLeft + line.x;
  const centerY = boxTop + line.y;
  const circleX = centerX;
  const circleY = centerY + geometry.centerDy;
  const halfWidth = Math.max(Math.abs(centerX - geometry.width / 2 - box.x), Math.abs(centerX + geometry.width / 2 - box.x));
  const halfHeight = Math.max(Math.abs(centerY - geometry.height / 2 - box.y), Math.abs(centerY + geometry.height / 2 - box.y));
  return {
    text: line.text,
    fontSize: layout.fontSize,
    geometry,
    centerX,
    centerY,
    circleX,
    circleY,
    pathD: textCurvePathD(circleX, circleY, geometry),
    frame: { x: box.x, y: box.y, width: Math.ceil(halfWidth * 2), height: Math.ceil(halfHeight * 2) },
  };
}
