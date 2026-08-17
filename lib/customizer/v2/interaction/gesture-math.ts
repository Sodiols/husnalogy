/**
 * The transform mathematics shared by the customer workspace and the admin
 * design builder (spec §40: "Do not maintain completely different transform
 * mathematics for customer and admin after the migration").
 *
 * Both canvases previously carried their own copy of resize anchoring, rotation
 * snapping, multi-object scaling and rotation-about-a-pivot — inline, inside a
 * 1,500 line component, reachable only through a real pointer. Two copies of
 * geometry drift, and there was no way to test either of them.
 *
 * Everything here is pure: numbers in, numbers out, no DOM, no Konva, no React.
 * The Konva layer supplies the pointer deltas; this decides what they mean; the
 * adapter normalises the result into the Husnalogy document.
 */

import { MIN_OBJECT_SIZE, normalizeRotation } from "./konva-adapter";
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
  const left = finite(input.start?.x) - startWidth / 2;
  const top = finite(input.start?.y) - startHeight / 2;
  const right = left + startWidth;
  const bottom = top + startHeight;
  const handle = String(input.handle);

  let nextLeft = left;
  let nextTop = top;
  let nextRight = right;
  let nextBottom = bottom;

  if (handle.includes("w")) nextLeft = Math.min(left + finite(input.dx), right - minimum);
  if (handle.includes("e")) nextRight = Math.max(right + finite(input.dx), left + minimum);
  if (handle.includes("n")) nextTop = Math.min(top + finite(input.dy), bottom - minimum);
  if (handle.includes("s")) nextBottom = Math.max(bottom + finite(input.dy), top + minimum);

  let width = Math.round(nextRight - nextLeft);
  let height = Math.round(nextBottom - nextTop);

  if (input.preserveAspect && startWidth > 0 && startHeight > 0) {
    const ratio = startWidth / startHeight;
    if (height > 0 && width / height > ratio) width = Math.round(height * ratio);
    else height = Math.round(width / ratio);
    if (handle.includes("w")) nextLeft = nextRight - width;
    else nextRight = nextLeft + width;
    if (handle.includes("n")) nextTop = nextBottom - height;
    else nextBottom = nextTop + height;
  }

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
    width: Math.max(minimum, width),
    height: Math.max(minimum, height),
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

/** Degrees the rotation handle snaps to when the modifier is NOT held. */
export const ROTATION_SNAP_STEP = 15;
/** How close the pointer must be, in degrees, before the snap engages. */
export const ROTATION_SNAP_TOLERANCE = 4;

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

/** Rotate a point about a pivot. The primitive multi-rotation is built on. */
export function rotatePoint(
  x: number,
  y: number,
  pivotX: number,
  pivotY: number,
  degrees: number,
): { x: number; y: number } {
  const radians = (finite(degrees) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = finite(x) - finite(pivotX);
  const dy = finite(y) - finite(pivotY);
  return {
    x: finite(pivotX) + dx * cos - dy * sin,
    y: finite(pivotY) + dx * sin + dy * cos,
  };
}

/* ---------------------------------------------------------------------------
 * Multi-object transforms (spec §18)
 * ------------------------------------------------------------------------ */

export type MultiMember = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
};

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

/* ---------------------------------------------------------------------------
 * Movement
 * ------------------------------------------------------------------------ */

/**
 * Move a whole selection by the delta that was actually APPLIED to the grabbed
 * object, snapping included.
 *
 * Applying the raw pointer delta to the followers while the grabbed object gets
 * the snapped one silently changes their spacing every time a snap engages —
 * the objects drift apart over a long drag. Propagating the effective delta is
 * what keeps a multi-selection rigid.
 */
export function applySelectionDelta(
  members: readonly MultiMember[],
  leadId: string,
  leadX: number,
  leadY: number,
  leadStartX: number,
  leadStartY: number,
): Array<{ id: string; x: number; y: number }> {
  const dx = leadX - finite(leadStartX);
  const dy = leadY - finite(leadStartY);
  return members.map((member) =>
    member.id === leadId
      ? { id: member.id, x: Math.round(leadX), y: Math.round(leadY) }
      : { id: member.id, x: Math.round(finite(member.x) + dx), y: Math.round(finite(member.y) + dy) },
  );
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
