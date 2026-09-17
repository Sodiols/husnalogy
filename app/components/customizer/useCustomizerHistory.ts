"use client";

// Snapshot-based undo/redo for the customizer (customer and admin flavours).
// The caller records a snapshot of its undoable state BEFORE applying a change;
// undo() / redo() return the snapshot to restore. Continuous interactions
// (slider drags, typing bursts) pass a group key so they collapse into a single
// history entry instead of one per event.
//
// The stacks live in a plain object (`createHistoryStacks`) that the hook wraps.
// That keeps the rules — grouping, limits, checkpoints — testable without a
// React renderer, and the hook only adds a re-render when the stacks change.

import { useCallback, useRef, useState } from "react";

import { recordEditorEvent } from "@/lib/customizer/v2/dev-metrics";

const DEFAULT_LIMIT = 50;
const GROUP_WINDOW_MS = 900;

/**
 * An exact copy of the undo and redo stacks at one moment.
 *
 * A modal editing session (crop) takes one when it opens so Cancel can put
 * history back EXACTLY as it was — however many steps the session committed —
 * instead of popping entries one at a time and hoping the count is right.
 * Copies hold snapshot references, not snapshot contents, so taking one is an
 * array copy, not a document copy.
 */
export type HistoryCheckpoint<T> = {
  readonly past: readonly T[];
  readonly future: readonly T[];
};

export type HistoryStacks<T> = {
  /** True when an entry was pushed (false when a group window absorbed it). */
  record: (snapshot: T, group?: string) => boolean;
  undo: (current: T) => T | null;
  redo: (current: T) => T | null;
  discardLast: () => void;
  reset: () => void;
  checkpoint: () => HistoryCheckpoint<T>;
  restoreCheckpoint: (checkpoint: HistoryCheckpoint<T>) => void;
  depth: () => { past: number; future: number };
};

export function createHistoryStacks<T>(
  limit = DEFAULT_LIMIT,
  now: () => number = () => Date.now(),
): HistoryStacks<T> {
  let past: T[] = [];
  let future: T[] = [];
  let lastGroup: { key: string; at: number } | null = null;

  return {
    record(snapshot, group) {
      const at = now();
      if (group && lastGroup && lastGroup.key === group && at - lastGroup.at < GROUP_WINDOW_MS) {
        // Same continuous interaction: the snapshot before it is already saved.
        lastGroup.at = at;
        return false;
      }
      lastGroup = group ? { key: group, at } : null;
      past.push(snapshot);
      if (past.length > limit) past.shift();
      future = [];
      return true;
    },
    undo(current) {
      if (!past.length) return null;
      const previous = past.pop() as T;
      future.push(current);
      lastGroup = null;
      return previous;
    },
    redo(current) {
      if (!future.length) return null;
      const next = future.pop() as T;
      past.push(current);
      lastGroup = null;
      return next;
    },
    discardLast() {
      if (!past.length) return;
      past.pop();
      future = [];
      lastGroup = null;
    },
    reset() {
      past = [];
      future = [];
      lastGroup = null;
    },
    checkpoint: () => ({ past: past.slice(), future: future.slice() }),
    restoreCheckpoint(saved) {
      past = saved.past.slice();
      future = saved.future.slice();
      // A group window opened inside the discarded steps must not swallow the
      // next real edit into an entry that no longer exists.
      lastGroup = null;
    },
    depth: () => ({ past: past.length, future: future.length }),
  };
}

type HistoryApi<T> = {
  record: (snapshot: T, group?: string) => void;
  undo: (current: T) => T | null;
  redo: (current: T) => T | null;
  discardLast: () => void;
  reset: () => void;
  /** Capture both stacks so they can later be restored exactly. */
  checkpoint: () => HistoryCheckpoint<T>;
  /** Replace both stacks with a checkpoint taken earlier. */
  restoreCheckpoint: (checkpoint: HistoryCheckpoint<T>) => void;
  /** Current stack depths, for callers that must not cross a checkpoint. */
  depth: () => { past: number; future: number };
  canUndo: boolean;
  canRedo: boolean;
};

export default function useCustomizerHistory<T>(limit = DEFAULT_LIMIT): HistoryApi<T> {
  const stacksRef = useRef<HistoryStacks<T> | null>(null);
  if (!stacksRef.current) stacksRef.current = createHistoryStacks<T>(limit);
  const stacks = stacksRef.current;
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  const record = useCallback(
    (snapshot: T, group?: string) => {
      if (!stacks.record(snapshot, group)) return;
      recordEditorEvent("historyTransaction");
      bump();
    },
    [stacks, bump],
  );

  const undo = useCallback(
    (current: T): T | null => {
      const previous = stacks.undo(current);
      if (previous !== null) bump();
      return previous;
    },
    [stacks, bump],
  );

  const redo = useCallback(
    (current: T): T | null => {
      const next = stacks.redo(current);
      if (next !== null) bump();
      return next;
    },
    [stacks, bump],
  );

  const discardLast = useCallback(() => {
    stacks.discardLast();
    bump();
  }, [stacks, bump]);

  const reset = useCallback(() => {
    stacks.reset();
    bump();
  }, [stacks, bump]);

  const checkpoint = useCallback(() => stacks.checkpoint(), [stacks]);

  const restoreCheckpoint = useCallback(
    (saved: HistoryCheckpoint<T>) => {
      stacks.restoreCheckpoint(saved);
      bump();
    },
    [stacks, bump],
  );

  const depth = useCallback(() => stacks.depth(), [stacks]);
  const { past, future } = stacks.depth();

  return {
    record,
    undo,
    redo,
    discardLast,
    reset,
    checkpoint,
    restoreCheckpoint,
    depth,
    canUndo: past > 0,
    canRedo: future > 0,
  };
}
