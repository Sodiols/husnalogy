"use client";

import EditableNumericStepper from "./EditableNumericStepper";
import {
  resetImageTransformPatch,
  resolveImageCropCapabilities,
} from "@/lib/customizer/v2/image-permissions";
import { FOCUS_RING } from "@/lib/customizer/v2/design-tokens";

// Contextual photo toolbar (spec §11, §26). Rendered while an editable image
// layer is selected. Two modes:
//  - normal: Replace / Crop / rotation input, gated by permissions
//  - crop:   zoom slider, rotate 90°, flip H/V, reset, cancel, done
// Every control is gated by the layer's admin-configured customer permissions.

type ImageTransformState = {
  zoom?: number;
  offsetX?: number;
  offsetY?: number;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
};

type Props = {
  layer: any;
  permissions: Record<string, boolean>;
  cropping: boolean;
  hasImage: boolean;
  onReplace?: () => void;
  onEnterCrop?: () => void;
  onConfirmCrop?: () => void;
  onCancelCrop?: () => void;
  onImagePatch: (patch: ImageTransformState, group?: string) => void;
  onLayerRotate?: (rotation: number) => void;
  filtersEnabled?: boolean;
  onFilterPatch?: (patch: Record<string, number | string | undefined>, group?: string) => void;
  allowedFilters?: string[];
};

