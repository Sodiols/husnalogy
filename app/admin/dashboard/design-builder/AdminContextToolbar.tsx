"use client";

import { rememberRecentColor } from "@/lib/customizer/v2/studio-recent-colors";
import { FONT_SIZE_POINT_RULES, documentPxToPoints, fontSizeBoundsInPoints, pointsToDocumentPx } from "@/lib/customizer/v2/type-units";
import { useEffect, useRef, useState } from "react";
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
} as const;

/* ----------------------------------------------------------- primitives ---- */

// One look for every control in the capsule: compact, borderless, dark ink,
// a soft grey hover and a light-blue "on" state.
const BUTTON =
  "flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full text-[13px] font-medium text-[#303839] transition-colors hover:bg-[#303839]/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] disabled:cursor-not-allowed disabled:text-[#303839]/30 disabled:hover:bg-transparent";
const BUTTON_ON = "bg-[#DCEBFA] text-[#12385C] hover:bg-[#CFE3F8]";
const ICON_BUTTON = `${BUTTON} w-9`;
const TEXT_BUTTON = `${BUTTON} px-3`;

function Separator() {
  return <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-[#303839]/12" />;
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
}: {
  label: string;
  path?: string;
  onClick: () => void;
  disabled?: boolean;
  reason?: string;
  pressed?: boolean;
  ariaLabel?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={pressed}
      title={disabled && reason ? `${label} — ${reason}` : title || label}
      disabled={disabled}
      onClick={onClick}
      className={`${TEXT_BUTTON} ${pressed ? BUTTON_ON : ""}`}
    >
      {path && <Icon path={path} />}
      <span className="whitespace-nowrap">{label}</span>
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
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls="admin-alignment-panel"
      onClick={onToggle}
      className={`${TEXT_BUTTON} ${open ? BUTTON_ON : ""}`}
    >
      Alignment
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
  return (
    <div className="flex shrink-0 items-center gap-1.5 pl-2">
      <span className="whitespace-nowrap text-[13px] font-medium text-[#303839]/80">{caption}</span>
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
  const trigger = caption ? `${TEXT_BUTTON}` : ICON_BUTTON;
  return (
    <ToolbarPopover
      label={`${title}: ${none ? "Transparent" : value}`}
      triggerTitle={title}
      role="dialog"
      menuWidth={236}
      triggerClassName={trigger}
      triggerActiveClassName={`${trigger} ${BUTTON_ON}`}
      trigger={
        caption ? (
          <>
            <span className="whitespace-nowrap">{caption}</span>
            <ColourChip value={value} size={18} />
            <Icon path={ICONS.chevron} size={14} strokeWidth={2.2} />
          </>
        ) : (
          <ColourChip value={value} />
        )
      }
    >
      {(close) => (
        <div className="grid gap-2 p-1.5" data-customizer-text-interaction>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#303839]/50">{title}</p>
          <div className="grid grid-cols-8 gap-1.5">
            {allowTransparent && (
              <button
                type="button"
                data-toolbar-menu-item
                aria-label="Transparent"
                aria-pressed={none}
                title="Transparent — no paint"
                onClick={() => {
                  onCommit(TRANSPARENT_PAINT);
                  close();
                }}
                className={`grid h-6 w-6 place-items-center rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] ${none ? "ring-2 ring-[#2B7BD8] ring-offset-1" : ""}`}
              >
                <ColourChip value={TRANSPARENT_PAINT} size={24} />
              </button>
            )}
            {swatches.map((swatch) => {
              const selected = !none && swatch.toLowerCase() === String(value).toLowerCase();
              return (
                <button
                  key={swatch}
                  type="button"
                  data-toolbar-menu-item
                  aria-label={`${title} ${swatch}`}
                  aria-pressed={selected}
                  title={swatch}
                  onClick={() => {
                    onCommit(swatch);
                    close();
                  }}
                  className={`h-6 w-6 rounded-full border border-[#303839]/15 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] ${selected ? "ring-2 ring-[#2B7BD8] ring-offset-1" : ""}`}
                  style={{ backgroundColor: swatch }}
                />
              );
            })}
          </div>
          <span className="flex items-center gap-1.5">
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
              className="h-9 min-w-0 flex-1 rounded-lg border border-[#303839]/15 bg-white px-2 text-[13px] font-semibold uppercase tabular-nums text-[#303839] outline-none focus:border-[#303839]/60"
            />
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
              className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-[#303839]/15 bg-white p-0.5"
            />
          </span>
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
        className="w-[164px]"
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
      <ColourControl
        title="Line color"
        caption="Line color"
        value={stroke}
        swatches={swatches}
        allowTransparent={!line}
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
  return (
    <>
      <LabelButton
        label="Fit"
        title={fitMode ? "Fit — show the whole picture inside its frame" : "Fit — as large as fits on the artboard"}
        pressed={fitMode ? fitMode === "fit" : undefined}
        onClick={() => props.onFit("fit")}
        disabled={!props.canTransform}
        reason="Unlock the selection first."
      />
      <LabelButton
        label="Fill"
        title={fitMode ? "Fill — cover the frame, cropping the overflow" : "Fill — cover the whole artboard"}
        pressed={fitMode ? fitMode === "fill" : undefined}
        onClick={() => props.onFit("fill")}
        disabled={!props.canTransform}
        reason="Unlock the selection first."
      />
    </>
  );
}

export default function AdminContextToolbar(props: Props) {
  const layers = props.selectedLayers.filter(Boolean);
  const kind: AdminToolbarKind | null = adminToolbarKind(layers);
  const scrollRef = useRef<HTMLDivElement>(null);
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
        <LabelButton label="Group" path={ICONS.group} onClick={props.onGroup} disabled={!props.groupAction.group.enabled} reason={props.groupAction.group.reason} />
      )}
      {kind === "group" && (
        <LabelButton label="Ungroup" path={ICONS.ungroup} onClick={props.onUngroup} disabled={!props.groupAction.ungroup.enabled} reason={props.groupAction.ungroup.reason} />
      )}
      {kind === "mask" && (
        <LabelButton
          label="Mask"
          path={ICONS.mask}
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

  return (
    <div className="pointer-events-none flex w-full justify-center">
      <div
        data-customizer-text-interaction
        data-admin-text-toolbar
        data-admin-toolbar={kind}
        role="toolbar"
        aria-label={kind === "multi" || kind === "mask" ? `${layers.length} objects selected` : "Selection tools"}
        className="pointer-events-auto max-w-full rounded-full border border-[#303839]/10 bg-white p-1 shadow-[0_4px_18px_rgba(48,56,57,0.12)]"
      >
        {/* One row that scrolls sideways when the workspace is narrow — never wraps. */}
        <div
          ref={scrollRef}
          className="flex items-center overflow-x-auto overflow-y-hidden rounded-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
      </div>
    </div>
  );
}
