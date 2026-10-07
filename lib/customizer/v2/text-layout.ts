// Husnalogy text layout service (spec §9).
//
// ONE layout implementation shared by the admin canvas, customer canvas, page
// thumbnails, review preview, server preview renderer, and print renderer.
// Layout decisions (line breaks, shrink-to-fit size, line positions) are made
// here from injected font measurements, so every surface renders the same
// breaks. SVG has no automatic wrapping — each output line becomes one
// positioned <tspan>/<text>, which resvg and browsers draw identically.

import { anchorGrownTextBox, normalizeTextGrowthDirection, type TextGrowthDirection } from "./text-growth";

/**
 * Product defaults for new text, shared by every surface that creates,
 * normalizes or resets a text object so "the default" is one number rather
 * than a literal repeated across a dozen modules.
 *
 * Render-time fallbacks for a MISSING letter spacing stay at 0 ("no extra
 * spacing"), which is a different question from what a new object starts with.
 */
export const DEFAULT_LINE_HEIGHT = 1;
export const DEFAULT_LETTER_SPACING = 1;

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

function canonicalLayoutText(value: unknown): string {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}

function usesMultilineLayout(text: string, configuredMultiline: boolean | undefined): boolean {
  // A real newline is authoritative. This renderer-level invariant protects
  // every surface (canvas, preview, PNG and PDF), including restored legacy
  // documents whose old single-line flag was not promoted when the text saved.
  return configuredMultiline !== false || text.includes("\n");
}

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

  const canonicalText = canonicalLayoutText(text);
  const paragraphs = canonicalText.split("\n");
  const multiline = usesMultilineLayout(canonicalText, input.multiline);
  const unbreakableWord =
    multiline &&
    paragraphs.some((paragraph) =>
      paragraph
        .split(/\s+/)
        .filter(Boolean)
        .some((word) => measure(word, style) > input.width + 0.5),
    );
  let lines: string[];
  if (!multiline) {
    // No manual break is present here (one would have promoted multiline).
    lines = [canonicalText];
  } else {
    lines = paragraphs.flatMap((p) => wrapParagraph(p, input.width, style, measure));
  }

  const widths = lines.map((line) => measure(line, style));
  const overflowWidth = widths.some((w) => w > input.width + 0.5);
  return { lines, widths, overflowWidth, unbreakableWord };
}

