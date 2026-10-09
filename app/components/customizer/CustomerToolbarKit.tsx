"use client";

/**
 * The customer customizer's toolbar kit: the Design Studio's selection-toolbar
 * look (AdminContextToolbar) in the Husnalogy brand colours.
 *
 * One white capsule with a hairline border; borderless round controls with a
 * soft grey hover; thin separators; "Caption − 17 +" steppers; a colour chip
 * that opens a swatch popover. The studio's light-blue "on" state is the brand
 * ink here, and its navy accents are charcoal.
 *
 * Sizing matches the studio — 36px controls, 32px in the compact density — and
 * grows to the 44px touch target on a coarse pointer (spec §22), so a phone
 * still gets thumb-sized controls.
 */

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import EditableNumericStepper from "./EditableNumericStepper";
import ToolbarPopover from "@/app/admin/dashboard/design-builder/ToolbarPopover";
import { normaliseSwatch, orderSwatches } from "@/lib/customizer/v2/swatch-order";

/* ------------------------------------------------------------- density ---- */

export type Density = "comfortable" | "compact";
const DensityContext = createContext<Density>("comfortable");
export const useCompact = () => useContext(DensityContext) === "compact";

/** Popover content keeps its captions: it is never squeezed like the bar it opens from. */
export function ComfortableDensity({ children }: { children: ReactNode }) {
  return <DensityContext.Provider value="comfortable">{children}</DensityContext.Provider>;
}

/* ----------------------------------------------------------- primitives ---- */

export const TB_BUTTON =
  "flex h-[var(--tb-size,36px)] shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full text-[13px] font-medium text-[#303839] transition-colors hover:bg-[#303839]/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] disabled:cursor-not-allowed disabled:text-[#303839]/30 disabled:hover:bg-transparent";
/** The "on" state: brand ink, where the studio uses light blue. */
export const TB_ON = "bg-[#303839] text-white hover:bg-[#414b4c]";
export const TB_ICON_BUTTON = `${TB_BUTTON} w-[var(--tb-size,36px)]`;
export const TB_TEXT_BUTTON = `${TB_BUTTON} px-[var(--tb-pad,12px)]`;

export function ToolbarSeparator() {
  return <span aria-hidden className="mx-[var(--tb-sep,4px)] h-6 w-px shrink-0 bg-[#303839]/12" />;
}

