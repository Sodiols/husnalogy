/**
 * REFERENCE GEOMETRY — a pure model of resize, rotation and nudging that the
 * shipped editor does NOT execute.
 *
 * Read this before changing anything here.
 *
 * Husnalogy has exactly one LIVE resize/rotate implementation, and it is not
 * this one. Live transforms run through Konva's `Transformer`: it owns the
 * anchors, the rotated-axis maths and the aspect modifier, and the result is
 * converted into Husnalogy geometry by `konva-adapter`
 * (`normalizeKonvaGeometry` / `normalizeTextScale` / `geometryPatch`) inside
 * `CustomizerInteractionStage`. Both the admin builder and the customer editor
 * mount that same stage, so there is one shipped definition of a transform.
 *
 * These functions are a SECOND, independent definition of the same operations.
 * They are correct, and they are tested — but nothing in `app/` or `lib/`
 * imports them, so their tests prove the behaviour of this module and say
 * NOTHING about what the editor does. They previously sat in `gesture-math.ts`
 * alongside the genuinely live helpers, where a green test named "anchors a
 * resize to the opposite edge" read as coverage of production resizing. It was
 * not. That false signal is the reason this file exists under this name.
 *
 * They are kept rather than deleted because they are the only executable
 * specification of Husnalogy's intended transform semantics, independent of
 * Konva — useful for server-side geometry, for a future non-Konva surface, and
 * as the reference a Konva upgrade can be diffed against.
 *
 * Rules:
 *  - Do not import this module from the editor. If a live path ever needs this
 *    model, move the function into `gesture-math.ts` and give it browser
 *    coverage in `e2e/customizer-resize.spec.ts` in the same change.
 *  - Do not "fix a resize bug" here and expect the editor to change. Production
 *    resize behaviour is proven by the browser tests, not by this file.
 */

import { MIN_OBJECT_SIZE, normalizeRotation } from "./konva-adapter";
import { rotatePoint, ROTATION_SNAP_STEP, ROTATION_SNAP_TOLERANCE, type MultiMember } from "./gesture-math";
import type { HandleId } from "./handles";
import type { SelectionRect } from "../selection-geometry";

const finite = (value: unknown, fallback = 0): number => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export type Box = { x: number; y: number; width: number; height: number };

/* ---------------------------------------------------------------------------
 * Rotation-aware delta
 * ------------------------------------------------------------------------ */

/**
 * A pointer delta expressed in the object's OWN frame.
 *
 * Dragging the east handle of an object rotated 90° must widen it along the
 * direction the handle points, not along the screen's x axis. Without this the
 * object appears to resize on the wrong edge as soon as it is rotated.
 */
export function toLocalDelta(dx: number, dy: number, rotationDegrees: number): { dx: number; dy: number } {
  const radians = (finite(rotationDegrees) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    dx: finite(dx) * cos + finite(dy) * sin,
    dy: -finite(dx) * sin + finite(dy) * cos,
  };
}

/**
 * The inverse: a delta measured on a rotated SURFACE (a canvas embedded in a
 * rotated product mockup) converted back into document space.
 */
export function fromSurfaceDelta(dx: number, dy: number, surfaceRotationDegrees: number): { dx: number; dy: number } {
  const radians = (-finite(surfaceRotationDegrees) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    dx: finite(dx) * cos - finite(dy) * sin,
    dy: finite(dx) * sin + finite(dy) * cos,
  };
}

/* ---------------------------------------------------------------------------
 * Single-object resize
 * ------------------------------------------------------------------------ */

export type ResizeInput = {
  handle: HandleId;
  /** Starting geometry, centre-origin, as stored in the document. */
  start: Box;
  /** Pointer delta in the OBJECT's frame (see `toLocalDelta`). */
  dx: number;
  dy: number;
  /** Shift: keep the starting aspect ratio. */
  preserveAspect?: boolean;
  minSize?: number;
  /** Clamp the result inside these document bounds (text safe area). */
  bounds?: SelectionRect | null;
};

/**
 * Resize anchored to the OPPOSITE edge/corner, which is what every editor does
 * and what makes a handle feel attached to the thing it is dragging.
 *
 * Returns centre-origin geometry so the caller can hand it straight to the
 * document without another conversion.
 */
