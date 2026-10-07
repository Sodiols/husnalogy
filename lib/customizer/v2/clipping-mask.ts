// Shape + image clipping mask.
//
// A clipping mask is NOT a new kind of object and has no renderer of its own.
// It is the masked photo the Customizer already has — an image or frame layer
// whose `mask` is drawn by the shared generator in masks.ts — with the SHAPE's
// box as its geometry and the shape's outline as its mask. The browser preview,
// the server SVG, the crop tools, history and the save pipeline all understand
// that layer already, so a clip moves, resizes, rotates, crops, saves and
// prints exactly like any frame.
//
// Creating one is a pure, deterministic document edit: the photo layer keeps its
// id and every byte of its image data (source, asset, crop, flips, filters),
// takes the shape's geometry, stacking position and paint, and the shape is
// removed. Callers apply the result as ONE history step.

import { CUSTOM_PATH_BOX, sanitizeCustomPath } from "./shape-library";
import { isTransparentPaint } from "./paint";
import type { MaskShape } from "./types";

type AnyLayer = Record<string, any>;

const TRIANGLE: ReadonlyArray<{ x: number; y: number }> = [
  { x: 0.5, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const inUnitRange = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * The mask that reproduces the shape's outline, or null when the shared mask
 * engine cannot draw it. Every case here matches what the shape renderer draws
 * for the same box:
 *  - rectangle / rounded rectangle → rectangle, or rounded with the shape's
 *    corner radius (the mask clamps a radius beyond half the shorter side to
 *    that half, which is the largest radius the shape can show on that side);
 *  - ellipse, circle and oval all draw an ellipse filling the box → oval;
 *  - arch → the same full arch the shape draws through getMaskPath;
 *  - triangle and polygon → polygon in the same normalized box coordinates.
 * Lines and free paths have no area the engine can clip to, so they are not
 * offered (a path shape's data is in absolute canvas units, not its box).
 */
export function maskForShape(shape: AnyLayer | null | undefined): MaskShape | null {
  if (!shape || shape.type !== "shape") return null;
  if (!(Number(shape.width) > 0) || !(Number(shape.height) > 0)) return null;
  switch (String(shape.shape || "rectangle")) {
    case "rectangle":
    case "rounded-rectangle": {
      const radius = Number(shape.borderRadius) || 0;
      return radius > 0 ? { kind: "rounded", radius } : { kind: "rectangle" };
    }
    case "ellipse":
    case "circle":
    case "oval":
      return { kind: "oval" };
    case "arch":
      return { kind: "arch" };
    case "custom": {
      const d = sanitizeCustomPath(shape.pathData);
      return d ? { kind: "path", d, viewBoxWidth: CUSTOM_PATH_BOX, viewBoxHeight: CUSTOM_PATH_BOX } : null;
    }
    case "triangle":
      return { kind: "polygon", points: TRIANGLE.map((point) => ({ ...point })) };
    case "polygon": {
      const points = (Array.isArray(shape.points) ? shape.points : []).map((point: any) => ({
        x: Number(point?.x),
        y: Number(point?.y),
      }));
      // The mask engine clamps points to the box; the shape renderer does not.
      // Only points already inside the box render identically in both.
      if (points.length < 3 || points.some((point: { x: number; y: number }) => !inUnitRange(point.x) || !inUnitRange(point.y))) return null;
      return { kind: "polygon", points };
    }
    default:
      return null;
  }
}

/** An image or frame layer that actually shows a picture (a source, a stored asset, or a customer photo field). */
export function isClipMaskContent(layer: AnyLayer | null | undefined): boolean {
  if (!layer || (layer.type !== "image" && layer.type !== "frame")) return false;
  return Boolean(layer.src || layer.path || layer.assetId || layer.fieldId);
}

const pageOf = (layer: AnyLayer) => String(layer.page ?? layer.pageId ?? "");

export type ClipMaskPair = { shape: AnyLayer; image: AnyLayer; mask: MaskShape };

/**
 * The shape and photo a selection would clip, or null when the selection is not
 * exactly one compatible shape plus one photo on the same page and in the same
 * group. Permission checks (locks, ownership, template rules) belong to the
 * caller, which knows whose document it is editing.
 */
export function findClipMaskPair(layers: readonly AnyLayer[]): ClipMaskPair | null {
  if (layers.length !== 2) return null;
  const shape = layers.find((layer) => layer?.type === "shape");
  const image = layers.find((layer) => isClipMaskContent(layer));
  if (!shape || !image) return null;
  if (pageOf(shape) !== pageOf(image)) return null;
  if (String(shape.groupId || "") !== String(image.groupId || "")) return null;
  const mask = maskForShape(shape);
  return mask ? { shape, image, mask } : null;
}

/** The legacy `maskShape` name for a mask, kept in step so older readers agree with the mask. */
export function legacyMaskShapeName(mask: MaskShape): string {
  switch (mask.kind) {
    case "arch":
      return "arch-full";
    case "arch-top":
      return "arch";
    case "polygon":
    case "path":
      // No legacy name exists; the mask object is what every renderer draws.
      return "rectangle";
    default:
      return mask.kind;
  }
}

/**
 * The photo layer clipped to the shape. Pure: the inputs are not modified.
 *
 * The photo keeps its id (so field bindings and saved overrides still find it)
 * and all of its image data. Its in-frame pan is stored in document units
 * relative to its own box, so it is rescaled to the shape's box — the same part
 * of the picture stays in view. Its crop rectangle, zoom, flips and in-frame
 * rotation are relative already and carry over unchanged.
 */
export function clipImageToShape({ shape, image, mask }: ClipMaskPair): AnyLayer {
  const scaleX = Number(image.width) > 0 ? Number(shape.width) / Number(image.width) : 1;
  const scaleY = Number(image.height) > 0 ? Number(shape.height) / Number(image.height) : 1;
  const transform = image.imageTransform && typeof image.imageTransform === "object" ? image.imageTransform : null;
  const imageTransform = transform
    ? {
        ...transform,
        ...(transform.offsetX !== undefined ? { offsetX: (Number(transform.offsetX) || 0) * scaleX } : {}),
        ...(transform.offsetY !== undefined ? { offsetY: (Number(transform.offsetY) || 0) * scaleY } : {}),
      }
    : undefined;
  const strokeWidth = Math.max(0, Number(shape.strokeWidth) || 0);
  const stroked = Boolean(shape.stroke) && !isTransparentPaint(shape.stroke) && strokeWidth > 0;
  const filled = Boolean(shape.fill) && !isTransparentPaint(shape.fill);

  return {
    ...image,
    ...(imageTransform ? { imageTransform } : {}),
    x: Number(shape.x) || 0,
    y: Number(shape.y) || 0,
    width: Number(shape.width),
    height: Number(shape.height),
    rotation: Number(shape.rotation) || 0,
    // The clip sits where the higher of the two sat, so nothing that was in
    // front of both ends up behind it, or the reverse.
    zIndex: Math.max(Number(shape.zIndex) || 0, Number(image.zIndex) || 0),
    mask,
    maskShape: legacyMaskShapeName(mask),
    // The shape's paint becomes the clip's: its fill shows wherever the photo
    // is transparent, and its outline is drawn along the same mask path.
    backgroundColor: filled ? String(shape.fill) : "",
    borderColor: stroked ? String(shape.stroke) : "",
    borderWidth: stroked ? strokeWidth : 0,
  };
}

/**
 * Replace the pair in a layer list with the clipped photo, in one pass. The
 * photo is rebuilt in place, the shape is removed, and the shape's id is removed
 * from any group that listed it — so no orphaned shape, photo or group entry is
 * left behind. Returns the same array when the pair is not in the list.
 */
export function applyClippingMask(layers: readonly AnyLayer[], pair: ClipMaskPair): AnyLayer[] {
  const shapeId = pair.shape.id;
  const imageId = pair.image.id;
  if (!layers.some((layer) => layer?.id === shapeId) || !layers.some((layer) => layer?.id === imageId)) {
    return layers as AnyLayer[];
  }
  const clipped = clipImageToShape(pair);
  return layers
    .filter((layer) => layer?.id !== shapeId)
    .map((layer) => {
      if (layer?.id === imageId) return clipped;
      if (layer?.type === "group" && Array.isArray(layer.childIds) && layer.childIds.includes(shapeId)) {
        return { ...layer, childIds: layer.childIds.filter((id: string) => id !== shapeId) };
      }
      return layer;
    });
}
