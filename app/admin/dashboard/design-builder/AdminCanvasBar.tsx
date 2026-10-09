"use client";

import type { ReactNode } from "react";
import EditableNumericStepper from "@/app/components/customizer/EditableNumericStepper";
import ToolbarPopover, { ToolbarMenuItem, ToolbarMenuSection } from "./ToolbarPopover";
import { ZOOM_MAX, ZOOM_MIN, nextZoomPreset } from "@/lib/customizer/v2/zoom";

/**
 * The Design Studio's canvas bar: zoom out · zoom · zoom in · settings · help
 * · orientation — round white controls floating under the artboard.
 *
 * Settings gathers the canvas aids (snapping, safe area, bleed, the hand tool
 * and ruler guides) as switches with a line of explanation each; Orientation
 * holds the card's Horizontal / Vertical choice. Every control drives the
 * studio's existing state — nothing here keeps state of its own.
 */

type Orientation = "portrait" | "landscape" | "square";

type Props = {
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onFit: () => void;
  onActualSize: () => void;
  /** The zoom that shows the printed card at true size, if known. */
  actualSizeZoom?: number | null;
  snapEnabled: boolean;
  onToggleSnap: () => void;
  showSafeArea: boolean;
  onToggleSafeArea: () => void;
  showBleed: boolean;
  onToggleBleed: () => void;
  panActive: boolean;
  onTogglePan: () => void;
  onAddGuide: (axis: "horizontal" | "vertical") => void;
  orientation: Orientation;
  onOrientationChange: (orientation: "portrait" | "landscape") => void;
};

const icon = (children: ReactNode, size = 22) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

const HELP_PATHS = (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.3-2.4 3.8" />
    <circle cx="12" cy="17.2" r="0.6" fill="currentColor" />
  </>
);

const ICONS = {
  minus: icon(<path d="M5 12h14" />),
  plus: icon(<path d="M12 5v14M5 12h14" />),
  caret: icon(<path d="m7 10 5 5 5-5Z" fill="currentColor" stroke="none" />, 18),
  gear: icon(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </>,
  ),
  help: icon(HELP_PATHS),
  // A card with its corner marks: the orientation control.
  orientation: icon(
    <>
      <path d="M7 4v13h13" />
      <path d="M4 7h13v6" />
    </>,
  ),
  portrait: icon(<rect x="7" y="3.5" width="10" height="17" rx="1.5" />, 18),
  landscape: icon(<rect x="3.5" y="7" width="17" height="10" rx="1.5" />, 18),
  check: icon(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.2 2.4 2.4 4.6-5" />
    </>,
    20,
  ),
};

const SHADOW = "shadow-[0_2px_10px_rgba(31,36,37,0.12)]";
const CIRCLE = `grid h-10 w-10 sm:h-11 sm:w-11 cursor-pointer place-items-center rounded-full bg-white text-[#1f2425] ${SHADOW} transition-colors hover:bg-[#F2F3F5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F3F1EC] disabled:cursor-not-allowed disabled:opacity-40`;
const CIRCLE_ACTIVE = `grid h-10 w-10 sm:h-11 sm:w-11 cursor-pointer place-items-center rounded-full bg-[#E3E5F2] text-[#27307A] ${SHADOW} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F3F1EC]`;
const ZOOM_PRESET_PERCENTS = [25, 50, 75, 100, 150, 200, 300];

