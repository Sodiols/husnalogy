"use client";

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
    className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg transition ${
      active ? "bg-[#303839] text-white" : "text-[#303839] hover:bg-[#F8F6F1]"
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
  const canCrop = Boolean(permissions.cropImage || permissions.zoomImage || permissions.repositionImage);
  const canZoom = Boolean(permissions.zoomImage || permissions.cropImage);
  const canFlip = Boolean(permissions.flipImage);
  const canRotateLayer = Boolean(permissions.rotate);
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
          <label className="flex shrink-0 items-center gap-1.5 px-1.5" title="Zoom">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="text-[#303839]/60">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3M8 11h6M11 8v6" />
            </svg>
            <input
              type="range"
              min={1}
              max={5}
              step={0.01}
              value={zoom}
              onChange={(e) => onImagePatch({ zoom: Number(e.target.value) }, "crop-zoom")}
              className="w-24 accent-[#303839]"
              aria-label="Zoom photo"
            />
            <span className="w-9 text-center text-[10px] font-bold text-[#303839]/70">{Math.round(zoom * 100)}%</span>
          </label>
        )}

        <IconButton
          label="Rotate photo 90°"
          onClick={() => onImagePatch({ rotation: (imageRotation + 90) % 360 }, "crop-rotate")}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <path d="M21 3v5h-5" />
          </svg>
        </IconButton>

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

        <IconButton
          label="Reset crop"
          onClick={() => onImagePatch({ zoom: 1, offsetX: 0, offsetY: 0, rotation: 0, flipX: false, flipY: false }, "crop-reset")}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 3v5h5" />
          </svg>
        </IconButton>

        {divider}

        <button
          type="button"
          onClick={onCancelCrop}
          className="min-h-11 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold text-[#303839]/70 hover:bg-[#F8F6F1]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirmCrop}
          className="min-h-11 whitespace-nowrap rounded-full bg-[#303839] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#1f2526]"
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
          className="min-h-11 whitespace-nowrap rounded-full bg-[#F8F6F1] px-3 py-1.5 text-xs font-bold text-[#303839] hover:bg-[#ECE9E1]"
        >
          {hasImage ? "Replace Photo" : "Add Photo"}
        </button>
      )}

      {canCrop && hasImage && (
        <button
          type="button"
          onClick={onEnterCrop}
          className="flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold text-[#303839] hover:bg-[#F8F6F1]"
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
          <label className="flex shrink-0 items-center gap-1.5 px-1.5" title="Rotation">
            <span className="text-[10px] font-bold uppercase text-[#303839]/50">Rotate</span>
            <input
              type="number"
              min={-360}
              max={360}
              step={1}
              value={Math.round(Number(layer?.rotation) || 0)}
              onChange={(e) => onLayerRotate(((Number(e.target.value) % 360) + 360) % 360)}
              className="h-8 w-14 rounded-md border border-[#303839]/12 px-1.5 text-center text-xs font-semibold text-[#303839] outline-none focus:border-[#303839]/40"
              aria-label="Rotation in degrees"
            />
          </label>
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
            <label key={key} className="flex shrink-0 items-center gap-1 rounded-lg bg-[#F8F6F1] px-2 py-1 text-[9px] font-bold">
              <span>{label}</span>
              <input type="range" min={min} max={max} step={step} value={layer.filters?.[key] ?? fallback} onChange={(event) => onFilterPatch({ [key]: Number(event.target.value) }, `filter-${key}`)} className="w-16 accent-[#303839]" aria-label={label} />
            </label>
          ))}
          {(!allowedFilters.length || allowedFilters.includes("tint")) && <><label className="grid min-h-11 shrink-0 grid-cols-[auto_30px] items-center gap-2 rounded-lg bg-[#F8F6F1] px-2 text-[9px] font-bold"><span>Tint</span><input type="color" value={layer.filters?.tintColor || "#D4AF37"} onChange={(event) => onFilterPatch({ tintColor: event.target.value, tintAmount: Math.max(0.2, Number(layer.filters?.tintAmount) || 0) }, "filter-tint")} className="h-8 w-8 rounded-full" /></label>
          <label className="flex min-h-11 shrink-0 items-center gap-1 rounded-lg bg-[#F8F6F1] px-2 text-[9px] font-bold"><span>Tint amount</span><input type="range" min="0" max="1" step="0.05" value={layer.filters?.tintAmount || 0} onChange={(event) => onFilterPatch({ tintAmount: Number(event.target.value) }, "filter-tint") } className="w-16 accent-[#303839]" /></label></>}
          <button type="button" onClick={() => onFilterPatch(resetFilters, "filter-reset")} className="min-h-11 shrink-0 rounded-lg px-2 text-[10px] font-bold hover:bg-[#F8F6F1]">Reset filters</button>
        </>
      )}
    </div>
  );
}
