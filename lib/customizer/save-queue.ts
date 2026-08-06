// Debounced, single-flight save queue for customizer drafts (spec §11).
//
// The customer editor used to autosave with a bare `setTimeout(900)` per change
// batch. That has three defects the spec calls out:
//
//   1. No single-flight. A slow PATCH plus continued typing let a second save
//      start before the first finished. When the draft had no id yet, both were
//      POSTs — producing DUPLICATE drafts ("Do not create duplicate drafts when
//      the customer returns to a saved design").
//   2. No retry. One flaky request left the editor in "Save failed" until the
//      next keystroke.
//   3. No offline handling, and "Saved" was reported for local-only writes
//      exactly as for server-confirmed ones ("Do not display Saved before the
//      server confirms the save").
//
// The queue is renderer-agnostic and timer-injectable so it is fully testable.

export type SaveQueueStatus =
  | "idle"
  | "unsaved"
  | "saving"
  | "saved"
  // Written to this browser only — never presented as a confirmed server save.
  | "saved-local"
  | "offline"
  | "error";

export type SaveOutcome =
  | { ok: true; local?: boolean }
  | { ok: false; error: unknown; retryable?: boolean };

export type SaveQueueOptions = {
  /** Performs one save. Must resolve — rejections are treated as retryable. */
  save: () => Promise<SaveOutcome>;
  onStatusChange?: (status: SaveQueueStatus, detail: { lastSavedAt: number | null; error: unknown }) => void;
  /** Quiet period after the last change before a save starts. */
  debounceMs?: number;
  /** Backoff for retryable failures. An empty array disables retrying. */
  retryDelaysMs?: number[];
  isOnline?: () => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
};

export type SaveQueue = {
  /** Record a change; schedules a save after the debounce window. */
  request: () => void;
  /** Save immediately and resolve once the queue is settled. */
  flush: () => Promise<void>;
  /** Stop all timers. Any in-flight save is left to finish. */
  destroy: () => void;
  getStatus: () => SaveQueueStatus;
  getLastSavedAt: () => number | null;
  /** True while there are unsaved changes or a save is running. */
  hasPendingWork: () => boolean;
};

const DEFAULT_DEBOUNCE_MS = 900;
const DEFAULT_RETRY_DELAYS_MS = [1200, 4000];

export function createSaveQueue(options: SaveQueueOptions): SaveQueue {
  const debounceMs = Math.max(0, Number(options.debounceMs ?? DEFAULT_DEBOUNCE_MS));
  const retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const now = options.now ?? (() => Date.now());
  const isOnline = options.isOnline ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));

  let status: SaveQueueStatus = "idle";
  let lastSavedAt: number | null = null;
  let lastError: unknown = null;
  let timer: unknown = null;
  let running = false;
  let dirty = false;
  let retryCount = 0;
  let destroyed = false;
  let settleWaiters: Array<() => void> = [];

  function setStatus(next: SaveQueueStatus) {
    if (status === next) return;
    status = next;
    options.onStatusChange?.(next, { lastSavedAt, error: lastError });
  }

  function clearPendingTimer() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function settle() {
    if (running || dirty) return;
    const waiters = settleWaiters;
    settleWaiters = [];
    waiters.forEach((resolve) => resolve());
  }

  function schedule(delayMs: number) {
    clearPendingTimer();
    if (destroyed) return;
    timer = setTimer(() => {
      timer = null;
      void run();
    }, delayMs);
  }

  async function run(): Promise<void> {
    if (destroyed || running || !dirty) return;

    if (!isOnline()) {
      // Keep the work queued; nothing is lost and the status is honest.
      setStatus("offline");
      schedule(Math.max(debounceMs, 2000));
      return;
    }

    running = true;
    // Claim the current changes. Anything typed from here on re-dirties the
    // queue and triggers exactly one follow-up save when this one lands.
    dirty = false;
    setStatus("saving");

    let outcome: SaveOutcome;
    try {
      outcome = await options.save();
    } catch (error) {
      outcome = { ok: false, error, retryable: true };
    }

    running = false;
    if (destroyed) return;

    if (outcome.ok) {
      retryCount = 0;
      lastError = null;
      lastSavedAt = now();
      // A local-only write is never reported as a confirmed save.
      setStatus(outcome.local ? "saved-local" : "saved");
      if (dirty) {
        setStatus("unsaved");
        schedule(debounceMs);
      }
      settle();
      return;
    }

    const failure = outcome as Extract<SaveOutcome, { ok: false }>;
    lastError = failure.error;
    // The change that failed is still unsaved — put it back in the queue.
    dirty = true;

    const retryable = failure.retryable !== false;
    if (retryable && retryCount < retryDelays.length) {
      const delay = retryDelays[retryCount];
      retryCount += 1;
      setStatus("saving");
      schedule(delay);
      return;
    }

    retryCount = 0;
    setStatus(isOnline() ? "error" : "offline");
    settle();
  }

  return {
    request() {
      if (destroyed) return;
      dirty = true;
      retryCount = 0;
      if (!running) setStatus("unsaved");
      schedule(debounceMs);
    },
    flush() {
      if (destroyed) return Promise.resolve();
      clearPendingTimer();
      const settled = new Promise<void>((resolve) => {
        if (!running && !dirty) {
          resolve();
          return;
        }
        settleWaiters.push(resolve);
      });
      if (!running && dirty) void run();
      return settled;
    },
    destroy() {
      destroyed = true;
      clearPendingTimer();
      settleWaiters.forEach((resolve) => resolve());
      settleWaiters = [];
    },
    getStatus: () => status,
    getLastSavedAt: () => lastSavedAt,
    hasPendingWork: () => dirty || running,
  };
}

/** Human label for a save status. Shared so header and review agree. */
export function saveStatusLabel(status: SaveQueueStatus, lastSavedAt: number | null): string {
  switch (status) {
    case "saving":
      return "Saving…";
    case "saved":
      return lastSavedAt ? `Saved ${formatClock(lastSavedAt)}` : "Saved";
    case "saved-local":
      return "Saved on this device";
    case "unsaved":
      return "Unsaved changes";
    case "offline":
      return "Offline — changes are queued";
    case "error":
      return "Save failed";
    default:
      return "";
  }
}

function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
