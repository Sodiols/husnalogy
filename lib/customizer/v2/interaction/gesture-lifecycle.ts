/**
 * When a live canvas gesture must be ABANDONED rather than committed
 * (spec §20 "Interactions must cleanly cancel").
 *
 * The rule used to live as a single `if (touches.size >= 2)` inside one
 * listener, which covered exactly one of the six ways a gesture can be
 * interrupted. The other five all ended the same way: Konva never delivered the
 * matching `dragend` / `transformend`, so the stage stayed permanently
 * mid-gesture — the Transformer could no longer re-attach on a selection
 * change, the cursor stuck, and the transient preview kept painting geometry
 * the document did not describe. Worse, the next pointer press could commit a
 * delta measured against a state the customer had long since left.
 *
 * Keeping the decision here, as a pure function, means the contract is one
 * readable list and is testable without a DOM, Konva or a React renderer —
 * none of which the interruption paths are reachable through.
 */

export type GestureLifecycleState = {
  /** A node drag is in flight. */
  dragging?: boolean;
  /** A Transformer resize/rotate is in flight. */
  transforming?: boolean;
  /** A marquee rectangle is being drawn. */
  marquee?: boolean;
};

export type GestureInterruption =
  /** Escape pressed. The canonical "put it back" key. */
  | { type: "escape" }
  /** The browser revoked the pointer: OS gesture, palm rejection, unplug. */
  | { type: "pointercancel" }
  /** The window lost focus — alt-tab, a system dialog, a different app. */
  | { type: "window-blur" }
  /** The tab was hidden. Pointer events simply stop arriving. */
  | { type: "visibility-hidden" }
  /** A second finger landed: the viewport owns this now, as a pinch. */
  | { type: "extra-touch"; activeTouches: number }
  /** Every object the gesture was acting on has left the document. */
  | { type: "targets-lost"; remainingTargets: number }
  /** The owner switched tool, mode or page out from under the gesture. */
  | { type: "tool-changed" };

/** Is there anything to abandon? */
export function isGestureActive(state: GestureLifecycleState | null | undefined): boolean {
  return Boolean(state?.dragging || state?.transforming || state?.marquee);
}

/**
 * Whether `interruption` should abandon the gesture described by `state`.
 *
 * Nothing is abandoned when no gesture is running, so every caller can fire
 * this unconditionally from a global listener without having to guard first —
 * which is what kept these listeners from being written at all.
 */
export function shouldAbortGesture(
  interruption: GestureInterruption,
  state: GestureLifecycleState | null | undefined,
): boolean {
  if (!isGestureActive(state)) return false;

  switch (interruption.type) {
    case "extra-touch":
      // One finger resting on the artwork plus a second arriving is a pinch,
      // not a 4mm move the customer will only discover once the card is
      // printed. A single touch is just the gesture itself.
      return Number(interruption.activeTouches) >= 2;

    case "targets-lost":
      // Some members surviving is a partial selection change, which the commit
      // path already tolerates by skipping the missing ones.
      return Number(interruption.remainingTargets) <= 0;

    case "escape":
    case "pointercancel":
    case "window-blur":
    case "visibility-hidden":
    case "tool-changed":
      return true;

    default:
      return false;
  }
}

/**
 * Should the canvas SWALLOW this Escape?
 *
 * Escape peels one layer of context at a time (spec §20). When it abandoned a
 * gesture, that was the layer it peeled, and letting it continue to the owner
 * would also clear the selection — so the customer would lose both the gesture
 * and the thing they were working on from one keypress. With no gesture to
 * abandon it must pass straight through.
 */
export function escapeConsumedByGesture(state: GestureLifecycleState | null | undefined): boolean {
  return isGestureActive(state);
}