/** A labelled on/off switch with one line of explanation, as in the reference settings. */
function SettingSwitch({ title, description, checked, onChange, hint }: { title: string; description: string; checked: boolean; onChange: () => void; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-[15px] font-bold text-[#1f2425]">{title}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-[#303839]/75">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        title={hint || title}
        data-shape="round"
        onClick={onChange}
        className={`relative mt-0.5 h-8 w-[54px] shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A] focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
          checked ? "bg-[#27307A]" : "bg-[#4a4f50]"
        }`}
      >
        <span
          aria-hidden
          className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow-sm transition-[left] duration-200 motion-reduce:transition-none ${checked ? "left-[26px]" : "left-1"}`}
        />
      </button>
    </div>
  );
}

export default function AdminCanvasBar(props: Props) {
  const percent = Math.round(props.zoom * 100);
  const actualPercent = props.actualSizeZoom && Number.isFinite(props.actualSizeZoom) ? Math.round(props.actualSizeZoom * 100) : null;
  const squareCard = props.orientation === "square";
  const pill = "inline-flex h-8 cursor-pointer items-center rounded-full border-[1.5px] border-[#27307A] bg-white px-3 text-[13px] font-semibold text-[#27307A] transition-colors hover:bg-[#27307A]/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A] focus-visible:ring-offset-2 focus-visible:ring-offset-white";

  return (
    <div data-admin-canvas-bar className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1.5 sm:flex-nowrap sm:gap-2.5">
      {/* Zoom: out · the value (typed or chosen) · in */}
      <button type="button" data-shape="round" aria-label="Zoom out" title="Zoom out" disabled={props.zoom <= ZOOM_MIN + 0.001} onClick={() => props.onZoomChange(nextZoomPreset(props.zoom, -1))} className={CIRCLE}>
        {ICONS.minus}
      </button>
      <div role="group" aria-label="Canvas zoom" className={`flex h-10 items-center rounded-lg bg-white pl-1 pr-0.5 sm:h-11 ${SHADOW}`}>
        <EditableNumericStepper
          label="Canvas zoom"
          value={percent}
          minimum={ZOOM_MIN * 100}
          maximum={ZOOM_MAX * 100}
          step={10}
          largeStep={50}
          allowNegative={false}
          allowDecimal={false}
          showStepButtons={false}
          formatValue={(value) => `${Math.round(value)}%`}
          onCommit={(value) => props.onZoomChange(value / 100)}
          className="h-9 w-[60px]"
          inputClassName="h-9 w-full rounded-md bg-transparent px-1 text-center text-[15px] font-bold tabular-nums text-[#1f2425] outline-none focus:bg-[#F2F3F5]"
        />
        <ToolbarPopover
          label="Zoom options"
          triggerTitle="Zoom options"
          menuWidth={200}
          align="center"
          triggerClassName="grid h-9 w-7 cursor-pointer place-items-center rounded-md text-[#1f2425] hover:bg-[#F2F3F5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A]"
          trigger={ICONS.caret}
        >
          {(close) => (
            <>
              <ToolbarMenuItem label="Fit to screen" onSelect={() => { props.onFit(); close(); }} />
              <ToolbarMenuItem
                label="Actual size"
                hint={actualPercent !== null ? `${actualPercent}% · the printed card at true scale` : "The printed card at true scale"}
                active={actualPercent !== null && Math.abs(percent - actualPercent) <= 1}
                onSelect={() => { props.onActualSize(); close(); }}
              />
              <ToolbarMenuSection title="Zoom">
                {ZOOM_PRESET_PERCENTS.map((value) => (
                  <ToolbarMenuItem key={value} label={`${value}%`} active={percent === value} onSelect={() => { props.onZoomChange(value / 100); close(); }} />
                ))}
              </ToolbarMenuSection>
            </>
          )}
        </ToolbarPopover>
      </div>
      <button type="button" data-shape="round" aria-label="Zoom in" title="Zoom in" disabled={props.zoom >= ZOOM_MAX - 0.001} onClick={() => props.onZoomChange(nextZoomPreset(props.zoom, 1))} className={CIRCLE}>
        {ICONS.plus}
      </button>

      {/* Settings: the canvas aids. */}
      <ToolbarPopover
        label="Canvas settings"
        triggerTitle="Settings"
        role="dialog"
        menuWidth={380}
        maxMenuHeight={620}
        align="center"
        triggerShape="round"
        triggerClassName={CIRCLE}
        triggerActiveClassName={CIRCLE_ACTIVE}
        trigger={ICONS.gear}
        menuClassName="!rounded-2xl !p-0"
      >
        {() => (
          <div className="px-5 pb-4 pt-2" data-canvas-settings>
            <SettingSwitch title="Snap" description="Snaps objects to guides, the page and each other" checked={props.snapEnabled} onChange={props.onToggleSnap} />
            <SettingSwitch title="Safe area" description="Shows where important text and photos should stay" checked={props.showSafeArea} onChange={props.onToggleSafeArea} />
            <SettingSwitch title="Bleed" description="Shows the margin printed past the trim" checked={props.showBleed} onChange={props.onToggleBleed} />
            <SettingSwitch title="Pan" description="Drag the canvas to move around (or hold Space)" hint="Pan the canvas (or hold Space)" checked={props.panActive} onChange={props.onTogglePan} />
            <div className="flex items-start justify-between gap-4 py-2">
              <div className="min-w-0">
                <p className="text-[15px] font-bold text-[#1f2425]">Guide</p>
                <p className="mt-0.5 text-[13px] leading-snug text-[#303839]/75">Adds a ruler guide to drag into place</p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button type="button" data-shape="round" aria-label="Horizontal guide" onClick={() => props.onAddGuide("horizontal")} className={pill}>
                  Horizontal
                </button>
                <button type="button" data-shape="round" aria-label="Vertical guide" onClick={() => props.onAddGuide("vertical")} className={pill}>
                  Vertical
                </button>
              </div>
            </div>
            <div className="mt-1 border-t border-[#303839]/12 pt-3">
              <a href="/support" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md text-[15px] text-[#1f2425] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A]">
                {icon(HELP_PATHS, 20)}
                Go to help center
              </a>
            </div>
          </div>
        )}
      </ToolbarPopover>

      <a href="/support" target="_blank" rel="noopener noreferrer" aria-label="Help center" title="Help center" className={`${CIRCLE} max-sm:hidden`}>
        {ICONS.help}
      </a>

      {/* Orientation: the card's Horizontal / Vertical choice. */}
      <ToolbarPopover
        label="Orientation"
        triggerTitle={squareCard ? "A square card has no orientation" : "Orientation"}
        disabled={squareCard}
        menuWidth={240}
        align="center"
        triggerShape="round"
        triggerClassName={CIRCLE}
        triggerActiveClassName={CIRCLE_ACTIVE}
        trigger={ICONS.orientation}
        menuClassName="!rounded-xl !p-2"
      >
        {(close) => (
          <div role="radiogroup" aria-label="Artboard orientation" className="grid gap-0.5">
            {(["landscape", "portrait"] as const).map((value) => {
              const active = props.orientation === value;
              const label = value === "portrait" ? "Vertical" : "Horizontal";
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={label}
                  data-toolbar-menu-item
                  title={`${label} card — the design is carried across`}
                  onClick={() => {
                    if (!active) props.onOrientationChange(value);
                    close();
                  }}
                  className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-left text-[15px] text-[#1f2425] transition-colors hover:bg-[#F2F3F5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A]"
                >
                  <span className="text-[#303839]/70">{value === "portrait" ? ICONS.portrait : ICONS.landscape}</span>
                  <span className="flex-1">{label}</span>
                  {active && <span className="text-[#1f7a3d]">{ICONS.check}</span>}
                </button>
              );
            })}
          </div>
        )}
      </ToolbarPopover>
    </div>
  );
}
