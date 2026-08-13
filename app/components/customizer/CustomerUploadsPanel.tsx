"use client";

import EditableNumericStepper from "./EditableNumericStepper";

// Uploads panel (Section 9 + spec §15). Reuses the existing
// /api/customizer/upload route and Supabase Storage flow; adds zoom / nudge /
// reset positioning controls gated by the layer's admin permissions, plus the
// reusable photo library so customers can reuse images across products.

import { useEffect, useState } from "react";
import useAuth from "@/app/lib/useAuth";
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

// Rough quality hint from source pixels: a 5x7 print at 300dpi wants ~1500px.
function qualityLabel(width: number, height: number): { label: string; good: boolean } {
  const largest = Math.max(width, height);
  if (!largest) return { label: "", good: true };
  if (largest >= 1500) return { label: "Great quality", good: true };
  if (largest >= 800) return { label: "Good quality", good: true };
  return { label: "Low resolution", good: false };
}

function PhotoLibrary({
  onPick,
  refreshKey,
  onUploadPhoto,
  onUploaded,
}: {
  onPick: (asset: LibraryAsset) => void;
  refreshKey: number;
  onUploadPhoto: (file: File) => Promise<any>;
  onUploaded: () => void;
}) {
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [batch, setBatch] = useState<{ index: number; total: number } | null>(null);
  const [uploadError, setUploadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const query = new URLSearchParams({ sort, pageSize: "24" });
    if (search.trim()) query.set("search", search.trim());
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/customizer/library?${query.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.ok) setAssets(data.assets || []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, search ? 300 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search, sort, refreshKey]);

  /**
   * Bulk upload into the photo library (spec §1, §37). Files are sent one at a
   * time, so a single rejected file never cancels the ones that already
   * succeeded and every success is reusable straight away. Filling a photo
   * area stays a deliberate, separate action.
   */
  const uploadFiles = async (input?: FileList | File[] | null) => {
    const files = Array.from(input || []).filter(Boolean) as File[];
    if (!files.length) return;
    setUploadError("");
    setMessage("");
    setBatch({ index: 1, total: files.length });
    const failed: string[] = [];
    let uploaded = 0;
    for (let index = 0; index < files.length; index += 1) {
      setBatch({ index: index + 1, total: files.length });
      try {
        await onUploadPhoto(files[index]);
        uploaded += 1;
      } catch (caught: any) {
        failed.push(files[index].name);
        if (String(caught?.message || "").toLowerCase().includes("sign in")) break;
      }
    }
    setBatch(null);
    if (uploaded) {
      setMessage(`${uploaded} photo${uploaded === 1 ? "" : "s"} added to your library.`);
      onUploaded();
    }
    if (failed.length) {
      setUploadError(
        failed.length === 1
          ? `${failed[0]} could not be uploaded.`
          : `${failed.length} of ${files.length} photos could not be uploaded (${failed.join(", ")}).`,
      );
    }
  };

  const removeAsset = async (asset: LibraryAsset) => {
    if (!window.confirm(`Delete “${asset.fileName}” from your photo library? Photos used in a cart or order cannot be deleted.`)) return;
    setMessage("");
    setUploadError("");
    setDeletingId(asset.id);
    try {
      const res = await fetch(`/api/customizer/library/${encodeURIComponent(asset.id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        setUploadError(data?.error || "Could not delete this photo.");
        return;
      }
      setAssets((current) => current.filter((item) => item.id !== asset.id));
      setMessage(`“${asset.fileName}” was deleted.`);
    } finally {
      setDeletingId("");
    }
  };

  return (
    <div className="rounded-lg border border-[#303839]/12 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[#303839]">Your photo library</p>
        <button
          type="button"
          onClick={() => setSort((current) => (current === "newest" ? "oldest" : "newest"))}
          className="text-xs font-bold text-[#303839]/60 underline-offset-2 hover:underline"
          aria-label={`Sort by ${sort === "newest" ? "oldest" : "newest"} first`}
        >
          {sort === "newest" ? "Newest first" : "Oldest first"}
        </button>
      </div>
      <label className="mt-2 flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-[#303839] px-3 text-xs font-extrabold text-white transition hover:bg-[#434c4d]">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 16V4M7 9l5-5 5 5" />
          <path d="M5 14v5h14v-5" />
        </svg>
        {batch ? `Uploading ${batch.index} of ${batch.total}` : "Upload photos"}
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={Boolean(batch)}
          onChange={(event) => {
            uploadFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </label>
      <p className="mt-1 text-center text-[10px] text-[#303839]/45">Select several photos at once · JPG, PNG or WebP</p>
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by filename…"
        aria-label="Search your photos"
        className="mt-2 w-full rounded-full border border-[#303839]/12 px-3 py-1.5 text-xs text-[#303839] outline-none placeholder:text-[#303839]/40 focus:border-[#303839]/35"
      />
      {batch && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#F8F6F1]" role="progressbar" aria-label="Photo upload progress" aria-valuemin={0} aria-valuemax={batch.total} aria-valuenow={batch.index}>
          <span className="block h-full rounded-full bg-[#D4AF37] transition-[width] duration-200" style={{ width: `${Math.round((batch.index / batch.total) * 100)}%` }} />
        </div>
      )}
      {uploadError && (
        <p className="mt-2 text-xs font-bold text-red-700" role="alert">
          {uploadError}
        </p>
      )}
      {message && (
        <p className="mt-2 text-xs font-bold text-[#303839]/70" role="status">
          {message}
        </p>
      )}
      {loading ? (
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="aspect-square animate-pulse rounded-md bg-white" aria-hidden />
          ))}
        </div>
      ) : assets.length === 0 ? (
        <p className="mt-2 text-xs text-[#303839]/50">
          {search ? "No photos match your search." : "Photos you upload will appear here for reuse."}
        </p>
      ) : (
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {assets.map((asset) => {
            const quality = qualityLabel(asset.width, asset.height);
            return (
              <div key={asset.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onPick(asset)}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData("application/x-husnalogy-photo", JSON.stringify(asset));
                  }}
                  title={`Use ${asset.fileName}${asset.width ? ` (${asset.width}×${asset.height}px${quality.label ? ` · ${quality.label}` : ""})` : ""}`}
                  aria-label={`Use photo ${asset.fileName}`}
                  className="block aspect-square w-full overflow-hidden rounded-md border border-[#303839]/10 bg-white transition hover:border-[#D4AF37] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37]"
                >
                  <img src={asset.thumbnailUrl || asset.url} alt={asset.fileName} loading="lazy" draggable={false} className="h-full w-full object-cover" />
                </button>
                {!quality.good && (
                  <span
                    className="pointer-events-none absolute left-0.5 top-0.5 rounded bg-amber-600 px-1 text-[8px] font-bold text-white"
                    title="Low resolution"
                  >
                    LOW
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeAsset(asset)}
                  disabled={deletingId === asset.id}
                  aria-label={`Delete ${asset.fileName} from library`}
                  title="Delete photo"
                  className="absolute right-1 top-1 grid h-9 w-9 cursor-pointer place-items-center rounded-lg bg-white/95 text-red-600 shadow-[0_2px_10px_rgba(48,56,57,0.18)] transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
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
            );
          })}
        </div>
      )}
    </div>
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
      className={`rounded-lg border p-3 transition ${selected ? "border-[#D4AF37] bg-[#D4AF37]/5" : "border-[#303839]/12"}`}
      onClick={onSelect}
    >
      <p className="text-sm font-semibold text-[#303839]">
        {field.label}
        {field.required && <span className="text-[#D4AF37]"> *</span>}
      </p>

      {!url ? (
        <label className="mt-2 flex h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-[#303839]/25 bg-white text-xs font-bold text-[#303839]/60 transition hover:bg-[#303839]/5">
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
                <label className="cursor-pointer rounded-full border border-[#303839]/15 bg-white px-3 py-1 text-center text-xs font-bold text-[#303839] hover:bg-[#303839]/5">
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
                className="rounded-full px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
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
              <span className="w-12 text-xs font-bold text-[#303839]/70">Move</span>
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
                    className="grid h-8 w-8 place-items-center rounded-md border border-[#303839]/12 text-[#303839] hover:bg-[#303839]/5"
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
                className="ml-auto text-xs font-bold text-[#303839]/60 underline-offset-2 hover:underline"
              >
                Reset
              </button>
            </div>
          )}
        </div>
      )}

      <p className="mt-2 text-[11px] text-[#303839]/45">JPG, PNG, or WebP · up to 15MB</p>
      {field.helpText && <p className="mt-0.5 text-xs text-[#303839]/55">{field.helpText}</p>}
      {(uploadError || error) && (
        <p className="mt-1 text-xs font-bold text-red-700" role="alert">
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
  const [libraryRefresh, setLibraryRefresh] = useState(0);
  const photoEntries = mapCustomerFields(template).filter(
    (entry) => entry.field.type === "image" || entry.field.type === "file",
  );

  const hasSelectedGridSlot = Boolean(selectedGridLayer?.type === "grid" && selectedGridSlotId);
  const hasSelectedUserFrame = Boolean(selectedUserFrame?.isUserLayer && (selectedUserFrame.type === "frame" || selectedUserFrame.type === "image"));

  if (!photoEntries.length && !hasSelectedGridSlot && !hasSelectedUserFrame) {
    return <p className="p-5 text-sm text-[#303839]/55">This design has no photo areas to fill.</p>;
  }

  // Reusing a library photo fills the selected photo area, else the first
  // empty one, else the first area.
  const applyLibraryAsset = (asset: LibraryAsset) => {
    if (hasSelectedGridSlot && onPickGridAsset) {
      onPickGridAsset(asset);
      return;
    }
    if (hasSelectedUserFrame && onPickUserFrame) {
      onPickUserFrame(asset);
      return;
    }
    const target =
      photoEntries.find((entry) => entry.layer.id === selectedLayerId) ||
      photoEntries.find((entry) => !getImageUrl(values[entry.field.id])) ||
      photoEntries[0];
    if (!target) return;
    if (!getLayerPermissions(target.layer).replaceImage) return;
    onFocusPage?.(target.page);
    onSelectLayer?.(target.layer.id);
    onChange(target.field.id, {
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
    });
  };

  return (
    <div className="grid gap-3 p-4">
      {hasSelectedGridSlot && (
        <div className="rounded-lg border border-[#D4AF37]/40 bg-[#D4AF37]/8 p-3 text-xs text-[#303839]">
          <p className="font-extrabold">Photo grid slot selected</p>
          <p className="mt-1 text-[#303839]/60">Choose a library photo below, drag one onto a slot, or use Replace above the canvas.</p>
        </div>
      )}
      {hasSelectedUserFrame && (
        <div className="grid gap-2 rounded-lg border border-[#D4AF37]/40 bg-[#D4AF37]/8 p-3 text-xs text-[#303839]">
          <p className="font-extrabold">Customer frame selected</p>
          <p className="text-[#303839]/60">Choose a library photo or upload a new one.</p>
          <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg bg-[#303839] px-3 font-bold text-white">
            Upload photo
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={async (event) => { const file = event.target.files?.[0]; if (file && onPickUserFrame) { const uploaded = await onUploadPhoto(file); onPickUserFrame(uploaded); setLibraryRefresh((current) => current + 1); } event.target.value = ""; }} />
          </label>
        </div>
      )}
      {photoEntries.map(({ field, layer, page }) => (
        <PhotoCard
          key={field.id}
          field={field}
          layer={layer}
          value={values[field.id]}
          error={errors[field.id]}
          selected={selectedLayerId === layer.id}
          onSelect={() => {
            onFocusPage?.(page);
            onSelectLayer?.(layer.id);
          }}
          onChange={(next: any) => onChange(field.id, next)}
          onUploadPhoto={async (file: File) => {
            const uploaded = await onUploadPhoto(file);
            setLibraryRefresh((current) => current + 1);
            return uploaded;
          }}
        />
      ))}

      {user && (
        <PhotoLibrary
          onPick={applyLibraryAsset}
          refreshKey={libraryRefresh}
          onUploadPhoto={onUploadPhoto}
          onUploaded={() => setLibraryRefresh((current) => current + 1)}
        />
      )}
    </div>
  );
}
