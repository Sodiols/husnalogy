/**
 * The artboard: a design's physical size, and the one way to change it.
 *
 * A Husnalogy card has a real printed size. The document carries it three
 * ways — `cardWidthIn`/`cardHeightIn`, `dpi`, and `canvasWidthPx`/
 * `canvasHeightPx` — and they are only meaningful together: the pixel canvas is
 * the printed card at its DPI. Every renderer relies on that. The editors draw
 * the pixel canvas, the print PDF sizes its page from the inches, and a mismatch
 * between them silently stretches the artwork onto the paper.
 *
 * So the size is never edited field by field. `resizeTemplateArtboard` changes
 * the inches and the DPI together, derives the pixels from them, and carries
 * the existing design across WITHOUT distortion: one uniform scale (the
 * largest that keeps every object on the card) about the card centre, so a
 * design moved between sizes with different aspect ratios is never stretched —
 * it is centred, with the difference left as margin.
 *
 * Operates on the flat template shape the Design Studio edits.
 */

import { pageSafeInsets } from "./safe-area";

export type CardSizePreset = {
  id: string;
  label: string;
  /** Portrait width/height in inches; landscape swaps them. */
  widthIn: number;
  heightIn: number;
};

/** The official Husnalogy card sizes. */
export const CARD_SIZE_PRESETS: readonly CardSizePreset[] = [
  { id: "5x7", label: "5 × 7 in", widthIn: 5, heightIn: 7 },
  { id: "3.5x5", label: "3.5 × 5 in", widthIn: 3.5, heightIn: 5 },
];

export const DEFAULT_PRINT_DPI = 300;

/** Inches -> canvas pixels at a DPI. The only place this conversion is made. */
export function canvasPixelsFor(inches: number, dpi: number): number {
  return Math.max(1, Math.round(Number(inches) * Number(dpi)));
}

export type ArtboardSize = { widthIn: number; heightIn: number; dpi: number };

export function artboardOf(template: any): ArtboardSize & { widthPx: number; heightPx: number } {
  const dpi = Number(template?.dpi) > 0 ? Number(template.dpi) : DEFAULT_PRINT_DPI;
  return {
    widthIn: Number(template?.cardWidthIn) > 0 ? Number(template.cardWidthIn) : 5,
    heightIn: Number(template?.cardHeightIn) > 0 ? Number(template.cardHeightIn) : 7,
    dpi,
    widthPx: Number(template?.canvasWidthPx) > 0 ? Number(template.canvasWidthPx) : 1500,
    heightPx: Number(template?.canvasHeightPx) > 0 ? Number(template.canvasHeightPx) : 2100,
  };
}

const sameInches = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** The official size a template uses, in either orientation, or null for a custom size. */
export function matchCardSizePreset(size: { widthIn: number; heightIn: number }): CardSizePreset | null {
  return (
    CARD_SIZE_PRESETS.find(
      (preset) =>
        (sameInches(preset.widthIn, size.widthIn) && sameInches(preset.heightIn, size.heightIn)) ||
        (sameInches(preset.widthIn, size.heightIn) && sameInches(preset.heightIn, size.widthIn)),
    ) || null
  );
}

