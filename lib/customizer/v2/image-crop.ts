// Image draw-box geometry, shared by the browser preview and the server SVG
// renderer (spec §16).
//
// Two things brought this module into being.
//
// 1. The draw-box maths was written out twice — once in `CustomizerPreview.tsx`
//    and once in `svg.ts` — even though the whole point of the shared renderer
//    is that browser preview and print output are identical. Two copies of the
//    same formula is exactly the drift risk the rest of this codebase avoids.
//
// 2. `ImageTransform` has carried `cropX/cropY/cropWidth/cropHeight` since the
//    V4 schema. They are defaulted in `types.ts`, accepted by the save
//    validator, round-tripped by `document.ts` and sanity-checked by
//    `grids.ts` — but NOTHING read them. `resolveLayerImage` dropped them, and
//    neither renderer referenced them. The crop rectangle was a dead field that
//    still persisted into order snapshots and production output records,
//    describing a crop the PNG and PDF would never contain.
//
// The crop rectangle is expressed in NORMALIZED FRAME COORDINATES (0..1 of the
// layer's frame box), not source-image pixels. That choice is deliberate: it
// composes with `preserveAspectRatio="slice"` without needing the intrinsic
// dimensions of the photo, which are not reliably known for template assets.
// The selected region is scaled UNIFORMLY to cover the frame, so a crop can
// never stretch a photo.

export type CropRect = { x: number; y: number; width: number; height: number };

export type DrawBox = { x: number; y: number; width: number; height: number };

export type ImageCropTransform = {
  zoom?: number;
  offsetX?: number;
  offsetY?: number;
  cropX?: number;
  cropY?: number;
  cropWidth?: number;
  cropHeight?: number;
};

const finite = (value: unknown, fallback = 0): number => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * The meaningful crop rectangle, or null when there is none.
 *
 * A zero width or height means "no crop" — that is the stored default on every
 * existing document, so returning null there is what keeps output byte
 * identical for artwork created before cropping existed. A rectangle covering
 * the whole frame is also null: it is a no-op, and collapsing it here means
 * callers never emit a redundant transform.
 */
export function resolveCropRect(transform: ImageCropTransform | null | undefined): CropRect | null {
  if (!transform) return null;
  const width = finite(transform.cropWidth);
  const height = finite(transform.cropHeight);
  if (!(width > 0) || !(height > 0)) return null;

  const x = clamp01(finite(transform.cropX));
  const y = clamp01(finite(transform.cropY));
  // A crop may not run past the frame edge.
  const clampedWidth = Math.min(clamp01(width), 1 - x);
  const clampedHeight = Math.min(clamp01(height), 1 - y);
  if (!(clampedWidth > 0) || !(clampedHeight > 0)) return null;

  // Covering the whole frame is the same as no crop at all.
  const EPSILON = 1e-6;
  if (x <= EPSILON && y <= EPSILON && clampedWidth >= 1 - EPSILON && clampedHeight >= 1 - EPSILON) {
    return null;
  }
  return { x, y, width: clampedWidth, height: clampedHeight };
}

export type DrawBoxInput = {
  /** The layer's frame box, in document units. */
  frameX: number;
  frameY: number;
  frameWidth: number;
  frameHeight: number;
  zoom?: number;
  offsetX?: number;
  offsetY?: number;
  /** Already resolved via `resolveCropRect`; null means no crop. */
  crop?: CropRect | null;
};

/**
 * Where the `<image>` element goes. Without a crop this reproduces exactly what
 * both renderers computed inline before, so existing artwork is unaffected.
 *
 * With a crop, the selected region of the frame is scaled up about its own
 * centre until it covers the frame, and the draw box rides along with it. The
 * scale is uniform on both axes, so a crop whose aspect ratio differs from the
 * frame fills the frame and loses the overflow — it never stretches the photo.
 */
export function resolveImageDrawBox(input: DrawBoxInput): DrawBox {
  const frameX = finite(input.frameX);
  const frameY = finite(input.frameY);
  const frameWidth = finite(input.frameWidth);
  const frameHeight = finite(input.frameHeight);
  const zoomValue = finite(input.zoom, 1);
  const zoom = zoomValue > 0 ? zoomValue : 1;

  const width = frameWidth * zoom;
  const height = frameHeight * zoom;
  const x = frameX - (width - frameWidth) / 2 + finite(input.offsetX);
  const y = frameY - (height - frameHeight) / 2 + finite(input.offsetY);

  const crop = input.crop;
  if (!crop || !(frameWidth > 0) || !(frameHeight > 0)) return { x, y, width, height };

  const regionWidth = crop.width * frameWidth;
  const regionHeight = crop.height * frameHeight;
  if (!(regionWidth > 0) || !(regionHeight > 0)) return { x, y, width, height };

  // Cover the frame without distorting: the tighter axis sets the scale.
  const scale = Math.max(frameWidth / regionWidth, frameHeight / regionHeight);
  const regionCenterX = frameX + (crop.x + crop.width / 2) * frameWidth;
  const regionCenterY = frameY + (crop.y + crop.height / 2) * frameHeight;
  const frameCenterX = frameX + frameWidth / 2;
  const frameCenterY = frameY + frameHeight / 2;

  return {
    x: (x - regionCenterX) * scale + frameCenterX,
    y: (y - regionCenterY) * scale + frameCenterY,
    width: width * scale,
    height: height * scale,
  };
}

/** Convenience: resolve the crop and the draw box in one call. */
export function resolveImageDrawBoxFromTransform(
  frame: { frameX: number; frameY: number; frameWidth: number; frameHeight: number },
  transform: (ImageCropTransform & { zoom?: number; offsetX?: number; offsetY?: number }) | null | undefined,
): DrawBox {
  return resolveImageDrawBox({
    ...frame,
    zoom: transform?.zoom,
    offsetX: transform?.offsetX,
    offsetY: transform?.offsetY,
    crop: resolveCropRect(transform),
  });
}

/**
 * A crop rectangle constrained to the frame's aspect ratio, centred on the
 * requested region. Crop UIs use this so the selection can never introduce a
 * shape the renderer would have to letterbox.
 */
export function constrainCropToAspect(
  crop: CropRect,
  frameWidth: number,
  frameHeight: number,
): CropRect {
  const width = clamp01(finite(crop.width));
  const height = clamp01(finite(crop.height));
  if (!(width > 0) || !(height > 0) || !(frameWidth > 0) || !(frameHeight > 0)) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  // Normalized units are already relative to the frame, so matching the frame
  // aspect means matching width and height in those units.
  const size = Math.min(width, height);
  const centerX = clamp01(finite(crop.x)) + width / 2;
  const centerY = clamp01(finite(crop.y)) + height / 2;
  const nextX = Math.min(Math.max(0, centerX - size / 2), 1 - size);
  const nextY = Math.min(Math.max(0, centerY - size / 2), 1 - size);
  return { x: nextX, y: nextY, width: size, height: size };
}