const IconButton = ({
  label,
  onClick,
  children,
  active = false,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
  active?: boolean;
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg transition ${FOCUS_RING} ${
      active ? "bg-[#303839] text-white" : "text-[#303839] hover:bg-[#303839]/5"
    }`}
  >
    {children}
  </button>
);

export default function CustomerImageToolbar({
  layer,
  permissions,
  cropping,
  hasImage,
  onReplace,
  onEnterCrop,
  onConfirmCrop,
  onCancelCrop,
  onImagePatch,
  onLayerRotate,
  filtersEnabled = false,
  onFilterPatch,
  allowedFilters = [],
}: Props) {
  const transform: ImageTransformState = layer?.imageTransform || {};
  const zoom = Number(transform.zoom) > 0 ? Number(transform.zoom) : 1;
  const imageRotation = Number(transform.rotation) || 0;

  const canReplace = Boolean(permissions.replaceImage);
  // Derived from the SAME rule the save validator applies, so no control here
  // can offer an edit the server will reject (spec §16, §25, §33).
  const { canZoom, canReposition, canFlip, canRotateImage, canEnterCrop } =
    resolveImageCropCapabilities(permissions);
  const canCrop = canEnterCrop;
  const canRotateLayer = Boolean(permissions.rotate);
  // Reset must only touch fields this customer may write — resetting a flip the
  // template forbids used to fail the whole save with `flip-not-allowed`.
  const resetPatch = resetImageTransformPatch(permissions);
  const canReset = Object.keys(resetPatch).length > 0;
  const filterAllowed = (key: string) => !allowedFilters.length || allowedFilters.includes(key) || (key.startsWith("tint") && allowedFilters.includes("tint"));
  const resetFilters = Object.fromEntries(Object.entries({ brightness: 1, contrast: 1, saturation: 1, grayscale: 0, sepia: 0, tintAmount: 0 }).filter(([key]) => filterAllowed(key)));

  const divider = <span className="mx-0.5 h-5 w-px shrink-0 bg-[#303839]/12" aria-hidden />;

  if (cropping) {
    return (
      <div
        className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-[#303839]/12 bg-white px-2 py-1.5 shadow-[0_6px_24px_rgba(48,56,57,0.14)] no-scrollbar"
        role="toolbar"
        aria-label="Crop photo"
      >
        <span className="whitespace-nowrap px-1 text-[10px] font-bold uppercase tracking-wide text-[#303839]/50">Crop</span>

        {canZoom && (
          <EditableNumericStepper label="Zoom photo" value={Math.round(zoom * 100)} minimum={100} maximum={500} step={1} largeStep={10} allowNegative={false} allowDecimal={false} formatValue={(value) => `${Math.round(value)}%`} onCommit={(value) => onImagePatch({ zoom: value / 100 }, "crop-zoom")} showLabel className="h-11 w-32 shrink-0 rounded-lg bg-white px-1" />
        )}

        {canRotateImage && (
          <EditableNumericStepper label="Image rotation" value={imageRotation} minimum={-360} maximum={360} step={1} largeStep={15} allowNegative allowDecimal={false} onCommit={(rotation) => onImagePatch({ rotation }, "crop-rotate")} showLabel className="h-11 w-32 shrink-0 rounded-lg bg-white px-1" />
        )}
        <EditableNumericStepper label="Crop X position" value={Number(transform.offsetX) || 0} minimum={-10000} maximum={10000} step={1} largeStep={10} allowNegative allowDecimal={false} disabled={!canReposition} onCommit={(offsetX) => onImagePatch({ offsetX }, "crop-position")} showLabel className="h-11 w-32 shrink-0 rounded-lg bg-white px-1" />
        <EditableNumericStepper label="Crop Y position" value={Number(transform.offsetY) || 0} minimum={-10000} maximum={10000} step={1} largeStep={10} allowNegative allowDecimal={false} disabled={!canReposition} onCommit={(offsetY) => onImagePatch({ offsetY }, "crop-position")} showLabel className="h-11 w-32 shrink-0 rounded-lg bg-white px-1" />

        {canRotateImage && (
          <IconButton
            label="Rotate photo 90°"
            onClick={() => onImagePatch({ rotation: (imageRotation + 90) % 360 }, "crop-rotate")}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 12a9 9 0 1 1-3-6.7" />
              <path d="M21 3v5h-5" />
            </svg>
          </IconButton>
        )}

        {canFlip && (
          <>
            <IconButton
              label="Flip horizontally"
              active={Boolean(transform.flipX)}
              onClick={() => onImagePatch({ flipX: !transform.flipX }, "crop-flip")}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M12 3v18M8 8 4 12l4 4M16 8l4 4-4 4" />
              </svg>
            </IconButton>
            <IconButton
              label="Flip vertically"
              active={Boolean(transform.flipY)}
              onClick={() => onImagePatch({ flipY: !transform.flipY }, "crop-flip")}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M3 12h18M8 8l4-4 4 4M8 16l4 4 4-4" />
              </svg>
            </IconButton>
          </>
        )}

        {canReset && (
          <IconButton
            label="Reset crop"
            onClick={() => onImagePatch(resetPatch, "crop-reset")}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 3v5h5" />
            </svg>
          </IconButton>
        )}

        {divider}

        <button
          type="button"
          onClick={onCancelCrop}
          className="min-h-11 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold text-[#303839]/70 hover:bg-[#303839]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirmCrop}
          className="min-h-11 whitespace-nowrap rounded-full bg-[#303839] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#1f2526] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div
      className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-[#303839]/12 bg-white px-2 py-1.5 shadow-[0_6px_24px_rgba(48,56,57,0.14)] no-scrollbar"
      role="toolbar"
      aria-label="Photo options"
    >
      {canReplace && (
        <button
          type="button"
          onClick={onReplace}
          className="min-h-11 whitespace-nowrap rounded-full bg-white px-3 py-1.5 text-xs font-bold text-[#303839] hover:bg-[#ECE9E1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
        >
          {hasImage ? "Replace Photo" : "Add Photo"}
        </button>
      )}

      {canCrop && hasImage && (
        <button
          type="button"
          onClick={onEnterCrop}
          className="flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold text-[#303839] hover:bg-[#303839]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M6 2v16a2 2 0 0 0 2 2h14" />
            <path d="M18 22V8a2 2 0 0 0-2-2H2" />
          </svg>
          Crop
        </button>
      )}

      {canRotateLayer && onLayerRotate && (
        <>
          {divider}
          <EditableNumericStepper label="Rotation in degrees" value={Math.round(Number(layer?.rotation) || 0)} minimum={-360} maximum={360} step={1} largeStep={15} allowNegative allowDecimal={false} onCommit={onLayerRotate} showLabel className="h-11 w-32 shrink-0 rounded-lg bg-white px-1" />
        </>
      )}
      {filtersEnabled && permissions.applyImageFilters && onFilterPatch && (
        <>
          {divider}
          {[
            ["brightness", "Brightness", 0, 2, 0.05, 1],
            ["contrast", "Contrast", 0, 2, 0.05, 1],
            ["saturation", "Saturation", 0, 2, 0.05, 1],
            ["grayscale", "Grayscale", 0, 1, 0.05, 0],
            ["sepia", "Sepia", 0, 1, 0.05, 0],
          ].filter(([key]) => !allowedFilters.length || allowedFilters.includes(String(key))).map(([key, label, min, max, step, fallback]: any) => (
            <EditableNumericStepper key={key} label={label} value={layer.filters?.[key] ?? fallback} minimum={min} maximum={max} step={step} largeStep={step * 5} allowNegative={min < 0} allowDecimal={step < 1} onCommit={(value) => onFilterPatch({ [key]: value }, `filter-${key}`)} showLabel className="h-11 w-28 shrink-0 rounded-lg bg-white px-1" />
          ))}
          {(!allowedFilters.length || allowedFilters.includes("tint")) && <><label className="grid min-h-11 shrink-0 grid-cols-[auto_44px] items-center gap-2 rounded-lg bg-white px-2 text-[9px] font-bold"><span>Tint</span><input type="color" value={layer.filters?.tintColor || "#D4AF37"} onChange={(event) => onFilterPatch({ tintColor: event.target.value, tintAmount: Math.max(0.2, Number(layer.filters?.tintAmount) || 0) }, "filter-tint")} className="h-11 w-11 rounded-full" /></label>
          <EditableNumericStepper label="Tint amount" value={layer.filters?.tintAmount || 0} minimum={0} maximum={1} step={0.05} largeStep={0.25} allowNegative={false} allowDecimal onCommit={(tintAmount) => onFilterPatch({ tintAmount }, "filter-tint")} showLabel className="h-11 w-28 shrink-0 rounded-lg bg-white px-1" /></>}
          <button type="button" onClick={() => onFilterPatch(resetFilters, "filter-reset")} className="min-h-11 shrink-0 rounded-lg px-2 text-[10px] font-bold hover:bg-[#303839]/5">Reset filters</button>
        </>
      )}
    </div>
  );
}
