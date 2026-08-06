"use client";

import EditableNumericStepper from "./EditableNumericStepper";
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "@/lib/customizer/v2/zoom";

// Bottom workspace zoom controls, shared by the customer customizer and admin
// builder. View-only zoom: never changes template dimensions or exports.
//
// The range lives in lib/customizer/v2/zoom.ts so the stepper, the pinch
// gesture, the wheel handler and Fit all agree — a computed Fit can legitimately
// land below 50% on a tall page in a short viewport, which the old fixed
// 0.5–2 range silently clipped.

export { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP };

type Props = {
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onFit?: () => void;
  onActualSize?: () => void;
  /** Percentage Fit will jump to; shown so the action is predictable. */
  fitZoom?: number | null;
  className?: string;
};

export default function CustomizerZoomControls({
  zoom,
  onZoomChange,
  onFit,
  onActualSize,
  fitZoom = null,
  className = "",
}: Props) {
  const fitPercent = fitZoom && Number.isFinite(fitZoom) ? Math.round(fitZoom * 100) : null;
  const atFit = fitPercent !== null && Math.abs(Math.round(zoom * 100) - fitPercent) <= 1;

  return (
    <div
      role="group"
      aria-label="Canvas zoom"
      className={`flex min-h-11 items-center gap-0.5 rounded-full border border-[#303839]/12 bg-white px-1 shadow-[0_4px_18px_rgba(48,56,57,0.10)] ${className}`}
    >
      <EditableNumericStepper label="Canvas zoom" value={Math.round(zoom * 100)} minimum={ZOOM_MIN * 100} maximum={ZOOM_MAX * 100} step={ZOOM_STEP * 100} largeStep={50} allowNegative={false} allowDecimal={false} formatValue={(value) => `${Math.round(value)}%`} onCommit={(value) => onZoomChange(value / 100)} className="h-10 w-36 rounded-full bg-white" buttonClassName="grid h-full min-h-10 place-items-center rounded-full text-[#303839] transition hover:bg-[#F8F6F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] disabled:opacity-30" />
      <button type="button" aria-label="Reset to actual size" title="Actual size (100%)" onClick={() => (onActualSize ? onActualSize() : onZoomChange(1))} className="h-10 rounded-full px-2 text-[10px] font-extrabold text-[#303839]/60 transition hover:bg-[#F8F6F1] hover:text-[#303839] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]">1:1</button>
      <span className="mx-1 h-5 w-px bg-[#303839]/15" aria-hidden />
      <button
        type="button"
        aria-pressed={atFit}
        title={fitPercent !== null ? `Fit the whole page (${fitPercent}%)` : "Fit the whole page"}
        onClick={() => (onFit ? onFit() : onZoomChange(1))}
        className={`min-h-10 rounded-full px-3 text-[11px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${
          atFit ? "bg-[#303839] text-white" : "text-[#303839]/70 hover:bg-[#F8F6F1] hover:text-[#303839]"
        }`}
      >
        Fit
      </button>
    </div>
  );
}
