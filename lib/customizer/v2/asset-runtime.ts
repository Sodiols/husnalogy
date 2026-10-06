// The ONE runtime resolver for Customizer image credentials.
//
// Every canvas image with a durable identity (asset-identity.ts) gets its
// signed URL through here, in the admin studio and the customer editor alike.
// The resolver:
//
//  - caches one signed URL per asset and variant, keyed by IDENTITY, never by
//    URL, so re-renders, remounts, undo/redo and page switches reuse it;
//  - knows each URL's expiry (from the server's answer, or the URL's own
//    token) and renews it in the background BEFORE it lapses, for every image
//    on screen;
//  - batches and de-duplicates requests: one request per asset per renewal,
//    however many layers show it;
//  - backs off and retries after a failure, and again when the browser comes
//    back online, without ever discarding the last working URL.
//
// It never touches the design document. A renewed credential is runtime
// state, so it cannot create an undo step, mark the design unsaved, or trigger
// autosave. The network and the clock are injected, so all of this is unit
// tested without a browser.

import { signedUrlExpiry, type AssetIdentity } from "./asset-identity";
import type { CustomerAssetReference } from "./asset-references";

/** Editor: the optimized canvas variant. Original: full quality, the fallback. Never the thumbnail. */
export type AssetVariant = "editor" | "original";

export type SignedAsset = { url: string; expiresAt: number | null; obtainedAt: number };

export type LibrarySignRequest = { assetId: string; variant: AssetVariant };

export type AssetRuntimeDeps = {
  /** Sign library assets. Resolves with one entry per signed asset, keyed `${assetId}:${variant}`. */
  signLibrary: (requests: LibrarySignRequest[], reason?: string) => Promise<Map<string, { url: string; expiresAt: number | null }>>;
  /** Sign customer uploads. Resolves with one entry per reference, keyed by identity key. */
  resolveCustomer: (
    references: Array<{ key: string; reference: CustomerAssetReference }>,
    variant: AssetVariant,
  ) => Promise<Map<string, { url: string; expiresAt: number | null }>>;
  now: () => number;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
};

export type AssetRuntime = ReturnType<typeof createAssetRuntime>;

/** How long before expiry a URL is renewed: a fifth of its lifetime, 1–10 minutes, never more than half. */
export function renewalMargin(lifetimeMs: number): number {
  const margin = Math.min(10 * 60_000, Math.max(60_000, lifetimeMs * 0.2));
  return Math.min(margin, Math.max(0, lifetimeMs * 0.5));
}

/** Whether a URL can still be handed to the browser: unexpired, with the renewal margin to spare. */
export function isFresh(asset: Pick<SignedAsset, "expiresAt" | "obtainedAt"> | null | undefined, now: number): boolean {
  if (!asset) return false;
  if (asset.expiresAt === null) return true;
  return now < asset.expiresAt - renewalMargin(asset.expiresAt - asset.obtainedAt);
}

const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

type Pending = { identity: AssetIdentity; variant: AssetVariant; reason?: string; resolve: (asset: SignedAsset) => void; reject: (error: unknown) => void };
type Watcher = { identity: AssetIdentity; variant: AssetVariant; listeners: Set<(asset: SignedAsset) => void>; timer: unknown; failures: number };

