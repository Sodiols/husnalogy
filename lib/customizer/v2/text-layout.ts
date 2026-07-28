// Husnalogy text layout service (spec §9).
//
// ONE layout implementation shared by the admin canvas, customer canvas, page
// thumbnails, review preview, server preview renderer, and print renderer.
// Layout decisions (line breaks, shrink-to-fit size, line positions) are made
// here from injected font measurements, so every surface renders the same
// breaks. SVG has no automatic wrapping — each output line becomes one
// positioned <tspan>/<text>, which resvg and browsers draw identically.

export type MeasureStyle = {
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  fontStyle: "normal" | "italic";
  letterSpacing: number;
};

// Returns the advance width of `text` in px at the given style.
export type MeasureFn = (text: string, style: MeasureStyle) => number;

export type TextLayoutInput = {
  text: string;
  width: number; // text box width in canvas px
  height: number; // text box height in canvas px
  fontFamily: string;
  fontSize: number;
  minFontSize?: number;
  fontWeight?: string;
  fontStyle?: "normal" | "italic";
  letterSpacing?: number;
  lineHeight?: number; // multiplier
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  uppercase?: boolean;
  multiline?: boolean;
  fitMode?: "fixed" | "shrink" | "auto-height";
  maxLines?: number;
};

export type TextLayoutLine = {
  text: string;
  width: number;
  // Position of the line's anchor point relative to the box top-left. x follows
  // the alignment anchor (start/middle/end); y is the line's BASELINE-CENTER
  // (use dominantBaseline="middle" / dy adjustments consistently).
  x: number;
  y: number;
};

export type TextLayoutResult = {
  lines: TextLayoutLine[];
  fontSize: number; // final size after shrink-to-fit
  lineHeightPx: number;
  totalHeight: number;
  overflowWidth: boolean; // a line is wider than the box
  overflowHeight: boolean; // lines exceed the box height
  overflowX: boolean;
  overflowY: boolean;
  unbreakableWord: boolean;
  resolvedFontSize: number;
  truncatedLines: boolean; // maxLines cut content
  anchor: "start" | "middle" | "end";
};

const WORD_SPLIT = /(\s+)/;

