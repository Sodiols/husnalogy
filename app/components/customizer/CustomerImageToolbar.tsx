"use client";

import { useRef } from "react";
import {
  resetImageTransformPatch,
  resolveImageCropCapabilities,
} from "@/lib/customizer/v2/image-permissions";
import ToolbarPopover from "@/app/admin/dashboard/design-builder/ToolbarPopover";
import ColourInput from "./ColourInput";
import { ComfortableDensity, TB_ICON_BUTTON, TB_ON, TB_TEXT_BUTTON, ToolbarButton, ToolbarIcon, ToolbarLabel, ToolbarShell, ToolbarStepper, useCompact } from "./CustomerToolbarKit";

// Contextual photo toolbar (spec §11, §26). Rendered while an editable image
// layer is selected. Two modes:
//  - normal: Replace / Crop / rotation input, gated by permissions
//  - crop:   zoom, rotate 90°, flip H/V, reset, cancel, done
// Every control is gated by the layer's admin-configured customer permissions.
//
// Drawn like the studio's selection toolbar through CustomerToolbarKit: it
// goes compact when the room is short (the studio's crop bar shares the
// workspace with two side panels) instead of hiding Done off-screen.

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
  /**
   * The Crop X / Crop Y number fields. On by default; an editor whose crop
   * surface already repositions by dragging and that has less room (the Design
   * Studio, which also keeps them in its inspector) can leave them out.
   */
  showPositionFields?: boolean;
  /** Kept for callers; the shared toolbar shell always fits itself to the room it has. */
  fitToWidth?: boolean;
};

const ICONS = {
  crop: "M6 2v16a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2",
  rotate: "M21 12a9 9 0 1 1-3-6.7M21 3v5h-5",
  flipX: "M12 3v18M8 8 4 12l4 4M16 8l4 4-4 4",
  flipY: "M3 12h18M8 8l4-4 4 4M8 16l4 4 4-4",
  reset: "M3 12a9 9 0 1 0 3-6.7M3 3v5h5",
  adjust: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
} as const;

/** The "Adjust" trigger: icon and label when there is room, icon alone when compact. */
function AdjustTrigger() {
  return (
    <>
      <ToolbarIcon path={ICONS.adjust} />
      <ToolbarLabel>Adjust</ToolbarLabel>
    </>
  );
}

/** "Crop" as the crop bar's caption: shown when there is room, a heading for assistive tech when compact. */
function CropCaption() {
  const compact = useCompact();
  return <span className={compact ? "sr-only" : "whitespace-nowrap px-2 text-[13px] font-semibold text-[#303839]/80"}>Crop</span>;
}