export function createAssetRuntime(deps: AssetRuntimeDeps) {
  const cache = new Map<string, SignedAsset>();
  const inFlight = new Map<string, Promise<SignedAsset>>();
  const watchers = new Map<string, Watcher>();
  let queue: Pending[] = [];
  let flushTimer: unknown = null;
  /** Requests sent to the server, for tests and diagnostics. */
  let requestCount = 0;

  const slot = (identity: AssetIdentity, variant: AssetVariant) => `${identity.key}:${variant}`;

  /** A URL the page already has (from server hydration). Kept only when it is still fresh. */
  function seed(identity: AssetIdentity, variant: AssetVariant, url: string, expiresAt?: number | null) {
    if (!url) return;
    const key = slot(identity, variant);
    const now = deps.now();
    const known = expiresAt ?? signedUrlExpiry(url);
    const candidate: SignedAsset = { url, expiresAt: known ?? null, obtainedAt: now };
    const current = cache.get(key);
    // A seed never replaces a fresher URL the resolver already holds.
    if (current && isFresh(current, now) && (current.expiresAt ?? Infinity) >= (candidate.expiresAt ?? Infinity)) return;
    if (known !== null && known <= now) return;
    // An expiry of unknown origin is trusted only with a lifetime estimate.
    cache.set(key, known === null ? candidate : { ...candidate, obtainedAt: Math.min(now, known - 60 * 60_000) });
  }

  function peek(identity: AssetIdentity, variant: AssetVariant): SignedAsset | null {
    const asset = cache.get(slot(identity, variant));
    return asset && isFresh(asset, deps.now()) ? asset : null;
  }

  async function flush() {
    flushTimer = null;
    const batch = queue;
    queue = [];
    const settle = (items: Pending[], results: Map<string, { url: string; expiresAt: number | null }>, keyOf: (item: Pending) => string) => {
      for (const item of items) {
        const result = results.get(keyOf(item));
        if (result?.url) {
          const asset = { url: result.url, expiresAt: result.expiresAt ?? signedUrlExpiry(result.url), obtainedAt: deps.now() };
          cache.set(slot(item.identity, item.variant), asset);
          item.resolve(asset);
        } else {
          item.reject(new Error(`Asset ${item.identity.key} (${item.variant}) could not be signed.`));
        }
      }
    };
    const fail = (items: Pending[], error: unknown) => items.forEach((item) => item.reject(error));

    const library = batch.filter((item) => item.identity.kind === "library");
    for (const variant of ["editor", "original"] as const) {
      const items = library.filter((item) => item.variant === variant);
      if (!items.length) continue;
      const reason = items.find((item) => item.reason)?.reason;
      const ids = [...new Set(items.map((item) => (item.identity as Extract<AssetIdentity, { kind: "library" }>).assetId))];
      requestCount += 1;
      try {
        const results = await deps.signLibrary(ids.map((assetId) => ({ assetId, variant })), reason);
        settle(items, results, (item) => `${(item.identity as Extract<AssetIdentity, { kind: "library" }>).assetId}:${variant}`);
      } catch (error) {
        fail(items, error);
      }
    }
    const customer = batch.filter((item) => item.identity.kind === "customer");
    for (const variant of ["editor", "original"] as const) {
      const items = customer.filter((item) => item.variant === variant);
      if (!items.length) continue;
      const unique = new Map(items.map((item) => [item.identity.key, item.identity as Extract<AssetIdentity, { kind: "customer" }>]));
      requestCount += 1;
      try {
        const results = await deps.resolveCustomer([...unique.values()].map((identity) => ({ key: identity.key, reference: identity.reference })), variant);
        settle(items, results, (item) => item.identity.key);
      } catch (error) {
        fail(items, error);
      }
    }
  }

  /**
   * A usable URL for the asset: the cached one while fresh, otherwise a new
   * one. `force` skips the cache — the browser just failed to load it.
   */
  function get(identity: AssetIdentity, variant: AssetVariant, options: { force?: boolean; reason?: string } = {}): Promise<SignedAsset> {
    const key = slot(identity, variant);
    if (!options.force) {
      const cached = peek(identity, variant);
      if (cached) return Promise.resolve(cached);
    }
    const running = inFlight.get(key);
    if (running) return running;
    const promise = new Promise<SignedAsset>((resolve, reject) => {
      queue.push({ identity, variant, reason: options.reason, resolve, reject });
      if (flushTimer === null) flushTimer = deps.setTimer(() => void flush(), 15);
    }).finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  }

  function schedule(watcher: Watcher) {
    if (watcher.timer !== null) deps.clearTimer(watcher.timer);
    watcher.timer = null;
    const asset = cache.get(slot(watcher.identity, watcher.variant));
    if (!asset || asset.expiresAt === null) return;
    const renewAt = asset.expiresAt - renewalMargin(asset.expiresAt - asset.obtainedAt);
    watcher.timer = deps.setTimer(() => void renew(watcher), Math.max(0, renewAt - deps.now()));
  }

  async function renew(watcher: Watcher) {
    watcher.timer = null;
    if (!watchers.has(slot(watcher.identity, watcher.variant))) return;
    try {
      const fresh = await get(watcher.identity, watcher.variant, { force: true });
      watcher.failures = 0;
      watcher.listeners.forEach((listener) => listener(fresh));
      schedule(watcher);
    } catch {
      // Keep the current URL; try again shortly. A URL that is still valid
      // keeps working meanwhile, and `retryNow` short-circuits the wait when
      // the connection returns.
      const delay = RETRY_DELAYS_MS[Math.min(watcher.failures, RETRY_DELAYS_MS.length - 1)];
      watcher.failures += 1;
      watcher.timer = deps.setTimer(() => void renew(watcher), delay);
    }
  }

  /**
   * Keep this asset's URL renewed for as long as something shows it. The
   * listener receives each renewed URL; the caller swaps to it only after the
   * new URL has loaded, so the picture never blanks.
   */
  function watch(identity: AssetIdentity, variant: AssetVariant, listener: (asset: SignedAsset) => void): () => void {
    const key = slot(identity, variant);
    let watcher = watchers.get(key);
    if (!watcher) {
      watcher = { identity, variant, listeners: new Set(), timer: null, failures: 0 };
      watchers.set(key, watcher);
      schedule(watcher);
    }
    watcher.listeners.add(listener);
    const current = watcher;
    return () => {
      current.listeners.delete(listener);
      if (current.listeners.size) return;
      if (current.timer !== null) deps.clearTimer(current.timer);
      watchers.delete(key);
    };
  }

  /** Re-arm a watcher after a new URL arrived outside the renewal loop. */
  function rescheduleWatch(identity: AssetIdentity, variant: AssetVariant) {
    const watcher = watchers.get(slot(identity, variant));
    if (watcher) schedule(watcher);
  }

  /** The connection is back: renew every watched asset whose last renewal failed, now. */
  function retryNow() {
    for (const watcher of watchers.values()) {
      if (watcher.failures > 0) void renew(watcher);
    }
  }

  return { seed, peek, get, watch, rescheduleWatch, retryNow, requests: () => requestCount };
}
