import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSaveQueue, saveStatusLabel, type SaveOutcome } from "../save-queue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createSaveQueue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces a burst of changes into one save", async () => {
    const save = vi.fn(async (): Promise<SaveOutcome> => ({ ok: true }));
    const queue = createSaveQueue({ save, debounceMs: 100 });

    queue.request();
    queue.request();
    queue.request();
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);
    expect(queue.getStatus()).toBe("saved");
  });

  it("never runs two saves at once — the duplicate-draft bug", async () => {
    const first = deferred<SaveOutcome>();
    const save = vi.fn(() => first.promise);
    const queue = createSaveQueue({ save, debounceMs: 50 });

    queue.request();
    await vi.advanceTimersByTimeAsync(50);
    expect(save).toHaveBeenCalledTimes(1);
    expect(queue.getStatus()).toBe("saving");

    // The customer keeps typing while the first request is still in flight.
    queue.request();
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);

    // Only when the first save lands does exactly one follow-up run.
    first.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(50);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("coalesces many changes made during one in-flight save into a single follow-up", async () => {
    const first = deferred<SaveOutcome>();
    let call = 0;
    const save = vi.fn(async (): Promise<SaveOutcome> => {
      call += 1;
      if (call === 1) return first.promise;
      return { ok: true };
    });
    const queue = createSaveQueue({ save, debounceMs: 20 });

    queue.request();
    await vi.advanceTimersByTimeAsync(20);
    for (let i = 0; i < 10; i += 1) queue.request();

    first.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(200);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("does not report Saved until the save resolves", async () => {
    const pending = deferred<SaveOutcome>();
    const statuses: string[] = [];
    const queue = createSaveQueue({
      save: () => pending.promise,
      debounceMs: 10,
      onStatusChange: (status) => statuses.push(status),
    });

    queue.request();
    expect(statuses).toEqual(["unsaved"]);
    await vi.advanceTimersByTimeAsync(10);
    expect(statuses).toEqual(["unsaved", "saving"]);
    expect(queue.getStatus()).not.toBe("saved");

    pending.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses).toEqual(["unsaved", "saving", "saved"]);
  });

  it("distinguishes a local-only write from a server-confirmed save", async () => {
    const queue = createSaveQueue({ save: async () => ({ ok: true, local: true }), debounceMs: 10 });
    queue.request();
    await vi.advanceTimersByTimeAsync(10);
    expect(queue.getStatus()).toBe("saved-local");
  });

  it("retries a failed save with backoff, then reports the failure", async () => {
    const save = vi
      .fn<() => Promise<SaveOutcome>>()
      .mockResolvedValueOnce({ ok: false, error: new Error("network") })
      .mockResolvedValueOnce({ ok: false, error: new Error("network") })
      .mockResolvedValueOnce({ ok: false, error: new Error("network") });
    const queue = createSaveQueue({ save, debounceMs: 10, retryDelaysMs: [20, 40] });

    queue.request();
    await vi.advanceTimersByTimeAsync(10);
    expect(save).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(20);
    expect(save).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(40);
    expect(save).toHaveBeenCalledTimes(3);
    expect(queue.getStatus()).toBe("error");
  });

  it("recovers after a retry succeeds", async () => {
    const save = vi
      .fn<() => Promise<SaveOutcome>>()
      .mockResolvedValueOnce({ ok: false, error: new Error("blip") })
      .mockResolvedValueOnce({ ok: true });
    const queue = createSaveQueue({ save, debounceMs: 10, retryDelaysMs: [20] });

    queue.request();
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(20);
    expect(queue.getStatus()).toBe("saved");
    expect(queue.hasPendingWork()).toBe(false);
  });

  it("treats a thrown save as a retryable failure instead of losing the change", async () => {
    const save = vi
      .fn<() => Promise<SaveOutcome>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ ok: true });
    const queue = createSaveQueue({ save, debounceMs: 10, retryDelaysMs: [20] });

    queue.request();
    await vi.advanceTimersByTimeAsync(10);
    expect(queue.hasPendingWork()).toBe(true);
    await vi.advanceTimersByTimeAsync(20);
    expect(queue.getStatus()).toBe("saved");
  });

  it("does not report a non-retryable failure as saved", async () => {
    const queue = createSaveQueue({
      save: async () => ({ ok: false, error: new Error("rejected"), retryable: false }),
      debounceMs: 10,
      retryDelaysMs: [20],
    });
    queue.request();
    await vi.advanceTimersByTimeAsync(10);
    expect(queue.getStatus()).toBe("error");
  });

  it("queues work while offline instead of claiming a save", async () => {
    let online = false;
    const save = vi.fn(async (): Promise<SaveOutcome> => ({ ok: true }));
    const queue = createSaveQueue({ save, debounceMs: 10, isOnline: () => online });

    queue.request();
    await vi.advanceTimersByTimeAsync(10);
    expect(save).not.toHaveBeenCalled();
    expect(queue.getStatus()).toBe("offline");
    expect(queue.hasPendingWork()).toBe(true);

    online = true;
    await vi.advanceTimersByTimeAsync(2100);
    expect(save).toHaveBeenCalledTimes(1);
    expect(queue.getStatus()).toBe("saved");
  });

  it("flush saves immediately and resolves once settled", async () => {
    const save = vi.fn(async (): Promise<SaveOutcome> => ({ ok: true }));
    const queue = createSaveQueue({ save, debounceMs: 5000 });

    queue.request();
    const settled = queue.flush();
    await vi.advanceTimersByTimeAsync(0);
    await settled;
    expect(save).toHaveBeenCalledTimes(1);
    expect(queue.hasPendingWork()).toBe(false);
  });

  it("flush resolves immediately when there is nothing to save", async () => {
    const save = vi.fn(async (): Promise<SaveOutcome> => ({ ok: true }));
    const queue = createSaveQueue({ save, debounceMs: 10 });
    await queue.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it("stops scheduling once destroyed", async () => {
    const save = vi.fn(async (): Promise<SaveOutcome> => ({ ok: true }));
    const queue = createSaveQueue({ save, debounceMs: 10 });
    queue.request();
    queue.destroy();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
  });

  it("reports pending work while changes are unsaved", async () => {
    const queue = createSaveQueue({ save: async () => ({ ok: true }), debounceMs: 10 });
    expect(queue.hasPendingWork()).toBe(false);
    queue.request();
    expect(queue.hasPendingWork()).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(queue.hasPendingWork()).toBe(false);
  });
});

describe("saveStatusLabel", () => {
  it("never says plain Saved for a local-only write", () => {
    expect(saveStatusLabel("saved-local", Date.now())).toBe("Saved on this device");
  });

  it("labels every state", () => {
    expect(saveStatusLabel("saving", null)).toBe("Saving…");
    expect(saveStatusLabel("saved", null)).toBe("Saved");
    expect(saveStatusLabel("saved", new Date("2026-08-06T09:05:00").getTime())).toBe("Saved 09:05");
    expect(saveStatusLabel("unsaved", null)).toBe("Unsaved changes");
    expect(saveStatusLabel("offline", null)).toBe("Offline — changes are queued");
    expect(saveStatusLabel("error", null)).toBe("Save failed");
    expect(saveStatusLabel("idle", null)).toBe("");
  });
});
