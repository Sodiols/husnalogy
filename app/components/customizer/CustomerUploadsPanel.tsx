"use client";

// Uploads panel (Section 9). Reuses the existing /api/customizer/upload route
// and Supabase Storage flow; adds zoom / nudge / reset positioning controls
// gated by the layer's admin permissions.

import { useState } from "react";
import { getImageUrl, getLayerPermissions } from "./customizer-utils";
import { mapCustomerFields } from "./CustomerEditPanel";

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
        <label className="mt-2 flex h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-[#303839]/25 bg-white text-xs font-bold text-[#303839]/60 transition hover:bg-[#F4ECEC]">
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
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-[#303839]/10 bg-[#F4ECEC]">
              <img src={url} alt={field.label} className="h-full w-full object-cover" draggable={false} />
            </div>
            <div className="grid gap-1.5">
              {allowReplace && (
                <label className="cursor-pointer rounded-full border border-[#303839]/15 bg-white px-3 py-1 text-center text-xs font-bold text-[#303839] hover:bg-[#F4ECEC]">
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
                    className="grid h-8 w-8 place-items-center rounded-md border border-[#303839]/12 text-[#303839] hover:bg-[#F4ECEC]"
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
}: Props) {
  const photoEntries = mapCustomerFields(template).filter(
    (entry) => entry.field.type === "image" || entry.field.type === "file",
  );

  if (!photoEntries.length) {
    return <p className="p-5 text-sm text-[#303839]/55">This design has no photo areas to fill.</p>;
  }

  return (
    <div className="grid gap-3 p-4">
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
          onUploadPhoto={onUploadPhoto}
        />
      ))}
    </div>
  );
}
