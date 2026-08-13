"use client";

import { useEffect, useRef, useState } from "react";
import { uploadBuilderImage, type BuilderAsset } from "./builder-utils";

export type AdminUploadAsset = BuilderAsset & {
  displayName?: string;
  fileSizeBytes?: number;
  adminAvailable?: boolean;
  archived?: boolean;
  status?: string;
  usageCount?: number;
};

type UsageLocation = { type?: string; id?: string; label?: string };

type Props = {
  onInsertAsset: (asset: AdminUploadAsset) => void;
  currentAssetIds?: string[];
};

const PAGE_SIZE = 24;

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

function formatFileType(asset: AdminUploadAsset) {
  const mime = String(asset.mimeType || "").replace("image/", "").replace("jpeg", "jpg").toUpperCase();
  return mime || String(asset.assetType || "image").toUpperCase();
}

export default function AdminUploadsPanel({ onInsertAsset, currentAssetIds = [] }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const [assets, setAssets] = useState<AdminUploadAsset[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  // Batch position for a multi-file selection ("Uploading 3 of 12").
  const [batch, setBatch] = useState<{ index: number; total: number } | null>(null);
  const [retryFiles, setRetryFiles] = useState<File[]>([]);
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [usage, setUsage] = useState<UsageLocation[]>([]);
  const currentIds = new Set(currentAssetIds.filter(Boolean));

  const loadPage = async (nextPage: number, append: boolean, signal?: AbortSignal) => {
    const query = new URLSearchParams({ page: String(nextPage), pageSize: String(PAGE_SIZE) });
    if (search.trim()) query.set("search", search.trim());
    const response = await fetch(`/api/admin/customizer/assets?${query.toString()}`, { cache: "no-store", signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "Could not load uploaded images.");
    const visible = (payload.assets || []).filter(
      (asset: AdminUploadAsset) => asset.adminAvailable !== false && !asset.archived && asset.status === "ready",
    );
    setAssets((current) => {
      const combined = append ? [...current, ...visible] : visible;
      const byId = new Map<string, AdminUploadAsset>();
      for (const asset of combined as AdminUploadAsset[]) byId.set(asset.id, asset);
      return [...byId.values()];
    });
    setTotal(Number(payload.total) || visible.length);
    setPage(nextPage);
  };

  useEffect(() => {
    const controller = new AbortController();
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      loadPage(1, false, controller.signal)
        .catch((caught: any) => {
          if (caught?.name !== "AbortError" && id === requestId.current) {
            setError(caught?.message || "Could not load uploaded images.");
            setAssets([]);
          }
        })
        .finally(() => {
          if (id === requestId.current) setLoading(false);
        });
    }, search.trim() ? 250 : 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    // loadPage intentionally follows the current search value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, reloadKey]);

  /**
   * Bulk upload (spec §1, §37). Files are sent one at a time so each keeps its
   * own duplicate detection, variant generation and progress, and so a single
   * rejected file can never cancel the ones that already succeeded. Every
   * successful asset lands in the library immediately.
   *
   * Auto-inserting onto the page stays a SINGLE-image action: choosing twelve
   * photos fills the library, it does not drop twelve layers on the card.
   */
  const uploadFiles = async (input?: File[] | FileList | null) => {
    const files = Array.from(input || []).filter(Boolean) as File[];
    if (!files.length) return;
    setUploading(true);
    setUploadProgress(0);
    setRetryFiles([]);
    setError("");
    setNotice("");
    setUsage([]);
    setBatch(files.length > 1 ? { index: 1, total: files.length } : null);

    const uploaded: AdminUploadAsset[] = [];
    const failed: Array<{ file: File; message: string }> = [];
    let duplicates = 0;

    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        if (files.length > 1) setBatch({ index: index + 1, total: files.length });
        setUploadProgress(0);
        try {
          const asset = await uploadBuilderImage(file, "image", { onProgress: setUploadProgress });
          uploaded.push(asset);
          if (asset.duplicate) duplicates += 1;
          // Publish each success as it lands rather than at the end of the batch.
          setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
          if (!asset.duplicate) setTotal((current) => current + 1);
        } catch (caught: any) {
          failed.push({ file, message: caught?.message || "Could not upload this image." });
        }
      }
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setBatch(null);
      if (inputRef.current) inputRef.current.value = "";
    }

    if (files.length === 1) {
      const asset = uploaded[0];
      if (asset) {
        setNotice(asset.duplicate ? asset.message || "This image already exists in your uploads." : `“${asset.title}” uploaded and added to this page.`);
        onInsertAsset(asset);
      }
    } else if (uploaded.length) {
      const added = uploaded.length - duplicates;
      setNotice(
        `${added} image${added === 1 ? "" : "s"} uploaded to your library${duplicates ? ` · ${duplicates} already existed` : ""}. Choose one to add it to this page.`,
      );
    }
    if (failed.length) {
      setRetryFiles(failed.map((entry) => entry.file));
      setError(
        failed.length === 1
          ? `${failed[0].file.name}: ${failed[0].message}`
          : `${failed.length} of ${files.length} images could not be uploaded (${failed.map((entry) => entry.file.name).join(", ")}).`,
      );
    }
  };

  const archiveAsset = async (asset: AdminUploadAsset) => {
    const response = await fetch(`/api/admin/customizer/assets/${encodeURIComponent(asset.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "Could not archive this image.");
  };

  const deleteAsset = async (asset: AdminUploadAsset) => {
    const usedOnCurrentDesign = currentIds.has(asset.id);
    const question = usedOnCurrentDesign
      ? `“${asset.title}” is used on the current design. Archive it so it is hidden from new selections but remains available here?`
      : `Delete “${asset.title}” permanently? Used images will be archived instead so existing designs keep working.`;
    if (!window.confirm(question)) return;

    setDeletingId(asset.id);
    setError("");
    setNotice("");
    setUsage([]);
    try {
      await archiveAsset(asset);
      setAssets((current) => current.filter((item) => item.id !== asset.id));
      setTotal((current) => Math.max(0, current - 1));

      if (usedOnCurrentDesign) {
        setUsage([{ type: "current_template", id: asset.id, label: "Current design" }]);
        setNotice(`“${asset.title}” was archived because the current design uses it.`);
        return;
      }

      const response = await fetch(`/api/admin/customizer/assets/${encodeURIComponent(asset.id)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        if (Array.isArray(payload.usage) && payload.usage.length) {
          setUsage(payload.usage);
          setNotice(`“${asset.title}” is in use, so it was archived instead of permanently deleted.`);
          return;
        }
        throw new Error(payload.error || "Could not permanently delete this image. It remains archived.");
      }
      setNotice(`“${asset.title}” was permanently deleted.`);
    } catch (caught: any) {
      setError(caught?.message || "Could not delete this image.");
      setReloadKey((current) => current + 1);
    } finally {
      setDeletingId("");
    }
  };

  const loadMore = async () => {
    setLoadingMore(true);
    setError("");
    try {
      await loadPage(page + 1, true);
    } catch (caught: any) {
      setError(caught?.message || "Could not load more images.");
    } finally {
      setLoadingMore(false);
    }
  };

  const hasMore = assets.length < total;

  return (
    <div className="min-h-full bg-white">
      <div className="sticky top-0 z-10 border-b border-[#303839]/10 bg-white px-4 pb-4 pt-4">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#D4AF37]">Uploads</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="mt-3 flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#303839] px-4 text-sm font-extrabold text-white transition-colors duration-200 hover:bg-[#434c4d] disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] focus-visible:ring-offset-2"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 16V4M7 9l5-5 5 5" />
            <path d="M5 14v5h14v-5" />
          </svg>
          {uploading
            ? batch
              ? `Uploading ${batch.index} of ${batch.total}`
              : `Uploading ${uploadProgress}%`
            : "Upload images"}
        </button>
        <input ref={inputRef} type="file" multiple accept="image/svg+xml,image/png,image/jpeg,image/webp" className="sr-only" disabled={uploading} onChange={(event) => uploadFiles(event.target.files)} />
        <p className="mt-1.5 text-center text-[10px] font-semibold text-[#303839]/45">Select several files at once — SVG, PNG, JPG or WebP.</p>
        {uploading && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#F8F6F1]" role="progressbar" aria-label="Image upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress}>
            <span className="block h-full rounded-full bg-[#D4AF37] transition-[width] duration-200" style={{ width: `${uploadProgress}%` }} />
          </div>
        )}
        {retryFiles.length > 0 && !uploading && (
          <button type="button" onClick={() => uploadFiles(retryFiles)} className="mt-2 min-h-11 w-full rounded-xl border border-red-200 text-xs font-extrabold text-red-700 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
            {retryFiles.length === 1 ? `Retry ${retryFiles[0].name}` : `Retry ${retryFiles.length} failed images`}
          </button>
        )}
        <label className="relative mt-3 block">
          <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-[#303839]/45"><SearchIcon /></span>
          <span className="sr-only">Search previously uploaded images</span>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search uploads" className="min-h-11 w-full rounded-xl border border-[#303839]/12 bg-[#F8F6F1] pl-3 pr-10 text-sm font-semibold text-[#303839] outline-none transition-colors placeholder:text-[#303839]/40 focus:border-[#D4AF37] focus:bg-white focus:ring-2 focus:ring-[#D4AF37]/20" />
        </label>
      </div>

      <div className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#303839]/55">Previously uploaded</p>
          {!loading && total > 0 && <span className="text-[10px] font-bold text-[#303839]/40">{total} image{total === 1 ? "" : "s"}</span>}
        </div>

        <div aria-live="polite" className="grid gap-2">
          {notice && <p className="rounded-xl border border-[#D4AF37]/35 bg-[#D4AF37]/10 px-3 py-2 text-xs font-semibold text-[#66551c]" role="status">{notice}</p>}
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700" role="alert">
              <p>{error}</p>
              <button type="button" onClick={() => setReloadKey((current) => current + 1)} className="mt-1 font-extrabold underline underline-offset-2">Try loading again</button>
            </div>
          )}
          {usage.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p className="font-extrabold">This image remains available in:</p>
              <ul className="mt-1 list-disc pl-4">{usage.map((location, index) => <li key={`${location.type}-${location.id}-${index}`}>{location.label || location.type || "Saved design"}</li>)}</ul>
            </div>
          )}
        </div>

        {loading ? (
          <div className="mt-3 grid grid-cols-2 gap-2" aria-label="Loading uploaded images">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="aspect-[4/5] animate-pulse rounded-xl bg-[#F8F6F1]" aria-hidden />)}</div>
        ) : assets.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-[#303839]/18 bg-[#F8F6F1] px-4 py-8 text-center">
            <p className="text-sm font-extrabold text-[#303839]">{search ? "No uploaded images match your search." : "No uploaded images yet."}</p>
            <p className="mt-1 text-xs leading-5 text-[#303839]/55">{search ? "Try a different display name, filename, keyword, or tag." : "Upload an image and it will remain available here for every product."}</p>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2 2xl:gap-3">
            {assets.map((asset) => (
              <article key={asset.id} className="group relative min-w-0 overflow-hidden rounded-xl border border-[#303839]/10 bg-white transition-colors duration-200 hover:border-[#D4AF37]/70">
                <button type="button" onClick={() => onInsertAsset(asset)} className="block w-full cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#D4AF37]" aria-label={`Add ${asset.title} to the current page`}>
                  <span className="grid aspect-square place-items-center overflow-hidden bg-[#F8F6F1] p-2"><img src={asset.thumbnailUrl || asset.editorUrl || asset.url} alt="" loading="lazy" draggable={false} className="max-h-full max-w-full object-contain" /></span>
                  <span className="block p-2 pr-10">
                    <span className="block truncate text-xs font-extrabold text-[#303839]" title={asset.title}>{asset.displayName || asset.title}</span>
                    {asset.originalFilename && asset.originalFilename !== asset.title && <span className="mt-0.5 block truncate text-[9px] text-[#303839]/45" title={asset.originalFilename}>{asset.originalFilename}</span>}
                    <span className="mt-1 block text-[9px] font-bold uppercase tracking-wide text-[#303839]/45">{formatFileType(asset)}{asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}</span>
                    {Boolean(asset.usageCount) && <span className="mt-1 block text-[9px] font-bold text-[#303839]/50">Used {asset.usageCount} time{asset.usageCount === 1 ? "" : "s"}</span>}
                  </span>
                </button>
                <button type="button" onClick={() => deleteAsset(asset)} disabled={deletingId === asset.id} aria-label={`Delete ${asset.title}`} title="Delete image" className="absolute bottom-1.5 right-1.5 grid h-9 w-9 cursor-pointer place-items-center rounded-lg bg-white text-red-600 shadow-[0_2px_10px_rgba(48,56,57,0.12)] transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-wait disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
                  {deletingId === asset.id ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-red-200 border-t-red-600" aria-hidden /> : <TrashIcon />}
                </button>
              </article>
            ))}
          </div>
        )}

        {hasMore && !loading && (
          <button type="button" onClick={loadMore} disabled={loadingMore} className="mt-4 min-h-11 w-full rounded-xl border border-[#303839]/15 bg-white text-xs font-extrabold text-[#303839] transition-colors hover:bg-[#F8F6F1] disabled:cursor-wait disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]">{loadingMore ? "Loading…" : "Load more"}</button>
        )}
      </div>
    </div>
  );
}
