"use client";

// Browser side of the shared asset resolver (lib/customizer/v2/asset-runtime.ts):
// the page-wide resolver instance, the image probe, and the hook every canvas
// image uses to decide WHICH URL to draw.
//
// The state machine per image, identical in the admin studio and the customer
// editor:
//
//   editor URL (cached / hydrated, renewed before expiry)
//     → loads and is sharp enough      → draw it
//     → fails to load / decode         → fresh editor URL, retry
//     → still fails, or is too small   → fresh ORIGINAL URL (where the viewer
//                                        may have it) and report the editor
//                                        variant for repair
//     → nothing loads                  → keep the last working picture (or a
//                                        recoverable placeholder) and retry on
//                                        reconnect — the layer is never touched
//
// A new URL replaces the drawn one only after it has loaded, so a renewal
// never blanks the picture. Nothing here edits the design: credentials are
// runtime state and can never create an undo step, an unsaved mark or an
// autosave.

import { useEffect, useMemo, useRef, useState } from "react";
import { assetIdentityOf, signedUrlExpiry, type AssetIdentity } from "@/lib/customizer/v2/asset-identity";
import { createAssetRuntime, type AssetRuntime, type AssetVariant } from "@/lib/customizer/v2/asset-runtime";

type RuntimeContext = { audience: "studio" | "customer"; productId: string };
const context: RuntimeContext = { audience: "customer", productId: "" };

/** Tell the resolver who is viewing: the studio may fall back to originals, a customer page names its product. */
export function configureAssetRuntime(next: Partial<RuntimeContext>) {
  if (next.audience) context.audience = next.audience;
  if (next.productId !== undefined) context.productId = next.productId;
}