function breakLongWord(word: string, maxWidth: number, style: MeasureStyle, measure: MeasureFn): string[] {
  const out: string[] = [];
  let current = "";
  for (const char of Array.from(word)) {
    const candidate = current + char;
    if (current && measure(candidate, style) > maxWidth) {
      out.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current) out.push(current);
  return out.length ? out : [word];
}

// Wrap one paragraph (no manual breaks inside) to maxWidth.
function wrapParagraph(paragraph: string, maxWidth: number, style: MeasureStyle, measure: MeasureFn): string[] {
  if (!paragraph) return [""];
  const tokens = paragraph.split(WORD_SPLIT).filter((t) => t.length > 0);
  const lines: string[] = [];
  let current = "";

  for (const token of tokens) {
    const isSpace = /^\s+$/.test(token);
    const candidate = current + token;
    if (measure(candidate, style) <= maxWidth || current === "") {
      // A single token wider than the box gets hard-broken by character.
      if (current === "" && !isSpace && measure(token, style) > maxWidth) {
        const pieces = breakLongWord(token, maxWidth, style, measure);
        lines.push(...pieces.slice(0, -1));
        current = pieces[pieces.length - 1] || "";
      } else {
        current = candidate;
      }
    } else if (isSpace) {
      // Trailing space that would overflow — break here, drop the space.
      lines.push(current.replace(/\s+$/, ""));
      current = "";
    } else {
      lines.push(current.replace(/\s+$/, ""));
      if (measure(token, style) > maxWidth) {
        const pieces = breakLongWord(token, maxWidth, style, measure);
        lines.push(...pieces.slice(0, -1));
        current = pieces[pieces.length - 1] || "";
      } else {
        current = token;
      }
    }
  }
  lines.push(current.replace(/\s+$/, ""));
  return lines.length ? lines : [""];
}

function layoutAtSize(
  text: string,
  fontSize: number,
  input: TextLayoutInput,
  measure: MeasureFn,
): { lines: string[]; widths: number[]; overflowWidth: boolean; unbreakableWord: boolean } {
  const style: MeasureStyle = {
    fontFamily: input.fontFamily,
    fontSize,
    fontWeight: input.fontWeight || "400",
    fontStyle: input.fontStyle || "normal",
    letterSpacing: input.letterSpacing || 0,
  };

  const paragraphs = String(text).split("\n");
  const unbreakableWord =
    input.multiline !== false &&
    paragraphs.some((paragraph) =>
      paragraph
        .split(/\s+/)
        .filter(Boolean)
        .some((word) => measure(word, style) > input.width + 0.5),
    );
  let lines: string[];
  if (input.multiline === false) {
    // Single-line mode: manual breaks collapse to spaces, no wrapping.
    lines = [paragraphs.join(" ")];
  } else {
    lines = paragraphs.flatMap((p) => wrapParagraph(p, input.width, style, measure));
  }

  const widths = lines.map((line) => measure(line, style));
  const overflowWidth = widths.some((w) => w > input.width + 0.5);
  return { lines, widths, overflowWidth, unbreakableWord };
}

export function layoutText(input: TextLayoutInput, measure: MeasureFn): TextLayoutResult {
  const canonicalText = String(input.text ?? "").replace(/\r\n?/g, "\n");
  const rawText = input.uppercase ? canonicalText.toUpperCase() : canonicalText;
  const lineHeightMult = Number(input.lineHeight) > 0 ? Number(input.lineHeight) : 1.15;
  const minFontSize = Math.max(4, Number(input.minFontSize) || 8);
  const startSize = Math.max(minFontSize, Number(input.fontSize) || 16);
  const shrink = input.fitMode === "shrink";

  let fontSize = startSize;
  let attempt = layoutAtSize(rawText, fontSize, input, measure);

  if (shrink) {
    // Shrink until width and height fit, or the minimum size is reached.
    while (fontSize > minFontSize) {
      const heightNeeded = attempt.lines.length * fontSize * lineHeightMult;
      if (!attempt.overflowWidth && heightNeeded <= input.height + 0.5) break;
      fontSize = Math.max(minFontSize, fontSize - 1);
      attempt = layoutAtSize(rawText, fontSize, input, measure);
      if (fontSize === minFontSize) break;
    }
  }

  let lines = attempt.lines;
  let truncatedLines = false;
  if (input.maxLines && input.maxLines > 0 && lines.length > input.maxLines) {
    lines = lines.slice(0, input.maxLines);
    truncatedLines = true;
  }

  const lineHeightPx = fontSize * lineHeightMult;
  const totalHeight = lines.length * lineHeightPx;
  const overflowHeight = totalHeight > input.height + 0.5;

  const align = input.textAlign || "center";
  const anchor: "start" | "middle" | "end" = align === "left" ? "start" : align === "right" ? "end" : "middle";
  const anchorX = align === "left" ? 0 : align === "right" ? input.width : input.width / 2;

  const vAlign = input.verticalAlign || "middle";
  const firstLineCenterY =
    vAlign === "top"
      ? lineHeightPx / 2
      : vAlign === "bottom"
        ? input.height - totalHeight + lineHeightPx / 2
        : (input.height - totalHeight) / 2 + lineHeightPx / 2;

  const style: MeasureStyle = {
    fontFamily: input.fontFamily,
    fontSize,
    fontWeight: input.fontWeight || "400",
    fontStyle: input.fontStyle || "normal",
    letterSpacing: input.letterSpacing || 0,
  };

  const outLines: TextLayoutLine[] = lines.map((line, index) => ({
    text: line,
    width: measure(line, style),
    x: anchorX,
    y: firstLineCenterY + index * lineHeightPx,
  }));

  return {
    lines: outLines,
    fontSize,
    lineHeightPx,
    totalHeight,
    overflowWidth: attempt.overflowWidth,
    overflowHeight,
    overflowX: attempt.overflowWidth,
    overflowY: overflowHeight,
    unbreakableWord: attempt.unbreakableWord,
    resolvedFontSize: fontSize,
    truncatedLines,
    anchor,
  };
}

export type TextResizeConstraints = {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
  requiredWidth: number;
  requiredHeight: number;
};

// Typography-aware bounds used by both admin and customer resize handles.
// Text is never stretched: resizing changes the box, wrapping, or the resolved
// shrink-to-fit font size.
export function getTextResizeConstraints(input: TextLayoutInput, measure: MeasureFn): TextResizeConstraints {
  const canonicalText = String(input.text ?? "").replace(/\r\n?/g, "\n");
  const rawText = input.uppercase ? canonicalText.toUpperCase() : canonicalText;
  const multiline = input.multiline !== false;
  const lineHeight = Number(input.lineHeight) > 0 ? Number(input.lineHeight) : 1.15;
  const baseFontSize = Math.max(4, Number(input.fontSize) || 16);
  const minFontSize = Math.max(4, Number(input.minFontSize) || Math.min(baseFontSize, 8));
  const width = Math.max(1, Number(input.width) || 1);
  const baseStyle: MeasureStyle = {
    fontFamily: input.fontFamily,
    fontSize: baseFontSize,
    fontWeight: input.fontWeight || "400",
    fontStyle: input.fontStyle || "normal",
    letterSpacing: input.letterSpacing || 0,
  };
  const minStyle = { ...baseStyle, fontSize: minFontSize };
  const singleLineText = rawText.replace(/[\r\n]+/g, " ");
  const chars = Array.from(rawText.replace(/\s/g, ""));
  const widestBaseGlyph = Math.max(1, ...chars.map((char) => measure(char, baseStyle)));
  const widestMinGlyph = Math.max(1, ...chars.map((char) => measure(char, minStyle)));
  const requiredSingleWidth = Math.max(1, measure(singleLineText, baseStyle));
  const requiredAtWidth = layoutText(
    { ...input, width, height: Number.MAX_SAFE_INTEGER, fitMode: "fixed" },
    measure,
  );
  const requiredAtMinSize = layoutText(
    {
      ...input,
      width,
      height: Number.MAX_SAFE_INTEGER,
      fontSize: minFontSize,
      minFontSize,
      fitMode: "fixed",
    },
    measure,
  );

  const shrink = input.fitMode === "shrink";
  const minWidth = multiline
    ? Math.ceil(shrink ? widestMinGlyph : widestBaseGlyph)
    : Math.ceil(shrink ? Math.min(requiredSingleWidth, widestMinGlyph) : requiredSingleWidth);
  const requiredWidth = multiline
    ? Math.ceil(Math.max(1, ...requiredAtWidth.lines.map((line) => line.width)))
    : Math.ceil(requiredSingleWidth);
  const requiredHeight = Math.ceil(requiredAtWidth.totalHeight);
  const minHeight = Math.ceil(
    shrink
      ? Math.max(minFontSize * lineHeight, requiredAtMinSize.totalHeight)
      : Math.max(baseFontSize * lineHeight, requiredHeight),
  );

  return {
    minWidth,
    minHeight,
    maxWidth: Number.POSITIVE_INFINITY,
    maxHeight: Number.POSITIVE_INFINITY,
    requiredWidth,
    requiredHeight,
  };
}

/* --------------------------------------------------------- auto sizing --
 * A text layer's box can either be exactly what was stored, or derived from
 * the measured content. Resolution is deliberately EXPLICIT-ONLY: a layer
 * auto-widths if and only if it carries `autoSizeMode: "width"`.
 *
 * That guarantee is what keeps completed orders safe. Historical order
 * snapshots were written before this field existed, so they carry no
 * autoSizeMode, fall through to the stored box, and render byte-for-byte as
 * they did when ordered. Eligible live templates are migrated separately and
 * persistently (see migrateTextAutoSizing), never inferred at render time.
 */

export const AUTO_SIZE_MODES = ["fixed", "width", "height", "shrink"] as const;
export type AutoSizeMode = (typeof AUTO_SIZE_MODES)[number];

export function getTextAutoSizeMode(style: Record<string, any> | null | undefined): AutoSizeMode {
  const explicit = String(style?.autoSizeMode || "");
  if ((AUTO_SIZE_MODES as ReadonlyArray<string>).includes(explicit)) return explicit as AutoSizeMode;
  // No explicit mode: fall back to the legacy fitMode behaviour unchanged.
  const fitMode = String(style?.fitMode || "fixed");
  if (fitMode === "shrink") return "shrink";
  if (fitMode === "auto-height") return "height";
  return "fixed";
}

// Auto width only ever applies to genuine single-line text.
export function isAutoWidthText(style: Record<string, any> | null | undefined): boolean {
  return !style?.multiline && getTextAutoSizeMode(style) === "width";
}

export type ResolvedTextBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  autoWidth: boolean;
  /** True when the content wanted more room than the safe area allows. */
  clampedBySafeArea: boolean;
};

