import { describe, expect, it } from "vitest";
import { createAssetRuntime, isFresh, renewalMargin, type LibrarySignRequest } from "../asset-runtime";
import type { AssetIdentity } from "../asset-identity";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** A deterministic clock and timer queue. */
function fakeTime(start = 1_000_000) {
  let now = start;
  const timers: Array<{ at: number; run: () => void; id: number }> = [];
  let id = 0;
  return {
    now: () => now,
    setTimer: (run: () => void, ms: number) => {
      id += 1;
      timers.push({ at: now + ms, run, id });
      return id;
    },
    clearTimer: (handle: unknown) => {
      const index = timers.findIndex((timer) => timer.id === handle);
      if (index >= 0) timers.splice(index, 1);
    },
    /** Advance the clock, running every timer that comes due, in order. */
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        now = next.at;
        next.run();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      now = end;
    },
  };
}

const library = (assetId: string): AssetIdentity => ({ kind: "library", key: `library:${assetId}`, assetId });

function setup(options: { fail?: () => boolean; lifetime?: number } = {}) {
  const time = fakeTime();
  const calls: Array<{ requests: LibrarySignRequest[]; reason?: string }> = [];
  let serial = 0;
  const runtime = createAssetRuntime({
    signLibrary: async (requests, reason) => {
      calls.push({ requests, reason });
      if (options.fail?.()) throw new Error("offline");
      serial += 1;
      return new Map(requests.map((request) => [`${request.assetId}:${request.variant}`, { url: `https://x/${request.assetId}/${request.variant}?v=${serial}`, expiresAt: time.now() + (options.lifetime ?? HOUR) }]));
    },
    resolveCustomer: async () => new Map(),
    now: time.now,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
  });
  return { time, calls, runtime };
}

describe("renewal timing", () => {
  it("renews a fifth of the way before expiry, between one and ten minutes, never more than half", () => {
    expect(renewalMargin(HOUR)).toBe(10 * MINUTE);
    expect(renewalMargin(20 * MINUTE)).toBe(4 * MINUTE);
    expect(renewalMargin(2 * MINUTE)).toBe(MINUTE);
    expect(renewalMargin(60_000)).toBe(30_000);
  });

  it("treats a URL inside its renewal margin as stale", () => {
    const asset = { expiresAt: HOUR, obtainedAt: 0 };
    expect(isFresh(asset, 49 * MINUTE)).toBe(true);
    expect(isFresh(asset, 51 * MINUTE)).toBe(false);
    expect(isFresh({ expiresAt: null, obtainedAt: 0 }, 10 * HOUR)).toBe(true);
  });
});

describe("one request per asset, however many images ask", () => {
  it("batches and de-duplicates concurrent requests", async () => {
    const { time, calls, runtime } = setup();
    const pending = [runtime.get(library("a"), "editor"), runtime.get(library("a"), "editor"), runtime.get(library("b"), "editor")];
    await time.advance(20);
    const [a1, a2, b] = await Promise.all(pending);
    expect(calls).toHaveLength(1);
    expect(calls[0].requests).toEqual([{ assetId: "a", variant: "editor" }, { assetId: "b", variant: "editor" }]);
    expect(a1.url).toBe(a2.url);
    expect(b.url).toContain("/b/editor");
  });

  it("serves a fresh URL from cache — re-renders and remounts cost nothing", async () => {
    const { time, calls, runtime } = setup();
    const first = runtime.get(library("a"), "editor");
    await time.advance(20);
    await first;
    for (let index = 0; index < 50; index += 1) await runtime.get(library("a"), "editor");
    expect(calls).toHaveLength(1);
  });

  it("uses a hydrated URL that is still fresh, and refuses one already expired", async () => {
    const { time, calls, runtime } = setup();
    runtime.seed(library("a"), "editor", "https://hydrated/a", time.now() + HOUR);
    expect((await runtime.get(library("a"), "editor")).url).toBe("https://hydrated/a");
    runtime.seed(library("b"), "editor", "https://hydrated/b-expired", time.now() - 1);
    const fresh = runtime.get(library("b"), "editor");
    await time.advance(20);
    expect((await fresh).url).toContain("/b/editor");
    expect(calls).toHaveLength(1);
  });

  it("force-refreshes after a load failure and passes the reason to the server", async () => {
    const { time, calls, runtime } = setup();
    runtime.seed(library("a"), "editor", "https://hydrated/a", time.now() + HOUR);
    const forced = runtime.get(library("a"), "editor", { force: true, reason: "editor-load-failed" });
    await time.advance(20);
    expect((await forced).url).toContain("/a/editor");
    expect(calls[0].reason).toBe("editor-load-failed");
  });
});

describe("long sessions: on-screen images are renewed before they expire", () => {
  it("renews each watched URL ahead of expiry, for as long as it is watched", async () => {
    const { time, calls, runtime } = setup({ lifetime: HOUR });
    const first = runtime.get(library("a"), "editor");
    await time.advance(20);
    let onScreen = await first;
    const seen: string[] = [];
    const stop = runtime.watch(library("a"), "editor", (asset) => {
      seen.push(asset.url);
      onScreen = asset;
    });
    // Five hours of an open studio: renewed every ~50 minutes; the URL on
    // screen is never an expired one.
    for (let minute = 0; minute < 300; minute += 5) {
      await time.advance(5 * MINUTE);
      expect(time.now()).toBeLessThan(onScreen.expiresAt!);
    }
    expect(seen.length).toBeGreaterThanOrEqual(5);
    expect(new Set(seen).size).toBe(seen.length);
    const before = calls.length;
    stop();
    await time.advance(3 * HOUR);
    expect(calls.length).toBe(before);
  });

  it("keeps the current URL through a failed renewal, backs off, and recovers when the network returns", async () => {
    let offline = false;
    const { time, calls, runtime } = setup({ fail: () => offline, lifetime: HOUR });
    const first = runtime.get(library("a"), "editor");
    await time.advance(20);
    const original = await first;
    const seen: string[] = [];
    runtime.watch(library("a"), "editor", (asset) => seen.push(asset.url));
    offline = true;
    await time.advance(52 * MINUTE);
    expect(seen).toEqual([]);
    const failedAttempts = calls.length;
    expect(failedAttempts).toBeGreaterThan(1);
    // Back online: one nudge renews immediately rather than waiting for the backoff.
    offline = false;
    runtime.retryNow();
    await time.advance(20);
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toBe(original.url);
  });
});
