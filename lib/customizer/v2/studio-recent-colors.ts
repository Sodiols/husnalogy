/**
 * The Design Studio's recently used colours: ONE list shared by every colour
 * control (text, shape fill and line, page background), most recent first.
 *
 * It is an editor convenience, not design data, so it lives in this browser
 * (localStorage) rather than in any template — and every read and write is
 * guarded, so a private window or blocked storage just starts empty.
 */
import { useSyncExternalStore } from "react";
import { normalizeHexInput } from "./background-palette";

export const RECENT_COLORS_KEY = "husnalogy_studio_recent_colors";
export const RECENT_COLORS_LIMIT = 8;

const EMPTY: string[] = [];
const listeners = new Set<() => void>();
let cache: string[] | null = null;

/** Pure: the list with `color` moved to the front, deduplicated, capped. */
export function pushRecentColor(list: ReadonlyArray<string>, color: unknown, limit = RECENT_COLORS_LIMIT): string[] {
  const hex = normalizeHexInput(color);
  if (!hex) return [...list];
  return [hex, ...list.filter((entry) => entry !== hex)].slice(0, limit);
}

function read(): string[] {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_COLORS_KEY) || "[]");
    cache = Array.isArray(parsed) ? parsed.map(normalizeHexInput).filter((hex): hex is string => Boolean(hex)).slice(0, RECENT_COLORS_LIMIT) : [];
  } catch {
    cache = [];
  }
  return cache;
}

/** Records a colour the admin just applied. */
export function rememberRecentColor(color: unknown) {
  if (typeof window === "undefined") return;
  const next = pushRecentColor(read(), color);
  if (next.join() === read().join()) return;
  cache = next;
  try {
    window.localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: the list still works for this page view.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== RECENT_COLORS_KEY) return;
    cache = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useRecentColors(): string[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
