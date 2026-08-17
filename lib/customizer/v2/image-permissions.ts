// One implementation of "what may the customer do to the photo inside this
// frame" (spec §16, §25), shared by the contextual photo toolbar and the server
// save validator.
//
// These rules previously existed twice, in slightly different forms:
//
//   - `validate.ts` gated rotation on an umbrella `cropAllowed` flag, flips on
//     `flipImage`, and zoom/offset on their own permission OR `cropAllowed`.
//   - `CustomerImageToolbar.tsx` re-derived its own booleans with `||` where the
//     server used `??`, left the "Rotate photo 90°" button ungated entirely, and
//     sent a Reset patch containing every transform field.
//
// The visible consequence was a customer who may crop but may NOT flip: the
// flip buttons were correctly hidden, but pressing "Reset crop" still sent
// `flipX:false, flipY:false`, so the save came back 422 `flip-not-allowed` and
// the reset silently failed. Deriving both sides from this module makes that
// class of drift impossible.

export type ImagePermissionsLike = {
  cropImage?: boolean;
  zoomImage?: boolean;
  repositionImage?: boolean;
  flipImage?: boolean;
  rotateImage?: boolean;
} & Record<string, unknown>;

export type ImageCropCapabilities = {
  /**
   * The umbrella permission the validator calls `cropAllowed`. An explicit
   * `cropImage` decides on its own; only when it is absent do the finer zoom /
   * reposition permissions imply it.
   */
  cropAllowed: boolean;
  canZoom: boolean;
  canReposition: boolean;
  canFlip: boolean;
  /** Rotating the photo INSIDE the frame — not rotating the frame itself. */
  canRotateImage: boolean;
  /** Is there anything at all to do in crop mode? Gates the Crop button. */
  canEnterCrop: boolean;
};

export function resolveImageCropCapabilities(
  permissions: ImagePermissionsLike | null | undefined,
): ImageCropCapabilities {
  const source = permissions || {};
  const cropAllowed = Boolean(
    source.cropImage ?? (Boolean(source.zoomImage) || Boolean(source.repositionImage)),
  );
  const canZoom = Boolean(source.zoomImage) || cropAllowed;
  const canReposition = Boolean(source.repositionImage) || cropAllowed;
  const canFlip = Boolean(source.flipImage);
  // The validator ties in-frame rotation to the umbrella flag, not to the
  // separate `rotateImage` permission (which governs rotating the frame).
  const canRotateImage = cropAllowed;
  return {
    cropAllowed,
    canZoom,
    canReposition,
    canFlip,
    canRotateImage,
    // Deliberately NOT `cropAllowed`: a template may grant zoom while leaving
    // `cropImage` explicitly false, and the customer still needs a way in.
    canEnterCrop: canZoom || canReposition || canFlip || canRotateImage,
  };
}

export type ImageTransformResetPatch = {
  zoom?: number;
  offsetX?: number;
  offsetY?: number;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
};

/**
 * "Reset crop" restricted to the fields this customer may actually write.
 * Sending a field the permissions forbid makes the whole save fail validation,
 * so a reset must never reach for more than it is allowed to touch.
 */
export function resetImageTransformPatch(
  permissions: ImagePermissionsLike | null | undefined,
): ImageTransformResetPatch {
  const { canZoom, canReposition, canFlip, canRotateImage } = resolveImageCropCapabilities(permissions);
  const patch: ImageTransformResetPatch = {};
  if (canZoom) patch.zoom = 1;
  if (canReposition) {
    patch.offsetX = 0;
    patch.offsetY = 0;
  }
  if (canRotateImage) patch.rotation = 0;
  if (canFlip) {
    patch.flipX = false;
    patch.flipY = false;
  }
  return patch;
}