export function layoutText(input: TextLayoutInput, measure: MeasureFn): TextLayoutResult {
  const canonicalText = canonicalLayoutText(input.text);
  const rawText = input.uppercase ? canonicalText.toUpperCase() : canonicalText;
  const lineHeightMult = Number(input.lineHeight) > 0 ? Number(input.lineHeight) : DEFAULT_LINE_HEIGHT;
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
  const canonicalText = canonicalLayoutText(input.text);
  const rawText = input.uppercase ? canonicalText.toUpperCase() : canonicalText;
  const multiline = usesMultilineLayout(rawText, input.multiline);
  const lineHeight = Number(input.lineHeight) > 0 ? Number(input.lineHeight) : DEFAULT_LINE_HEIGHT;
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
  const singleLineText = rawText;
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

export const AUTO_SIZE_MODES = ["fixed", "width", "height", "shrink", "safe-width"] as const;
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

/**
 * "safe-width" — the default for NEW text: the box is the words (its widest
 * line), growing as they are typed, until it would cross the page's safe area;
 * from there it keeps that maximum width and wraps at word boundaries, growing
 * in height (in its growth direction). Manual line breaks are kept, and
 * deleting text shrinks it back. It never freezes a width of its own, so no
 * edit can leave it wrapping inside a narrow box.
 *
 * A separate mode rather than a change to "width", whose clamped text shrinks:
 * layers and order snapshots made with "width" keep rendering exactly as made.
 */
export function isSafeWidthText(style: Record<string, any> | null | undefined): boolean {
  return getTextAutoSizeMode(style) === "safe-width";
}

/**
 * How a renderer lays out a text layer inside its RESOLVED box — one rule for
 * the studio canvas, the customer editor, previews and the server render.
 */
export function resolvedTextLayoutMode(
  style: Record<string, any> | null | undefined,
  clampedBySafeArea: boolean,
): { multiline: boolean; fitMode: "fixed" | "shrink" | "auto-height" } {
  if (isSafeWidthText(style)) return { multiline: true, fitMode: "fixed" };
  return {
    multiline: Boolean(style?.multiline),
    fitMode: clampedBySafeArea && !style?.multiline
      ? "shrink"
      : style?.fitMode === "shrink" ? "shrink" : style?.fitMode === "auto-height" ? "auto-height" : "fixed",
  };
}

/** The page's safe area in document px: the one bound auto-sized text grows to. */
export function templateSafeBounds(template: any): SafeBounds {
  const safe = template?.safeArea || {};
  const width = Number(template?.canvasWidthPx) || 1500;
  const height = Number(template?.canvasHeightPx) || 2100;
  return {
    left: Number(safe.left) || 0,
    top: Number(safe.top) || 0,
    right: width - (Number(safe.right) || 0),
    bottom: height - (Number(safe.bottom) || 0),
  };
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
  /** Degrees; the growth anchor is held in the box's own rotated frame. */
  rotation?: number;
  /** Which edge holds still when the text gets taller (lib/customizer/v2/text-growth). */
  growthDirection?: TextGrowthDirection | string;
};

export type SafeBounds = { left: number; top: number; right: number; bottom: number };

// Breathing room so italic overhang and side bearings are never clipped.
export function autoWidthPadding(fontSize: number): number {
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
  if (isSafeWidthText(input)) return resolveSafeWidthBox(input, measure, safeBounds);
  const canonicalText = canonicalLayoutText(input.text);
  const manualMultiline = canonicalText.includes("\n");
  const autoWidth = !manualMultiline && isAutoWidthText(input);
  const autoHeight = manualMultiline || getTextAutoSizeMode(input) === "height";
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
    const growth = normalizeTextGrowthDirection(input.growthDirection);
    if (growth) {
      const anchored = anchorGrownTextBox({ x: input.x, y: input.y, fromHeight: input.height, toHeight: height, rotation: input.rotation, growth });
      return { ...stored, x: anchored.x, y: anchored.y, height };
    }
    // Without a growth direction (documents made before it existed) growing
    // text is top-anchored. The element's visible top edge stays fixed
    // while its centre moves down by half the height delta; selection bounds
    // and resize handles consume this same resolved geometry.
    const y = input.y - input.height / 2 + height / 2;
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
  // Renderers space after EVERY glyph, the last included, and centre or
  // right-align on that full advance; the box makes room for that trailing
  // gap so wide letter spacing never pushes the first glyph out of it.
  let width = box.width + autoWidthPadding(fontSize) + Math.max(0, Number(input.letterSpacing) || 0);
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

  // The growth direction decides which edge holds when the height changes.
  const growth = normalizeTextGrowthDirection(input.growthDirection);
  if (growth) {
    const anchored = anchorGrownTextBox({ x, y: input.y, fromHeight: input.height, toHeight: height, rotation: input.rotation, growth });
    return { x: anchored.x, y: anchored.y, width, height, autoWidth: true, clampedBySafeArea };
  }

  // Without one (older documents), the vertical alignment edge holds.
  const vAlign = input.verticalAlign || "middle";
  let y = input.y;
  if (vAlign === "top") y = input.y - input.height / 2 + height / 2;
  else if (vAlign === "bottom") y = input.y + input.height / 2 - height / 2;

  return { x, y, width, height, autoWidth: true, clampedBySafeArea };
}

/**
 * The "safe-width" box: the widest line's own width (plus the auto-width
 * allowance), capped at the width the safe area leaves from this position and
 * alignment; past the cap the words wrap and the box grows in height. The
 * aligned edge holds horizontally, the growth direction vertically — the same
 * anchoring as auto width and auto height.
 */
function resolveSafeWidthBox(input: ResolveTextBoxInput, measure: MeasureFn, safeBounds?: SafeBounds | null): ResolvedTextBox {
  const fontSize = Math.max(4, Number(input.fontSize) || 16);
  const widest = getSingleLineTextBox(
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
  ).width;
  // Renderers space after the last glyph too: room for it, as for auto width.
  const natural = widest + autoWidthPadding(fontSize) + Math.max(0, Number(input.letterSpacing) || 0);
  const align = input.textAlign || "center";
  const available = safeBounds ? availableTextWidth(input.x, input.width, align, safeBounds) : Number.POSITIVE_INFINITY;
  const clampedBySafeArea = natural > available;
  const width = Math.max(1, Math.round(Math.min(natural, available)));
  const layout = layoutText(
    { ...input, fontSize, width, height: Number.MAX_SAFE_INTEGER, multiline: true, fitMode: "fixed" },
    measure,
  );
  const height = Math.max(1, Math.ceil(layout.totalHeight));

  let x = input.x;
  if (align === "left") x = input.x - input.width / 2 + width / 2;
  else if (align === "right") x = input.x + input.width / 2 - width / 2;

  const growth = normalizeTextGrowthDirection(input.growthDirection);
  if (growth) {
    const anchored = anchorGrownTextBox({ x, y: input.y, fromHeight: input.height, toHeight: height, rotation: input.rotation, growth });
    return { x: anchored.x, y: anchored.y, width, height, autoWidth: true, clampedBySafeArea };
  }
  // No growth direction: the top edge holds, as for paragraphs.
  return { x, y: input.y - input.height / 2 + height / 2, width, height, autoWidth: true, clampedBySafeArea };
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

export function isSingleLineAutoSizeText(
  style: Record<string, unknown> | null | undefined,
  text?: unknown,
): boolean {
  return (
    !Boolean(style?.multiline) &&
    !canonicalLayoutText(text).includes("\n") &&
    String(style?.fitMode || "fixed") === "fixed"
  );
}

// Measures the natural, undistorted box for a normal single-line text object.
// Width comes from the real injected font measurer; height follows the selected
// line-height so the document box and the rendered line remain synchronized.
export function getSingleLineTextBox(
  input: Omit<TextLayoutInput, "width" | "height" | "multiline" | "fitMode">,
  measure: MeasureFn,
): SingleLineTextBox {
  const fontSize = Math.max(4, Number(input.fontSize) || 16);
  const lineHeight = Number(input.lineHeight) > 0 ? Number(input.lineHeight) : DEFAULT_LINE_HEIGHT;
  const style: MeasureStyle = {
    fontFamily: input.fontFamily,
    fontSize,
    fontWeight: input.fontWeight || "400",
    fontStyle: input.fontStyle || "normal",
    letterSpacing: Number(input.letterSpacing) || 0,
  };
  const text = canonicalLayoutText(
    input.uppercase ? String(input.text ?? "").toUpperCase() : String(input.text ?? ""),
  );
  const measuredWidth = Math.max(
    1,
    ...text.split("\n").map((line) => measure(line, style)),
  );
  return {
    width: Math.max(1, Math.ceil(measuredWidth)),
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

export type TextBoxScaleInput = {
  /** Corner handle being dragged: "nw" | "ne" | "sw" | "se". */
  handle: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  letterSpacing?: number;
  /** Pointer travel in document units since the drag started. */
  deltaX: number;
  deltaY: number;
  minFontSize?: number;
  maxFontSize?: number;
};

export type TextBoxScaleResult = {
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  letterSpacing: number;
};

/**
 * Corner-drag scaling for a text object: the GLYPHS grow, not just the frame.
 *
 * Dragging a corner applies one uniform factor to the box, the font size and
 * the letter spacing, anchored on the opposite corner — the behaviour every
 * professional editor gives a corner handle. Side handles keep resizing the
 * box alone, which is how the wrap width and the block height are set.
 *
 * Pure geometry: no measurement is needed because the factor comes from the
 * pointer, and the renderers re-resolve the real text box afterwards.
 */
export function scaleTextBox(input: TextBoxScaleInput): TextBoxScaleResult {
  const startWidth = Math.max(1, Number(input.width) || 1);
  const startHeight = Math.max(1, Number(input.height) || 1);
  const minFontSize = Math.max(1, Number(input.minFontSize) || 4);
  const maxFontSize = Math.max(minFontSize, Number(input.maxFontSize) || 500);
  const startFontSize = Math.min(maxFontSize, Math.max(minFontSize, Number(input.fontSize) || 16));

  const signX = input.handle.includes("e") ? 1 : input.handle.includes("w") ? -1 : 0;
  const signY = input.handle.includes("s") ? 1 : input.handle.includes("n") ? -1 : 0;

  // The factor is the pointer's travel projected onto the box diagonal that
  // runs from the anchored corner to the dragged one. That is continuous in
  // both axes — no jump when a diagonal drag changes which axis dominates —
  // and it is exact whenever the pointer moves along the diagonal itself,
  // which is the direction the corner cursor invites.
  const deltaX = Number(input.deltaX) || 0;
  const deltaY = Number(input.deltaY) || 0;
  const diagonalX = signX * startWidth;
  const diagonalY = signY * startHeight;
  const diagonalLengthSquared = diagonalX * diagonalX + diagonalY * diagonalY;
  const requested = diagonalLengthSquared > 0
    ? 1 + (deltaX * diagonalX + deltaY * diagonalY) / diagonalLengthSquared
    : 1;
  const factor = Math.min(
    maxFontSize / startFontSize,
    Math.max(minFontSize / startFontSize, requested),
  );

  const width = Math.max(1, Math.round(startWidth * factor));
  const height = Math.max(1, Math.round(startHeight * factor));
  const left = input.x - startWidth / 2;
  const right = input.x + startWidth / 2;
  const top = input.y - startHeight / 2;
  const bottom = input.y + startHeight / 2;

  return {
    x: Math.round(signX < 0 ? right - width / 2 : signX > 0 ? left + width / 2 : input.x),
    y: Math.round(signY < 0 ? bottom - height / 2 : signY > 0 ? top + height / 2 : input.y),
    width,
    height,
    fontSize: Math.min(maxFontSize, Math.max(minFontSize, Math.round(startFontSize * factor))),
    // Letter spacing is stored in px, so it has to travel with the font size
    // or the wording visibly loosens as the text grows.
    letterSpacing: Number(((Number(input.letterSpacing) || 0) * factor).toFixed(2)),
  };
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

/**
 * The growth direction a text object actually behaves with. An explicit choice
 * wins; without one it is what the object has always done — auto-height text
 * grows downward, and a single line keeps its vertical-alignment edge — so the
 * control shows the truth for documents made before the property existed.
 */
export function effectiveTextGrowth(style: Record<string, any> | null | undefined, text: unknown): TextGrowthDirection {
  const explicit = normalizeTextGrowthDirection(style?.growthDirection);
  if (explicit) return explicit;
  const autoHeight = canonicalLayoutText(String(text ?? "")).includes("\n") || getTextAutoSizeMode(style || {}) === "height";
  if (autoHeight) return "down";
  return style?.verticalAlign === "top" ? "down" : style?.verticalAlign === "bottom" ? "up" : "center";
}
