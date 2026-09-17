// Regression coverage for the gesture cancellation contract (spec §20).
//
// Before this, the ONLY interruption the interaction stage handled was "a
// second finger arrived". Escape, a revoked pointer (`pointercancel`), a lost
// window and a hidden tab all left the stage permanently mid-gesture: Konva
// never delivers the matching `dragend`/`transformend` in those cases, so the
// active flag stayed set, the Transformer could never re-attach on a selection
// change, and the transient preview kept painting geometry the document did not
// describe.

import { describe, expect, it } from "vitest";

import {
  escapeConsumedByGesture,
  isGestureActive,
  shouldAbortGesture,
  type GestureLifecycleState,
} from "../interaction/gesture-lifecycle";

const dragging: GestureLifecycleState = { dragging: true };
const transforming: GestureLifecycleState = { transforming: true };
const marquee: GestureLifecycleState = { marquee: true };
const idle: GestureLifecycleState = { dragging: false, transforming: false, marquee: false };

describe("gesture lifecycle", () => {
  it("knows when there is anything to abandon", () => {
    expect(isGestureActive(dragging)).toBe(true);
    expect(isGestureActive(transforming)).toBe(true);
    expect(isGestureActive(marquee)).toBe(true);
    expect(isGestureActive(idle)).toBe(false);
    expect(isGestureActive(null)).toBe(false);
    expect(isGestureActive(undefined)).toBe(false);
  });

  it("abandons a live gesture on every interruption the brief names", () => {
    for (const state of [dragging, transforming, marquee]) {
      expect(shouldAbortGesture({ type: "escape" }, state)).toBe(true);
      expect(shouldAbortGesture({ type: "pointercancel" }, state)).toBe(true);
      expect(shouldAbortGesture({ type: "window-blur" }, state)).toBe(true);
      expect(shouldAbortGesture({ type: "visibility-hidden" }, state)).toBe(true);
      expect(shouldAbortGesture({ type: "tool-changed" }, state)).toBe(true);
    }
  });

  it("does nothing at all when no gesture is running", () => {
    // Every listener fires this unconditionally from a window-level handler, so
    // an idle canvas must be completely unaffected.
    expect(shouldAbortGesture({ type: "escape" }, idle)).toBe(false);
    expect(shouldAbortGesture({ type: "window-blur" }, idle)).toBe(false);
    expect(shouldAbortGesture({ type: "pointercancel" }, null)).toBe(false);
    expect(shouldAbortGesture({ type: "extra-touch", activeTouches: 3 }, idle)).toBe(false);
  });

  it("treats a second finger as a pinch but leaves a one-finger drag alone", () => {
    expect(shouldAbortGesture({ type: "extra-touch", activeTouches: 1 }, dragging)).toBe(false);
    expect(shouldAbortGesture({ type: "extra-touch", activeTouches: 2 }, dragging)).toBe(true);
    expect(shouldAbortGesture({ type: "extra-touch", activeTouches: 5 }, dragging)).toBe(true);
  });

  it("only abandons on lost targets when the whole selection is gone", () => {
    // A partial loss is tolerated: the commit path already skips members whose
    // proxy has disappeared, and abandoning would throw away the rest.
    expect(shouldAbortGesture({ type: "targets-lost", remainingTargets: 2 }, dragging)).toBe(false);
    expect(shouldAbortGesture({ type: "targets-lost", remainingTargets: 0 }, dragging)).toBe(true);
  });

  it("swallows Escape only when it actually abandoned something", () => {
    // Otherwise one keypress would both cancel the gesture AND clear the
    // selection the customer was working on.
    expect(escapeConsumedByGesture(dragging)).toBe(true);
    expect(escapeConsumedByGesture(transforming)).toBe(true);
    expect(escapeConsumedByGesture(idle)).toBe(false);
    expect(escapeConsumedByGesture(null)).toBe(false);
  });
});
