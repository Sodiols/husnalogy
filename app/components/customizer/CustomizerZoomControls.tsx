"use client";

// Bottom workspace zoom controls, shared by the customer customizer and admin
// builder. View-only zoom: never changes template dimensions or exports.

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
export const ZOOM_STEP = 0.1;

type Props = {
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onFit?: () => void;
  className?: string;
};

export default function CustomizerZoomControls({ zoom, onZoomChange, onFit, className = "" }: Props) {
  const clamp = (value: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(value.toFixed(2))));

  return (
    <div
      className={`flex items-center gap-1 rounded-full border border-[#303839]/12 bg-white px-2 py-1 shadow-[0_4px_18px_rgba(48,56,57,0.10)] ${className}`}
    >
      <button
        type="button"
        aria-label="Zoom out"
        onClick={() => onZoomChange(clamp(zoom - ZOOM_STEP))}
        className="grid h-7 w-7 place-items-center rounded-full text-base text-[#303839] hover:bg-[#F8F6F1]"
      >
        −
      </button>
      <span className="w-12 text-center text-xs font-bold text-[#303839]/70" aria-live="polite">
        {Math.round(zoom * 100)}%
      </span>
      <button
        type="button"
        aria-label="Zoom in"
        onClick={() => onZoomChange(clamp(zoom + ZOOM_STEP))}
        className="grid h-7 w-7 place-items-center rounded-full text-base text-[#303839] hover:bg-[#F8F6F1]"
      >
        +
      </button>
      <span className="mx-1 h-4 w-px bg-[#303839]/15" aria-hidden />
      <button
        type="button"
        onClick={() => (onFit ? onFit() : onZoomChange(1))}
        className="rounded-full px-2.5 py-1 text-[11px] font-bold text-[#303839]/70 hover:bg-[#F8F6F1] hover:text-[#303839]"
      >
        Fit
      </button>
    </div>
  );
}
