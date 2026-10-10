"use client";

import EditableNumericStepper from "./EditableNumericStepper";

// Uploads panel (Section 9 + spec §15), drawn like the Design Studio's Uploads
// (AdminUploadsPanel) in Husnalogy brand colours: upload from this computer or
// from a phone, click a photo to put it in the design, and a photo manager to
// search, sort and delete. Reuses the existing /api/customizer/upload route and
// Supabase Storage flow; photo areas keep their zoom / nudge / reset controls,
// gated by the layer's admin permissions.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import useAuth from "@/app/lib/useAuth";
import { openCustomerLogin } from "@/app/lib/customer-lists";
import { qrModuleRects } from "@/lib/customizer/v2/qr";
import { getImageUrl, getLayerPermissions } from "./customizer-utils";
import { mapCustomerFields } from "./CustomerEditPanel";

export type LibraryAsset = {
  id: string;
  bucket: string;
  path: string;
  fileName: string;
  width: number;
  height: number;
  url: string;
  signedUrl: string;
  thumbnailUrl: string;
  createdAt: string;
};

const PAGE_SIZE = 24;
/** The phone end of "Upload from your phone" (any signed-in customer). */
export const CUSTOMER_PHONE_UPLOAD_PATH = "/account/upload-photos";
/** The library API allows 120 reads per 10 minutes; the phone dialog stays well inside it. */
const PHONE_POLL_MS = 8000;

const OUTLINE_BUTTON =
  "flex min-h-[52px] w-full cursor-pointer items-center justify-center gap-3 rounded-full border-[1.5px] border-[#303839] bg-white px-5 text-[16px] font-semibold text-[#303839] transition-colors hover:bg-[#303839]/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-wait disabled:opacity-60";
const TEXT_BUTTON =
  "cursor-pointer rounded-full px-4 py-2 text-[14px] font-semibold text-[#303839] hover:bg-[#303839]/[0.06] disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839]";

// Rough quality hint from source pixels: a 5x7 print at 300dpi wants ~1500px.
function qualityLabel(width: number, height: number): { label: string; good: boolean } {
  const largest = Math.max(width, height);
  if (!largest) return { label: "", good: true };
  if (largest >= 1500) return { label: "Great quality", good: true };
  if (largest >= 800) return { label: "Good quality", good: true };
  return { label: "Low resolution", good: false };
}

async function fetchLibrary(
  options: { page?: number; search?: string; sort?: "newest" | "oldest" } = {},
  signal?: AbortSignal,
): Promise<{ assets: LibraryAsset[]; total: number }> {
  const query = new URLSearchParams({ sort: options.sort || "newest", pageSize: String(PAGE_SIZE), page: String(options.page || 1) });
  if (options.search?.trim()) query.set("search", options.search.trim());
  const res = await fetch(`/api/customizer/library?${query.toString()}`, { cache: "no-store", signal });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data?.error || "Could not load your photos.");
  const assets: LibraryAsset[] = data.assets || [];
  return { assets, total: Number(data.total) || assets.length };
}

/** An upload response (`data.file`) as a library row, so it can be placed like one. */
function uploadedAsLibraryAsset(file: any): LibraryAsset {
  return {
    ...file,
    id: String(file?.assetId || file?.id || ""),
    fileName: String(file?.name || file?.fileName || "photo"),
    width: Number(file?.width) || 0,
    height: Number(file?.height) || 0,
    url: file?.signedUrl || file?.url || "",
    signedUrl: file?.signedUrl || file?.url || "",
    thumbnailUrl: file?.thumbnailUrl || file?.signedUrl || file?.url || "",
    createdAt: String(file?.createdAt || ""),
  };
}

/**
 * A photo tile, as in the studio: click puts the photo in the design; it can
 * also be dragged onto a photo area or grid slot. Low-resolution photos say so.
 */
