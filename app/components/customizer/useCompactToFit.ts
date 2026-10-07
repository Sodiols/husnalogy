"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Whether a one-row toolbar must use its compact density to fit its space.
 *
 * The comfortable layout is always tried first; if its row is wider than the
 * space it has, the toolbar switches to compact. Both renders happen before
 * paint, so nothing flickers. Any change in the available width (window, side
 * panels opening or closing) tries the comfortable layout again.
 *
 * `ref` goes on the row that would overflow (the toolbar itself, with
 * `max-w-full`); the available width is watched on its nearest
 * `[data-density-host]` ancestor, or its parent.
 */
export function useCompactToFit<T extends HTMLElement>(enabled = true, resetKey?: unknown) {
  const ref = useRef<T>(null);
  const [compact, setCompact] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // A new space (or content) to fit: try the comfortable layout first.
  useLayoutEffect(() => {
    setCompact(false);
  }, [attempt, resetKey]);

  // Measure the comfortable row; fall back to compact if it does not fit.
  // The bars using this have fixed-width controls, so the row's width changes
  // only with the space (attempt), the content key or the density itself.
  useLayoutEffect(() => {
    const row = ref.current;
    if (!enabled || !row || compact) return;
    if (row.scrollWidth > row.clientWidth + 1) setCompact(true);
  }, [enabled, compact, attempt, resetKey]);

  useEffect(() => {
    const row = ref.current;
    if (!enabled || !row || typeof ResizeObserver === "undefined") return;
    const host = (row.closest("[data-density-host]") as HTMLElement | null) || row.parentElement;
    if (!host) return;
    let width = host.clientWidth;
    const observer = new ResizeObserver(() => {
      if (host.clientWidth === width) return;
      width = host.clientWidth;
      setAttempt((value) => value + 1);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [enabled]);

  return { ref, compact: enabled && compact };
}
