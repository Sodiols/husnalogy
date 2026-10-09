"use client";

import { rememberRecentColor, useRecentColors } from "@/lib/customizer/v2/studio-recent-colors";
import { normaliseSwatch, orderSwatches } from "@/lib/customizer/v2/swatch-order";
import { FONT_SIZE_POINT_RULES, documentPxToPoints, fontSizeBoundsInPoints, pointsToDocumentPx } from "@/lib/customizer/v2/type-units";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import GoogleFontSelector from "@/app/components/customizer/GoogleFontSelector";
import { ensureGoogleFontLoaded, reportGoogleFontLoadFailure, useFamilyCapabilities, useSelectableFamilies } from "@/app/components/customizer/useGoogleFonts";
import EditableNumericStepper from "@/app/components/customizer/EditableNumericStepper";
import { TEXT_GROWTH_OPTIONS, TextGrowthIcon } from "@/app/components/customizer/TextGrowthControl";
import {
  FONT_SIZE_RULES,
  TEXT_TOOLBAR_DEFAULTS,
  boldWeightForFont,
  isBoldWeight,
  nearestSupportedWeight,
  regularWeightForFont,
  sharedTextStyleValue,
} from "@/lib/customizer/v2/text-toolbar";
import { effectiveTextGrowth } from "@/lib/customizer/v2/text-layout";
import type { TextGrowthDirection } from "@/lib/customizer/v2/text-growth";
import { TRANSPARENT_PAINT, isTransparentPaint } from "@/lib/customizer/v2/paint";
import { LINE_WEIGHT_RULES, SCALE_STEP, adminToolbarKind, type AdminToolbarKind } from "@/lib/customizer/v2/admin-toolbar-state";
import type { GroupActionState } from "@/lib/customizer/v2/groups";
import ToolbarPopover from "./ToolbarPopover";
import { layerHasPicture } from "./builder-utils";

type Patch = Record<string, unknown>;
type Action = { enabled: boolean; reason?: string };

type Props = {
  /** The selected layers, in selection order (the toolbar does not depend on that order). */
  selectedLayers: any[];
  /** The artboard's DPI: font sizes are shown in points (lib/customizer/v2/type-units). */
  dpi?: unknown;
  editingText?: boolean;
  /** Every selected object may be moved, resized and restyled. */
  canTransform: boolean;
  /** At least one selected object may be deleted. */
  canDelete: boolean;
  approvedColors?: string[];
  /** Shared group-selection verdicts (the same ones Ctrl+G and the object menu use). */
  groupAction: { group: GroupActionState; ungroup: GroupActionState };
  /** Shared clipping-mask verdict for an image + shape selection. */
  maskAction?: Action;
  /** Text: committed change (one history entry) / live preview / Escape. */
  onStylePatch: (patch: Patch) => void;
  onStylePreview: (patch: Patch) => void;
  onStyleCancel: () => void;
  /** Shapes: top-level layer properties (fill, stroke, strokeWidth), same three phases. */
  onLayerPropsPatch: (patch: Patch) => void;
  onLayerPropsPreview: (patch: Patch) => void;
  onLayerPropsCancel: () => void;
  onCopy: () => void;
  onDelete: () => void;
  /** Scale the selection as one composition by this factor. */
  onScale: (factor: number) => void;
  onGroup: () => void;
  onUngroup: () => void;
  onMask: () => void;
  /** Shapes fit/fill the artboard; photos fit/fill their own box. */
  onFit: (mode: "fit" | "fill") => void;
  /** Uploads a replacement picture; resolves when the layer has it. */
  onChangeImage: (file: File) => Promise<void>;
  canCrop: boolean;
  onCrop: () => void;
  canErase: boolean;
  onErase: () => void;
  alignmentOpen: boolean;
  onToggleAlignment: () => void;
};

const FALLBACK_SWATCHES = ["#303839", "#5B6667", "#8D6E63", "#D4AF37", "#B08D2A", "#F4ECEC", "#FFFFFF", "#7A1F2B", "#000000", "#1F4E79", "#2E7D32", "#C62828"];

/* ------------------------------------------------------------------ icons -- */

