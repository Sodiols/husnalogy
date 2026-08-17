/**
 * The boundary between Konva's interaction representation and Husnalogy's
 * document geometry (spec §8, §71).
 *
 * Konva expresses a live transform as `scaleX` / `scaleY` on a node. Husnalogy
 * stores normalised design geometry — centre `x`/`y`, `width`, `height`,
 * `rotation` — because that is what the SVG renderer, the server renderer, the
 * preflight rules and the print pipeline all read.
 *
 * If a raw Konva node were ever written into the document, two things would
 * break, both silently and permanently:
 *
 *   1. Scale accumulates. A layer dragged five times would carry
 *      `scaleX: 1.0001 * 1.02 * ...` forever, and every consumer that reads
 *      `width` would disagree with what is on screen.
 *   2. Text would stretch. A glyph scaled by 1.4 on one axis is a distorted
 *      typeface, not a larger one — Husnalogy resizes type by changing
 *      `fontSize` (spec §23).
 *
 * So: Konva owns the gesture, this module owns the translation, and the
 * document only ever receives normalised Husnalogy values. Every function here
 * is pure and takes plain objects, so the rules are testable without a canvas.
 */

export type KonvaNodeGeometry = {
  /** Node position. With a centred offset this is the object's CENTRE. */
  x: number;
  y: number;
  /** Untransformed node size, i.e. the size before scale is applied. */
  width: number;
  height: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
};

export type HusnalogyGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

/** Smallest object either surface allows, matching the legacy resize clamps. */
export const MIN_OBJECT_SIZE = 24;

const finite = (value: unknown, fallback = 0): number => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

/** Rotation folded into 0–359, the range the document stores. */
export function normalizeRotation(rotation: unknown): number {
  const value = finite(rotation, 0);
  return ((Math.round(value) % 360) + 360) % 360;
}

/**
 * Fold a Konva node's transient scale into Husnalogy width/height.
 *
 * The returned geometry is what gets committed; the CALLER is responsible for
 * resetting the node's scale back to 1 (see `resetNodeScale`) so the next
 * gesture starts from a clean transform. Doing both in one place is what stops
 * scale from accumulating across gestures.
 */
export function normalizeKonvaGeometry(node: KonvaNodeGeometry): HusnalogyGeometry {
  const scaleX = Math.abs(finite(node?.scaleX, 1)) || 1;
  const scaleY = Math.abs(finite(node?.scaleY, 1)) || 1;
  const width = Math.max(MIN_OBJECT_SIZE, Math.round(Math.abs(finite(node?.width)) * scaleX));
  const height = Math.max(MIN_OBJECT_SIZE, Math.round(Math.abs(finite(node?.height)) * scaleY));
  return {
    x: Math.round(finite(node?.x)),
    y: Math.round(finite(node?.y)),
    width,
    height,
    rotation: normalizeRotation(node?.rotation),
  };
}

/**
 * Reset a live Konva node so its visual state matches the geometry that was
 * just committed. Called immediately after `normalizeKonvaGeometry`, inside the
 * same transform-end handler, so the node never renders with stale scale.
 *
 * Typed structurally rather than against `Konva.Node` so this module stays
 * importable from tests and from the server bundle.
 */
export function resetNodeScale(node: {
  scaleX: (value?: number) => unknown;
  scaleY: (value?: number) => unknown;
  width?: (value?: number) => unknown;
  height?: (value?: number) => unknown;
}, geometry?: { width: number; height: number }): void {
  node.scaleX(1);
  node.scaleY(1);
  if (geometry && typeof node.width === "function" && typeof node.height === "function") {
    node.width(geometry.width);
    node.height(geometry.height);
  }
}