export function resolveResize(input: ResizeInput): Box {
  const minimum = Math.max(1, finite(input.minSize, MIN_OBJECT_SIZE));
  const startWidth = Math.abs(finite(input.start?.width));
  const startHeight = Math.abs(finite(input.start?.height));
  const centerX = finite(input.start?.x);
  const centerY = finite(input.start?.y);
  const left = centerX - startWidth / 2;
  const top = centerY - startHeight / 2;
  const right = left + startWidth;
  const bottom = top + startHeight;

  const handle = String(input.handle);
  const movesWest = handle.includes("w");
  const movesEast = handle.includes("e");
  const movesNorth = handle.includes("n");
  const movesSouth = handle.includes("s");

  // Size first, placement second. Deriving the size on its own and only then
  // anchoring it is what keeps the returned centre consistent with the returned
  // width/height: computing the centre from edges that a later clamp moves is
  // how an object ends up reporting a box its own edges disagree with.
  let width = movesWest ? startWidth - finite(input.dx) : movesEast ? startWidth + finite(input.dx) : startWidth;
  let height = movesNorth ? startHeight - finite(input.dy) : movesSouth ? startHeight + finite(input.dy) : startHeight;

  if (input.preserveAspect && startWidth > 0 && startHeight > 0) {
    const ratio = startWidth / startHeight;
    // The axis the pointer actually moved the most drives both. That is what
    // makes a locked resize work from a plain EDGE handle as well as a corner:
    // an edge handle only produces a delta on one axis, and comparing the two
    // resulting sizes against each other (as this used to) simply cancelled it
    // back to the starting size, so Shift on an edge did nothing at all.
    const widthChange = Math.abs(width / startWidth - 1);
    const heightChange = Math.abs(height / startHeight - 1);
    if (widthChange >= heightChange) height = width / ratio;
    else width = height * ratio;

    // The minimum has to be applied along the ratio too. Clamping each axis
    // independently silently unlocks the aspect ratio at the smallest sizes.
    if (width < minimum || height < minimum) {
      const widthAtMinimumHeight = minimum * ratio;
      if (widthAtMinimumHeight >= minimum) {
        height = minimum;
        width = widthAtMinimumHeight;
      } else {
        width = minimum;
        height = minimum / ratio;
      }
    }
  }

  width = Math.max(minimum, Math.round(width));
  height = Math.max(minimum, Math.round(height));

  // Anchor to the edge OPPOSITE the handle. An axis the handle does not touch
  // keeps its centre, so an aspect-locked edge drag grows symmetrically about
  // the object instead of pivoting on an arbitrary side.
  let nextLeft = movesWest ? right - width : movesEast ? left : centerX - width / 2;
  let nextTop = movesNorth ? bottom - height : movesSouth ? top : centerY - height / 2;

  if (input.bounds) {
    const clamped = clampBoxIntoBounds(
      { left: nextLeft, top: nextTop, right: nextLeft + width, bottom: nextTop + height },
      input.bounds,
    );
    nextLeft = clamped.left;
    nextTop = clamped.top;
  }

  return {
    x: Math.round(nextLeft + width / 2),
    y: Math.round(nextTop + height / 2),
    width,
    height,
  };
}

/**
 * Slide a box back inside bounds without shrinking it. A box larger than the
 * bounds on an axis is left alone on that axis: shrinking artwork to fit the
 * safe area silently would be a worse outcome than showing it overflowing.
 */
export function clampBoxIntoBounds(box: SelectionRect, bounds: SelectionRect): SelectionRect {
  let { left, top, right, bottom } = box;
  const width = right - left;
  const height = bottom - top;
  if (width <= bounds.right - bounds.left) {
    if (left < bounds.left) {
      right += bounds.left - left;
      left = bounds.left;
    }
    if (right > bounds.right) {
      left -= right - bounds.right;
      right = bounds.right;
    }
  }
  if (height <= bounds.bottom - bounds.top) {
    if (top < bounds.top) {
      bottom += bounds.top - top;
      top = bounds.top;
    }
    if (bottom > bounds.bottom) {
      top -= bottom - bounds.bottom;
      bottom = bounds.bottom;
    }
  }
  return { left, top, right, bottom };
}

/* ---------------------------------------------------------------------------
 * Rotation
 * ------------------------------------------------------------------------ */


/**
 * Rotation from a pointer position around a pivot.
 *
 * `+90` because the rotation handle sits ABOVE the object: with the pointer
 * directly above the centre, `atan2` reports -90°, which must read as 0.
 */
export function resolveRotation(input: {
  pointerX: number;
  pointerY: number;
  pivotX: number;
  pivotY: number;
  /** Shift held: free rotation, no snapping. */
  freeRotation?: boolean;
}): number {
  const angle =
    (Math.atan2(finite(input.pointerY) - finite(input.pivotY), finite(input.pointerX) - finite(input.pivotX)) * 180) /
      Math.PI +
    90;
  let rotation = Math.round(angle);
  if (!input.freeRotation) {
    const nearest = Math.round(rotation / ROTATION_SNAP_STEP) * ROTATION_SNAP_STEP;
    if (Math.abs(rotation - nearest) <= ROTATION_SNAP_TOLERANCE) rotation = nearest;
  }
  return normalizeRotation(rotation);
}