function Icon({ path, size = 18, strokeWidth = 1.8 }: { path: string; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}

const ICONS = {
  copy: "M9 9h10v10H9zM5 15V5h10",
  check: "M5 12.5l4.5 4.5L19 7.5",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3",
  minus: "M5 12h14",
  plus: "M12 5v14M5 12h14",
  group: "M3 3h4M17 3h4v4M21 17v4h-4M7 21H3v-4M3 7V3M8 8h8v8H8z",
  ungroup: "M3 3h8v8H3zM13 13h8v8h-8z",
  mask: "M4 4h16v16H4zM12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z",
  crop: "M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2",
  eraser: "M8 20h12M5.5 14.5l7-7a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 19H8l-2.5-2.5a1.4 1.4 0 0 1 0-2zM9.5 10.5l5 5",
  image: "M4 5h16v14H4zM4 15l4.5-4.5 4 4L15 12l5 5M15.5 8.5h.01",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5M9 9h6v6H9z",
  fill: "M4 4h16v16H4zM9 4v16M15 4v16",
  chevron: "m6 9 6 6 6-6",
  alignLeft: "M4 6h16M4 10h10M4 14h16M4 18h12",
  alignCenter: "M4 6h16M7 10h10M4 14h16M6 18h12",
  alignRight: "M4 6h16M10 10h10M4 14h16M8 18h12",
  // Objects aligned to a shared edge: the Alignment panel.
  alignObjects: "M4 3v18M8 6h10v4H8zM8 14h6v4H8z",
  scrollLeft: "m15 6-6 6 6 6",
  scrollRight: "m9 6 6 6-6 6",
} as const;

/* ------------------------------------------------------------- density ---- */

/*
 * The toolbar always shows EVERY approved control for the selection. How much
 * room it gets depends on the workspace between the side panels, not on the
 * window: at 1440px with both panels open the text bar needed ~770px of a
 * ~700px column, and the overflow was scrolled sideways with a hidden
 * scrollbar — Alignment was simply out of sight.
 *
 * So the bar has two densities, chosen from the space it actually has:
 *   comfortable  36px controls, text labels beside icons;
 *   compact      32px controls, tighter separators, a narrower font picker,
 *                and secondary labels shown as their icon (each control keeps
 *                its accessible name and tooltip, and all of its function).
 * Only if even the compact bar cannot fit (narrower than the supported desktop
 * sizes) does it scroll — intentionally, with visible scroll buttons.
 */
type Density = "comfortable" | "compact";
const DensityContext = createContext<Density>("comfortable");
const useCompact = () => useContext(DensityContext) === "compact";

/* ----------------------------------------------------------- primitives ---- */

// One look for every control in the capsule: compact, borderless, dark ink,
// a soft grey hover and a light-blue "on" state. Sizes come from the density
// variables set on the toolbar (--tb-size, --tb-pad).
const BUTTON =
  "flex h-[var(--tb-size,36px)] shrink-0 items-center justify-center gap-1.5 rounded-full text-[13px] font-medium text-[#303839] transition-colors hover:bg-[#303839]/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] disabled:cursor-not-allowed disabled:text-[#303839]/30 disabled:hover:bg-transparent";
const BUTTON_ON = "bg-[#DCEBFA] text-[#12385C] hover:bg-[#CFE3F8]";
const ICON_BUTTON = `${BUTTON} w-[var(--tb-size,36px)]`;
const TEXT_BUTTON = `${BUTTON} px-[var(--tb-pad,12px)]`;

function Separator() {
  return <span aria-hidden className="mx-[var(--tb-sep,4px)] h-6 w-px shrink-0 bg-[#303839]/12" />;
}

/** A control's text label: beside its icon when there is room, its accessible name only when compact. */
function ControlLabel({ children, collapsible = true }: { children: React.ReactNode; collapsible?: boolean }) {
  const compact = useCompact();
  return <span className={compact && collapsible ? "sr-only" : "whitespace-nowrap"}>{children}</span>;
}

function IconButton({ label, path, onClick, disabled, reason, pressed }: { label: string; path: string; onClick: () => void; disabled?: boolean; reason?: string; pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={disabled && reason ? `${label} — ${reason}` : label}
      disabled={disabled}
      onClick={onClick}
      className={`${ICON_BUTTON} ${pressed ? BUTTON_ON : ""}`}
    >
      <Icon path={path} />
    </button>
  );
}

function LabelButton({
  label,
  path,
  onClick,
  disabled,
  reason,
  pressed,
  ariaLabel,
  title,
  collapsible = true,
}: {
  label: string;
  path?: string;
  onClick: () => void;
  disabled?: boolean;
  reason?: string;
  pressed?: boolean;
  ariaLabel?: string;
  title?: string;
  /** False keeps the label visible in the compact density (short, decisive actions such as Mask). */
  collapsible?: boolean;
}) {
  const iconOnly = useCompact() && collapsible && Boolean(path);
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={pressed}
      title={disabled && reason ? `${label} — ${reason}` : title || label}
      disabled={disabled}
      onClick={onClick}
      className={`${iconOnly ? ICON_BUTTON : TEXT_BUTTON} ${pressed ? BUTTON_ON : ""}`}
    >
      {path && <Icon path={path} />}
      <ControlLabel collapsible={iconOnly}>{label}</ControlLabel>
    </button>
  );
}

/** Copy, with a brief tick so a click that changes nothing visible still answers. */
function CopyButton({ onCopy }: { onCopy: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <>
      <IconButton
        label="Copy"
        path={copied ? ICONS.check : ICONS.copy}
        onClick={() => {
          onCopy();
          setCopied(true);
        }}
      />
      <span role="status" className="sr-only">{copied ? "Copied" : ""}</span>
    </>
  );
}