/** True when the pixel canvas is exactly the printed card at its DPI. */
export function isArtboardConsistent(template: any): boolean {
  const board = artboardOf(template);
  return (
    board.widthPx === canvasPixelsFor(board.widthIn, board.dpi) &&
    board.heightPx === canvasPixelsFor(board.heightIn, board.dpi)
  );
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const num = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const scaled = (value: unknown, factor: number) => (value === undefined || value === null || value === "" ? value : round2(num(value) * factor));

/**
 * Scale everything a layer draws in DOCUMENT PIXELS by `factor`: type sizes,
 * letter spacing, stroke and border widths, corner radii, grid spacing and the
 * photo's in-frame offsets. Ratios — normalised crop rects, grid slot rects,
 * polygon points, opacity, line height, zoom — are scale-free and untouched.
 * Box geometry (x/y/width/height) is the caller's: it depends on the mapping.
 */
export function scaleLayerContent(layer: any, factor: number): any {
  if (!layer || typeof layer !== "object" || factor === 1) return layer;
  const next: any = { ...layer };
  if (layer.textStyle && typeof layer.textStyle === "object") {
    next.textStyle = {
      ...layer.textStyle,
      ...(layer.textStyle.fontSize !== undefined ? { fontSize: scaled(layer.textStyle.fontSize, factor) } : {}),
      ...(layer.textStyle.minFontSize !== undefined ? { minFontSize: scaled(layer.textStyle.minFontSize, factor) } : {}),
      ...(layer.textStyle.maxFontSize !== undefined ? { maxFontSize: scaled(layer.textStyle.maxFontSize, factor) } : {}),
      ...(layer.textStyle.letterSpacing !== undefined ? { letterSpacing: scaled(layer.textStyle.letterSpacing, factor) } : {}),
    };
  }
  for (const key of ["strokeWidth", "borderWidth", "borderRadius", "gap", "padding", "cornerRadius"]) {
    if (layer[key] !== undefined) next[key] = scaled(layer[key], factor);
  }
  if (layer.mask && typeof layer.mask === "object" && layer.mask.radius !== undefined) {
    next.mask = { ...layer.mask, radius: scaled(layer.mask.radius, factor) };
  }
  const scaleCrop = (transform: any) =>
    transform && typeof transform === "object"
      ? {
          ...transform,
          ...(transform.offsetX !== undefined ? { offsetX: scaled(transform.offsetX, factor) } : {}),
          ...(transform.offsetY !== undefined ? { offsetY: scaled(transform.offsetY, factor) } : {}),
        }
      : transform;
  if (layer.imageTransform) next.imageTransform = scaleCrop(layer.imageTransform);
  if (layer.transform && typeof layer.transform === "object") next.transform = scaleCrop(layer.transform);
  if (Array.isArray(layer.slots)) {
    next.slots = layer.slots.map((slot: any) => (slot && slot.transform ? { ...slot, transform: scaleCrop(slot.transform) } : slot));
  }
  return next;
}

const scaleInsets = (insets: any, factor: number) =>
  insets && typeof insets === "object"
    ? Object.fromEntries(Object.entries(insets).map(([side, value]) => [side, round2(num(value) * factor)]))
    : insets;

export type CardOrientation = "portrait" | "landscape" | "square";

/** The orientation a card's DIMENSIONS have — the one source of truth. */
export function orientationOf(size: { widthIn: number; heightIn: number }): CardOrientation {
  if (sameInches(size.widthIn, size.heightIn)) return "square";
  return size.widthIn > size.heightIn ? "landscape" : "portrait";
}

type ArtboardMapping = {
  widthIn: number;
  heightIn: number;
  dpi: number;
  /** Uniform design scale; the mapping is `x' = x * scale + offsetX`. */
  scale: number;
  offsetX: number;
  offsetY: number;
};

/**
 * Apply ONE uniform mapping to everything a design positions in document
 * pixels. Size changes and orientation changes differ only in the mapping they
 * choose; how a layer, a guide or a margin moves is decided here, once.
 */
function applyArtboardMapping(template: any, mapping: ArtboardMapping): any {
  const from = artboardOf(template);
  const { widthIn, heightIn, dpi, scale, offsetX, offsetY } = mapping;
  const widthPx = canvasPixelsFor(widthIn, dpi);
  const heightPx = canvasPixelsFor(heightIn, dpi);
  // Safe area and bleed are PRINT margins: the same physical distance on any
  // card, so they follow the DPI, not the design.
  const marginFactor = dpi / from.dpi;

  const layers = (Array.isArray(template?.layers) ? template.layers : []).map((layer: any) => {
    if (layer?.type === "background") {
      // A background covers the page, whatever its proportions.
      return { ...layer, x: widthPx / 2, y: heightPx / 2, width: widthPx, height: heightPx };
    }
    return {
      ...scaleLayerContent(layer, scale),
      x: round2(num(layer?.x) * scale + offsetX),
      y: round2(num(layer?.y) * scale + offsetY),
      width: round2(num(layer?.width) * scale),
      height: round2(num(layer?.height) * scale),
    };
  });

  const guides = (Array.isArray(template?.guides) ? template.guides : []).map((guide: any) => ({
    ...guide,
    position: round2(num(guide?.position) * scale + (guide?.axis === "vertical" ? offsetX : offsetY)),
  }));

  const pages = (Array.isArray(template?.pages) ? template.pages : []).map((page: any) => {
    const next: any = { ...page };
    // A page that carried its own size follows the card; one that did not keeps
    // inheriting it.
    if (page?.widthPx !== undefined) next.widthPx = widthPx;
    if (page?.heightPx !== undefined) next.heightPx = heightPx;
    if (page?.widthIn !== undefined) next.widthIn = widthIn;
    if (page?.heightIn !== undefined) next.heightIn = heightIn;
    if (page?.dpi !== undefined) next.dpi = dpi;
    if (page?.safeArea) next.safeArea = scaleInsets(page.safeArea, marginFactor);
    if (page?.bleed) next.bleed = scaleInsets(page.bleed, marginFactor);
    return next;
  });

  const settings = template?.settings && typeof template.settings === "object" ? { ...template.settings } : template?.settings;
  if (settings?.customerObjectLimits && typeof settings.customerObjectLimits === "object") {
    const limits = { ...settings.customerObjectLimits };
    for (const key of ["minWidth", "maxWidth", "minHeight", "maxHeight", "insetLeft", "insetTop", "insetRight", "insetBottom"]) {
      if (num(limits[key]) > 0) limits[key] = round2(num(limits[key]) * scale);
    }
    settings.customerObjectLimits = limits;
  }

  return {
    ...template,
    cardWidthIn: widthIn,
    cardHeightIn: heightIn,
    dpi,
    canvasWidthPx: widthPx,
    canvasHeightPx: heightPx,
    // Derived from the dimensions, so the label can never disagree with them.
    orientation: orientationOf({ widthIn, heightIn }),
    layers,
    guides,
    pages,
    safeArea: scaleInsets(template?.safeArea, marginFactor),
    bleed: scaleInsets(template?.bleed, marginFactor),
    ...(settings !== undefined ? { settings } : {}),
  };
}

/**
 * Change a template's printed size (and/or DPI) and carry the design across.
 *
 * Returns the new template and the mapping applied, so the caller can show it
 * and an undo step can restore the previous template whole.
 */
export function resizeTemplateArtboard(
  template: any,
  target: ArtboardSize,
): { template: any; scale: number; offsetX: number; offsetY: number } {
  const from = artboardOf(template);
  const dpi = Number(target.dpi) > 0 ? Math.round(Number(target.dpi)) : from.dpi;
  const widthIn = Number(target.widthIn) > 0 ? Number(target.widthIn) : from.widthIn;
  const heightIn = Number(target.heightIn) > 0 ? Number(target.heightIn) : from.heightIn;
  const widthPx = canvasPixelsFor(widthIn, dpi);
  const heightPx = canvasPixelsFor(heightIn, dpi);

  // Uniform: the largest scale that keeps the whole old canvas on the new one.
  const scale = Math.min(widthPx / from.widthPx, heightPx / from.heightPx);
  const offsetX = (widthPx - from.widthPx * scale) / 2;
  const offsetY = (heightPx - from.heightPx * scale) / 2;
  return {
    template: applyArtboardMapping(template, { widthIn, heightIn, dpi, scale, offsetX, offsetY }),
    scale,
    offsetX,
    offsetY,
  };
}

/** The axis-aligned box a layer actually covers, rotation included. */
function layerBounds(layer: any) {
  const halfW = Math.abs(num(layer?.width)) / 2;
  const halfH = Math.abs(num(layer?.height)) / 2;
  const radians = (num(layer?.rotation) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const extentX = halfW * cos + halfH * sin;
  const extentY = halfW * sin + halfH * cos;
  const x = num(layer?.x);
  const y = num(layer?.y);
  return { left: x - extentX, right: x + extentX, top: y - extentY, bottom: y + extentY };
}

/**
 * The box every drawn object occupies — backgrounds (which cover any page) and
 * group containers (whose members are counted themselves) excluded. Null for a
 * design with nothing to place.
 */
export function designContentBounds(layers: readonly any[]) {
  let bounds: { left: number; right: number; top: number; bottom: number } | null = null;
  for (const layer of layers) {
    if (!layer || layer.type === "background" || layer.type === "group") continue;
    const box = layerBounds(layer);
    bounds = bounds
      ? {
          left: Math.min(bounds.left, box.left),
          right: Math.max(bounds.right, box.right),
          top: Math.min(bounds.top, box.top),
          bottom: Math.max(bounds.bottom, box.bottom),
        }
      : box;
  }
  return bounds;
}

/**
 * Turn the card between Portrait and Landscape.
 *
 * The card's printed dimensions swap (5 × 7 portrait becomes 7 × 5 landscape:
 * 1500 × 2100 px becomes 2100 × 1500 px) and the design comes across as ONE
 * rigid unit — never distorted, never rotated, never rearranged:
 *
 *  - every object keeps its size, its rotation and its place relative to the
 *    others, and the whole design is centred on the new card;
 *  - it is scaled down — uniformly — only if it would no longer fit inside the
 *    new card's safe area, and never scaled up;
 *  - backgrounds cover the new page; guides move with the design; print
 *    margins keep their physical size.
 *
 * Returns the same template when the card already has that orientation. A
 * square card has no portrait or landscape to switch to.
 */
export function changeTemplateOrientation(
  template: any,
  target: "portrait" | "landscape",
): { template: any; scale: number; offsetX: number; offsetY: number } {
  const from = artboardOf(template);
  const current = orientationOf(from);
  if (current === "square" || current === target) return { template, scale: 1, offsetX: 0, offsetY: 0 };

  const widthIn = from.heightIn;
  const heightIn = from.widthIn;
  const widthPx = canvasPixelsFor(widthIn, from.dpi);
  const heightPx = canvasPixelsFor(heightIn, from.dpi);

  const layers = Array.isArray(template?.layers) ? template.layers : [];
  const content = designContentBounds(layers);
  // Every page's own safe area counts (Front and Back may differ): the design
  // is fitted inside the tightest one so nothing crosses any page's line.
  const pageIds = (Array.isArray(template?.pages) && template.pages.length ? template.pages : [null]).map((page: any) => page?.id ?? null);
  const safe = pageIds.reduce(
    (acc: any, id: string | null) => {
      const own = pageSafeInsets(template, id);
      return {
        left: Math.max(acc.left, own.left),
        right: Math.max(acc.right, own.right),
        top: Math.max(acc.top, own.top),
        bottom: Math.max(acc.bottom, own.bottom),
      };
    },
    { left: 0, right: 0, top: 0, bottom: 0 },
  );
  const availableW = Math.max(1, widthPx - num(safe.left) - num(safe.right));
  const availableH = Math.max(1, heightPx - num(safe.top) - num(safe.bottom));

  let scale = 1;
  let centreX = from.widthPx / 2;
  let centreY = from.heightPx / 2;
  if (content) {
    const contentW = Math.max(1e-6, content.right - content.left);
    const contentH = Math.max(1e-6, content.bottom - content.top);
    scale = Math.min(1, availableW / contentW, availableH / contentH);
    centreX = (content.left + content.right) / 2;
    centreY = (content.top + content.bottom) / 2;
  }
  const offsetX = widthPx / 2 - centreX * scale;
  const offsetY = heightPx / 2 - centreY * scale;
  return {
    template: applyArtboardMapping(template, { widthIn, heightIn, dpi: from.dpi, scale, offsetX, offsetY }),
    scale,
    offsetX,
    offsetY,
  };
}