export type MultiResizeResult = Array<{ id: string; x: number; y: number; width: number; height: number }>;

/**
 * Scale a whole selection about its combined bounding box.
 *
 * Every member keeps its RELATIVE position inside the box, so an arrangement
 * the customer built stays an arrangement after the resize. Each member's size
 * may then be constrained further by the caller (text has minimum widths the
 * layout engine enforces), which is why `constrain` is injected rather than
 * baked in — the customer and admin text rules differ.
 */
export function resolveMultiResize(input: {
  handle: HandleId;
  startBounds: SelectionRect & { width: number; height: number };
  dx: number;
  dy: number;
  members: readonly MultiMember[];
  preserveAspect?: boolean;
  minSize?: number;
  constrain?: (member: MultiMember, width: number, height: number) => { width: number; height: number };
}): MultiResizeResult {
  const minimum = Math.max(1, finite(input.minSize, MIN_OBJECT_SIZE));
  const start = input.startBounds;
  const handle = String(input.handle);

  let left = start.left;
  let top = start.top;
  let right = start.right;
  let bottom = start.bottom;

  if (handle.includes("w")) left = Math.min(start.left + finite(input.dx), start.right - minimum);
  if (handle.includes("e")) right = Math.max(start.right + finite(input.dx), start.left + minimum);
  if (handle.includes("n")) top = Math.min(start.top + finite(input.dy), start.bottom - minimum);
  if (handle.includes("s")) bottom = Math.max(start.bottom + finite(input.dy), start.top + minimum);

  let width = right - left;
  let height = bottom - top;

  if (input.preserveAspect && start.width > 0 && start.height > 0) {
    const factor = Math.max(width / start.width, height / start.height);
    width = start.width * factor;
    height = start.height * factor;
    if (handle.includes("w")) left = right - width;
    else right = left + width;
    if (handle.includes("n")) top = bottom - height;
    else bottom = top + height;
  }

  const scaleX = start.width > 0 ? width / start.width : 1;
  const scaleY = start.height > 0 ? height / start.height : 1;

  return input.members.map((member) => {
    const requestedWidth = finite(member.width) * scaleX;
    const requestedHeight = finite(member.height) * scaleY;
    const constrained = input.constrain
      ? input.constrain(member, requestedWidth, requestedHeight)
      : { width: requestedWidth, height: requestedHeight };
    return {
      id: member.id,
      x: Math.round(left + (finite(member.x) - start.left) * scaleX),
      y: Math.round(top + (finite(member.y) - start.top) * scaleY),
      width: Math.max(1, Math.round(constrained.width)),
      height: Math.max(1, Math.round(constrained.height)),
    };
  });
}

/**
 * Rotate a selection as one rigid body: every member orbits the shared pivot
 * AND spins by the same delta, which is what keeps the arrangement intact.
 */
export function resolveMultiRotate(input: {
  members: readonly MultiMember[];
  pivotX: number;
  pivotY: number;
  deltaDegrees: number;
  freeRotation?: boolean;
}): Array<{ id: string; x: number; y: number; rotation: number }> {
  let delta = finite(input.deltaDegrees);
  if (!input.freeRotation) delta = Math.round(delta / ROTATION_SNAP_STEP) * ROTATION_SNAP_STEP;
  return input.members.map((member) => {
    const point = rotatePoint(member.x, member.y, input.pivotX, input.pivotY, delta);
    return {
      id: member.id,
      x: Math.round(point.x),
      y: Math.round(point.y),
      rotation: normalizeRotation(finite(member.rotation) + delta),
    };
  });
}

/** Arrow-key nudge (spec §33). Shift takes a bigger step. */
export const NUDGE_STEP = 1;
export const NUDGE_STEP_LARGE = 10;

export function resolveNudge(key: string, large: boolean): { dx: number; dy: number } | null {
  const step = large ? NUDGE_STEP_LARGE : NUDGE_STEP;
  switch (key) {
    case "ArrowLeft":
      return { dx: -step, dy: 0 };
    case "ArrowRight":
      return { dx: step, dy: 0 };
    case "ArrowUp":
      return { dx: 0, dy: -step };
    case "ArrowDown":
      return { dx: 0, dy: step };
    default:
      return null;
  }
}