/** Copy · Delete — then Scale smaller · Scale larger, the pair every toolbar shares. */
function CopyDelete({ onCopy, onDelete, canDelete }: { onCopy: () => void; onDelete: () => void; canDelete: boolean }) {
  return (
    <>
      <CopyButton onCopy={onCopy} />
      <IconButton label="Delete" path={ICONS.trash} onClick={onDelete} disabled={!canDelete} reason="The selection is locked." />
    </>
  );
}

function ScalePair({ onScale, disabled }: { onScale: (factor: number) => void; disabled: boolean }) {
  return (
    <>
      <IconButton label="Scale smaller" path={ICONS.minus} onClick={() => onScale(1 / SCALE_STEP)} disabled={disabled} reason="Unlock the selection first." />
      <IconButton label="Scale larger" path={ICONS.plus} onClick={() => onScale(SCALE_STEP)} disabled={disabled} reason="Unlock the selection first." />
    </>
  );
}

function AlignmentButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const compact = useCompact();
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls="admin-alignment-panel"
      title="Alignment"
      onClick={onToggle}
      className={`${compact ? ICON_BUTTON : TEXT_BUTTON} ${open ? BUTTON_ON : ""}`}
    >
      {compact && <Icon path={ICONS.alignObjects} />}
      <ControlLabel>Alignment</ControlLabel>
    </button>
  );
}

/** "Font size − 10 +" and "Line weight − 7 +": a caption, then a stepper whose value is typed or stepped. */
function LabelledStepper({
  caption,
  label,
  value,
  mixed = false,
  rules,
  allowDecimal = !Number.isInteger(rules.step),
  disabled,
  onPreview,
  onCommit,
  onCancel,
}: {
  caption: string;
  label: string;
  value: number;
  mixed?: boolean;
  rules: { minimum: number; maximum: number; step: number; largeStep: number };
  allowDecimal?: boolean;
  disabled?: boolean;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
  onCancel: () => void;
}) {
  const compact = useCompact();
  return (
    <div className={`flex shrink-0 items-center gap-1.5 ${compact ? "" : "pl-2"}`}>
      <span className={compact ? "sr-only" : "whitespace-nowrap text-[13px] font-medium text-[#303839]/80"}>{caption}</span>
      <EditableNumericStepper
        label={label}
        value={value}
        mixed={mixed}
        minimum={rules.minimum}
        maximum={rules.maximum}
        step={rules.step}
        largeStep={rules.largeStep}
        allowDecimal={allowDecimal}
        disabled={disabled}
        onPreviewChange={onPreview}
        onCommit={onCommit}
        onCancel={onCancel}
        showStepButtons
        stepIcons="plusMinus"
        stepButtonWidth={28}
        className="h-9 w-[96px] overflow-hidden rounded-full"
        buttonClassName="grid h-full place-items-center rounded-full text-[#303839] transition-colors hover:bg-[#303839]/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#303839] disabled:cursor-not-allowed disabled:text-[#303839]/25"
        inputClassName="h-full min-w-0 w-full rounded-md bg-transparent text-center text-[13px] font-semibold tabular-nums text-[#303839] outline-none focus:bg-[#303839]/[0.05]"
        inputStyle={{ paddingLeft: 0, paddingRight: 0 }}
      />
    </div>
  );
}

/* ------------------------------------------------------------ colour ------- */

function normalizeHex(input: string): string | null {
  const raw = input.trim().replace(/^#/, "");
  const expanded = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  return /^[0-9a-fA-F]{6}$/.test(expanded) ? `#${expanded.toLowerCase()}` : null;
}

/** A round chip of the current colour; "no paint" is a white chip with a red slash. */
function ColourChip({ value, size = 20 }: { value: string; size?: number }) {
  const none = isTransparentPaint(value);
  return (
    <span className="relative block shrink-0 overflow-hidden rounded-full border border-[#303839]/25" style={{ width: size, height: size, background: none ? "#FFFFFF" : value }} aria-hidden>
      {none && <span className="absolute left-1/2 top-[-20%] h-[140%] w-[1.5px] -translate-x-1/2 rotate-45 bg-red-500" />}
    </span>
  );
}

/** True when dark ink would be hard to read on this colour. */
function isDarkSwatch(hex: string): boolean {
  const full = normaliseSwatch(hex);
  if (!full) return false;
  const n = parseInt(full.slice(1), 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum < 150;
}

/** One round swatch; the selected one carries a ring and a check, not colour alone. */
function SwatchButton({ title, swatch, selected, onPick }: { title: string; swatch: string; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      data-toolbar-menu-item
      data-shape="round"
      aria-label={`${title} ${swatch}`}
      aria-pressed={selected}
      title={swatch.toUpperCase()}
      onClick={onPick}
      className={`grid aspect-square w-full place-items-center rounded-full border border-[#303839]/15 transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A] focus-visible:ring-offset-2 ${
        selected ? "ring-2 ring-[#27307A] ring-offset-2" : "hover:ring-2 hover:ring-[#303839]/25 hover:ring-offset-1"
      }`}
      style={{ backgroundColor: swatch }}
    >
      {selected && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isDarkSwatch(swatch) ? "#ffffff" : "#1f2425"} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m5 12 5 5 9-10" />
        </svg>
      )}
    </button>
  );
}

