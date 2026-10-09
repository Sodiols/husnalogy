"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import AdminMediaLibrary, { type AdminUploadAsset } from "./AdminMediaLibrary";
import { uploadBuilderImage } from "./builder-utils";
import LibraryThumb from "./LibraryThumb";
import { qrModuleRects } from "@/lib/customizer/v2/qr";
import { libraryRefreshDelayMs, libraryTileSourceKey, mergeRefreshedLibraryAssets } from "@/lib/customizer/v2/library-thumbnail";

export type { AdminUploadAsset } from "./AdminMediaLibrary";

/**
 * Uploads: the studio's image library at a glance. Upload from this computer
 * or from a phone (both land in the one library, through the one upload
 * pipeline), click a picture to add it to the page being edited, or open the
 * media manager to browse, search and manage everything.
 *
 * A tile is only a picker preview (the library's thumbnail variant); inserting
 * hands the ASSET to the studio, which places its editor/original variants.
 */

type Props = {
  onInsertAsset: (asset: AdminUploadAsset) => void;
  currentAssetIds?: string[];
};

const PAGE_SIZE = 24;
const MOBILE_UPLOAD_PATH = "/upload-from-phone";

const OUTLINE_BUTTON =
  "flex min-h-[52px] w-full items-center justify-center gap-3 rounded-full border-[1.5px] border-[#27307A] bg-white px-5 text-[16px] font-semibold text-[#27307A] transition-colors hover:bg-[#27307A]/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-wait disabled:opacity-60";

const visible = (asset: AdminUploadAsset) => asset.adminAvailable !== false && !asset.archived && (asset.status || "ready") === "ready";

async function fetchLibrary(page: number, signal?: AbortSignal): Promise<{ assets: AdminUploadAsset[]; total: number }> {
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  const response = await fetch(`/api/admin/customizer/assets?${query}`, { cache: "no-store", signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || "Could not load your images.");
  const assets = (payload.assets || []).filter(visible);
  return { assets, total: Number(payload.total) || assets.length };
}

/**
 * A picture tile: the library's preview of the asset (LibraryThumb). Clicking
 * inserts the ASSET — its identity and full-quality variants — never the
 * preview URL. A tile whose preview cannot load asks the panel to re-sign the
 * library and offers Retry; a re-signed row starts the tile over.
 */
function Thumb({
  asset,
  onPick,
  onUnavailable,
  onRetry,
}: {
  asset: AdminUploadAsset;
  onPick: () => void;
  onUnavailable?: (assetId: string) => void;
  onRetry?: (assetId: string) => void;
}) {
  const sourceKey = libraryTileSourceKey(asset);
  const [unavailableKey, setUnavailableKey] = useState("");
  const [nonce, setNonce] = useState(0);
  const failed = unavailableKey === sourceKey;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onPick}
        aria-label={`Add ${asset.title} to the current page`}
        title={asset.displayName || asset.title}
        data-upload-tile
        className="block aspect-[4/5] w-full overflow-hidden rounded-xl bg-[#F2F3F5] transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
      >
        <LibraryThumb
          key={nonce}
          asset={asset}
          onUnavailable={(assetId, key) => {
            setUnavailableKey(key);
            onUnavailable?.(assetId);
          }}
        />
      </button>
      {failed && onRetry && (
        <button
          type="button"
          data-thumb-retry
          aria-label={`Retry loading ${asset.title}`}
          onClick={() => {
            setUnavailableKey("");
            setNonce((value) => value + 1);
            onRetry(asset.id);
          }}
          className="absolute bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[#27307A] shadow-[0_1px_3px_rgba(31,36,37,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A]"
          data-shape="round"
        >
          Retry
        </button>
      )}
    </div>
  );
}