function PhotoTile({ asset, onPick }: { asset: LibraryAsset; onPick: () => void }) {
  const quality = qualityLabel(asset.width, asset.height);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onPick}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData("application/x-husnalogy-photo", JSON.stringify(asset));
        }}
        title={`Use ${asset.fileName}${asset.width ? ` (${asset.width}×${asset.height}px${quality.label ? ` · ${quality.label}` : ""})` : ""}`}
        aria-label={`Use photo ${asset.fileName}`}
        data-upload-tile
        className="block aspect-[4/5] w-full cursor-pointer overflow-hidden rounded-xl bg-[#F3F1EC] transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
      >
        <img src={asset.thumbnailUrl || asset.url} alt={asset.fileName} loading="lazy" draggable={false} className="h-full w-full object-cover" />
      </button>
      {!quality.good && (
        <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-full bg-[#303839]/85 px-1.5 py-px text-[9.5px] font-bold uppercase tracking-[0.06em] text-white" title="Low resolution — may print soft">
          Low res
        </span>
      )}
    </div>
  );
}

/** A centred dialog over the customizer; Escape and the X close it. */
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
    <div className="fixed inset-0 z-[3300] grid place-items-center bg-[#1f2425]/35 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
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
          <button data-shape="round" type="button" aria-label="Close" onClick={onClose} className="grid h-9 w-9 cursor-pointer place-items-center rounded-full text-[#1f2425] hover:bg-[#303839]/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">{children}</div>
      </div>
    </div>
  );
}

/**
 * The photo manager: the whole library, searchable and sortable, where a
 * customer deletes photos they no longer want. Clicking a photo uses it.
 */
