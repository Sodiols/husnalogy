// Text growth direction.
//
// When a text object becomes taller — another line typed, a larger font, a
// tighter width — something has to decide where the extra height goes. That is
// this property, and it is NOT alignment: alignment places the glyphs inside a
// box, growth decides how the box itself moves.
//
//   "down"   the top edge stays put; the box grows downward
//   "up"     the bottom edge stays put; the box grows upward
//   "center" the centre stays put; half the growth goes each way
//
// The anchor is held in the object's OWN frame, so a rotated text box grows
// along its rotated vertical axis and its anchored edge does not drift. Every
// position is computed from the stored box, never from a previous resolved
// box, so repeated edits cannot accumulate drift.
//
// The property is optional. A document without it keeps the behaviour it was
// created with (see `resolveTextBox`), which is what keeps historical order
// snapshots rendering byte-identically.

export type TextGrowthDirection = "up" | "center" | "down";

export const TEXT_GROWTH_DIRECTIONS: readonly TextGrowthDirection[] = ["up", "center", "down"];

/** A valid growth direction, or undefined for anything else (absent stays absent). */
export function normalizeTextGrowthDirection(value: unknown): TextGrowthDirection | undefined {
  const text = String(value ?? "").trim().toLowerCase();
  return (TEXT_GROWTH_DIRECTIONS as readonly string[]).includes(text) ? (text as TextGrowthDirection) : undefined;
}

/**
 * The centre of a text box whose height changes from `fromHeight` to
 * `toHeight`, holding the edge the growth direction anchors. `x`/`y` are the
 * stored centre and `rotation` the box's rotation in degrees (clockwise, as
 * every renderer draws it).
 */
export function anchorGrownTextBox(input: {
  x: number;
  y: number;
  fromHeight: number;
  toHeight: number;
  rotation?: number;
  growth: TextGrowthDirection;
}): { x: number; y: number } {
  const delta = (Number(input.toHeight) || 0) - (Number(input.fromHeight) || 0);
  const shift = input.growth === "down" ? delta / 2 : input.growth === "up" ? -delta / 2 : 0;
  if (!shift) return { x: input.x, y: input.y };
  const angle = ((Number(input.rotation) || 0) * Math.PI) / 180;
  // The box's local +y axis, in canvas coordinates.
  return { x: input.x - Math.sin(angle) * shift, y: input.y + Math.cos(angle) * shift };
}