/** A centred dialog over the studio; Escape and the X close it. */
function Dialog({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[300] grid place-items-center bg-[#1f2425]/35 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`flex max-h-[min(86vh,820px)] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(31,36,37,0.28)] outline-none ${wide ? "max-w-[720px]" : "max-w-[440px]"}`}
      >
        <div className="flex shrink-0 items-center justify-between px-6 pb-2 pt-5">
          <h2 className="text-[20px] font-semibold text-[#1f2425]">{title}</h2>
          <button data-shape="round" type="button" aria-label="Close" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full text-[#1f2425] hover:bg-[#303839]/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">{children}</div>
      </div>
    </div>
  );
}

/**
 * Phone handoff: a QR code to the admin's mobile upload page. Photos sent
 * from the phone go into the same library; this dialog watches the library
 * and lists each new picture the moment it arrives.
 */
function PhoneUploadDialog({ onClose, onInsertAsset }: { onClose: () => void; onInsertAsset: (asset: AdminUploadAsset) => void }) {
  const [url] = useState(() => `${window.location.origin}${MOBILE_UPLOAD_PATH}`);
  const [qr] = useState(() => qrModuleRects({ value: url, margin: 2, errorCorrection: "M" }));
  const [received, setReceived] = useState<AdminUploadAsset[]>([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const known = useRef<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const { assets } = await fetchLibrary(1);
        if (cancelled) return;
        setError("");
        // Everything already in the library when the dialog opened is old.
        if (!known.current) {
          known.current = new Set(assets.map((asset) => asset.id));
          return;
        }
        const fresh = assets.filter((asset) => !known.current!.has(asset.id));
        if (fresh.length) {
          fresh.forEach((asset) => known.current!.add(asset.id));
          setReceived((current) => [...fresh, ...current]);
        }
      } catch (caught: any) {
        if (!cancelled) setError(caught?.message || "Could not check for new photos.");
      }
    };
    void poll();
    const timer = window.setInterval(poll, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <Dialog title="Upload from your phone" onClose={onClose}>
      <div className="grid gap-4 px-6 pb-6" data-phone-upload>
        <div className="flex items-start gap-4">
          <svg
            viewBox={`0 0 ${qr.totalSize} ${qr.totalSize}`}
            width="148"
            height="148"
            role="img"
            aria-label="QR code that opens the phone upload page"
            data-phone-upload-qr={url}
            className="shrink-0 rounded-lg border border-[#303839]/12"
            shapeRendering="crispEdges"
          >
            <rect width={qr.totalSize} height={qr.totalSize} fill="#ffffff" />
            {qr.rects.map((rect) => <rect key={`${rect.x}-${rect.y}`} x={rect.x} y={rect.y} width="1" height="1" fill="#1f2425" />)}
          </svg>
          <ol className="grid list-decimal gap-1.5 pl-4 text-[14px] leading-snug text-[#1f2425]">
            <li>Scan the code with your phone&apos;s camera.</li>
            <li>Sign in to the Husnalogy admin if your phone asks.</li>
            <li>Take or choose photos — they appear below and in Uploads.</li>
          </ol>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-[#F2F3F5] px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[13px] text-[#303839]">{url}</span>
          <button data-shape="round"
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(url).then(() => setCopied(true), () => setCopied(false));
            }}
            className="shrink-0 rounded-full px-3 py-1 text-[13px] font-semibold text-[#27307A] hover:bg-[#27307A]/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A]"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
        <div aria-live="polite">
          <p className="text-[13px] font-semibold text-[#1f2425]">{received.length ? "Received from your phone — click one to add it" : "Waiting for photos from your phone…"}</p>
          {error && <p role="alert" className="mt-1 text-[12px] font-semibold text-red-700">{error}</p>}
          {received.length > 0 && (
            <div className="mt-2 grid grid-cols-4 gap-2">
              {received.map((asset) => (
                <Thumb
                  key={asset.id}
                  asset={asset}
                  onPick={() => {
                    onInsertAsset(asset);
                    onClose();
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

export default function AdminUploadsPanel({ onInsertAsset, currentAssetIds = [] }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [assets, setAssets] = useState<AdminUploadAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [uploading, setUploading] = useState<{ index: number; total: number; progress: number } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<"media" | "phone" | null>(null);
  const pageRef = useRef(page);
  pageRef.current = page;

  // Re-sign the loaded rows (their preview URLs expire): before they lapse, and
  // when a tile's preview fails. Automatic refreshes are throttled so a
  // genuinely missing file can never cause a request loop; Retry is immediate.
  const refreshingRef = useRef(false);
  const lastAutoRefreshRef = useRef(0);
  const refreshLibrary = useCallback(async (manual: boolean) => {
    if (refreshingRef.current) return;
    const now = Date.now();
    if (!manual && now - lastAutoRefreshRef.current < 20_000) return;
    lastAutoRefreshRef.current = now;
    refreshingRef.current = true;
    try {
      const fresh: AdminUploadAsset[] = [];
      for (let index = 1; index <= Math.max(1, pageRef.current); index += 1) fresh.push(...(await fetchLibrary(index)).assets);
      setAssets((current) => mergeRefreshedLibraryAssets(current, fresh));
    } catch {
      // The tiles keep their placeholders and Retry; the next attempt may succeed.
    } finally {
      refreshingRef.current = false;
    }
  }, []);
  useEffect(() => {
    // Before the earliest link lapses (at most every 15 s, never for links
    // that have already lapsed — those are the tiles' failure path).
    const delay = libraryRefreshDelayMs(assets, Date.now(), 60_000, 15_000);
    if (delay === null) return;
    const timer = window.setTimeout(() => void refreshLibrary(true), delay);
    return () => window.clearTimeout(timer);
  }, [assets, refreshLibrary]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchLibrary(1, controller.signal)
      .then(({ assets: first, total: count }) => {
        setAssets(first);
        setTotal(count);
        setPage(1);
        setError("");
      })
      .catch((caught: any) => {
        if (caught?.name !== "AbortError") setError(caught?.message || "Could not load your images.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [reloadKey]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const { assets: next, total: count } = await fetchLibrary(page + 1);
      setAssets((current) => [...current, ...next.filter((asset) => !current.some((item) => item.id === asset.id))]);
      setTotal(count);
      setPage(page + 1);
    } catch (caught: any) {
      setError(caught?.message || "Could not load more images.");
    } finally {
      setLoadingMore(false);
    }
  };

  // The shared upload pipeline (storage, asset record, variants). One file is
  // added to the page straight away; several fill the library to choose from.
  const uploadFiles = async (input?: FileList | null) => {
    const files = Array.from(input || []);
    if (!files.length) return;
    setError("");
    setNotice("");
    const uploaded: AdminUploadAsset[] = [];
    const failed: string[] = [];
    for (let index = 0; index < files.length; index += 1) {
      setUploading({ index: index + 1, total: files.length, progress: 0 });
      try {
        const asset = await uploadBuilderImage(files[index], "image", {
          onProgress: (progress) => setUploading({ index: index + 1, total: files.length, progress }),
        });
        uploaded.push(asset);
        setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
        if (!asset.duplicate) setTotal((current) => current + 1);
      } catch (caught: any) {
        failed.push(`${files[index].name}: ${caught?.message || "could not be uploaded"}`);
      }
    }
    setUploading(null);
    if (inputRef.current) inputRef.current.value = "";
    if (files.length === 1 && uploaded[0]) {
      setNotice(uploaded[0].duplicate ? uploaded[0].message || "This image was already in your library — added to the page." : "Uploaded and added to this page.");
      onInsertAsset(uploaded[0]);
    } else if (uploaded.length) {
      setNotice(`${uploaded.length} images added to your library. Click one to add it to this page.`);
    }
    if (failed.length) setError(failed.join(" · "));
  };

  const closeDialog = useCallback(() => {
    setDialog(null);
    // The library may have changed there (uploads, archive, phone photos).
    setReloadKey((key) => key + 1);
  }, []);

  const insertFromDialog = (asset: AdminUploadAsset) => {
    onInsertAsset(asset);
    closeDialog();
  };

  return (
    <div className="grid gap-5 px-4 pb-6 pt-1" data-admin-uploads-panel>
      <p className="text-[16px] leading-[1.55] text-[#1f2425]">
        Click an image below to add it to your design, or use the{" "}
        <button type="button" onClick={() => setDialog("media")} className="text-[#27307A] underline decoration-[1.5px] underline-offset-[5px] hover:decoration-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A]">
          media manager
        </button>{" "}
        to browse your image library.
      </p>
      <hr className="border-[#303839]/15" />

      <div className="grid gap-3">
        <button data-shape="round" type="button" className={OUTLINE_BUTTON} disabled={Boolean(uploading)} onClick={() => inputRef.current?.click()}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3.5 18.5 8.5 12l3.5 4 2.5-3 2 2.5" /><path d="M3.5 18.5h11" /><circle cx="15" cy="6.5" r="1.6" /><path d="M19 14.5v6M16 17.5h6" />
          </svg>
          {uploading ? (uploading.total > 1 ? `Uploading ${uploading.index} of ${uploading.total}` : `Uploading ${uploading.progress}%`) : "Upload from computer"}
        </button>
        <button data-shape="round" type="button" className={OUTLINE_BUTTON} onClick={() => setDialog("phone")}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" />
          </svg>
          Upload from your phone
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/svg+xml,image/png,image/jpeg,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-label="Images to upload"
          onChange={(event) => void uploadFiles(event.target.files)}
        />
        {uploading && (
          <div className="h-1 overflow-hidden rounded-full bg-[#F2F3F5]" role="progressbar" aria-label="Image upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploading.progress}>
            <span className="block h-full rounded-full bg-[#27307A] transition-[width]" style={{ width: `${uploading.progress}%` }} />
          </div>
        )}
      </div>

      <div aria-live="polite" className="grid gap-2 empty:hidden">
        {notice && <p role="status" className="text-[13px] text-[#303839]/75">{notice}</p>}
        {error && (
          <p role="alert" className="text-[13px] font-semibold text-red-700">
            {error}{" "}
            <button type="button" className="underline" onClick={() => setReloadKey((key) => key + 1)}>Try again</button>
          </p>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-3 gap-2.5" aria-label="Loading your images">
          {Array.from({ length: 6 }).map((_, index) => <span key={index} className="aspect-[4/5] animate-pulse rounded-xl bg-[#F2F3F5]" aria-hidden />)}
        </div>
      ) : assets.length ? (
        <div className="grid grid-cols-3 gap-2.5" data-upload-grid>
          {assets.map((asset) => (
            <Thumb
              key={asset.id}
              asset={asset}
              onPick={() => onInsertAsset(asset)}
              onUnavailable={() => void refreshLibrary(false)}
              onRetry={() => void refreshLibrary(true)}
            />
          ))}
        </div>
      ) : (
        !error && <p className="text-[14px] text-[#303839]/60">No images yet. Upload one and it stays here for every product.</p>
      )}
      {!loading && assets.length < total && (
        <button data-shape="round" type="button" onClick={loadMore} disabled={loadingMore} className="justify-self-center rounded-full px-4 py-2 text-[14px] font-semibold text-[#27307A] hover:bg-[#27307A]/[0.06] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A]">
          {loadingMore ? "Loading…" : "Show more"}
        </button>
      )}

      {dialog === "media" && (
        <Dialog title="Media manager" wide onClose={closeDialog}>
          <AdminMediaLibrary onInsertAsset={insertFromDialog} currentAssetIds={currentAssetIds} />
        </Dialog>
      )}
      {dialog === "phone" && <PhoneUploadDialog onClose={closeDialog} onInsertAsset={onInsertAsset} />}
    </div>
  );
}
