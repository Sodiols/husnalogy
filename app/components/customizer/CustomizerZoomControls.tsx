"use client";

import EditableNumericStepper from "./EditableNumericStepper";
import ToolbarPopover, { ToolbarMenuItem, ToolbarMenuSection } from "@/app/admin/dashboard/design-builder/ToolbarPopover";
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, nextZoomPreset } from "@/lib/customizer/v2/zoom";

// Bottom workspace zoom controls of the customer customizer, drawn like the
// Design Studio's canvas bar (AdminCanvasBar): round white "−" and "+", the
// value in a white box with a menu of Fit / Actual size / presets, and the
// 1:1 actual-size control as its own round button — in brand colours.
// View-only zoom: never changes template dimensions or exports.
//
// The range lives in lib/customizer/v2/zoom.ts so the stepper, the pinch
// gesture, the wheel handler and Fit all agree — a computed Fit can legitimately
// land below 50% on a tall page in a short viewport.

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
   * where 1:1 is a real, separate scale; when omitted, 1:1 falls back to 100%.
   */
  actualSizeZoom?: number | null;
  /** Step through the named zoom stops instead of a linear percentage step. */
  usePresetSteps?: boolean;
  className?: string;
};

const SHADOW = "shadow-[0_2px_10px_rgba(31,36,37,0.12)]";
/** The studio canvas bar's round control, 44px (the touch target) in brand ink. */
export const CANVAS_CIRCLE = `grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full bg-white text-[#1f2425] ${SHADOW} transition-colors hover:bg-[#F3F1EC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F3F1EC] disabled:cursor-not-allowed disabled:opacity-40`;
const CANVAS_CIRCLE_ON = `grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full bg-[#303839] text-white ${SHADOW} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F3F1EC]`;
const ZOOM_PRESET_PERCENTS = [25, 50, 75, 100, 150, 200, 300];

const icon = (path: string, size = 22) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={path} />
  </svg>
);

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
  const percent = Math.round(zoom * 100);
  const fitPercent = fitZoom && Number.isFinite(fitZoom) ? Math.round(fitZoom * 100) : null;
  const atFit = fitPercent !== null && Math.abs(percent - fitPercent) <= 1;
  const actualPercent = actualSizeZoom && Number.isFinite(actualSizeZoom) ? Math.round(actualSizeZoom * 100) : null;
  const atActualSize = actualPercent !== null && Math.abs(percent - actualPercent) <= 1;
  // Preset mode walks the named stops (25, 33, 50, ...) so each press lands on a
  // round, meaningful percentage; otherwise it is a plain linear step.
  const stepZoom = (direction: -1 | 1) =>
    onZoomChange(usePresetSteps ? nextZoomPreset(zoom, direction) : Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom + direction * ZOOM_STEP)));
  const fit = () => (onFit ? onFit() : onZoomChange(1));
  const actualSize = () => (onActualSize ? onActualSize() : onZoomChange(1));

  return (
    <div data-customer-canvas-bar className={`flex shrink-0 items-center gap-2 ${className}`}>
      <button type="button" data-shape="round" aria-label="Zoom out" title="Zoom out" disabled={zoom <= ZOOM_MIN + 0.001} onClick={() => stepZoom(-1)} className={CANVAS_CIRCLE}>
        {icon("M5 12h14")}
      </button>
      <div role="group" aria-label="Canvas zoom" className={`flex h-11 items-center rounded-lg bg-white pl-1 pr-0.5 ${SHADOW}`}>
        <EditableNumericStepper
          label="Canvas zoom"
          // The same `zoom` the canvas multiplies by, so the label and the rendered size cannot diverge.
          value={Math.round(zoom * 100)}
          minimum={ZOOM_MIN * 100}
          maximum={ZOOM_MAX * 100}
          step={ZOOM_STEP * 100}
          largeStep={50}
          allowNegative={false}
          allowDecimal={false}
          showStepButtons={false}
          formatValue={(value) => `${Math.round(value)}%`}
          onCommit={(value) => onZoomChange(value / 100)}
          className="h-9 w-[60px]"
          inputClassName="h-9 w-full rounded-md bg-transparent px-1 text-center text-[15px] font-bold tabular-nums text-[#1f2425] outline-none focus:bg-[#F3F1EC]"
        />
        <ToolbarPopover
          label="Zoom options"
          triggerTitle="Zoom options"
          menuWidth={200}
          align="center"
          triggerClassName="grid h-9 w-7 cursor-pointer place-items-center rounded-md text-[#1f2425] hover:bg-[#F3F1EC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839]"
          trigger={
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M6 9h12l-6 7z" />
            </svg>
          }
        >
          {(close) => (
            <>
              <ToolbarMenuItem
                label="Fit to screen"
                hint={fitPercent !== null ? `${fitPercent}% · the whole page, recentred` : undefined}
                active={atFit}
                onSelect={() => {
                  fit();
                  close();
                }}
              />
              <ToolbarMenuItem
                label="Actual size"
                hint={actualPercent !== null ? `${actualPercent}% · the printed page at true scale` : "The printed page at true scale"}
                active={atActualSize}
                onSelect={() => {
                  actualSize();
                  close();
                }}
              />
              <ToolbarMenuSection title="Zoom">
                {ZOOM_PRESET_PERCENTS.map((value) => (
                  <ToolbarMenuItem
                    key={value}
                    label={`${value}%`}
                    active={percent === value}
                    onSelect={() => {
                      onZoomChange(value / 100);
                      close();
                    }}
                  />
                ))}
              </ToolbarMenuSection>
            </>
          )}
        </ToolbarPopover>
      </div>
      <button type="button" data-shape="round" aria-label="Zoom in" title="Zoom in" disabled={zoom >= ZOOM_MAX - 0.001} onClick={() => stepZoom(1)} className={CANVAS_CIRCLE}>
        {icon("M12 5v14M5 12h14")}
      </button>
      <button
        type="button"
        data-shape="round"
        aria-label="Show the page at actual size"
        aria-pressed={atActualSize}
        title={actualPercent !== null ? `Actual size — the printed page at true scale (${actualPercent}%)` : "Actual size"}
        onClick={actualSize}
        className={`${atActualSize ? CANVAS_CIRCLE_ON : CANVAS_CIRCLE} text-[13px] font-bold`}
      >
        1:1
      </button>
    </div>
  );
}
