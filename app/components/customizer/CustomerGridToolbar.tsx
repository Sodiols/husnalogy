"use client";

import { useRef } from "react";
import { getLayerPermissions } from "./customizer-utils";
import {
  resetImageTransformPatch,
  resolveImageCropCapabilities,
} from "@/lib/customizer/v2/image-permissions";
import { ToolbarButton, ToolbarShell, ToolbarStepper } from "./CustomerToolbarKit";

// Contextual toolbar for a selected photo-grid slot: pick the slot, replace or
// clear its photo, crop it, move it to another slot. Drawn like the studio's
// selection toolbar through CustomerToolbarKit.

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

  if (!slot) return null;
  const slots = layer.slots || [];

  const sections: React.ReactNode[] = [];
  sections.push(
    <div key="slots" className="flex shrink-0 items-center">
      {slots.map((item: any, index: number) => (
        // The visible label is just a number; assistive technology needs to
        // hear what the number refers to, and whether the slot has a photo.
        <ToolbarButton
          key={item.id}
          label={`${item.src || item.assetId ? "Photo" : "Empty"} slot ${index + 1} of ${slots.length}`}
          pressed={item.id === slot.id}
          onClick={() => onSelectSlot(item.id)}
        >
          <span className="text-[13px] font-semibold tabular-nums">{index + 1}</span>
        </ToolbarButton>
      ))}
    </div>,
  );

  sections.push(
    <div key="photo" className="flex shrink-0 items-center">
      <ToolbarButton label="Replace" disabled={!permissions.replaceImage} onClick={() => inputRef.current?.click()} />
      {slot.src && <ToolbarButton label="Clear" disabled={!permissions.replaceImage} onClick={onClear} />}
      {!cropping && (
        <ToolbarButton label="Crop" disabled={!slot.src || !(permissions.cropImage || permissions.zoomImage || permissions.repositionImage)} onClick={onEnterCrop} />
      )}
    </div>,
  );

  if (cropping) {
    sections.push(
      <div key="crop-values" className="flex shrink-0 items-center">
        <ToolbarStepper label="Grid photo zoom" value={Math.round(Number(transform.zoom || 1) * 100)} minimum={100} maximum={800} step={10} largeStep={50} disabled={!(permissions.zoomImage || permissions.cropImage)} formatValue={(value) => `${Math.round(value)}%`} widthClass="w-[112px]" onCommit={(value) => onTransform({ zoom: value / 100 })} />
        <ToolbarStepper label="Grid image rotation" value={Number(transform.rotation) || 0} minimum={-360} maximum={360} step={1} largeStep={15} allowNegative disabled={!(permissions.cropImage || permissions.zoomImage || permissions.repositionImage)} widthClass="w-[104px]" onCommit={(rotation) => onTransform({ rotation })} />
        <ToolbarStepper label="Grid crop X position" value={Number(transform.offsetX) || 0} minimum={-10000} maximum={10000} step={1} largeStep={10} allowNegative disabled={!(permissions.repositionImage || permissions.cropImage)} widthClass="w-[104px]" onCommit={(offsetX) => onTransform({ offsetX })} />
        <ToolbarStepper label="Grid crop Y position" value={Number(transform.offsetY) || 0} minimum={-10000} maximum={10000} step={1} largeStep={10} allowNegative disabled={!(permissions.repositionImage || permissions.cropImage)} widthClass="w-[104px]" onCommit={(offsetY) => onTransform({ offsetY })} />
      </div>,
    );
    sections.push(
      <div key="crop-actions" className="flex shrink-0 items-center">
        {/* Gated on the same capabilities as the steppers above, so the
            toolbar never offers a slot edit the save validator will reject. */}
        {capabilities.canRotateImage && (
          <ToolbarButton label="Rotate" ariaLabel="Rotate photo 90 degrees" onClick={() => onTransform({ rotation: (Number(transform.rotation || 0) + 90) % 360 })} />
        )}
        {capabilities.canFlip && <ToolbarButton label="Flip" ariaLabel="Flip photo horizontally" pressed={Boolean(transform.flipX)} onClick={() => onTransform({ flipX: !transform.flipX })} />}
        {Object.keys(resetPatch).length > 0 && <ToolbarButton label="Reset" ariaLabel="Reset photo crop" onClick={onReset} />}
      </div>,
    );
    sections.push(
      <div key="crop-finish" className="flex shrink-0 items-center gap-1">
        <ToolbarButton label="Cancel" onClick={onCancelCrop} />
        <ToolbarButton label="Done" primary onClick={onConfirmCrop} />
      </div>,
    );
  } else if (slots.length > 1) {
    sections.push(
      <div key="move" className="flex shrink-0 items-center">
        <ToolbarButton label="Move ←" ariaLabel="Move photo to previous slot" onClick={() => onMove(-1)} />
        <ToolbarButton label="Move →" ariaLabel="Move photo to next slot" onClick={() => onMove(1)} />
      </div>,
    );
  }

  if (quality) {
    sections.push(
      <span key="quality" className={`mx-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-semibold ${quality === "High quality" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
        {quality}
      </span>,
    );
  }

  return (
    <>
      <ToolbarShell label="Photo grid" selectionKey={`grid-${layer?.id || ""}-${slot.id}`} sections={sections} />
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        tabIndex={-1}
        aria-hidden
        className="sr-only focus-visible:outline-none"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (file) await onUpload(file);
          event.target.value = "";
        }}
      />
    </>
  );
}