export type ResolveTextBoxInput = {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight?: string;
  fontStyle?: "normal" | "italic";
  letterSpacing?: number;
  lineHeight?: number;
  uppercase?: boolean;
  multiline?: boolean;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  autoSizeMode?: AutoSizeMode | string;
  fitMode?: string;
};

export type SafeBounds = { left: number; top: number; right: number; bottom: number };

// Breathing room so italic overhang and side bearings are never clipped.
function autoWidthPadding(fontSize: number): number {
  return Math.max(2, Math.ceil(fontSize * 0.12));
}

// Widest the box may become before it would cross the safe area, honouring the
// anchor implied by the alignment.
export function availableTextWidth(
  x: number,
  storedWidth: number,
  textAlign: "left" | "center" | "right",
  safe: SafeBounds,
): number {
  if (textAlign === "left") {
    const left = x - storedWidth / 2;
    return Math.max(1, safe.right - left);
  }
  if (textAlign === "right") {
    const right = x + storedWidth / 2;
    return Math.max(1, right - safe.left);
  }
  // Centred text grows both ways, so the tighter side governs.
  return Math.max(1, 2 * Math.min(x - safe.left, safe.right - x));
}

/**
 * The box a text layer should actually occupy.
 *
 * For auto-width layers the width comes from the measured content (never the
 * stored width, which may be stale), the height follows the font metrics, and
 * the box is re-anchored so the alignment edge stays put: centred text grows
 * evenly, left-aligned text grows rightwards, right-aligned text leftwards.
 * Everything else is returned untouched.
 */
