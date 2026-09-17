/**
 * The transform maths the shipped editor actually executes.
 *
 * Everything in this file has a LIVE caller in `CustomizerInteractionStage`,
 * which both the admin builder and the customer editor mount — so there is one
 * implementation of each of these behaviours, not two.
 *
 *   rotatePoint          — un-rotating a pointer to find the grid slot under it
 *   applySelectionDelta  — propagating a snapped drag across a multi-selection
 *   ROTATION_SNAP_STEP   — the angles the rotation handle snaps to
 *
 * What is NOT here, deliberately: single-object and multi-object RESIZE and
 * ROTATION maths. Konva's `Transformer` owns those on the live path — it
 * resolves the anchor, the rotated axes and the aspect modifier — and
 * `konva-adapter` converts its output into Husnalogy geometry. A pure model of
 * the same operations exists in `reference-geometry.ts`, which the editor does
 * not import; see that file's header for why it is kept and what its tests do
 * and do not prove.
 *
 * Everything here is pure: numbers in, numbers out, no DOM, no Konva, no React.
 */

const finite = (value: unknown, fallback = 0): number => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

/* ---------------------------------------------------------------------------
 * Rotation snapping
 * ------------------------------------------------------------------------ */

/**
 * Degrees the rotation handle snaps to when the modifier is NOT held. Passed
 * straight to the Konva Transformer's `rotationSnaps`, so this constant is the
 * live contract rather than a description of one.
 */
export const ROTATION_SNAP_STEP = 15;
/** How close the pointer must be, in degrees, before the snap engages. */
export const ROTATION_SNAP_TOLERANCE = 4;

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

export type MultiMember = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
};

/* ---------------------------------------------------------------------------
 * Multi-object movement (spec §18)
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

/* ---------------------------------------------------------------------------
 * Committing a drag (spec §18)
 * ------------------------------------------------------------------------ */

/** A dragged object, carrying BOTH geometries it is described by. */
export type DragCommitMember = {
  id: string;
  /** Resolved centre at pointer-down — the box the gesture moved on screen. */
  x: number;
  y: number;
  /** Persisted centre at pointer-down — the origin the document stores. */
  documentX: number;
  documentY: number;
};

/**
 * Turn the resolved positions a gesture ended at into document patches.
 *
 * A drag is a TRANSLATION, and this is the one place that fact is enforced.
 * The interaction layer works in RESOLVED geometry — for auto-sized text that
 * is the measured glyph box, which `resolveTextBox` re-anchors inside the
 * authored box, so its centre is NOT the centre the document stores. Writing
 * the resolved position straight into the document therefore silently moved the
 * layer by the difference between the two, on every drag, for as long as that
 * difference existed. Measured on the fixture's auto-width layer: a drag
 * intended to move 161.5 document pixels moved 119 — a 42.5px error, and the
 * error grew with the gap between the stored and measured box, which is why it
 * appeared after resizing type.
 *
 * Taking the delta and applying it to the persisted origin makes the committed
 * movement identical to the movement the customer saw, independently of font
 * size, alignment, auto-sizing mode, zoom or rotation.
 */
export function resolveDragCommits(
  members: readonly DragCommitMember[],
  moves: ReadonlyArray<{ id: string; x: number; y: number }>,
  leadId?: string,
): Array<{ id: string; patch: { x?: number; y?: number } }> {
  const byId = new Map(members.map((member) => [member.id, member]));
  const moveById = new Map(moves.map((move) => [move.id, move]));

  /**
   * ONE delta for the whole selection, taken from the object the pointer
   * actually held.
   *
   * Deriving each member's delta from its own entry in `moves` looks
   * equivalent, but those positions are rounded to whole document pixels while
   * a resolved text centre is frequently fractional (621.5). Rounding a
   * fractional start plus an exact delta yields a delta that is off by up to
   * half a pixel — enough to shift text by 1px relative to the shape it was
   * selected with, which is exactly the rigidity a multi-selection promises not
   * to break.
   */
  let sharedDelta: { dx: number; dy: number } | null = null;
  const lead = leadId ? byId.get(leadId) : null;
  const leadMove = leadId ? moveById.get(leadId) : null;
  if (lead && leadMove) {
    sharedDelta = { dx: finite(leadMove.x) - finite(lead.x), dy: finite(leadMove.y) - finite(lead.y) };
  }

  const changes: Array<{ id: string; patch: { x?: number; y?: number } }> = [];
  for (const move of moves) {
    const member = byId.get(move.id);
    if (!member) continue;
    const delta = sharedDelta ?? {
      dx: finite(move.x) - finite(member.x),
      dy: finite(move.y) - finite(member.y),
    };
    const startX = Number.isFinite(Number(member.documentX)) ? Number(member.documentX) : finite(member.x);
    const startY = Number.isFinite(Number(member.documentY)) ? Number(member.documentY) : finite(member.y);
    const nextX = Math.round(startX + delta.dx);
    const nextY = Math.round(startY + delta.dy);
    const patch: { x?: number; y?: number } = {};
    if (Math.round(startX) !== nextX) patch.x = nextX;
    if (Math.round(startY) !== nextY) patch.y = nextY;
    if (patch.x !== undefined || patch.y !== undefined) changes.push({ id: move.id, patch });
  }
  return changes;
}
