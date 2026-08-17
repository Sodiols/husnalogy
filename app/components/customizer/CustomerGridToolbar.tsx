"use client";

import { useRef } from "react";
import { getLayerPermissions } from "./customizer-utils";
import EditableNumericStepper from "./EditableNumericStepper";
import {
  resetImageTransformPatch,
  resolveImageCropCapabilities,
} from "@/lib/customizer/v2/image-permissions";

export default function CustomerGridToolbar({
  layer,
  selectedSlotId,
  onSelectSlot,
  onUpload,
  onEnterCrop,
  cropping,
  onConfirmCrop,
  onCancelCrop,
  onTransform,
  onClear,
  onReset,
  onMove,
}: any) {
  const inputRef = useRef<HTMLInputElement>(null);
  const slot = (layer?.slots || []).find((item: any) => item.id === selectedSlotId) || layer?.slots?.[0];
  const transform = slot?.transform || {};
  // Slot permissions override the container's — a fixed grid may still expose
  // editable slots (spec §17).
  const permissions = { ...getLayerPermissions(layer), ...(slot?.permissions || {}) };
  const capabilities = resolveImageCropCapabilities(permissions);
  const resetPatch = resetImageTransformPatch(permissions);
  const width = Number(slot?.metadata?.width) || 0;
  const height = Number(slot?.metadata?.height) || 0;
  const quality = Math.min(width, height) >= 1200 ? "High quality" : width && height ? "Check resolution" : "";
  const button = "grid min-h-11 min-w-11 cursor-pointer place-items-center rounded-lg border border-[#303839]/12 bg-white px-3 text-xs font-bold text-[#303839] shadow-sm transition-colors hover:border-[#D4AF37] hover:bg-[#303839]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]";

  if (!slot) return null;

  return (
    <div className="pointer-events-auto flex max-w-[calc(100vw-1rem)] items-center gap-1.5 overflow-x-auto rounded-2xl border border-[#303839]/12 bg-white/95 p-1.5 shadow-[0_16px_45px_rgba(48,56,57,0.16)] backdrop-blur-md">
      <div className="flex items-center gap-1 border-r border-[#303839]/10 pr-1.5">
        {(layer.slots || []).map((item: any, index: number) => (
          // The visible label is just a number; assistive technology needs to
          // hear what the number refers to, and whether the slot has a photo.
          <button
            key={item.id}
            type="button"
            aria-pressed={item.id === slot.id}
            aria-label={`${item.src || item.assetId ? "Photo" : "Empty"} slot ${index + 1} of ${(layer.slots || []).length}`}
            onClick={() => onSelectSlot(item.id)}
            className={`${button} ${item.id === slot.id ? "border-[#303839] bg-[#303839] text-white hover:bg-[#303839]" : ""}`}
          >
            {index + 1}
          </button>
        ))}
      </div>
      <button type="button" disabled={!permissions.replaceImage} onClick={() => inputRef.current?.click()} className={`${button} disabled:cursor-not-allowed disabled:opacity-35`}>Replace</button>
      {slot.src && <button type="button" onClick={onClear} disabled={!permissions.replaceImage} className={`${button} disabled:cursor-not-allowed disabled:opacity-35`}>Clear</button>}
      {!cropping ? (
        <button type="button" onClick={onEnterCrop} disabled={!slot.src || !(permissions.cropImage || permissions.zoomImage || permissions.repositionImage)} className={`${button} disabled:cursor-not-allowed disabled:opacity-35`}>Crop</button>
      ) : (
        <>
          <EditableNumericStepper label="Grid photo zoom" value={Math.round(Number(transform.zoom || 1) * 100)} minimum={100} maximum={800} step={10} largeStep={50} allowNegative={false} allowDecimal={false} disabled={!(permissions.zoomImage || permissions.cropImage)} formatValue={(value) => `${Math.round(value)}%`} onCommit={(value) => onTransform({ zoom: value / 100 })} className="h-11 w-36 shrink-0 rounded-lg border border-[#303839]/12 bg-white" />
          <EditableNumericStepper label="Grid image rotation" value={Number(transform.rotation) || 0} minimum={-360} maximum={360} step={1} largeStep={15} allowNegative allowDecimal={false} disabled={!(permissions.cropImage || permissions.zoomImage || permissions.repositionImage)} onCommit={(rotation) => onTransform({ rotation })} className="h-11 w-36 shrink-0 rounded-lg border border-[#303839]/12 bg-white" />
          <EditableNumericStepper label="Grid crop X position" value={Number(transform.offsetX) || 0} minimum={-10000} maximum={10000} step={1} largeStep={10} allowNegative allowDecimal={false} disabled={!(permissions.repositionImage || permissions.cropImage)} onCommit={(offsetX) => onTransform({ offsetX })} className="h-11 w-36 shrink-0 rounded-lg border border-[#303839]/12 bg-white" />
          <EditableNumericStepper label="Grid crop Y position" value={Number(transform.offsetY) || 0} minimum={-10000} maximum={10000} step={1} largeStep={10} allowNegative allowDecimal={false} disabled={!(permissions.repositionImage || permissions.cropImage)} onCommit={(offsetY) => onTransform({ offsetY })} className="h-11 w-36 shrink-0 rounded-lg border border-[#303839]/12 bg-white" />
          {/* Gated on the same capabilities as the steppers above, so the
              toolbar never offers a slot edit the save validator will reject. */}
          {capabilities.canRotateImage && (
            <button type="button" aria-label="Rotate photo 90 degrees" onClick={() => onTransform({ rotation: (Number(transform.rotation || 0) + 90) % 360 })} className={button}>Rotate</button>
          )}
          {capabilities.canFlip && (
            <button type="button" aria-label="Flip photo horizontally" onClick={() => onTransform({ flipX: !transform.flipX })} className={button}>Flip</button>
          )}
          {Object.keys(resetPatch).length > 0 && (
            <button type="button" aria-label="Reset photo crop" onClick={onReset} className={button}>Reset</button>
          )}
          <button type="button" onClick={onCancelCrop} className={button}>Cancel</button>
          <button type="button" onClick={onConfirmCrop} className={`${button} !border-[#303839] !bg-[#303839] !text-white`}>Done</button>
        </>
      )}
      {!cropping && (layer.slots || []).length > 1 && (
        <>
          <button type="button" onClick={() => onMove(-1)} className={button} aria-label="Move photo to previous slot">Move ←</button>
          <button type="button" onClick={() => onMove(1)} className={button} aria-label="Move photo to next slot">Move →</button>
        </>
      )}
      {quality && <span className={`whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-extrabold ${quality === "High quality" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{quality}</span>}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (file) await onUpload(file);
          event.target.value = "";
        }}
      />
    </div>
  );
}
