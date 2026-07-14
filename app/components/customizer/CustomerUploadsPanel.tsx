"use client";

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

function PhotoLibrary({ onPick, refreshKey }: { onPick: (asset: LibraryAsset) => void; refreshKey: number }) {
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

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

  const removeAsset = async (asset: LibraryAsset) => {
    setMessage("");
    const res = await fetch(`/api/customizer/library/${encodeURIComponent(asset.id)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      setMessage(data?.error || "Could not delete this photo.");
      return;
    }
    setAssets((current) => current.filter((item) => item.id !== asset.id));
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
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by filename…"
        aria-label="Search your photos"
        className="mt-2 w-full rounded-full border border-[#303839]/12 px-3 py-1.5 text-xs text-[#303839] outline-none placeholder:text-[#303839]/40 focus:border-[#303839]/35"
      />
      {message && (
        <p className="mt-2 text-xs font-bold text-red-700" role="alert">
          {message}
        </p>
      )}
      {loading ? (
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="aspect-square animate-pulse rounded-md bg-[#F8F6F1]" aria-hidden />
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
                  className="block aspect-square w-full overflow-hidden rounded-md border border-[#303839]/10 bg-[#F8F6F1] transition hover:border-[#D4AF37] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37]"
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
                  aria-label={`Delete ${asset.fileName} from library`}
                  className="absolute right-0.5 top-0.5 hidden h-5 w-5 place-items-center rounded-full bg-white/90 text-red-700 shadow group-hover:grid"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
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
        <label className="mt-2 flex h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-[#303839]/25 bg-white text-xs font-bold text-[#303839]/60 transition hover:bg-[#F8F6F1]">
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
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-[#303839]/10 bg-[#F8F6F1]">
              <img src={url} alt={field.label} className="h-full w-full object-cover" draggable={false} />
            </div>
            <div className="grid gap-1.5">
              {allowReplace && (
                <label className="cursor-pointer rounded-full border border-[#303839]/15 bg-white px-3 py-1 text-center text-xs font-bold text-[#303839] hover:bg-[#F8F6F1]">
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
            <label className="mt-3 flex items-center gap-2 text-xs font-bold text-[#303839]/70">
              <span className="w-12">Zoom</span>
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={Number(value?.zoom) || 1}
                onChange={(e) => patch({ zoom: Number(e.target.value) })}
                className="flex-1 accent-[#303839]"
                aria-label={`Zoom ${field.label}`}
              />
            </label>
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
                    className="grid h-8 w-8 place-items-center rounded-md border border-[#303839]/12 text-[#303839] hover:bg-[#F8F6F1]"
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
}: Props) {
  const { user } = useAuth();
  const [libraryRefresh, setLibraryRefresh] = useState(0);
  const photoEntries = mapCustomerFields(template).filter(
    (entry) => entry.field.type === "image" || entry.field.type === "file",
  );

  const hasSelectedGridSlot = Boolean(selectedGridLayer?.type === "grid" && selectedGridSlotId);

  if (!photoEntries.length && !hasSelectedGridSlot) {
    return <p className="p-5 text-sm text-[#303839]/55">This design has no photo areas to fill.</p>;
  }

  // Reusing a library photo fills the selected photo area, else the first
  // empty one, else the first area.
  const applyLibraryAsset = (asset: LibraryAsset) => {
    if (hasSelectedGridSlot && onPickGridAsset) {
      onPickGridAsset(asset);
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

      {user && <PhotoLibrary onPick={applyLibraryAsset} refreshKey={libraryRefresh} />}
    </div>
  );
}