/** The photo tint: a colour chip that opens the system colour picker. */
function TintChip({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <label
      title="Tint colour"
      className="relative grid h-[var(--tb-size,36px)] w-[var(--tb-size,36px)] shrink-0 cursor-pointer place-items-center rounded-full transition-colors hover:bg-[#303839]/[0.06] focus-within:ring-2 focus-within:ring-[#303839]"
    >
      <span className="block h-5 w-5 rounded-full border border-[#303839]/25" style={{ background: value }} aria-hidden />
      <ColourInput aria-label="Tint colour" value={value} onChange={onChange} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
    </label>
  );
}

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
  showPositionFields = true,
}: Props) {
  // Rotate 90° and the flips act on the value THEY last set, not only the
  // rendered one: two clicks faster than a re-render each saw the same stale
  // value, so a rotation step (or a flip) was silently lost. A new value from
  // outside (the stepper, Reset, another session) is picked up as it arrives.
  const latest = useRef({ rotation: 0, flipX: false, flipY: false, seen: { rotation: NaN as number, flipX: undefined as boolean | undefined, flipY: undefined as boolean | undefined } });
  const transform: ImageTransformState = layer?.imageTransform || {};
  const zoom = Number(transform.zoom) > 0 ? Number(transform.zoom) : 1;
  const imageRotation = Number(transform.rotation) || 0;
  const flipX = Boolean(transform.flipX);
  const flipY = Boolean(transform.flipY);

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

  if (latest.current.seen.rotation !== imageRotation) latest.current = { ...latest.current, rotation: imageRotation, seen: { ...latest.current.seen, rotation: imageRotation } };
  if (latest.current.seen.flipX !== flipX) latest.current = { ...latest.current, flipX, seen: { ...latest.current.seen, flipX } };
  if (latest.current.seen.flipY !== flipY) latest.current = { ...latest.current, flipY, seen: { ...latest.current.seen, flipY } };
  const rotateQuarter = () => {
    const rotation = (latest.current.rotation + 90) % 360;
    latest.current.rotation = rotation;
    onImagePatch({ rotation }, "crop-rotate");
  };
  const toggleFlip = (axis: "flipX" | "flipY") => {
    const next = !latest.current[axis];
    latest.current[axis] = next;
    onImagePatch({ [axis]: next }, "crop-flip");
  };

  if (cropping) {
    const sections: React.ReactNode[] = [];
    // Values: the steppers keep room for "100%".
    sections.push(
      <div key="values" className="flex shrink-0 items-center">
        <CropCaption />
        {canZoom && (
          <ToolbarStepper label="Zoom photo" value={Math.round(zoom * 100)} minimum={100} maximum={500} step={1} largeStep={10} formatValue={(value) => `${Math.round(value)}%`} widthClass="w-[112px]" onCommit={(value) => onImagePatch({ zoom: value / 100 }, "crop-zoom")} />
        )}
        {canRotateImage && (
          <ToolbarStepper label="Image rotation" value={imageRotation} minimum={-360} maximum={360} step={1} largeStep={15} allowNegative widthClass="w-[104px]" onCommit={(rotation) => onImagePatch({ rotation }, "crop-rotate")} />
        )}
        {showPositionFields && (
          <>
            <ToolbarStepper label="Crop X position" value={Number(transform.offsetX) || 0} minimum={-10000} maximum={10000} step={1} largeStep={10} allowNegative disabled={!canReposition} widthClass="w-[104px]" onCommit={(offsetX) => onImagePatch({ offsetX }, "crop-position")} />
            <ToolbarStepper label="Crop Y position" value={Number(transform.offsetY) || 0} minimum={-10000} maximum={10000} step={1} largeStep={10} allowNegative disabled={!canReposition} widthClass="w-[104px]" onCommit={(offsetY) => onImagePatch({ offsetY }, "crop-position")} />
          </>
        )}
      </div>,
    );
    if (canRotateImage || canFlip || canReset) {
      sections.push(
        <div key="actions" className="flex shrink-0 items-center">
          {canRotateImage && <ToolbarButton label="Rotate photo 90°" icon={ICONS.rotate} onClick={rotateQuarter} />}
          {canFlip && (
            <>
              <ToolbarButton label="Flip horizontally" icon={ICONS.flipX} pressed={flipX} onClick={() => toggleFlip("flipX")} />
              <ToolbarButton label="Flip vertically" icon={ICONS.flipY} pressed={flipY} onClick={() => toggleFlip("flipY")} />
            </>
          )}
          {canReset && <ToolbarButton label="Reset crop" icon={ICONS.reset} onClick={() => onImagePatch(resetPatch, "crop-reset")} />}
        </div>,
      );
    }
    sections.push(
      <div key="finish" className="flex shrink-0 items-center gap-1">
        <ToolbarButton label="Cancel" onClick={onCancelCrop} />
        <ToolbarButton label="Done" primary onClick={onConfirmCrop} />
      </div>,
    );
    return <ToolbarShell label="Crop photo" selectionKey={`crop-${layer?.id || ""}`} sections={sections} />;
  }

  const sections: React.ReactNode[] = [];
  if (canReplace || (canCrop && hasImage)) {
    sections.push(
      <div key="photo" className="flex shrink-0 items-center">
        {canReplace && <ToolbarButton label={hasImage ? "Replace Photo" : "Add Photo"} onClick={onReplace} />}
        {canCrop && hasImage && <ToolbarButton label="Crop" icon={ICONS.crop} showLabel collapsible={false} onClick={onEnterCrop} />}
      </div>,
    );
  }
  if (canRotateLayer && onLayerRotate) {
    sections.push(
      <ToolbarStepper key="rotation" caption="Rotation" label="Rotation in degrees" value={Math.round(Number(layer?.rotation) || 0)} minimum={-360} maximum={360} step={1} largeStep={15} allowNegative widthClass="w-[104px]" onCommit={onLayerRotate} />,
    );
  }
  if (filtersEnabled && permissions.applyImageFilters && onFilterPatch) {
    // The photo adjustments live in one popover, as the studio keeps its image
    // bar short: brightness, contrast, saturation, greyscale, sepia and tint.
    sections.push(
      <AdjustMenu key="filters" layer={layer} allowedFilters={allowedFilters} resetFilters={resetFilters} onFilterPatch={onFilterPatch} />,
    );
  }
  if (!sections.length) return null;
  return <ToolbarShell label="Photo options" selectionKey={`photo-${layer?.id || ""}`} sections={sections} />;
}