/**
 * Text normalisation (spec §14, §23).
 *
 * A corner drag on text is a TYPE SIZE change, so the uniform scale factor is
 * folded into `fontSize` (and proportionally into `letterSpacing`, which is an
 * absolute px value and would otherwise drift as the type grows). The box grows
 * with the type; the glyphs are never stretched, because no scale survives.
 *
 * A side drag is a BOX change and never touches `fontSize` — that is handled by
 * the plain geometry path, since re-wrapping is the renderer's job.
 */
export type TextTransformNormalization = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fontSize: number;
  letterSpacing: number;
};

export function normalizeTextScale(input: {
  node: KonvaNodeGeometry;
  fontSize: number;
  letterSpacing?: number;
  minFontSize?: number;
  maxFontSize?: number;
}): TextTransformNormalization {
  const scaleX = Math.abs(finite(input?.node?.scaleX, 1)) || 1;
  const scaleY = Math.abs(finite(input?.node?.scaleY, 1)) || 1;
  // A corner drag is uniform by construction; averaging keeps a nudge on one
  // axis from tipping the type size the wrong way.
  const factor = (scaleX + scaleY) / 2;
  const minFontSize = Math.max(1, finite(input?.minFontSize, 4));
  const maxFontSize = Math.max(minFontSize, finite(input?.maxFontSize, 500));
  const fontSize = Math.min(
    maxFontSize,
    Math.max(minFontSize, Math.round(finite(input?.fontSize, 48) * factor)),
  );
  // The applied factor is the CLAMPED one, so a font size pinned at its limit
  // does not keep growing the box past the type it contains.
  const applied = finite(input?.fontSize, 48) > 0 ? fontSize / finite(input.fontSize, 48) : 1;

  return {
    x: Math.round(finite(input?.node?.x)),
    y: Math.round(finite(input?.node?.y)),
    width: Math.max(1, Math.round(Math.abs(finite(input?.node?.width)) * applied)),
    height: Math.max(1, Math.round(Math.abs(finite(input?.node?.height)) * applied)),
    rotation: normalizeRotation(input?.node?.rotation),
    fontSize,
    letterSpacing: Number((finite(input?.letterSpacing, 0) * applied).toFixed(2)),
  };
}

/**
 * Husnalogy geometry -> the props a Konva node needs to sit exactly on it.
 *
 * The offset is the object's own half-extent, which puts the node's origin at
 * its CENTRE. That matters for more than convenience: Husnalogy stores `x`/`y`
 * as the centre and rotates around it, so a centred origin makes Konva rotation
 * and document rotation the same number with no correction term.
 */
export function konvaNodePropsFromLayer(layer: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
}): {
  x: number;
  y: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  scaleX: 1;
  scaleY: 1;
} {
  const width = Math.abs(finite(layer?.width));
  const height = Math.abs(finite(layer?.height));
  return {
    x: finite(layer?.x),
    y: finite(layer?.y),
    width,
    height,
    offsetX: width / 2,
    offsetY: height / 2,
    rotation: finite(layer?.rotation),
    scaleX: 1,
    scaleY: 1,
  };
}

/**
 * Only the properties that actually changed.
 *
 * A transform that ends where it started must not enqueue a document write:
 * that would push an empty entry onto the undo stack and wake autosave for
 * nothing (spec §45, §46).
 */
export function geometryPatch(
  before: Partial<HusnalogyGeometry>,
  after: HusnalogyGeometry,
): Partial<HusnalogyGeometry> {
  const patch: Partial<HusnalogyGeometry> = {};
  if (Math.round(finite(before?.x)) !== after.x) patch.x = after.x;
  if (Math.round(finite(before?.y)) !== after.y) patch.y = after.y;
  if (Math.round(finite(before?.width)) !== after.width) patch.width = after.width;
  if (Math.round(finite(before?.height)) !== after.height) patch.height = after.height;
  if (normalizeRotation(before?.rotation) !== after.rotation) patch.rotation = after.rotation;
  return patch;
}

export function isEmptyPatch(patch: Record<string, unknown> | null | undefined): boolean {
  return !patch || Object.keys(patch).length === 0;
}