export function ToolbarIcon({ path, size = 18, strokeWidth = 1.8 }: { path: string; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}

/** A text label beside an icon: shown when there is room, an accessible name only when compact. */
export function ToolbarLabel({ children, collapsible = true }: { children: ReactNode; collapsible?: boolean }) {
  const compact = useCompact();
  return <span className={compact && collapsible ? "sr-only" : "whitespace-nowrap"}>{children}</span>;
}

/** An icon (and, when there is room, a label) button. */
export function ToolbarButton({
  label,
  icon,
  onClick,
  pressed,
  disabled,
  title,
  ariaLabel,
  showLabel = false,
  collapsible = true,
  primary = false,
  children,
}: {
  label: string;
  icon?: string;
  onClick?: () => void;
  pressed?: boolean;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  /** Show the label text beside the icon (collapses to icon-only when compact). */
  showLabel?: boolean;
  collapsible?: boolean;
  /** A solid ink button (the decisive action of a bar, such as Done). */
  primary?: boolean;
  /** Custom glyph content (Bold's "B"); the button is then icon-sized with `label` as its name. */
  children?: ReactNode;
}) {
  const compact = useCompact();
  if (children) {
    return (
      <button
        type="button"
        aria-label={ariaLabel || label}
        aria-pressed={pressed}
        title={title || label}
        disabled={disabled}
        onClick={onClick}
        className={`${TB_ICON_BUTTON} ${pressed || primary ? TB_ON : ""}`}
      >
        {children}
      </button>
    );
  }
  const textual = showLabel && !(compact && collapsible && icon);
  return (
    <button
      type="button"
      aria-label={ariaLabel || (textual ? undefined : label)}
      aria-pressed={pressed}
      title={title || label}
      disabled={disabled}
      onClick={onClick}
      className={`${textual ? TB_TEXT_BUTTON : icon ? TB_ICON_BUTTON : TB_TEXT_BUTTON} ${pressed || primary ? TB_ON : ""}`}
    >
      {icon && <ToolbarIcon path={icon} />}
      {(textual || !icon) && <span className="whitespace-nowrap">{label}</span>}
    </button>
  );
}

/** "Font size − 17 +": a caption, then a stepper whose value is typed or stepped. */
export function ToolbarStepper({
  caption,
  label,
  value,
  minimum,
  maximum,
  step,
  largeStep,
  allowNegative = false,
  allowDecimal = false,
  disabled,
  formatValue,
  widthClass = "w-[96px]",
  onCommit,
}: {
  /** Visible caption; omitted = the stepper alone. */
  caption?: string;
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  largeStep: number;
  allowNegative?: boolean;
  allowDecimal?: boolean;
  disabled?: boolean;
  formatValue?: (value: number) => string;
  /** A literal Tailwind width class, e.g. "w-[112px]" (wider for "100%" values). */
  widthClass?: string;
  onCommit: (value: number) => void;
}) {
  const compact = useCompact();
  return (
    <div className={`flex shrink-0 items-center gap-1.5 ${caption && !compact ? "pl-2" : ""}`}>
      {caption && <span className={compact ? "sr-only" : "whitespace-nowrap text-[13px] font-medium text-[#303839]/80"}>{caption}</span>}
      <EditableNumericStepper
        label={label}
        value={value}
        minimum={minimum}
        maximum={maximum}
        step={step}
        largeStep={largeStep}
        allowNegative={allowNegative}
        allowDecimal={allowDecimal}
        disabled={disabled}
        formatValue={formatValue}
        onCommit={onCommit}
        showStepButtons
        stepIcons="plusMinus"
        stepButtonWidth={28}
        className={`h-[var(--tb-size,36px)] shrink-0 overflow-hidden rounded-full ${widthClass}`}
        buttonClassName="grid h-full cursor-pointer place-items-center rounded-full text-[#303839] transition-colors hover:bg-[#303839]/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#303839] disabled:cursor-not-allowed disabled:text-[#303839]/25"
        inputClassName="h-full min-w-0 w-full rounded-md bg-transparent text-center text-[13px] font-semibold tabular-nums text-[#303839] outline-none focus:bg-[#303839]/[0.05]"
        inputStyle={{ paddingLeft: 0, paddingRight: 0 }}
      />
    </div>
  );
}

/* ------------------------------------------------------------ colour ------- */

/** The studio's default swatches, offered when a design sets no palette of its own. */
export const DEFAULT_SWATCHES = ["#303839", "#5B6667", "#8D6E63", "#D4AF37", "#B08D2A", "#F4ECEC", "#7A1F2B", "#1F4E79", "#2E7D32", "#C62828"];

function isDarkSwatch(hex: string): boolean {
  const full = normaliseSwatch(hex);
  if (!full) return false;
  const n = parseInt(full.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) < 150;
}

/**
 * The colour chip and its popover: the design's allowed colours when it set a
 * palette (and nothing else), otherwise the default swatches plus a free
 * colour picker. An optional extra choice (an element's "Original colours")
 * sits first.
 */
export function ToolbarColourControl({
  title,
  value,
  palette,
  swatchLabel,
  pickerLabel,
  onChange,
  original,
}: {
  title: string;
  /** The current colour, or "" when none is applied (shown as the original). */
  value: string;
  /** Allowed colours; empty = any colour. */
  palette: readonly string[];
  /** Accessible name of each swatch: `${swatchLabel} ${hex}`. */
  swatchLabel: string;
  /** Accessible name of the free colour picker. */
  pickerLabel: string;
  onChange: (color: string) => void;
  original?: { label: string; active: boolean; onSelect: () => void };
}) {
  const restricted = palette.length > 0;
  const swatches = restricted ? orderSwatches(palette) : orderSwatches(DEFAULT_SWATCHES, { includeBasics: true });
  const current = normaliseSwatch(value);
  const chip = (
    <span
      className="block h-5 w-5 shrink-0 rounded-full border border-[#303839]/25"
      style={{ background: current || "repeating-conic-gradient(#d9d9d9 0% 25%, #ffffff 0% 50%) 50% / 8px 8px" }}
      aria-hidden
    />
  );
  return (
    <ToolbarPopover
      label={`${title}: ${current || "Original"}`}
      triggerTitle={title}
      role="dialog"
      menuWidth={264}
      triggerClassName={TB_ICON_BUTTON}
      triggerActiveClassName={`${TB_ICON_BUTTON} bg-[#303839]/[0.08]`}
      trigger={chip}
    >
      {(close) => (
        <div className="grid min-w-0 gap-3 p-2" data-customizer-text-interaction>
          <p className="text-[13px] font-bold text-[#1f2425]">{title}</p>
          {original && (
            <button
              type="button"
              data-toolbar-menu-item
              aria-pressed={original.active}
              onClick={() => {
                original.onSelect();
                close();
              }}
              className={`flex h-9 cursor-pointer items-center justify-center rounded-full border text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 ${
                original.active ? "border-[#303839] bg-[#303839] text-white" : "border-[#303839]/20 text-[#303839] hover:bg-[#F8F6F1]"
              }`}
            >
              {original.label}
            </button>
          )}
          <div className="grid grid-cols-7 gap-2" aria-label={restricted ? `Allowed ${title.toLowerCase()}s` : title}>
            {swatches.map((color) => {
              const selected = current === normaliseSwatch(color);
              return (
                <button
                  key={color}
                  type="button"
                  data-toolbar-menu-item
                  data-shape="round"
                  aria-label={`${swatchLabel} ${color}`}
                  aria-pressed={selected}
                  title={color.toUpperCase()}
                  onClick={() => {
                    onChange(color);
                    close();
                  }}
                  className={`grid aspect-square w-full cursor-pointer place-items-center rounded-full border border-[#303839]/15 transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 ${
                    selected ? "ring-2 ring-[#303839] ring-offset-2" : "hover:ring-2 hover:ring-[#303839]/25 hover:ring-offset-1"
                  }`}
                  style={{ backgroundColor: color }}
                >
                  {selected && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isDarkSwatch(color) ? "#ffffff" : "#1f2425"} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="m5 12 5 5 9-10" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
          {!restricted && (
            <div className="grid gap-2 border-t border-[#303839]/10 pt-3">
              <p className="text-[12px] font-semibold text-[#303839]/65">Custom colour</p>
              <label
                className="relative flex h-9 cursor-pointer items-center gap-2 rounded-full border border-[#303839]/20 bg-white pl-1.5 pr-3 focus-within:border-[#303839] focus-within:ring-2 focus-within:ring-[#303839]/15"
                title="Pick any colour"
              >
                <span
                  aria-hidden
                  className="h-6 w-6 shrink-0 rounded-full border border-[#303839]/15"
                  style={{ background: "conic-gradient(from 0deg, #ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)" }}
                />
                <span className="text-[13px] font-semibold uppercase tabular-nums text-[#1f2425]">{current || "—"}</span>
                <input
                  type="color"
                  aria-label={pickerLabel}
                  value={current || "#303839"}
                  onChange={(event) => onChange(event.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>
            </div>
          )}
        </div>
      )}
    </ToolbarPopover>
  );
}

/* --------------------------------------------------------------- shell ----- */

/** The studio toolbar's fit: comfortable when it fits, compact when not, scroll arrows only beyond that. */
function useToolbarFit(selectionKey: string) {
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [density, setDensity] = useState<Density>("comfortable");
  const [edges, setEdges] = useState({ left: false, right: false });
  /** Width the comfortable bar needed when it last did not fit; it returns only once that fits. */
  const comfortableNeedRef = useRef(0);
  const lastKeyRef = useRef(selectionKey);

  const evaluate = useCallback(() => {
    const host = hostRef.current;
    const strip = scrollRef.current;
    if (!host || !strip) return;
    const chrome = 10; // capsule padding + border
    if (density === "comfortable") {
      if (strip.scrollWidth > strip.clientWidth + 1) {
        comfortableNeedRef.current = strip.scrollWidth + chrome;
        setDensity("compact");
        return;
      }
    } else if (comfortableNeedRef.current && host.clientWidth >= comfortableNeedRef.current) {
      setDensity("comfortable");
      return;
    }
    const left = strip.scrollLeft > 1;
    const right = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
    setEdges((current) => (current.left === left && current.right === right ? current : { left, right }));
  }, [density]);

  // After every render, like the studio: any change (a font name, a disabled
  // state) can change the bar's width. Density only flips on a real overflow /
  // fit transition, so this cannot loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (lastKeyRef.current !== selectionKey) {
      lastKeyRef.current = selectionKey;
      comfortableNeedRef.current = 0;
      if (density === "compact") {
        setDensity("comfortable");
        return;
      }
    }
    evaluate();
  });

  useEffect(() => {
    const host = hostRef.current;
    const strip = scrollRef.current;
    if (!host || !strip || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => evaluate());
    observer.observe(host);
    observer.observe(strip);
    window.addEventListener("resize", evaluate);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", evaluate);
    };
  }, [evaluate]);

  const scrollBy = (direction: -1 | 1) => {
    const strip = scrollRef.current;
    if (strip) strip.scrollBy({ left: direction * Math.max(120, strip.clientWidth * 0.6), behavior: "smooth" });
  };
  return { hostRef, scrollRef, density, edges, evaluate, scrollBy };
}

const SCROLL_BUTTON =
  "pointer-events-auto absolute top-1/2 z-10 grid h-8 w-8 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-[#303839]/10 bg-white text-[#303839] shadow-[0_2px_8px_rgba(48,56,57,0.18)] transition-colors hover:bg-[#F3F1EC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839]";

/**
 * The capsule every customer toolbar sits in: one row, never wrapped, its
 * sections divided by thin rules. It goes compact when the comfortable bar does
 * not fit and only scrolls (with visible arrows) if even that cannot.
 */
export function ToolbarShell({
  label,
  selectionKey = "",
  sections,
  attributes = {},
}: {
  label: string;
  /** Changes when a different object is selected, so its bar tries the comfortable size first. */
  selectionKey?: string;
  sections: ReactNode[];
  /** Extra data-* attributes for the toolbar element (tests and the canvas use them). */
  attributes?: Record<string, string | boolean | undefined>;
}) {
  const { hostRef, scrollRef, density, edges, evaluate, scrollBy } = useToolbarFit(selectionKey);
  const compact = density === "compact";
  const visible = sections.filter(Boolean);
  return (
    <DensityContext.Provider value={density}>
      <div ref={hostRef} className="pointer-events-none flex w-full min-w-0 justify-center">
        <div
          data-customizer-text-interaction
          data-customer-toolbar-density={density}
          {...attributes}
          role="toolbar"
          aria-label={label}
          className={`pointer-events-auto relative max-w-full rounded-full border border-[#303839]/10 bg-white p-1 shadow-[0_4px_18px_rgba(48,56,57,0.12)] ${
            compact ? "[--tb-pad:8px] [--tb-sep:2px] [--tb-size:32px]" : "[--tb-pad:12px] [--tb-sep:4px] [--tb-size:36px]"
          } pointer-coarse:[--tb-size:44px]`}
        >
          <div
            ref={scrollRef}
            className="flex items-center overflow-x-auto overflow-y-hidden scroll-smooth rounded-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            onScroll={evaluate}
            onWheel={(event) => {
              const strip = scrollRef.current;
              if (!strip || strip.scrollWidth <= strip.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
              strip.scrollLeft += event.deltaY;
            }}
          >
            {visible.map((section, index) => (
              <div key={index} className="flex shrink-0 items-center">
                {index > 0 && <ToolbarSeparator />}
                {section}
              </div>
            ))}
          </div>
          {edges.left && (
            <>
              <span aria-hidden className="pointer-events-none absolute inset-y-1 left-1 w-10 rounded-l-full bg-white" />
              <button type="button" data-shape="round" aria-label="Scroll tools left" title="More tools" onClick={() => scrollBy(-1)} className={`${SCROLL_BUTTON} left-1`}>
                <ToolbarIcon path="m15 6-6 6 6 6" size={16} strokeWidth={2.2} />
              </button>
            </>
          )}
          {edges.right && (
            <>
              <span aria-hidden className="pointer-events-none absolute inset-y-1 right-1 w-10 rounded-r-full bg-white" />
              <button type="button" data-shape="round" aria-label="Scroll tools right" title="More tools" onClick={() => scrollBy(1)} className={`${SCROLL_BUTTON} right-1`}>
                <ToolbarIcon path="m9 6 6 6-6 6" size={16} strokeWidth={2.2} />
              </button>
            </>
          )}
        </div>
      </div>
    </DensityContext.Provider>
  );
}