/** The photo adjustments, opened from "Adjust" on the photo toolbar. */
function AdjustMenu({
  layer,
  allowedFilters,
  resetFilters,
  onFilterPatch,
}: {
  layer: any;
  allowedFilters: string[];
  resetFilters: Record<string, number>;
  onFilterPatch: (patch: Record<string, number | string | undefined>, group?: string) => void;
}) {
  const compact = useCompact();
  const trigger = compact ? TB_ICON_BUTTON : TB_TEXT_BUTTON;
  const filters = [
    ["brightness", "Brightness", 0, 2, 0.05, 1],
    ["contrast", "Contrast", 0, 2, 0.05, 1],
    ["saturation", "Saturation", 0, 2, 0.05, 1],
    ["grayscale", "Grayscale", 0, 1, 0.05, 0],
    ["sepia", "Sepia", 0, 1, 0.05, 0],
  ].filter(([key]) => !allowedFilters.length || allowedFilters.includes(String(key)));
  return (
    <ToolbarPopover
      label="Adjust photo"
      triggerTitle="Adjust photo"
      role="dialog"
      menuWidth={272}
      triggerClassName={trigger}
      triggerActiveClassName={`${trigger} ${TB_ON}`}
      trigger={<AdjustTrigger />}
    >
      {() => (
        <ComfortableDensity>
          <div className="grid gap-2 p-2" data-customizer-text-interaction>
            <p className="text-[13px] font-bold text-[#1f2425]">Adjust photo</p>
            {filters.map(([key, label, min, max, step, fallback]: any) => (
              <div key={key} className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-[#303839]/80">{label}</span>
                <ToolbarStepper label={label} value={layer.filters?.[key] ?? fallback} minimum={min} maximum={max} step={step} largeStep={step * 5} allowNegative={min < 0} allowDecimal={step < 1} onCommit={(value) => onFilterPatch({ [key]: value }, `filter-${key}`)} />
              </div>
            ))}
            {(!allowedFilters.length || allowedFilters.includes("tint")) && (
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1 text-[13px] font-medium text-[#303839]/80">
                  Tint
                  <TintChip value={layer.filters?.tintColor || "#D4AF37"} onChange={(tintColor) => onFilterPatch({ tintColor, tintAmount: Math.max(0.2, Number(layer.filters?.tintAmount) || 0) }, "filter-tint")} />
                </span>
                <ToolbarStepper label="Tint amount" value={layer.filters?.tintAmount || 0} minimum={0} maximum={1} step={0.05} largeStep={0.25} allowDecimal onCommit={(tintAmount) => onFilterPatch({ tintAmount }, "filter-tint")} />
              </div>
            )}
            <div className="border-t border-[#303839]/10 pt-2">
              <ToolbarButton label="Reset filters" onClick={() => onFilterPatch(resetFilters, "filter-reset")} />
            </div>
          </div>
        </ComfortableDensity>
      )}
    </ToolbarPopover>
  );
}