const parseExpiry = (value: unknown, url: string): number | null => {
  const parsed = typeof value === "string" ? Date.parse(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(parsed) ? parsed : signedUrlExpiry(url);
};

let runtime: AssetRuntime | null = null;

/** The page's single resolver instance. */
export function assetRuntime(): AssetRuntime {
  if (runtime) return runtime;
  runtime = createAssetRuntime({
    signLibrary: async (requests, reason) => {
      const res = await fetch("/api/customizer/assets/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ assets: requests, productId: context.productId || undefined, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.assets)) throw new Error(`Asset signing failed (${res.status}).`);
      const results = new Map<string, { url: string; expiresAt: number | null }>();
      for (const asset of data.assets) {
        if (asset?.assetId && asset?.url) results.set(`${asset.assetId}:${asset.variant}`, { url: String(asset.url), expiresAt: parseExpiry(asset.expiresAt, String(asset.url)) });
      }
      return results;
    },
    resolveCustomer: async (references, variant) => {
      const res = await fetch("/api/customizer/assets/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ references: references.map((entry) => entry.reference), variant }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.assets)) throw new Error(`Photo signing failed (${res.status}).`);
      const results = new Map<string, { url: string; expiresAt: number | null }>();
      references.forEach((entry, index) => {
        const asset = data.assets[index];
        if (asset?.signedUrl) results.set(entry.key, { url: String(asset.signedUrl), expiresAt: parseExpiry(asset.expiresAt, String(asset.signedUrl)) });
      });
      return results;
    },
    now: () => Date.now(),
    setTimer: (callback, ms) => window.setTimeout(callback, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
  });
  if (typeof window !== "undefined") window.addEventListener("online", () => runtime?.retryNow());
  return runtime;
}

/* ----------------------------------------------------------------- probe -- */

type Probe = { width: number; height: number } | null;
const probes = new Map<string, Promise<Probe>>();

/** Load and decode a URL off-screen. Successful results are remembered; failures are retried next time. */
export function probeImage(url: string): Promise<Probe> {
  if (!url) return Promise.resolve(null);
  const known = probes.get(url);
  if (known) return known;
  const pending = new Promise<Probe>((resolve) => {
    if (typeof window === "undefined" || typeof window.Image === "undefined") {
      resolve({ width: 0, height: 0 });
      return;
    }
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      const done = () => resolve(image.naturalWidth > 0 ? { width: image.naturalWidth, height: image.naturalHeight } : null);
      if (typeof image.decode === "function") image.decode().then(done, () => resolve(null));
      else done();
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
  probes.set(url, pending);
  void pending.then((result) => {
    if (!result) probes.delete(url);
    // Bounded: a long session with many renewals must not grow without limit.
    if (probes.size > 400) probes.delete(probes.keys().next().value as string);
  });
  return pending;
}

/* ------------------------------------------------------------------ hook -- */

export type CanvasImageStatus = "loading" | "ready" | "original" | "error";

/** Diagnostics in development only — never a signed URL. */
function diagnose(event: string, identity: AssetIdentity | null, detail: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === "production") return;
  console.info(`[customizer-assets] ${event}`, { asset: identity?.key || "(no identity)", ...detail });
}

/**
 * The URL to draw for one canvas image.
 *
 * `source` is the object carrying the image's identity (the layer, or a
 * customer's field value); `url` is whatever URL it arrived with (possibly
 * expired, possibly empty after a recovery restore); `minLongestPx` is the
 * smallest decoded size that still looks sharp at the size it is drawn.
 */
export function useCanvasImageSource(source: unknown, url: string, minLongestPx = 0): { href: string; status: CanvasImageStatus } {
  const identity = useMemo(() => assetIdentityOf(source), [source]);
  const identityKey = identity?.key || "";
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const sourceExpiry = source && typeof source === "object" ? (source as Record<string, unknown>).expiresAt : undefined;

  // Drawn until the resolver has judged it. An expired URL simply fails to
  // load and is replaced within a moment; recovered designs carry no URL at all.
  const initial = url;
  const [state, setState] = useState<{ key: string; href: string; status: CanvasImageStatus }>({ key: identityKey, href: initial, status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const required = Math.round(minLongestPx / 100) * 100;

  useEffect(() => {
    let cancelled = false;
    let unwatch: (() => void) | null = null;
    const current = identityRef.current;
    const show = (href: string, status: CanvasImageStatus, variant: AssetVariant | null) => {
      if (cancelled) return;
      setState((previous) => (previous.href === href && previous.status === status && previous.key === identityKey ? previous : { key: identityKey, href, status }));
      if (!current || !variant) return;
      // Keep this exact variant renewed while it is on screen; swap only once the new URL has loaded.
      unwatch?.();
      unwatch = assetRuntime().watch(current, variant, (fresh) => {
        void probeImage(fresh.url).then((loaded) => {
          if (cancelled || !loaded) return;
          diagnose("renewed", current, { variant });
          setState((previous) => ({ ...previous, href: fresh.url }));
        });
      });
    };
    // Nothing loads: keep whatever is drawn, flag it, and try again later.
    const fail = () => {
      if (cancelled) return;
      diagnose("unavailable", current);
      setState((previous) => ({ ...previous, key: identityKey, status: "error" }));
    };

    const run = async () => {
      if (!current) {
        if (!url) return;
        const loaded = await probeImage(url);
        if (loaded) show(url, "ready", null);
        else fail();
        return;
      }
      const resolver = assetRuntime();
      if (url) resolver.seed(current, "editor", url, parseExpiry(sourceExpiry, url));
      const allowOriginal = current.kind === "customer" || context.audience === "studio";

      let editorUrl = "";
      let editor: Probe = null;
      try {
        editorUrl = (await resolver.get(current, "editor")).url;
        editor = await probeImage(editorUrl);
        if (!editor) {
          // Expired, revoked or a transient failure: one fresh credential, then judge the file.
          diagnose("editor-retry", current);
          editorUrl = (await resolver.get(current, "editor", { force: true, reason: "editor-load-failed" })).url;
          editor = await probeImage(editorUrl);
        }
      } catch {
        editor = null;
      }
      if (cancelled) return;
      const lowRes = Boolean(editor && required > 0 && Math.max(editor.width, editor.height) > 0 && Math.max(editor.width, editor.height) < required);
      if (editor && !lowRes) return show(editorUrl, "ready", "editor");

      const reason = lowRes ? "editor-low-res" : "editor-load-failed";
      if (allowOriginal) {
        try {
          let original = await resolver.get(current, "original", { reason });
          let loaded = await probeImage(original.url);
          if (!loaded) {
            original = await resolver.get(current, "original", { force: true, reason });
            loaded = await probeImage(original.url);
          }
          if (cancelled) return;
          if (loaded) {
            diagnose("original-fallback", current, { reason, editor: editor ? `${editor.width}x${editor.height}` : "failed" });
            return show(original.url, "original", "original");
          }
        } catch {
          // Fall through: the editor, if it loaded at all, is the best there is.
        }
      } else if (lowRes) {
        // The viewer may not have the original: report the variant for repair.
        void resolver.get(current, "editor", { force: true, reason }).catch(() => undefined);
      }
      if (cancelled) return;
      if (editor) return show(editorUrl, "ready", "editor");
      fail();
    };
    void run();
    return () => {
      cancelled = true;
      unwatch?.();
    };
  }, [identityKey, url, required, attempt, sourceExpiry]);

  // A failed image retries when the connection returns, and on a slow timer.
  useEffect(() => {
    if (state.status !== "error") return;
    const retry = () => setAttempt((count) => count + 1);
    window.addEventListener("online", retry);
    const timer = window.setTimeout(retry, 15_000);
    return () => {
      window.removeEventListener("online", retry);
      window.clearTimeout(timer);
    };
  }, [state.status, attempt]);

  // The identity changed (a different picture): never show the previous one's URL.
  const href = state.key === identityKey ? state.href || initial : initial;
  return { href, status: state.key === identityKey ? state.status : "loading" };
}

/**
 * An SVG <image> drawn through the resolver. Every canvas image — photos,
 * decorative elements, backgrounds — renders through this, so none of them can
 * keep drawing an expired URL.
 */
export function CanvasImage({
  source,
  url,
  minLongestPx = 0,
  ...props
}: { source: unknown; url: string; minLongestPx?: number } & Omit<React.SVGProps<SVGImageElement>, "href">) {
  const { href, status } = useCanvasImageSource(source, url, minLongestPx);
  if (!href) return null;
  return <image {...props} href={href} data-image-status={status} />;
}
