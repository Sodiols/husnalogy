// Non-destructive eraser for photo layers.
//
// The picture file is never touched. A photo's `eraseMask` is a list of brush
// strokes that both renderers (the browser preview and the server/print SVG)
// turn into an SVG <mask> over the drawn picture, so erased areas become
// transparent everywhere the design is shown or printed.
//
// Coordinates are normalized to the picture's DRAW BOX — the rectangle the
// shared crop formula (image-crop.ts) places the picture in — so the marks stay
// on the same part of the picture when it is panned, zoomed, cropped, flipped,
// rotated inside its frame, or when the layer is moved, resized or rotated.
// Brush widths are a fraction of the draw box's shorter side.

export type EraseStroke = {
  /** Brush diameter as a fraction of the draw box's shorter side. */
  size: number;
  /** Flat list of normalized points: x0, y0, x1, y1, … */
  points: number[];
};

export type EraseMask = { strokes: EraseStroke[] };

export const ERASE_LIMITS = {
  /** Strokes per photo. */
  maxStrokes: 500,
  /** Points per photo, across every stroke. */
  maxPoints: 40000,
  minSize: 0.001,
  maxSize: 2,
  /** Normalized coordinates outside this range cannot affect the picture. */
  minCoordinate: -1,
  maxCoordinate: 2,
} as const;

const round4 = (value: number) => Math.round(value * 10000) / 10000;

/**
 * A stored eraser mask, cleaned: finite, rounded, in range, and within the
 * limits. Returns null when nothing usable remains, so an empty mask is never
 * stored or drawn.
 */
export function normalizeEraseMask(input: unknown): EraseMask | null {
  if (!input || typeof input !== "object") return null;
  const rawStrokes = Array.isArray((input as any).strokes) ? (input as any).strokes : [];
  const strokes: EraseStroke[] = [];
  let budget: number = ERASE_LIMITS.maxPoints;
  for (const raw of rawStrokes.slice(0, ERASE_LIMITS.maxStrokes)) {
    if (!raw || typeof raw !== "object" || budget <= 0) continue;
    const size = Number(raw.size);
    if (!Number.isFinite(size) || size < ERASE_LIMITS.minSize) continue;
    const flat = Array.isArray(raw.points) ? raw.points : [];
    const points: number[] = [];
    for (let index = 0; index + 1 < flat.length && points.length / 2 < budget; index += 2) {
      const x = Number(flat[index]);
      const y = Number(flat[index + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push(
        round4(Math.min(ERASE_LIMITS.maxCoordinate, Math.max(ERASE_LIMITS.minCoordinate, x))),
        round4(Math.min(ERASE_LIMITS.maxCoordinate, Math.max(ERASE_LIMITS.minCoordinate, y))),
      );
    }
    if (!points.length) continue;
    budget -= points.length / 2;
    strokes.push({ size: round4(Math.min(ERASE_LIMITS.maxSize, size)), points });
  }
  return strokes.length ? { strokes } : null;
}

export type DrawBox = { x: number; y: number; width: number; height: number };

/** The SVG path and stroke width of every stroke, in the draw box's own coordinates. */
export function eraseStrokePaths(mask: EraseMask | null | undefined, draw: DrawBox): Array<{ d: string; width: number }> {
  if (!mask?.strokes?.length || !(draw.width > 0) || !(draw.height > 0)) return [];
  const shorter = Math.min(draw.width, draw.height);
  const fmt = (value: number) => String(Math.round(value * 100) / 100);
  return mask.strokes.map((stroke) => {
    const parts: string[] = [];
    for (let index = 0; index + 1 < stroke.points.length; index += 2) {
      const x = draw.x + stroke.points[index] * draw.width;
      const y = draw.y + stroke.points[index + 1] * draw.height;
      parts.push(`${index === 0 ? "M" : "L"}${fmt(x)} ${fmt(y)}`);
    }
    // A single dab: a hair-length segment, so round caps draw a dot in every renderer.
    if (parts.length === 1) parts.push("l0.01 0");
    return { d: parts.join(" "), width: Math.max(0.5, stroke.size * shorter) };
  });
}

/**
 * Whether a photo's eraser marks apply to the picture being drawn: only to the
 * layer's OWN picture. A customer's replacement photo is a different picture,
 * and marks made on the template's picture must not punch holes in it. Decided
 * by whose picture it is, never by comparing URLs — a renewed signed URL is
 * still the same picture.
 */
export function eraseMaskAppliesTo(layer: { eraseMask?: unknown }, image: { source?: string } | null | undefined): boolean {
  return Boolean(layer.eraseMask && image?.source === "layer");
}

/**
 * A canvas point (document units) as a normalized point in a photo's draw box —
 * the inverse of how both renderers place the picture: the layer's rotation
 * about its centre, then the picture's in-frame rotation and flips about that
 * same centre.
 */
export function canvasPointToDrawBox(
  point: { x: number; y: number },
  layer: { x: number; y: number; rotation?: number },
  picture: { imageRotation?: number; flipX?: boolean; flipY?: boolean },
  draw: DrawBox,
): { x: number; y: number } {
  const cx = Number(layer.x) || 0;
  const cy = Number(layer.y) || 0;
  const unrotate = (px: number, py: number, degrees: number) => {
    if (!degrees) return { x: px, y: py };
    const radians = (-degrees * Math.PI) / 180;
    const dx = px - cx;
    const dy = py - cy;
    return { x: cx + dx * Math.cos(radians) - dy * Math.sin(radians), y: cy + dx * Math.sin(radians) + dy * Math.cos(radians) };
  };
  let local = unrotate(point.x, point.y, Number(layer.rotation) || 0);
  local = unrotate(local.x, local.y, Number(picture.imageRotation) || 0);
  if (picture.flipX) local = { x: 2 * cx - local.x, y: local.y };
  if (picture.flipY) local = { x: local.x, y: 2 * cy - local.y };
  return { x: (local.x - draw.x) / draw.width, y: (local.y - draw.y) / draw.height };
}