export function resolveTextBox(
  input: ResolveTextBoxInput,
  measure: MeasureFn,
  safeBounds?: SafeBounds | null,
): ResolvedTextBox {
  const stored: ResolvedTextBox = {
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
    autoWidth: false,
    clampedBySafeArea: false,
  };
  const autoWidth = isAutoWidthText(input);
  const autoHeight = getTextAutoSizeMode(input) === "height";
  if (!autoWidth && !autoHeight) return stored;

  if (autoHeight) {
    const layout = layoutText(
      {
        ...input,
        width: Math.max(1, input.width),
        height: Number.MAX_SAFE_INTEGER,
        fitMode: "fixed",
      },
      measure,
    );
    const height = Math.max(1, Math.ceil(layout.totalHeight));
    const vAlign = input.verticalAlign || "middle";
    let y = input.y;
    if (vAlign === "top") y = input.y - input.height / 2 + height / 2;
    else if (vAlign === "bottom") y = input.y + input.height / 2 - height / 2;
    return { ...stored, y, height };
  }

  const fontSize = Math.max(4, Number(input.fontSize) || 16);
  const box = getSingleLineTextBox(
    {
      text: input.text,
      fontFamily: input.fontFamily,
      fontSize,
      fontWeight: input.fontWeight,
      fontStyle: input.fontStyle,
      letterSpacing: input.letterSpacing,
      lineHeight: input.lineHeight,
      uppercase: input.uppercase,
    },
    measure,
  );

  const align = input.textAlign || "center";
  let width = box.width + autoWidthPadding(fontSize);
  let clampedBySafeArea = false;

  if (safeBounds) {
    const available = availableTextWidth(input.x, input.width, align, safeBounds);
    if (width > available) {
      width = available;
      clampedBySafeArea = true;
    }
  }
  width = Math.max(1, Math.round(width));
  const height = Math.max(1, box.height);

  // Re-anchor so the aligned edge does not drift as the text grows. x stays
  // exact: rounding it after rounding the width would shift the anchored edge
  // by half a pixel on odd widths.
  let x = input.x;
  if (align === "left") x = input.x - input.width / 2 + width / 2;
  else if (align === "right") x = input.x + input.width / 2 - width / 2;

  // Same for the vertical edge when the height tightens around the glyphs.
  const vAlign = input.verticalAlign || "middle";
  let y = input.y;
  if (vAlign === "top") y = input.y - input.height / 2 + height / 2;
  else if (vAlign === "bottom") y = input.y + input.height / 2 - height / 2;

  return { x, y, width, height, autoWidth: true, clampedBySafeArea };
}

/**
 * Whether a legacy text layer should be migrated to auto width.
 *
 * Deliberately narrow: only a single-line text layer BOUND TO A CUSTOMER FIELD
 * (Bride, Groom, Couple Names, Venue, Date, …) qualifies — that binding is what
 * makes its length vary with customer input, which is exactly what auto width
 * is for. Note this is a different axis from `customerEditable`, which governs
 * whether the customer may drag and restyle the layer on the canvas; a Bride
 * field is still typed by the customer with canvas manipulation switched off.
 *
 * Paragraph and multiline text, text the admin intentionally set to shrink or
 * auto-height, and decorative text with no field binding are all left exactly
 * as they are, so no historical design is reflowed wholesale.
 */