/**
 * Colour popover for text, a shape's fill and a shape's line: approved swatches,
 * an optional real "no paint" choice, and a hex field / picker that preview live
 * and commit once.
 */
function ColourControl({
  title,
  value,
  swatches,
  allowTransparent,
  caption,
  onPreview,
  onCommit: commitColour,
}: {
  title: string;
  value: string;
  swatches: string[];
  allowTransparent: boolean;
  /** Shown before the chip ("Fill color"); without it the trigger is just the chip. */
  caption?: string;
  onPreview: (color: string) => void;
  onCommit: (color: string) => void;
}) {
  const none = isTransparentPaint(value);
  const [draft, setDraft] = useState(none ? "" : value);
  // Every applied colour joins the studio's shared recent colours.
  const onCommit = (color: string) => {
    if (!isTransparentPaint(color)) rememberRecentColor(color);
    commitColour(color);
  };
  useEffect(() => setDraft(isTransparentPaint(value) ? "" : value), [value]);
  const compact = useCompact();
  const trigger = caption ? `${TEXT_BUTTON} ${compact ? "gap-1 !px-2" : ""}` : ICON_BUTTON;
  // White and black always lead, then the approved colours in a natural order.
  const ordered = orderSwatches(swatches, { includeBasics: true });
  const shown = new Set(ordered.map((swatch) => normaliseSwatch(swatch)));
  const recent = useRecentColors()
    .filter((colour) => !shown.has(normaliseSwatch(colour)))
    .slice(0, 7);
  const pick = (colour: string, close: () => void) => {
    onCommit(colour);
    close();
  };
  return (
    <ToolbarPopover
      label={`${title}: ${none ? "Transparent" : value}`}
      triggerTitle={title}
      role="dialog"
      menuWidth={264}
      triggerClassName={trigger}
      triggerActiveClassName={`${trigger} ${BUTTON_ON}`}
      trigger={
        caption ? (
          <>
            <ControlLabel>{caption}</ControlLabel>
            <ColourChip value={value} size={18} />
            <Icon path={ICONS.chevron} size={14} strokeWidth={2.2} />
          </>
        ) : (
          <ColourChip value={value} />
        )
      }
    >
      {(close) => (
        <div className="grid min-w-0 gap-3 p-2" data-customizer-text-interaction>
          <p className="text-[13px] font-bold text-[#1f2425]">{title}</p>

          <div className="grid grid-cols-7 gap-2" data-colour-swatches>
            {allowTransparent && (
              <button
                type="button"
                data-toolbar-menu-item
                data-shape="round"
                aria-label="Transparent"
                aria-pressed={none}
                title="Transparent — no paint"
                onClick={() => pick(TRANSPARENT_PAINT, close)}
                className={`grid aspect-square w-full place-items-center overflow-hidden rounded-full transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A] focus-visible:ring-offset-2 ${
                  none ? "ring-2 ring-[#27307A] ring-offset-2" : "hover:ring-2 hover:ring-[#303839]/25 hover:ring-offset-1"
                }`}
              >
                <ColourChip value={TRANSPARENT_PAINT} size={28} />
              </button>
            )}
            {ordered.map((swatch) => (
              <SwatchButton key={swatch} title={title} swatch={swatch} selected={!none && normaliseSwatch(swatch) === normaliseSwatch(String(value))} onPick={() => pick(swatch, close)} />
            ))}
          </div>

          {recent.length > 0 && (
            <div className="grid gap-2">
              <p className="text-[12px] font-semibold text-[#303839]/65">Recent colours</p>
              <div className="grid grid-cols-7 gap-2" data-colour-recent>
                {recent.map((swatch) => (
                  <SwatchButton key={swatch} title={title} swatch={swatch} selected={!none && normaliseSwatch(swatch) === normaliseSwatch(String(value))} onPick={() => pick(swatch, close)} />
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-2 border-t border-[#303839]/10 pt-3">
            <p className="text-[12px] font-semibold text-[#303839]/65">Custom colour</p>
            <span className="flex min-w-0 items-center gap-2">
              <label
                className="relative h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-full border border-[#303839]/15 focus-within:ring-2 focus-within:ring-[#27307A] focus-within:ring-offset-2"
                title={`Pick ${title.toLowerCase()}`}
                style={{ background: "conic-gradient(from 0deg, #ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)" }}
              >
                <input
                  type="color"
                  aria-label={`Pick ${title.toLowerCase()}`}
                  value={none ? "#ffffff" : normalizeHex(value) || "#303839"}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    onPreview(event.target.value);
                  }}
                  onBlur={(event) => {
                    if (event.target.value.toLowerCase() !== String(value).toLowerCase()) onCommit(event.target.value);
                  }}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>
              <span className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border border-[#303839]/20 bg-white pl-1.5 pr-3 focus-within:border-[#27307A]">
                <ColourChip value={none ? TRANSPARENT_PAINT : normalizeHex(draft) || value} size={22} />
                <input
                  type="text"
                  value={draft}
                  placeholder={none ? "Transparent" : "#303839"}
                  aria-label={`${title} hex value`}
                  spellCheck={false}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    const hex = normalizeHex(event.target.value);
                    if (hex) onPreview(hex);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    const hex = normalizeHex(draft);
                    if (hex) onCommit(hex);
                    close();
                  }}
                  onBlur={() => {
                    const hex = normalizeHex(draft);
                    if (hex && hex !== String(value).toLowerCase()) onCommit(hex);
                    else if (!hex) setDraft(none ? "" : value);
                  }}
                  className="input-bare h-full w-0 min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] font-semibold uppercase tabular-nums text-[#1f2425] outline-none placeholder:normal-case placeholder:text-[#303839]/45"
                />
              </span>
            </span>
          </div>
        </div>
      )}
    </ToolbarPopover>
  );
}

/* ------------------------------------------- text alignment + growth ------- */

const TEXT_ALIGN = [
  { value: "left", label: "Align text left", path: ICONS.alignLeft },
  { value: "center", label: "Align text centre", path: ICONS.alignCenter },
  { value: "right", label: "Align text right", path: ICONS.alignRight },
] as const;

const GROWTH_LABELS: Record<TextGrowthDirection, string> = {
  up: "Grow upward",
  center: "Grow from centre",
  down: "Grow downward",
};

/**
 * The small text dropdown: row one is the text's horizontal alignment, row two
 * is its growth direction (which edge holds still as lines are added). It is
 * deliberately NOT vertical alignment and NOT the full Alignment panel.
 */
function TextAlignGrowthMenu({
  align,
  growth,
  onAlign,
  onGrowth,
}: {
  align: string;
  growth: TextGrowthDirection;
  onAlign: (value: string) => void;
  onGrowth: (value: TextGrowthDirection) => void;
}) {
  const current = TEXT_ALIGN.find((option) => option.value === align) || TEXT_ALIGN[1];
  const cell = "grid h-9 w-9 place-items-center rounded-lg text-[#303839] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839]";
  return (
    <ToolbarPopover
      label="Text alignment and growth"
      triggerTitle="Text alignment and growth"
      menuWidth={148}
      align="center"
      triggerClassName={`${BUTTON} gap-0.5 px-2`}
      triggerActiveClassName={`${BUTTON} gap-0.5 px-2 ${BUTTON_ON}`}
      trigger={
        <>
          <Icon path={current.path} />
          <Icon path={ICONS.chevron} size={14} strokeWidth={2.2} />
        </>
      }
    >
      {() => (
        <div className="grid gap-1 p-1" data-admin-text-align-menu>
          <div role="radiogroup" aria-label="Text alignment" className="grid grid-cols-3 gap-1">
            {TEXT_ALIGN.map((option) => {
              const active = align === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={option.label}
                  title={option.label}
                  data-toolbar-menu-item
                  onClick={() => onAlign(option.value)}
                  className={`${cell} ${active ? BUTTON_ON : "hover:bg-[#303839]/[0.06]"}`}
                >
                  <Icon path={option.path} />
                </button>
              );
            })}
          </div>
          <div role="radiogroup" aria-label="Text growth" className="grid grid-cols-3 gap-1">
            {TEXT_GROWTH_OPTIONS.map((option) => {
              const active = growth === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={GROWTH_LABELS[option.value]}
                  title={option.hint}
                  data-toolbar-menu-item
                  onClick={() => onGrowth(option.value)}
                  className={`${cell} ${active ? BUTTON_ON : "hover:bg-[#303839]/[0.06]"}`}
                >
                  <TextGrowthIcon path={option.path} size={18} />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </ToolbarPopover>
  );
}

/* ------------------------------------------------------------- states ------ */

function TextControls({ layer, props, swatches }: { layer: any; props: Props; swatches: string[] }) {
  const layers = [layer];
  const fontFamily = sharedTextStyleValue(layers, "fontFamily", TEXT_TOOLBAR_DEFAULTS.fontFamily as string);
  const fontSize = sharedTextStyleValue(layers, "fontSize", TEXT_TOOLBAR_DEFAULTS.fontSize as number);
  const fontWeight = sharedTextStyleValue(layers, "fontWeight", TEXT_TOOLBAR_DEFAULTS.fontWeight as string);
  const fontStyle = sharedTextStyleValue(layers, "fontStyle", TEXT_TOOLBAR_DEFAULTS.fontStyle as string);
  const color = sharedTextStyleValue(layers, "color", TEXT_TOOLBAR_DEFAULTS.color as string);
  const textAlign = sharedTextStyleValue(layers, "textAlign", TEXT_TOOLBAR_DEFAULTS.textAlign as string);
  const growth = effectiveTextGrowth(layer?.textStyle, layer?.text);

  // Weights and italic come from the family's real Google Fonts cuts, so Bold
  // and Italic never ask for a face production could not render.
  const { families } = useSelectableFamilies();
  const capabilities = useFamilyCapabilities(String(fontFamily.value), families);
  const weight = nearestSupportedWeight(capabilities.weights, fontWeight.value);
  const italic = fontStyle.value === "italic";
  const bold = isBoldWeight(weight);
  const noItalicCut = capabilities.known && !capabilities.hasItalic && !italic;

  // Load the faces in use so the canvas measures real metrics, not a fallback.
  useEffect(() => {
    const family = String(fontFamily.value || "");
    if (family) void ensureGoogleFontLoaded(family, weight, italic ? "italic" : "normal").catch(reportGoogleFontLoadFailure);
  }, [fontFamily.value, weight, italic]);

  // A new family keeps the weight (and italic) valid for that family, in one patch.
  const applyFontFamily = (next: string) => {
    const entry = families.find((item) => item.family.toLowerCase() === next.toLowerCase());
    const nextWeights = entry?.weights?.length ? entry.weights : ["400", "700"];
    const snapped = nearestSupportedWeight(nextWeights, fontWeight.value);
    const change: Patch = { fontFamily: next };
    if (snapped !== String(fontWeight.value)) change.fontWeight = snapped;
    if (italic && entry && !entry.hasItalic) change.fontStyle = "normal";
    void ensureGoogleFontLoaded(next, snapped, italic && entry?.hasItalic ? "italic" : "normal").catch(reportGoogleFontLoadFailure);
    props.onStylePatch(change);
  };

  return (
    <>
      <GoogleFontSelector
        label="Font"
        value={String(fontFamily.value)}
        onChange={applyFontFamily}
        className={useCompact() ? "w-[124px]" : "w-[164px]"}
        triggerPrefix="Font:"
        triggerClassName="h-9 rounded-full px-3 text-[13px] hover:bg-[#303839]/[0.06]"
        portal
        manageFavourites
      />
      <Separator />
      {/* Shown and typed in points; stored in document px (type-units.ts). */}
      <LabelledStepper
        caption="Font size"
        label="Font size"
        value={documentPxToPoints(Number(fontSize.value), props.dpi)}
        rules={{ ...FONT_SIZE_POINT_RULES, ...fontSizeBoundsInPoints(FONT_SIZE_RULES, props.dpi) }}
        allowDecimal
        disabled={!props.canTransform}
        onPreview={(next) => props.onStylePreview({ fontSize: pointsToDocumentPx(next, props.dpi) })}
        onCommit={(next) => props.onStylePatch({ fontSize: pointsToDocumentPx(next, props.dpi) })}
        onCancel={props.onStyleCancel}
      />
      <Separator />
      <ColourControl
        title="Text colour"
        value={String(color.value)}
        swatches={swatches}
        allowTransparent={false}
        onPreview={(next) => props.onStylePreview({ color: next })}
        onCommit={(next) => props.onStylePatch({ color: next })}
      />
      <button
        type="button"
        aria-label="Bold"
        aria-pressed={bold}
        title="Bold"
        onClick={() => props.onStylePatch({ fontWeight: bold ? regularWeightForFont(capabilities.weights) : boldWeightForFont(capabilities.weights) })}
        className={`${ICON_BUTTON} ${bold ? BUTTON_ON : ""}`}
      >
        <span className="text-[15px] font-black leading-none">B</span>
      </button>
      <button
        type="button"
        aria-label="Italic"
        aria-pressed={italic}
        title={noItalicCut ? "Italic — this font has no italic cut" : "Italic"}
        disabled={noItalicCut}
        onClick={() => props.onStylePatch({ fontStyle: italic ? "normal" : "italic" })}
        className={`${ICON_BUTTON} ${italic ? BUTTON_ON : ""}`}
      >
        <span className="font-serif text-[16px] italic leading-none">I</span>
      </button>
      <TextAlignGrowthMenu
        align={String(textAlign.value)}
        growth={growth}
        onAlign={(value) => props.onStylePatch({ textAlign: value })}
        onGrowth={(value) => props.onStylePatch({ growthDirection: value })}
      />
    </>
  );
}

function ShapeControls({ layer, props, swatches, line }: { layer: any; props: Props; swatches: string[]; line: boolean }) {
  const stroke = String(layer?.stroke || TRANSPARENT_PAINT);
  return (
    <>
      {!line && (
        <ColourControl
          title="Fill color"
          caption="Fill color"
          value={String(layer?.fill || TRANSPARENT_PAINT)}
          swatches={swatches}
          allowTransparent
          onPreview={(next) => props.onLayerPropsPreview({ fill: next })}
          onCommit={(next) => props.onLayerPropsPatch({ fill: next })}
        />
      )}
      {/* Transparent is offered for a line too: it hides the stroke without
          deleting the line or touching its geometry (it stays selectable on
          the canvas and in Layers, and a colour brings it back). */}
      <ColourControl
        title="Line color"
        caption="Line color"
        value={stroke}
        swatches={swatches}
        allowTransparent
        onPreview={(next) => props.onLayerPropsPreview({ stroke: next })}
        onCommit={(next) => props.onLayerPropsPatch({ stroke: next })}
      />
      <Separator />
      <LabelledStepper
        caption="Line weight"
        label="Line weight"
        value={Number(layer?.strokeWidth) || 0}
        rules={LINE_WEIGHT_RULES}
        disabled={!props.canTransform}
        onPreview={(next) => props.onLayerPropsPreview({ strokeWidth: next })}
        onCommit={(next) => props.onLayerPropsPatch({ strokeWidth: next })}
        onCancel={props.onLayerPropsCancel}
      />
    </>
  );
}

function ChangeImageButton({ hasImage, onChangeImage, disabled }: { hasImage: boolean; onChangeImage: Props["onChangeImage"]; disabled: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <>
      <LabelButton
        label={busy ? "Uploading…" : hasImage ? "Change image" : "Add image"}
        path={ICONS.image}
        disabled={disabled || busy}
        reason="Unlock the photo first."
        title={failed ? "The upload failed — try again" : undefined}
        onClick={() => inputRef.current?.click()}
      />
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-admin-change-image
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setBusy(true);
          setFailed(false);
          try {
            await onChangeImage(file);
          } catch {
            setFailed(true);
          } finally {
            setBusy(false);
          }
        }}
      />
      {failed && <span role="alert" className="shrink-0 px-1 text-[12px] font-semibold text-red-700">Upload failed</span>}
    </>
  );
}

function ImageControls({ layer, props }: { layer: any; props: Props }) {
  const hasImage = layerHasPicture(layer);
  return (
    <>
      <ChangeImageButton hasImage={hasImage} onChangeImage={props.onChangeImage} disabled={!props.canTransform} />
      {hasImage && <LabelButton label="Eraser" path={ICONS.eraser} onClick={props.onErase} disabled={!props.canErase} reason="Unlock the photo first." />}
      {hasImage && <LabelButton label="Crop" ariaLabel="Crop photo" title="Crop photo — move, zoom, rotate or flip it inside its frame" path={ICONS.crop} onClick={props.onCrop} disabled={!props.canCrop} reason="Unlock the photo first." />}
    </>
  );
}

function FitFill({ props, fitMode }: { props: Props; fitMode?: "fit" | "fill" }) {
  // Words when there is room; their icons only in the compact density.
  const compact = useCompact();
  return (
    <>
      <LabelButton
        label="Fit"
        path={compact ? ICONS.fit : undefined}
        title={fitMode ? "Fit — show the whole picture inside its frame" : "Fit — as large as fits on the artboard"}
        pressed={fitMode ? fitMode === "fit" : undefined}
        onClick={() => props.onFit("fit")}
        disabled={!props.canTransform}
        reason="Unlock the selection first."
      />
      <LabelButton
        label="Fill"
        path={compact ? ICONS.fill : undefined}
        title={fitMode ? "Fill — cover the frame, cropping the overflow" : "Fill — cover the whole artboard"}
        pressed={fitMode ? fitMode === "fill" : undefined}
        onClick={() => props.onFit("fill")}
        disabled={!props.canTransform}
        reason="Unlock the selection first."
      />
    </>
  );
}

/**
 * The density for the space the bar actually has. Measured before paint, so a
 * selection that needs the compact bar never flashes the comfortable one.
 * Returns the density, the overflow state for the scroll buttons, and a
 * scroll helper.
 */
function useToolbarFit(kind: string | null) {
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [density, setDensity] = useState<Density>("comfortable");
  const [edges, setEdges] = useState({ left: false, right: false });
  /** Width the comfortable bar needed when it last did not fit; it returns only once that fits. */
  const comfortableNeedRef = useRef(0);
  const lastKindRef = useRef(kind);

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

  // Runs after EVERY render on purpose: any prop (a font name, a colour
  // swatch, a disabled state) can change the bar's width. It cannot loop —
  // density only changes on a real overflow / fit transition, and the edge
  // state keeps its identity when unchanged.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    // Another kind of selection has its own width: try its comfortable bar
    // first. Both renders happen before paint, so nothing flickers.
    if (lastKindRef.current !== kind) {
      lastKindRef.current = kind;
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
    return () => observer.disconnect();
  }, [evaluate, kind]);

  const scrollBy = (direction: -1 | 1) => {
    const strip = scrollRef.current;
    if (strip) strip.scrollBy({ left: direction * Math.max(120, strip.clientWidth * 0.6), behavior: "smooth" });
  };
  return { hostRef, scrollRef, density, edges, evaluate, scrollBy };
}

export default function AdminContextToolbar(props: Props) {
  const layers = props.selectedLayers.filter(Boolean);
  const kind: AdminToolbarKind | null = adminToolbarKind(layers);
  const { hostRef, scrollRef, density, edges, evaluate, scrollBy } = useToolbarFit(kind);
  if (!kind) return null;

  const layer = layers[0];
  const swatches = props.approvedColors?.length ? props.approvedColors.slice(0, 15) : FALLBACK_SWATCHES;
  const transformLocked = !props.canTransform;
  const imageFitMode = kind === "image" ? (layer.fitMode === "contain" ? "fit" : "fill") : undefined;

  const sections: React.ReactNode[] = [];
  if (kind === "text") sections.push(<TextControls key="text" layer={layer} props={props} swatches={swatches} />);
  if (kind === "shape" || kind === "line") sections.push(<ShapeControls key="shape" layer={layer} props={props} swatches={swatches} line={kind === "line"} />);
  if (kind === "image") sections.push(<ImageControls key="image" layer={layer} props={props} />);

  const objectActions = (
    <>
      <CopyDelete onCopy={props.onCopy} onDelete={props.onDelete} canDelete={props.canDelete} />
      {(kind === "multi" || kind === "mask") && (
        <LabelButton label="Group" path={ICONS.group} collapsible={false} onClick={props.onGroup} disabled={!props.groupAction.group.enabled} reason={props.groupAction.group.reason} />
      )}
      {kind === "group" && (
        <LabelButton label="Ungroup" path={ICONS.ungroup} collapsible={false} onClick={props.onUngroup} disabled={!props.groupAction.ungroup.enabled} reason={props.groupAction.ungroup.reason} />
      )}
      {kind === "mask" && (
        <LabelButton
          label="Mask"
          path={ICONS.mask}
          collapsible={false}
          title="Mask — show the photo inside the shape"
          onClick={props.onMask}
          disabled={!props.maskAction?.enabled}
          reason={props.maskAction?.reason}
        />
      )}
    </>
  );
  sections.push(<div key="object" className="flex shrink-0 items-center">{objectActions}</div>);
  sections.push(
    <div key="scale" className="flex shrink-0 items-center">
      <ScalePair onScale={props.onScale} disabled={transformLocked} />
    </div>,
  );
  if (kind === "shape" || kind === "image") {
    sections.push(
      <div key="fit" className="flex shrink-0 items-center">
        <FitFill props={props} fitMode={imageFitMode} />
      </div>,
    );
  }
  sections.push(<AlignmentButton key="alignment" open={props.alignmentOpen} onToggle={props.onToggleAlignment} />);

  const compact = density === "compact";
  const densityStyle = (compact ? { "--tb-size": "32px", "--tb-pad": "8px", "--tb-sep": "2px" } : { "--tb-size": "36px", "--tb-pad": "12px", "--tb-sep": "4px" }) as React.CSSProperties;
  const scrollButton = "pointer-events-auto absolute top-1/2 z-10 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-[#303839]/10 bg-white text-[#303839] shadow-[0_2px_8px_rgba(48,56,57,0.18)] transition-colors hover:bg-[#F3F1EC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839]";

  return (
    <DensityContext.Provider value={density}>
      <div ref={hostRef} className="pointer-events-none flex w-full justify-center">
        <div
          data-customizer-text-interaction
          data-admin-text-toolbar
          data-admin-toolbar={kind}
          data-admin-toolbar-density={density}
          role="toolbar"
          aria-label={kind === "multi" || kind === "mask" ? `${layers.length} objects selected` : "Selection tools"}
          style={densityStyle}
          className="pointer-events-auto relative max-w-full rounded-full border border-[#303839]/10 bg-white p-1 shadow-[0_4px_18px_rgba(48,56,57,0.12)]"
        >
          {/* One row, never wrapped. It fits at the supported desktop sizes; only
              a narrower workspace scrolls it, with visible scroll buttons. */}
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
            {sections.map((section, index) => (
              <div key={index} className="flex shrink-0 items-center">
                {index > 0 && <Separator />}
                {section}
              </div>
            ))}
          </div>
          {edges.left && (
            <>
              <span aria-hidden className="pointer-events-none absolute inset-y-1 left-1 w-10 rounded-l-full bg-white" />
              <button type="button" data-shape="round" aria-label="Scroll tools left" title="More tools" onClick={() => scrollBy(-1)} className={`${scrollButton} left-1`}>
                <Icon path={ICONS.scrollLeft} size={16} strokeWidth={2.2} />
              </button>
            </>
          )}
          {edges.right && (
            <>
              <span aria-hidden className="pointer-events-none absolute inset-y-1 right-1 w-10 rounded-r-full bg-white" />
              <button type="button" data-shape="round" aria-label="Scroll tools right" title="More tools" onClick={() => scrollBy(1)} className={`${scrollButton} right-1`}>
                <Icon path={ICONS.scrollRight} size={16} strokeWidth={2.2} />
              </button>
            </>
          )}
        </div>
      </div>
    </DensityContext.Provider>
  );
}
