"use client";

// Snapshot-based undo/redo for the customizer (customer and admin flavours).
// The caller records a snapshot of its undoable state BEFORE applying a change;
// undo() / redo() return the snapshot to restore. Continuous interactions
// (slider drags, typing bursts) pass a group key so they collapse into a single
// history entry instead of one per event.

import { useCallback, useRef, useState } from "react";

const DEFAULT_LIMIT = 50;
const GROUP_WINDOW_MS = 900;

type HistoryApi<T> = {
  record: (snapshot: T, group?: string) => void;
  undo: (current: T) => T | null;
  redo: (current: T) => T | null;
  reset: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

export default function useCustomizerHistory<T>(limit = DEFAULT_LIMIT): HistoryApi<T> {
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const lastGroup = useRef<{ key: string; at: number } | null>(null);
  const [, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);

  const record = useCallback(
    (snapshot: T, group?: string) => {
      const now = Date.now();
      if (
        group &&
        lastGroup.current &&
        lastGroup.current.key === group &&
        now - lastGroup.current.at < GROUP_WINDOW_MS
      ) {
        // Same continuous interaction: the snapshot before it is already saved.
        lastGroup.current.at = now;
        return;
      }
      lastGroup.current = group ? { key: group, at: now } : null;
      past.current.push(snapshot);
      if (past.current.length > limit) past.current.shift();
      future.current = [];
      bump();
    },
    [limit],
  );

  const undo = useCallback((current: T): T | null => {
    if (!past.current.length) return null;
    const previous = past.current.pop() as T;
    future.current.push(current);
    lastGroup.current = null;
    bump();
    return previous;
  }, []);

  const redo = useCallback((current: T): T | null => {
    if (!future.current.length) return null;
    const next = future.current.pop() as T;
    past.current.push(current);
    lastGroup.current = null;
    bump();
    return next;
  }, []);

  const reset = useCallback(() => {
    past.current = [];
    future.current = [];
    lastGroup.current = null;
    bump();
  }, []);

  return {
    record,
    undo,
    redo,
    reset,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}