export function shouldMigrateToAutoWidth(layer: Record<string, any> | null | undefined): boolean {
  if (!layer || layer.type !== "text") return false;
  const style = layer.textStyle || {};
  // Never override a decision that was already made explicitly.
  if (String(style.autoSizeMode || "")) return false;
  if (style.multiline) return false;
  // "shrink" / "auto-height" are intentional admin choices.
  if (String(style.fitMode || "fixed") !== "fixed") return false;
  // Must be driven by customer input rather than being decorative.
  return Boolean(layer.fieldId);
}

// Stamps autoSizeMode onto eligible layers. Pure: returns a new layer array
// only when something actually changed.
export function migrateTextAutoSizing<T extends Record<string, any>>(layers: T[]): T[] {
  let changed = false;
  const next = layers.map((layer) => {
    if (!shouldMigrateToAutoWidth(layer)) return layer;
    changed = true;
    return { ...layer, textStyle: { ...(layer.textStyle || {}), autoSizeMode: "width" } };
  });
  return changed ? next : layers;
}

export type SingleLineTextBox = {
  width: number;
  height: number;
};

export type SingleLineTextScaleInput = {
  text: string;
  x: number;
  y: number;
  fontFamily: string;
  fontSize: number;
  minFontSize?: number;
  maxFontSize?: number;
  fontWeight?: string;
  fontStyle?: "normal" | "italic";
  letterSpacing?: number;
  lineHeight?: number;
  uppercase?: boolean;
  rotation?: number;
  handle: "w" | "e";
  delta: number;
  centered?: boolean;
  safeBounds?: { left: number; top: number; right: number; bottom: number };
};

export type SingleLineTextScaleResult = SingleLineTextBox & {
  x: number;
  y: number;
  fontSize: number;
};

export function isSingleLineAutoSizeText(style: Record<string, unknown> | null | undefined): boolean {
  return !Boolean(style?.multiline) && String(style?.fitMode || "fixed") === "fixed";
}

// Measures the natural, undistorted box for a normal single-line text object.
// Width comes from the real injected font measurer; height follows the selected
// line-height so the document box and the rendered line remain synchronized.
export function getSingleLineTextBox(
  input: Omit<TextLayoutInput, "width" | "height" | "multiline" | "fitMode">,
  measure: MeasureFn,
): SingleLineTextBox {
  const fontSize = Math.max(4, Number(input.fontSize) || 16);
  const lineHeight = Number(input.lineHeight) > 0 ? Number(input.lineHeight) : 1.15;
  const style: MeasureStyle = {
    fontFamily: input.fontFamily,
    fontSize,
    fontWeight: input.fontWeight || "400",
    fontStyle: input.fontStyle || "normal",
    letterSpacing: Number(input.letterSpacing) || 0,
  };
  const text = (input.uppercase ? String(input.text ?? "").toUpperCase() : String(input.text ?? ""))
    .replace(/[\r\n]+/g, " ");
  return {
    width: Math.max(1, Math.ceil(measure(text, style))),
    height: Math.max(1, Math.ceil(fontSize * lineHeight)),
  };
}

function rotatedBoxFitsSafeArea(
  box: SingleLineTextScaleResult,
  rotation: number,
  safe: NonNullable<SingleLineTextScaleInput["safeBounds"]>,
): boolean {
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const halfExtentX = (box.width * cos + box.height * sin) / 2;
  const halfExtentY = (box.width * sin + box.height * cos) / 2;
  return (
    box.x - halfExtentX >= safe.left - 0.5 &&
    box.x + halfExtentX <= safe.right + 0.5 &&
    box.y - halfExtentY >= safe.top - 0.5 &&
    box.y + halfExtentY <= safe.bottom + 0.5
  );
}