function PhotoManager({ onPick, onChanged }: { onPick: (asset: LibraryAsset) => void; onChanged: () => void }) {
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      fetchLibrary({ search, sort }, controller.signal)
        .then(({ assets: first, total: count }) => {
          setAssets(first);
          setTotal(count);
          setPage(1);
          setError("");
        })
        .catch((caught: any) => {
          if (caught?.name !== "AbortError") setError(caught?.message || "Could not load your photos.");
        })
        .finally(() => setLoading(false));
    }, search ? 300 : 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [search, sort]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const { assets: next, total: count } = await fetchLibrary({ page: page + 1, search, sort });
      setAssets((current) => [...current, ...next.filter((asset) => !current.some((item) => item.id === asset.id))]);
      setTotal(count);
      setPage(page + 1);
    } catch (caught: any) {
      setError(caught?.message || "Could not load more photos.");
    } finally {
      setLoadingMore(false);
    }
  };

  const removeAsset = async (asset: LibraryAsset) => {
    if (!window.confirm(`Delete “${asset.fileName}” from your photo library? Photos used in a cart or order cannot be deleted.`)) return;
    setMessage("");
    setError("");
    setDeletingId(asset.id);
    try {
      const res = await fetch(`/api/customizer/library/${encodeURIComponent(asset.id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        setError(data?.error || "Could not delete this photo.");
        return;
      }
      setAssets((current) => current.filter((item) => item.id !== asset.id));
      setTotal((current) => Math.max(0, current - 1));
      setMessage(`“${asset.fileName}” was deleted.`);
      onChanged();
    } finally {
      setDeletingId("");
    }
  };

  return (
    <div className="grid gap-4 px-6 pb-6" data-photo-manager>
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by file name…"
          aria-label="Search your photos"
          className="h-11 min-w-0 flex-1 rounded-full border-[1.5px] border-[#303839]/20 bg-white px-4 text-[14px] text-[#1f2425] outline-none placeholder:text-[#303839]/55 focus-visible:border-[#303839] focus-visible:ring-2 focus-visible:ring-[#303839]/15"
        />
        <button
          data-shape="round"
          type="button"
          onClick={() => setSort((current) => (current === "newest" ? "oldest" : "newest"))}
          aria-label={`Sort by ${sort === "newest" ? "oldest" : "newest"} first`}
          className={`${TEXT_BUTTON} shrink-0`}
        >
          {sort === "newest" ? "Newest first" : "Oldest first"}
        </button>
      </div>
      <div aria-live="polite" className="grid gap-1 empty:hidden">
        {message && <p role="status" className="text-[13px] text-[#303839]/75">{message}</p>}
        {error && <p role="alert" className="text-[13px] font-semibold text-red-700">{error}</p>}
      </div>
      {loading ? (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4" aria-label="Loading your photos">
          {Array.from({ length: 8 }).map((_, index) => <span key={index} className="aspect-[4/5] animate-pulse rounded-xl bg-[#F3F1EC]" aria-hidden />)}
        </div>
      ) : assets.length === 0 ? (
        <p className="text-[14px] text-[#303839]/65">{search ? "No photos match your search." : "Photos you upload appear here, ready for every product."}</p>
      ) : (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
          {assets.map((asset) => (
            <div key={asset.id} className="relative">
              <PhotoTile asset={asset} onPick={() => onPick(asset)} />
              <button
                data-shape="round"
                type="button"
                onClick={() => removeAsset(asset)}
                disabled={deletingId === asset.id}
                aria-label={`Delete ${asset.fileName} from library`}
                title="Delete photo"
                className="absolute right-1.5 top-1.5 grid h-9 w-9 cursor-pointer place-items-center rounded-full bg-white/95 text-red-600 shadow-[0_2px_10px_rgba(48,56,57,0.18)] transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              >
                {deletingId === asset.id ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-red-200 border-t-red-600" aria-hidden />
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
                  </svg>
                )}
              </button>
            </div>
          ))}
        </div>
      )}
      {!loading && assets.length < total && (
        <button data-shape="round" type="button" onClick={loadMore} disabled={loadingMore} className={`${TEXT_BUTTON} justify-self-center`}>
          {loadingMore ? "Loading…" : "Show more"}
        </button>
      )}
    </div>
  );
}

/**
 * Phone handoff, as in the studio: a QR code to the customer's phone upload
 * page. Photos sent from the phone land in the same library; this dialog
 * watches it and lists each new photo the moment it arrives.
 */
function PhoneUploadDialog({ onClose, onPick }: { onClose: () => void; onPick: (asset: LibraryAsset) => void }) {
  const [url] = useState(() => `${window.location.origin}${CUSTOMER_PHONE_UPLOAD_PATH}`);
  const [qr] = useState(() => qrModuleRects({ value: url, margin: 2, errorCorrection: "M" }));
  const [received, setReceived] = useState<LibraryAsset[]>([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const known = useRef<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const { assets } = await fetchLibrary();
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
    const timer = window.setInterval(poll, PHONE_POLL_MS);
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
            <li>Sign in to your Husnalogy account if your phone asks.</li>
            <li>Take or choose photos — they appear below and in your photos.</li>
          </ol>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-[#F3F1EC] px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[13px] text-[#303839]">{url}</span>
          <button
            data-shape="round"
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(url).then(() => setCopied(true), () => setCopied(false));
            }}
            className="shrink-0 cursor-pointer rounded-full px-3 py-1 text-[13px] font-semibold text-[#303839] hover:bg-[#303839]/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839]"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
        <div aria-live="polite">
          <p className="text-[13px] font-semibold text-[#1f2425]">{received.length ? "Received from your phone — click one to use it" : "Waiting for photos from your phone…"}</p>
          {error && <p role="alert" className="mt-1 text-[12px] font-semibold text-red-700">{error}</p>}
          {received.length > 0 && (
            <div className="mt-2 grid grid-cols-4 gap-2">
              {received.map((asset) => (
                <PhotoTile
                  key={asset.id}
                  asset={asset}
                  onPick={() => {
                    onPick(asset);
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

const NUDGE = 20;

function PhotoCard({ field, layer, value, error, busyGlobal, onChange, onUploadPhoto, selected, onSelect }: any) {
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [uploadError, setUploadError] = useState("");
  const url = getImageUrl(value);
  const permissions = getLayerPermissions(layer);
  const allowZoom = permissions.zoomImage;
  const allowReposition = permissions.repositionImage;
  const allowReplace = permissions.replaceImage;

  const handleFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setUploadError("");
    setProgressText("Uploading photo…");
    try {
      const uploaded = await onUploadPhoto(file);
      if (uploaded?.url) {
        onChange({ ...uploaded, zoom: 1, offsetX: 0, offsetY: 0 });
      }
      setProgressText("");
    } catch (e: any) {
      setUploadError(e?.message || "Could not upload this photo.");
      setProgressText("");
    } finally {
      setBusy(false);
    }
  };

  const patch = (updates: any) => onChange({ ...(value || {}), ...updates });
  const nudge = (dx: number, dy: number) =>
    patch({ offsetX: (Number(value?.offsetX) || 0) + dx, offsetY: (Number(value?.offsetY) || 0) + dy });

  return (
    <div
      className={`rounded-[10px] p-3 transition ${selected ? "bg-[#D4AF37]/10 ring-[1.5px] ring-[#D4AF37]" : "bg-[#F8F6F1]"}`}
      onClick={onSelect}
    >
      <p className="text-[14px] font-bold text-[#1f2425]">
        {field.label}
        {field.required && <span className="text-[#303839]"> *</span>}
      </p>

      {!url ? (
        <label className="mt-2 flex h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-[10px] border-[1.5px] border-dashed border-[#303839]/30 bg-white text-[13px] font-semibold text-[#303839]/80 transition hover:border-[#303839]/60">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="m17 8-5-5-5 5M12 3v12" />
          </svg>
          {busy || busyGlobal ? progressText || "Uploading…" : "Upload photo"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              handleFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      ) : (
        <div className="mt-2">
          <div className="flex items-center gap-3">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-[#303839]/10 bg-white">
              <img src={url} alt={field.label} className="h-full w-full object-cover" draggable={false} />
            </div>
            <div className="grid gap-1.5">
              {allowReplace && (
                <label className="cursor-pointer rounded-full border-[1.5px] border-[#303839] bg-white px-3 py-1 text-center text-[12.5px] font-semibold text-[#303839] hover:bg-[#303839]/[0.05]">
                  {busy ? progressText || "Uploading…" : "Replace photo"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    disabled={busy}
                    onChange={(e) => {
                      handleFile(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
              <button
                type="button"
                onClick={() => onChange(null)}
                className="rounded-full px-3 py-1 text-[13px] font-semibold text-red-700 hover:bg-red-50"
              >
                Remove photo
              </button>
            </div>
          </div>

          {allowZoom && (
            <div className="mt-3">
              <EditableNumericStepper label={`Zoom ${field.label}`} value={Math.round((Number(value?.zoom) || 1) * 100)} minimum={100} maximum={300} step={5} largeStep={25} allowNegative={false} allowDecimal={false} formatValue={(next) => `${Math.round(next)}%`} onCommit={(next) => patch({ zoom: next / 100 })} showLabel className="h-12 w-full rounded-lg bg-white px-1" />
            </div>
          )}

          {allowReposition && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <EditableNumericStepper label={`${field.label} X position`} value={Number(value?.offsetX) || 0} minimum={-10000} maximum={10000} step={1} largeStep={10} allowNegative allowDecimal={false} onCommit={(offsetX) => patch({ offsetX })} showLabel className="h-12 w-full rounded-lg bg-white px-1" />
              <EditableNumericStepper label={`${field.label} Y position`} value={Number(value?.offsetY) || 0} minimum={-10000} maximum={10000} step={1} largeStep={10} allowNegative allowDecimal={false} onCommit={(offsetY) => patch({ offsetY })} showLabel className="h-12 w-full rounded-lg bg-white px-1" />
            </div>
          )}

          {allowReposition && (
            <div className="mt-2 flex items-center gap-2">
              <span className="w-12 text-[13px] font-semibold text-[#303839]/70">Move</span>
              <div className="flex gap-1">
                {[
                  { label: "Move left", dx: -NUDGE, dy: 0, d: "M15 18l-6-6 6-6" },
                  { label: "Move right", dx: NUDGE, dy: 0, d: "M9 18l6-6-6-6" },
                  { label: "Move up", dx: 0, dy: -NUDGE, d: "M6 15l6-6 6 6" },
                  { label: "Move down", dx: 0, dy: NUDGE, d: "M6 9l6 6 6-6" },
                ].map((btn) => (
                  <button
                    key={btn.label}
                    type="button"
                    aria-label={btn.label}
                    onClick={() => nudge(btn.dx, btn.dy)}
                    className="grid h-8 w-8 cursor-pointer place-items-center rounded-md border border-[#303839]/20 bg-white text-[#303839] hover:bg-[#EFEBE1]"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d={btn.d} />
                    </svg>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => patch({ zoom: 1, offsetX: 0, offsetY: 0 })}
                className="ml-auto cursor-pointer text-[12.5px] font-semibold text-[#303839]/75 underline-offset-2 hover:underline"
              >
                Reset
              </button>
            </div>
          )}
        </div>
      )}

      <p className="mt-2 text-[12px] text-[#303839]/70">JPG, PNG, or WebP · up to 15MB</p>
      {field.helpText && <p className="mt-0.5 text-xs text-[#303839]/70">{field.helpText}</p>}
      {(uploadError || error) && (
        <p className="mt-1 text-[13px] font-semibold text-red-700" role="alert">
          {uploadError || error}
        </p>
      )}
    </div>
  );
}

type Props = {
  template: any;
  values: Record<string, any>;
  errors?: Record<string, string>;
  onChange: (fieldId: string, value: any) => void;
  onUploadPhoto: (file: File) => Promise<any>;
  selectedLayerId?: string | null;
  onSelectLayer?: (layerId: string) => void;
  onFocusPage?: (pageId: string) => void;
  selectedGridLayer?: any;
  selectedGridSlotId?: string | null;
  onPickGridAsset?: (asset: LibraryAsset) => void;
  selectedUserFrame?: any;
  onPickUserFrame?: (asset: any) => void;
};

export default function CustomerUploadsPanel({
  template,
  values,
  errors = {},
  onChange,
  onUploadPhoto,
  selectedLayerId,
  onSelectLayer,
  onFocusPage,
  selectedGridLayer,
  selectedGridSlotId,
  onPickGridAsset,
  selectedUserFrame,
  onPickUserFrame,
}: Props) {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [libraryRefresh, setLibraryRefresh] = useState(0);
  const [batch, setBatch] = useState<{ index: number; total: number } | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<"manager" | "phone" | null>(null);
  const signedIn = Boolean(user);

  const photoEntries = mapCustomerFields(template).filter(
    (entry) => entry.field.type === "image" || entry.field.type === "file",
  );
  const hasSelectedGridSlot = Boolean(selectedGridLayer?.type === "grid" && selectedGridSlotId);
  const hasSelectedUserFrame = Boolean(selectedUserFrame?.isUserLayer && (selectedUserFrame.type === "frame" || selectedUserFrame.type === "image"));

  // The library's first page; reloaded after uploads, deletions and phone photos.
  useEffect(() => {
    if (!signedIn) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    fetchLibrary({}, controller.signal)
      .then(({ assets: first, total: count }) => {
        setAssets(first);
        setTotal(count);
        setPage(1);
      })
      .catch((caught: any) => {
        if (caught?.name !== "AbortError") setError(caught?.message || "Could not load your photos.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [signedIn, libraryRefresh]);

  const refreshLibrary = useCallback(() => setLibraryRefresh((current) => current + 1), []);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const { assets: next, total: count } = await fetchLibrary({ page: page + 1 });
      setAssets((current) => [...current, ...next.filter((asset) => !current.some((item) => item.id === asset.id))]);
      setTotal(count);
      setPage(page + 1);
    } catch (caught: any) {
      setError(caught?.message || "Could not load more photos.");
    } finally {
      setLoadingMore(false);
    }
  };

  if (!photoEntries.length && !hasSelectedGridSlot && !hasSelectedUserFrame) {
    return <p className="p-5 text-sm text-[#303839]/70">This design has no photo areas to fill.</p>;
  }

  /**
   * Put a photo in the design: the selected grid slot or customer frame, else
   * the selected photo area, else the first empty one, else the first. Returns
   * false when the target area may not be changed.
   */
  const placePhoto = (asset: LibraryAsset, value?: Record<string, unknown>) => {
    if (hasSelectedGridSlot && onPickGridAsset) {
      onPickGridAsset(asset);
      return true;
    }
    if (hasSelectedUserFrame && onPickUserFrame) {
      onPickUserFrame(asset);
      return true;
    }
    const target =
      photoEntries.find((entry) => entry.layer.id === selectedLayerId) ||
      photoEntries.find((entry) => !getImageUrl(values[entry.field.id])) ||
      photoEntries[0];
    if (!target || !getLayerPermissions(target.layer).replaceImage) return false;
    onFocusPage?.(target.page);
    onSelectLayer?.(target.layer.id);
    onChange(
      target.field.id,
      value || {
        assetId: asset.id,
        bucket: asset.bucket,
        path: asset.path,
        name: asset.fileName,
        width: asset.width,
        height: asset.height,
        url: asset.signedUrl || asset.url,
        signedUrl: asset.signedUrl || asset.url,
        zoom: 1,
        offsetX: 0,
        offsetY: 0,
      },
    );
    return true;
  };

  const pickPhoto = (asset: LibraryAsset) => {
    setError("");
    setNotice(placePhoto(asset) ? "" : "This photo area can't be changed. Select another one, then choose a photo.");
  };

  /**
   * Upload from this computer (spec §1, §37). Files are sent one at a time, so
   * a single rejected file never cancels the ones that already succeeded; every
   * success lands in the library. One photo goes straight into the design, as
   * in the studio; several fill the library to choose from.
   */
  const uploadFiles = async (input?: FileList | File[] | null) => {
    const files = Array.from(input || []).filter(Boolean) as File[];
    if (!files.length) return;
    setError("");
    setNotice("");
    setBatch({ index: 1, total: files.length });
    const failed: string[] = [];
    const uploaded: any[] = [];
    for (let index = 0; index < files.length; index += 1) {
      setBatch({ index: index + 1, total: files.length });
      try {
        uploaded.push(await onUploadPhoto(files[index]));
      } catch (caught: any) {
        failed.push(files[index].name);
        if (String(caught?.message || "").toLowerCase().includes("sign in")) break;
      }
    }
    setBatch(null);
    if (inputRef.current) inputRef.current.value = "";
    if (files.length === 1 && uploaded[0]) {
      const placed = placePhoto(uploadedAsLibraryAsset(uploaded[0]), { ...uploaded[0], zoom: 1, offsetX: 0, offsetY: 0 });
      setNotice(placed ? "Uploaded and added to your design." : "Uploaded to your photos.");
    } else if (uploaded.length) {
      setNotice(`${uploaded.length} photo${uploaded.length === 1 ? "" : "s"} added to your photos. Click one to use it.`);
    }
    if (uploaded.length) refreshLibrary();
    if (failed.length) {
      setError(
        failed.length === 1
          ? `${failed[0]} could not be uploaded.`
          : `${failed.length} of ${files.length} photos could not be uploaded (${failed.join(", ")}).`,
      );
    }
  };

  const closeDialog = () => {
    setDialog(null);
    // The library may have changed there (deletions, phone photos).
    refreshLibrary();
  };

  return (
    <div className="grid gap-5 px-4 pb-6 pt-1" data-customer-uploads-panel>
      {hasSelectedGridSlot && (
        <div className="rounded-xl bg-[#D4AF37]/10 p-3 text-[13px] text-[#1f2425]">
          <p className="font-semibold">Photo grid slot selected</p>
          <p className="mt-1 text-[#303839]/70">Choose a photo below, drag one onto a slot, or use Replace above the canvas.</p>
        </div>
      )}
      {hasSelectedUserFrame && (
        <div className="rounded-xl bg-[#D4AF37]/10 p-3 text-[13px] text-[#1f2425]">
          <p className="font-semibold">Customer frame selected</p>
          <p className="mt-1 text-[#303839]/70">Choose a photo below or upload a new one.</p>
        </div>
      )}

      <p className="text-[16px] leading-[1.55] text-[#1f2425]">
        {signedIn ? (
          <>
            Click a photo below to add it to your design, or open the{" "}
            <button type="button" onClick={() => setDialog("manager")} className="cursor-pointer text-[#303839] underline decoration-[1.5px] underline-offset-[5px] hover:decoration-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839]">
              photo manager
            </button>{" "}
            to search and manage your photos.
          </>
        ) : (
          <>Sign in to upload photos. They stay in your photos, ready for every product.</>
        )}
      </p>
      <hr className="border-[#303839]/15" />

      <div className="grid gap-3">
        <button data-shape="round" type="button" className={OUTLINE_BUTTON} disabled={Boolean(batch)} onClick={() => inputRef.current?.click()}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3.5 18.5 8.5 12l3.5 4 2.5-3 2 2.5" /><path d="M3.5 18.5h11" /><circle cx="15" cy="6.5" r="1.6" /><path d="M19 14.5v6M16 17.5h6" />
          </svg>
          {batch ? `Uploading ${batch.index} of ${batch.total}` : "Upload from computer"}
        </button>
        <button data-shape="round" type="button" className={OUTLINE_BUTTON} onClick={() => (signedIn ? setDialog("phone") : openCustomerLogin())}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" />
          </svg>
          Upload from your phone
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-label="Photos to upload"
          onChange={(event) => void uploadFiles(event.target.files)}
        />
        {batch ? (
          <div className="h-1 overflow-hidden rounded-full bg-[#F3F1EC]" role="progressbar" aria-label="Photo upload progress" aria-valuemin={0} aria-valuemax={batch.total} aria-valuenow={batch.index}>
            <span className="block h-full rounded-full bg-[#303839] transition-[width] duration-200" style={{ width: `${Math.round((batch.index / batch.total) * 100)}%` }} />
          </div>
        ) : (
          <p className="text-center text-[12.5px] text-[#303839]/65">Select several at once · JPG, PNG or WebP</p>
        )}
      </div>

      <div aria-live="polite" className="grid gap-2 empty:hidden">
        {notice && <p role="status" className="text-[13px] text-[#303839]/75">{notice}</p>}
        {error && (
          <p role="alert" className="text-[13px] font-semibold text-red-700">
            {error}
          </p>
        )}
      </div>

      {photoEntries.length > 0 && (
        <section className="grid gap-2.5" aria-label="Photo areas in this design">
          <h3 className="text-[13px] font-semibold text-[#1f2425]">Photo areas in this design</h3>
          {photoEntries.map(({ field, layer, page: fieldPage }) => (
            <PhotoCard
              key={field.id}
              field={field}
              layer={layer}
              value={values[field.id]}
              error={errors[field.id]}
              selected={selectedLayerId === layer.id}
              onSelect={() => {
                onFocusPage?.(fieldPage);
                onSelectLayer?.(layer.id);
              }}
              onChange={(next: any) => onChange(field.id, next)}
              onUploadPhoto={async (file: File) => {
                const uploaded = await onUploadPhoto(file);
                refreshLibrary();
                return uploaded;
              }}
            />
          ))}
        </section>
      )}

      {signedIn && (
        <section className="grid gap-2.5" aria-label="Your photos">
          <h3 className="text-[13px] font-semibold text-[#1f2425]">Your photos</h3>
          {loading ? (
            <div className="grid grid-cols-3 gap-2.5" aria-label="Loading your photos">
              {Array.from({ length: 6 }).map((_, index) => <span key={index} className="aspect-[4/5] animate-pulse rounded-xl bg-[#F3F1EC]" aria-hidden />)}
            </div>
          ) : assets.length ? (
            <div className="grid grid-cols-3 gap-2.5" data-upload-grid>
              {assets.map((asset) => <PhotoTile key={asset.id} asset={asset} onPick={() => pickPhoto(asset)} />)}
            </div>
          ) : (
            <p className="text-[14px] text-[#303839]/60">No photos yet. Upload one and it stays here for every product.</p>
          )}
          {!loading && assets.length < total && (
            <button data-shape="round" type="button" onClick={loadMore} disabled={loadingMore} className={`${TEXT_BUTTON} justify-self-center`}>
              {loadingMore ? "Loading…" : "Show more"}
            </button>
          )}
        </section>
      )}

      {dialog === "manager" && (
        <Dialog title="Photo manager" wide onClose={closeDialog}>
          <PhotoManager
            onPick={(asset) => {
              pickPhoto(asset);
              closeDialog();
            }}
            onChanged={refreshLibrary}
          />
        </Dialog>
      )}
      {dialog === "phone" && <PhoneUploadDialog onClose={closeDialog} onPick={pickPhoto} />}
    </div>
  );
}
