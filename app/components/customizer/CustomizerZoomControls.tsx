"use client";

import EditableNumericStepper from "./EditableNumericStepper";
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, nextZoomPreset } from "@/lib/customizer/v2/zoom";

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
  /**
   * Zoom value that renders the document at its true physical size. Supplied
   * where 1:1 is a real, separate scale (the admin builder); when omitted, 1:1
   * falls back to plain 100%.
   */
  actualSizeZoom?: number | null;
  /** Step through the named zoom stops instead of a linear percentage step. */
  usePresetSteps?: boolean;
  className?: string;
};

export default function CustomizerZoomControls({
  zoom,
  onZoomChange,
  onFit,
  onActualSize,
  fitZoom = null,
  actualSizeZoom = null,
  usePresetSteps = false,
  className = "",
}: Props) {
  const fitPercent = fitZoom && Number.isFinite(fitZoom) ? Math.round(fitZoom * 100) : null;
  const atFit = fitPercent !== null && Math.abs(Math.round(zoom * 100) - fitPercent) <= 1;
  const actualPercent =
    actualSizeZoom && Number.isFinite(actualSizeZoom) ? Math.round(actualSizeZoom * 100) : null;
  const atActualSize = actualPercent !== null && Math.abs(Math.round(zoom * 100) - actualPercent) <= 1;

  return (
    <div
      role="group"
      aria-label="Canvas zoom"
      className={`flex min-h-11 items-center gap-0.5 rounded-full border border-[#303839]/12 bg-white px-1 shadow-[0_4px_18px_rgba(48,56,57,0.10)] ${className}`}
    >
      <EditableNumericStepper
        label="Canvas zoom"
        value={Math.round(zoom * 100)}
        minimum={ZOOM_MIN * 100}
        maximum={ZOOM_MAX * 100}
        step={ZOOM_STEP * 100}
        largeStep={50}
        allowNegative={false}
        allowDecimal={false}
        formatValue={(value) => `${Math.round(value)}%`}
        onCommit={(value) => {
          // Preset mode: the arrows walk the named stops (25, 33, 50, ...) so
          // each press lands on a round, meaningful percentage.
          if (!usePresetSteps) return onZoomChange(value / 100);
          const current = Math.round(zoom * 100);
          if (value === current) return;
          const stepped = Math.abs(value - current) <= ZOOM_STEP * 100 + 0.5
            ? nextZoomPreset(zoom, value > current ? 1 : -1) * 100
            : value;
          onZoomChange(stepped / 100);
        }}
        className="h-10 w-36 rounded-full bg-white"
        buttonClassName="grid h-full min-h-10 place-items-center rounded-full text-[#303839] transition hover:bg-[#F8F6F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] disabled:opacity-30"
      />
      <button
        type="button"
        aria-label="Show the page at actual size"
        aria-pressed={atActualSize}
        title={actualPercent !== null ? `Actual size — the printed page at true scale (${actualPercent}%)` : "Actual size"}
        onClick={() => (onActualSize ? onActualSize() : onZoomChange(1))}
        className={`h-10 rounded-full px-2 text-[10px] font-extrabold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${
          atActualSize ? "bg-[#303839] text-white" : "text-[#303839]/60 hover:bg-[#F8F6F1] hover:text-[#303839]"
        }`}
      >
        1:1
      </button>
      <span className="mx-1 h-5 w-px bg-[#303839]/15" aria-hidden />
      <button
        type="button"
        aria-pressed={atFit}
        title={fitPercent !== null ? `Fit the whole page and recentre (${fitPercent}%)` : "Fit the whole page"}
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
