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
  fitMode?: "fixed" | "shrink";
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
): { lines: string[]; widths: number[]; overflowWidth: boolean } {
  const style: MeasureStyle = {
    fontFamily: input.fontFamily,
    fontSize,
    fontWeight: input.fontWeight || "400",
    fontStyle: input.fontStyle || "normal",
    letterSpacing: input.letterSpacing || 0,
  };

  const paragraphs = String(text).split("\n");
  let lines: string[];
  if (input.multiline === false) {
    // Single-line mode: manual breaks collapse to spaces, no wrapping.
    lines = [paragraphs.join(" ")];
  } else {
    lines = paragraphs.flatMap((p) => wrapParagraph(p, input.width, style, measure));
  }

  const widths = lines.map((line) => measure(line, style));
  const overflowWidth = widths.some((w) => w > input.width + 0.5);
  return { lines, widths, overflowWidth };
}

export function layoutText(input: TextLayoutInput, measure: MeasureFn): TextLayoutResult {
  const rawText = input.uppercase ? String(input.text ?? "").toUpperCase() : String(input.text ?? "");
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
    truncatedLines,
    anchor,
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
