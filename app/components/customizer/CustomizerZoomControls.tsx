"use client";

import EditableNumericStepper from "./EditableNumericStepper";

// Bottom workspace zoom controls, shared by the customer customizer and admin
// builder. View-only zoom: never changes template dimensions or exports.

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
export const ZOOM_STEP = 0.1;

type Props = {
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onFit?: () => void;
  onActualSize?: () => void;
  className?: string;
};

export default function CustomizerZoomControls({ zoom, onZoomChange, onFit, onActualSize, className = "" }: Props) {
  return (
    <div
      role="group"
      aria-label="Canvas zoom"
      className={`flex min-h-11 items-center gap-0.5 rounded-full border border-[#303839]/12 bg-white px-1 shadow-[0_4px_18px_rgba(48,56,57,0.10)] ${className}`}
    >
      <EditableNumericStepper label="Canvas zoom" value={Math.round(zoom * 100)} minimum={ZOOM_MIN * 100} maximum={ZOOM_MAX * 100} step={ZOOM_STEP * 100} largeStep={50} allowNegative={false} allowDecimal={false} formatValue={(value) => `${Math.round(value)}%`} onCommit={(value) => onZoomChange(value / 100)} className="h-10 w-36 rounded-full bg-white" buttonClassName="grid h-full min-h-10 place-items-center rounded-full text-[#303839] transition hover:bg-[#F8F6F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] disabled:opacity-30" />
      <button type="button" aria-label="Reset to actual size" title="Actual size" onClick={() => (onActualSize ? onActualSize() : onZoomChange(1))} className="h-10 rounded-full px-2 text-[10px] font-extrabold text-[#303839]/60 transition hover:bg-[#F8F6F1] hover:text-[#303839]">1:1</button>
      <span className="mx-1 h-5 w-px bg-[#303839]/15" aria-hidden />
      <button
        type="button"
        onClick={() => (onFit ? onFit() : onZoomChange(1))}
        className="min-h-10 rounded-full px-3 text-[11px] font-bold text-[#303839]/70 transition hover:bg-[#F8F6F1] hover:text-[#303839]"
      >
        Fit
      </button>
    </div>
  );
}