// Scales a single-line auto-sized text object by changing its real font size.
// The opposite horizontal edge remains anchored unless centered (Alt/Option)
// scaling is requested. No scaleX/scaleY transform is produced.
export function scaleSingleLineText(
  input: SingleLineTextScaleInput,
  measure: MeasureFn,
): SingleLineTextScaleResult {
  const minFontSize = Math.max(4, Number(input.minFontSize) || 4);
  const maxFontSize = Math.max(minFontSize, Number(input.maxFontSize) || 500);
  const startFontSize = Math.min(maxFontSize, Math.max(minFontSize, Number(input.fontSize) || 16));
  const rotation = Number(input.rotation) || 0;
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const measureAt = (fontSize: number) => getSingleLineTextBox({
    text: input.text,
    fontFamily: input.fontFamily,
    fontSize,
    minFontSize,
    fontWeight: input.fontWeight,
    fontStyle: input.fontStyle,
    letterSpacing: input.letterSpacing,
    lineHeight: input.lineHeight,
    uppercase: input.uppercase,
  }, measure);
  const startBox = measureAt(startFontSize);
  const direction = input.handle === "e" ? 1 : -1;
  const desiredWidth = Math.max(1, startBox.width + direction * input.delta * (input.centered ? 2 : 1));
  const requestedFontSize = Math.min(
    maxFontSize,
    Math.max(minFontSize, Math.round(startFontSize * (desiredWidth / Math.max(1, startBox.width)))),
  );

  const resultAt = (fontSize: number): SingleLineTextScaleResult => {
    const box = measureAt(fontSize);
    const localShift = input.centered
      ? 0
      : (input.handle === "e" ? 1 : -1) * (box.width - startBox.width) / 2;
    return {
      x: Math.round(input.x + localShift * cos),
      y: Math.round(input.y + localShift * sin),
      width: box.width,
      height: box.height,
      fontSize,
    };
  };

  let result = resultAt(requestedFontSize);
  if (
    input.safeBounds &&
    requestedFontSize > startFontSize &&
    !rotatedBoxFitsSafeArea(result, rotation, input.safeBounds)
  ) {
    let low = startFontSize;
    let high = requestedFontSize;
    let best = resultAt(startFontSize);
    while (low <= high) {
      const candidateSize = Math.floor((low + high) / 2);
      const candidate = resultAt(candidateSize);
      if (rotatedBoxFitsSafeArea(candidate, rotation, input.safeBounds)) {
        best = candidate;
        low = candidateSize + 1;
      } else {
        high = candidateSize - 1;
      }
    }
    result = best;
  }
  return result;
}

/* ---------------------------------------------------------------- measurers */

// Approximate per-character width factors relative to font size, used ONLY as
// the last-resort fallback when neither a registered font file nor a canvas is
// available (e.g. server rendering a non-registry system font — which preflight
// flags as an error before it reaches production output).
const FALLBACK_AVG_FACTOR = 0.52;

export function fallbackMeasure(text: string, style: MeasureStyle): number {
  const chars = Array.from(text);
  let width = 0;
  for (const char of chars) {
    if (/[iIl1.,;:'|!\[\]()]/.test(char)) width += style.fontSize * 0.28;
    else if (/[mwMW@]/.test(char)) width += style.fontSize * 0.82;
    else if (char === " ") width += style.fontSize * 0.27;
    else width += style.fontSize * FALLBACK_AVG_FACTOR;
  }
  return width + Math.max(0, chars.length - 1) * (style.letterSpacing || 0);
}

// Canvas-based measurer for the browser. Fonts must be loaded first — await
// document.fonts.ready before trusting results (spec §9).
export function createCanvasMeasure(): MeasureFn {
  if (typeof document === "undefined") return fallbackMeasure;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return fallbackMeasure;
  return (text, style) => {
    ctx.font = `${style.fontStyle === "italic" ? "italic " : ""}${style.fontWeight || "400"} ${style.fontSize}px "${style.fontFamily}"`;
    const width = ctx.measureText(text).width;
    return width + Math.max(0, Array.from(text).length - 1) * (style.letterSpacing || 0);
  };
}

// Measurer backed by parsed opentype.js fonts (shared client/server). Callers
// register parsed fonts keyed by family+weight+style; unknown fonts fall back.
export type ParsedFontLike = {
  unitsPerEm: number;
  charToGlyph: (char: string) => { advanceWidth?: number };
  getKerningValue?: (left: unknown, right: unknown) => number;
};

export function createOpentypeMeasure(
  resolveFont: (style: MeasureStyle) => ParsedFontLike | null,
  fallback: MeasureFn = fallbackMeasure,
): MeasureFn {
  return (text, style) => {
    const font = resolveFont(style);
    if (!font || !font.unitsPerEm) return fallback(text, style);
    const scale = style.fontSize / font.unitsPerEm;
    const chars = Array.from(text);
    let units = 0;
    let prevGlyph: unknown = null;
    for (const char of chars) {
      const glyph = font.charToGlyph(char);
      units += Number(glyph?.advanceWidth) || 0;
      if (prevGlyph && typeof font.getKerningValue === "function") {
        units += font.getKerningValue(prevGlyph, glyph) || 0;
      }
      prevGlyph = glyph;
    }
    return units * scale + Math.max(0, chars.length - 1) * (style.letterSpacing || 0);
  };
}
