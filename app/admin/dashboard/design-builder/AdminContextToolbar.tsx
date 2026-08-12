"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CUSTOMIZER_APPROVED_FONTS } from "@/lib/customizer";
import EditableNumericStepper from "@/app/components/customizer/EditableNumericStepper";
import ToolbarDropdown, {
  type ToolbarDropdownOption,
} from "@/app/components/customizer/ToolbarDropdown";
import {
  CAPTION_HEIGHT,
  CONTROL_GAP,
  CONTROL_HEIGHT,
  FONT_SIZE_RULES,
  LETTER_SPACING_RULES,
  LINE_HEIGHT_RULES,
  STEPPER_BUTTON_WIDTH,
  TEXT_TOOLBAR_DEFAULTS,
  boldWeightForFont,
  controlWidth,
  isBoldWeight,
  layoutActionAvailability,
  nearestSupportedWeight,
  planTextToolbar,
  regularWeightForFont,
  resolveWeightOptions,
  sharedTextStyleValue,
  verticalAlignAffectsCanvas,
  type ToolbarControlId,
  type ToolbarDensity,
  type ToolbarPlan,
} from "@/lib/customizer/v2/text-toolbar";
import type { GroupActionState } from "@/lib/customizer/v2/groups";
import ToolbarPopover, { ToolbarMenuItem, ToolbarMenuSection } from "./ToolbarPopover";
import type { AlignMode, DistributionMode, LayerArrangeMode } from "./builder-utils";

type StylePatch = Record<string, unknown>;

type Props = {
  layer: any;
  selectedLayers?: any[];
  selectionCount: number;
  editingText?: boolean;
  canTransformSelection?: boolean;
  approvedColors?: string[];
  /** Shared group-selection rules, evaluated once by the owner of the document
   *  so the toolbar, the Layout menu and the keyboard shortcuts agree. */
  groupAction?: { group: GroupActionState; ungroup: GroupActionState };
  onEnterGroup?: () => void;
  /** Committed change: updates the document and creates one history entry. */
  onStylePatch: (patch: StylePatch) => void;
  /** Live change while a control is being manipulated. No history entry. */
  onStylePreview?: (patch: StylePatch) => void;
  /** Escape during a live change: discards the preview. */
  onStyleCancel?: () => void;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: "horizontal" | "vertical", mode: DistributionMode) => void;
  onMatchSize: (dimension: "width" | "height" | "both") => void;
  onGroup: () => void;
  onUngroup: () => void;
  onDuplicate: () => void;
  onLayerOrder: (action: LayerArrangeMode) => void;
  onDelete: () => void;
};

const FONT_OPTIONS: ToolbarDropdownOption[] = CUSTOMIZER_APPROVED_FONTS.map((font) => ({
  value: font.value,
  label: font.label,
  fontFamily: font.stack,
}));

const FALLBACK_SWATCHES = ["#303839", "#5B6667", "#8D6E63", "#D4AF37", "#B08D2A", "#F4ECEC", "#FFFFFF", "#7A1F2B"];

/* ------------------------------------------------------------------ icons -- */

function Icon({ path, size = 16, strokeWidth = 1.8 }: { path: string; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}

const ICONS = {
  alignLeft: "M4 6h16M4 11h10M4 16h16M4 21h12",
  alignCenter: "M4 6h16M7 11h10M4 16h16M6 21h12",
  alignRight: "M4 6h16M10 11h10M4 16h16M8 21h12",
  alignTop: "M4 4h16M9 8h6v11H9z",
  alignMiddle: "M4 12h16M9 7h6v10H9z",
  alignBottom: "M4 20h16M9 5h6v11H9z",
  objectLeft: "M4 3v18M8 7h11v4H8zM8 14h7v4H8z",
  objectCenterH: "M12 3v18M6 7h12v4H6zM8 14h8v4H8z",
  objectRight: "M20 3v18M5 7h11v4H5zM9 14h7v4H9z",
  objectTop: "M3 4h18M7 8h4v11H7zM14 8h4v7h-4z",
  objectCenterV: "M3 12h18M7 6h4v12H7zM14 8h4v8h-4z",
  objectBottom: "M3 20h18M7 5h4v11H7zM14 9h4v7h-4z",
  card: "M4 4h16v16H4zM12 8v8M8 12h8",
  cardH: "M4 4h16v16H4zM12 4v16",
  cardV: "M4 4h16v16H4zM4 12h16",
  distributeH: "M3 3v18M21 3v18M9 8h6v8H9z",
  distributeV: "M3 3h18M3 21h18M8 9h8v6H8z",
  bringToFront: "M8 8h11v11H8zM5 5h11v3M5 5v11h3",
  bringForward: "M8 8h11v11H8zM5 5h11v6M5 5v11h6",
  sendBackward: "M5 5h11v11H5zM8 8h11v11H8z",
  sendToBack: "M5 5h11v11H5zM8 16v3h11V8h-3",
  duplicate: "M8 8h11v11H8zM16 8V6.5A1.5 1.5 0 0 0 14.5 5h-9A1.5 1.5 0 0 0 4 6.5v9A1.5 1.5 0 0 0 5.5 17H8",
  trash: "M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6",
  layout: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z",
  more: "M6 12h.01M12 12h.01M18 12h.01",
  group: "M4 4h6v6H4zM14 14h6v6h-6zM10 7h4M7 10v4",
  ungroup: "M3 3h6v6H3zM15 15h6v6h-6zM9 6h3v3",
  matchSize: "M4 8h7v8H4zM14 5h6v14h-6z",
  chevron: "m6 9 6 6 6-6",
  pencil: "M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16z",
} as const;

/* ----------------------------------------------------------- primitives ---- */

/**
 * One control style for the whole toolbar: same border, radius, background,
 * text size, padding, hover, focus ring and disabled treatment. Every trigger,
 * stepper, segment and icon button is built from these four strings, which is
 * what makes the row read as a single component system (spec §26).
 */
const CONTROL_BASE =
  "flex shrink-0 items-center justify-center rounded-lg border text-[12.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed";
const CONTROL_IDLE = "border-[#303839]/15 bg-white text-[#303839] hover:border-[#303839]/30 hover:bg-[#F4ECEC]";
const CONTROL_ACTIVE = "border-[#303839] bg-[#303839] text-white hover:bg-[#3D4647]";
const CONTROL_MIXED = "border-[#D4AF37] bg-[#F4ECEC] text-[#303839]";
// Disabled controls stay legible (spec §26): dimmed, never invisible.
const ICON_BUTTON_DISABLED = "border-[#303839]/10 bg-[#F4ECEC]/50 text-[#303839]/35";
/** Same shell without a display utility, for controls that own their layout
 *  (the numeric stepper is a grid). Literal classes so Tailwind emits them. */
const CONTROL_SHELL = "rounded-lg border border-[#303839]/15 bg-white transition-colors focus-within:border-[#D4AF37]";
const CONTROL_HEIGHT_CLASS: Record<ToolbarDensity, string> = {
  comfortable: "h-[36px]",
  condensed: "h-[34px]",
  icon: "h-[32px]",
};

function controlState(options: { active?: boolean; mixed?: boolean; disabled?: boolean; danger?: boolean }) {
  if (options.disabled) return ICON_BUTTON_DISABLED;
  if (options.danger) return "border-[#303839]/15 bg-white text-red-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700";
  if (options.active) return CONTROL_ACTIVE;
  if (options.mixed) return CONTROL_MIXED;
  return CONTROL_IDLE;
}

function iconSize(density: ToolbarDensity) {
  return density === "comfortable" ? 16 : 15;
}

/**
 * Every toolbar entry sits in this wrapper: a reserved caption row of a fixed
 * height above a control of the shared height, both at the exact width the
 * layout planner budgeted. Reserving the caption row even when there is no
 * caption is what keeps SIZE, SPACING and LINE on one line instead of letting
 * captioned controls ride higher than the rest.
 */
function ToolbarItem({
  width,
  density,
  showCaption,
  caption,
  onReset,
  resetLabel,
  children,
}: {
  width: number;
  density: ToolbarDensity;
  showCaption: boolean;
  caption?: string;
  onReset?: () => void;
  resetLabel?: string;
  children: React.ReactNode;
}) {
  const captionClass = "block w-full truncate text-center text-[8.5px] font-extrabold uppercase leading-3 tracking-[0.11em] text-[#303839]/45";
  return (
    <div
      className="grid shrink-0 items-center"
      style={{
        width,
        gridTemplateRows: showCaption ? `${CAPTION_HEIGHT}px ${CONTROL_HEIGHT[density]}px` : `${CONTROL_HEIGHT[density]}px`,
      }}
    >
      {showCaption &&
        (caption && onReset ? (
          <button
            type="button"
            onClick={onReset}
            title={resetLabel}
            aria-label={resetLabel}
            className={`${captionClass} cursor-pointer rounded transition-colors hover:text-[#D4AF37] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#D4AF37]`}
          >
            {caption}
          </button>
        ) : (
          <span className={captionClass} aria-hidden>
            {caption || ""}
          </span>
        ))}
      {children}
    </div>
  );
}

function ToolbarIconButton({
  label,
  hint,
  path,
  density,
  width,
  showCaption,
  active = false,
  mixed = false,
  disabled = false,
  danger = false,
  onClick,
  children,
}: {
  label: string;
  hint?: string;
  path?: string;
  density: ToolbarDensity;
  width: number;
  showCaption: boolean;
  active?: boolean;
  mixed?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <ToolbarItem width={width} density={density} showCaption={showCaption}>
      <button
        type="button"
        aria-label={mixed ? `${label}: Mixed` : label}
        aria-pressed={active}
        aria-disabled={disabled}
        title={disabled && hint ? `${label} — ${hint}` : hint || label}
        disabled={disabled}
        onClick={onClick}
        style={{ height: CONTROL_HEIGHT[density] }}
        className={`${CONTROL_BASE} w-full ${controlState({ active, mixed, disabled, danger })}`}
      >
        {children ?? (path ? <Icon path={path} size={iconSize(density)} /> : null)}
      </button>
    </ToolbarItem>
  );
}

/** The only divider in the toolbar: one between each major group. */
function Divider({ density }: { density: ToolbarDensity }) {
  return <span className="w-px shrink-0 bg-[#303839]/12" style={{ height: CONTROL_HEIGHT[density] - 8 }} aria-hidden />;
}

/**
 * Numeric toolbar field: caption (which doubles as reset), visible decrease and
 * increase buttons, and an editable value that previews live while it is typed
 * and commits on Enter, blur or a step click (spec §17).
 */
function ToolbarNumberField({
  label,
  caption,
  value,
  mixed,
  rules,
  density,
  showCaption,
  width,
  disabled = false,
  onPreview,
  onCommit,
  onCancel,
  onReset,
  resetLabel,
}: {
  label: string;
  caption: string;
  value: number;
  mixed: boolean;
  rules: { minimum: number; maximum: number; step: number; largeStep: number };
  density: ToolbarDensity;
  showCaption: boolean;
  width: number;
  disabled?: boolean;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
  onCancel: () => void;
  onReset?: () => void;
  resetLabel?: string;
}) {
  return (
    <ToolbarItem
      width={width}
      density={density}
      showCaption={showCaption}
      caption={caption}
      onReset={onReset}
      resetLabel={resetLabel}
    >
      <EditableNumericStepper
        label={label}
        value={value}
        mixed={mixed}
        minimum={rules.minimum}
        maximum={rules.maximum}
        step={rules.step}
        largeStep={rules.largeStep}
        allowNegative={rules.minimum < 0}
        allowDecimal={!Number.isInteger(rules.step)}
        disabled={disabled}
        onPreviewChange={onPreview}
        onCommit={onCommit}
        onCancel={onCancel}
        showStepButtons
        // Fixed arrow width, so whatever is left over is a known, readable
        // value column — never a value squeezed under a stepper button.
        stepButtonWidth={STEPPER_BUTTON_WIDTH[density]}
        className={`${CONTROL_SHELL} ${CONTROL_HEIGHT_CLASS[density]} w-full overflow-hidden`}
        buttonClassName="grid h-full place-items-center text-[#303839]/60 transition-colors hover:bg-[#F4ECEC] hover:text-[#303839] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#D4AF37] disabled:cursor-not-allowed disabled:text-[#303839]/25"
        inputClassName="h-full min-w-0 w-full bg-transparent text-center text-[12.5px] font-bold tabular-nums text-[#303839] outline-none placeholder:text-[9.5px] placeholder:font-bold placeholder:uppercase placeholder:tracking-wide placeholder:text-[#303839]/40 focus:bg-[#F4ECEC]/60"
        // The value column is exactly as wide as the planner budgeted, so the
        // site-wide input padding must not reclaim any of it.
        inputStyle={{ paddingLeft: 0, paddingRight: 0 }}
      />
    </ToolbarItem>
  );
}

/* ------------------------------------------------------------ colour ------- */

function normalizeHex(input: string): string | null {
  const raw = input.trim().replace(/^#/, "");
  const expanded = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  return /^[0-9a-fA-F]{6}$/.test(expanded) ? `#${expanded.toLowerCase()}` : null;
}

function TextColorControl({
  value,
  mixed,
  density,
  width,
  showCaption,
  swatches,
  onPreview,
  onCommit,
}: {
  value: string;
  mixed: boolean;
  density: ToolbarDensity;
  width: number;
  showCaption: boolean;
  swatches: string[];
  onPreview: (color: string) => void;
  onCommit: (color: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const shell = `${CONTROL_BASE} w-full ${CONTROL_HEIGHT_CLASS[density]}`;

  return (
    <ToolbarItem width={width} density={density} showCaption={showCaption}>
      <ToolbarPopover
      label={mixed ? "Text colour: Mixed" : `Text colour: ${value}`}
      role="dialog"
      menuWidth={228}
      align="center"
      triggerClassName={`${shell} ${CONTROL_IDLE}`}
      triggerActiveClassName={`${shell} ${CONTROL_ACTIVE}`}
      trigger={
        <span className="block rounded-full border border-[#303839]/25" style={{ height: 16, width: 16 }}>
          <span
            className="block h-full w-full rounded-full"
            style={{
              background: mixed
                ? "conic-gradient(#303839 0 25%, #D4AF37 0 50%, #8D6E63 0 75%, #F4ECEC 0)"
                : value,
            }}
            aria-hidden
          />
        </span>
      }
    >
      {(close) => (
        <div className="grid gap-2 p-1.5">
          <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#303839]/45">Text colour</p>
          <div className="grid grid-cols-8 gap-1.5">
            {swatches.map((swatch) => {
              const selected = !mixed && swatch.toLowerCase() === String(value).toLowerCase();
              return (
                <button
                  key={swatch}
                  type="button"
                  data-toolbar-menu-item
                  aria-label={`Text colour ${swatch}`}
                  aria-pressed={selected}
                  title={swatch}
                  onClick={() => {
                    onCommit(swatch);
                    close();
                  }}
                  className={`h-6 w-6 rounded-md border transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${
                    selected ? "border-[#303839] ring-2 ring-[#D4AF37]" : "border-[#303839]/15"
                  }`}
                  style={{ backgroundColor: swatch }}
                />
              );
            })}
          </div>
          <label className="grid gap-1">
            <span className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#303839]/45">Hex</span>
            <span className="flex items-center gap-1.5">
              <input
                type="text"
                value={mixed && draft === value ? "" : draft}
                placeholder={mixed ? "Mixed" : "#303839"}
                aria-label="Text colour hex value"
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
                  if (hex) onCommit(hex);
                  else setDraft(value);
                }}
                className="h-9 min-w-0 flex-1 rounded-lg border border-[#303839]/15 bg-white px-2 text-[13px] font-bold uppercase tabular-nums text-[#303839] outline-none focus:border-[#D4AF37] focus-visible:ring-2 focus-visible:ring-[#D4AF37]/25"
              />
              <input
                type="color"
                aria-label="Pick a text colour"
                value={mixed ? "#303839" : value}
                onChange={(event) => {
                  setDraft(event.target.value);
                  onPreview(event.target.value);
                }}
                onBlur={(event) => onCommit(event.target.value)}
                className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-[#303839]/15 bg-white p-0.5"
              />
            </span>
          </label>
        </div>
      )}
      </ToolbarPopover>
    </ToolbarItem>
  );
}

/* -------------------------------------------------------- text alignment --- */

const HORIZONTAL_ALIGN = [
  { value: "left", label: "Align text left", path: ICONS.alignLeft },
  { value: "center", label: "Align text centre", path: ICONS.alignCenter },
  { value: "right", label: "Align text right", path: ICONS.alignRight },
] as const;

const VERTICAL_ALIGN = [
  { value: "top", label: "Align text to the top", path: ICONS.alignTop },
  { value: "middle", label: "Align text to the middle", path: ICONS.alignMiddle },
  { value: "bottom", label: "Align text to the bottom", path: ICONS.alignBottom },
] as const;

function HorizontalAlignControl({
  value,
  mixed,
  mode,
  density,
  width,
  showCaption,
  hint,
  onChange,
}: {
  value: string;
  mixed: boolean;
  mode: "segmented" | "dropdown";
  density: ToolbarDensity;
  width: number;
  showCaption: boolean;
  hint?: string;
  onChange: (value: string) => void;
}) {
  const current = HORIZONTAL_ALIGN.find((option) => option.value === value) || HORIZONTAL_ALIGN[1];

  if (mode === "segmented") {
    // One bordered group of three equal segments at the shared control height,
    // so it never sits taller or shorter than the steppers beside it.
    return (
      <ToolbarItem width={width} density={density} showCaption={showCaption}>
        <div
          role="radiogroup"
          aria-label={mixed ? "Text alignment: Mixed" : "Text alignment"}
          style={{ height: CONTROL_HEIGHT[density] }}
          className={`grid w-full grid-cols-3 overflow-hidden ${CONTROL_SHELL} ${mixed ? "border-[#D4AF37]" : ""}`}
        >
          {HORIZONTAL_ALIGN.map((option, index) => {
            const active = !mixed && value === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={option.label}
                title={hint ? `${option.label} — ${hint}` : option.label}
                onClick={() => onChange(option.value)}
                className={`grid h-full w-full place-items-center transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#D4AF37] ${
                  index > 0 ? "border-l border-[#303839]/10" : ""
                } ${active ? "bg-[#303839] text-white" : "text-[#303839]/65 hover:bg-[#F4ECEC] hover:text-[#303839]"}`}
              >
                <Icon path={option.path} size={iconSize(density)} />
              </button>
            );
          })}
        </div>
      </ToolbarItem>
    );
  }

  return (
    <ToolbarItem width={width} density={density} showCaption={showCaption}>
      <ToolbarPopover
      label={mixed ? "Text alignment: Mixed" : "Text alignment"}
      triggerTitle={hint ? `Text alignment — ${hint}` : "Text alignment"}
      menuWidth={196}
      triggerClassName={`${CONTROL_BASE} w-full ${CONTROL_HEIGHT_CLASS[density]} ${mixed ? CONTROL_MIXED : CONTROL_IDLE}`}
      triggerActiveClassName={`${CONTROL_BASE} w-full ${CONTROL_HEIGHT_CLASS[density]} ${CONTROL_ACTIVE}`}
      trigger={<Icon path={current.path} size={iconSize(density)} />}
    >
      {(close) => (
        <ToolbarMenuSection title="Text alignment">
          {HORIZONTAL_ALIGN.map((option) => (
            <ToolbarMenuItem
              key={option.value}
              label={option.label}
              icon={<Icon path={option.path} size={15} />}
              active={!mixed && value === option.value}
              onSelect={() => {
                onChange(option.value);
                close();
              }}
            />
          ))}
        </ToolbarMenuSection>
      )}
      </ToolbarPopover>
    </ToolbarItem>
  );
}

function VerticalAlignControl({
  value,
  mixed,
  enabled,
  reason,
  density,
  width,
  showCaption,
  onChange,
}: {
  value: string;
  mixed: boolean;
  enabled: boolean;
  reason: string;
  density: ToolbarDensity;
  width: number;
  showCaption: boolean;
  onChange: (value: string) => void;
}) {
  const current = VERTICAL_ALIGN.find((option) => option.value === value) || VERTICAL_ALIGN[1];
  const shell = `${CONTROL_BASE} w-full ${CONTROL_HEIGHT_CLASS[density]}`;
  return (
    <ToolbarItem width={width} density={density} showCaption={showCaption}>
      <ToolbarPopover
      label={mixed ? "Vertical text alignment: Mixed" : "Vertical text alignment"}
      triggerTitle={enabled ? "Vertical text alignment" : `Vertical text alignment — ${reason}`}
      disabled={!enabled}
      menuWidth={214}
      triggerClassName={`${shell} ${enabled ? CONTROL_IDLE : ICON_BUTTON_DISABLED}`}
      triggerActiveClassName={`${shell} ${CONTROL_ACTIVE}`}
      trigger={<Icon path={current.path} size={iconSize(density)} />}
    >
      {(close) => (
        <ToolbarMenuSection title="Vertical text alignment">
          {VERTICAL_ALIGN.map((option) => (
            <ToolbarMenuItem
              key={option.value}
              label={option.label}
              icon={<Icon path={option.path} size={15} />}
              active={!mixed && value === option.value}
              onSelect={() => {
                onChange(option.value);
                close();
              }}
            />
          ))}
        </ToolbarMenuSection>
      )}
      </ToolbarPopover>
    </ToolbarItem>
  );
}

/* -------------------------------------------------------------- layout ----- */

function LayoutMenu({
  density,
  showLabel,
  width,
  showCaption,
  selectionCount,
  canTransformSelection,
  isGroup,
  groupAction,
  onAlign,
  onDistribute,
  onMatchSize,
  onGroup,
  onUngroup,
  onEnterGroup,
  onLayerOrder,
}: {
  density: ToolbarDensity;
  showLabel: boolean;
  width: number;
  showCaption: boolean;
  selectionCount: number;
  canTransformSelection: boolean;
  isGroup: boolean;
  groupAction?: { group: GroupActionState; ungroup: GroupActionState };
  onEnterGroup?: () => void;
  onAlign: Props["onAlign"];
  onDistribute: Props["onDistribute"];
  onMatchSize: Props["onMatchSize"];
  onGroup: Props["onGroup"];
  onUngroup: Props["onUngroup"];
  onLayerOrder: Props["onLayerOrder"];
}) {
  const can = layoutActionAvailability({ selectionCount, canTransform: canTransformSelection, isGroup });
  const alignTarget = selectionCount >= 2 ? "Align objects" : "Align to card";
  const shell = `${CONTROL_BASE} w-full ${CONTROL_HEIGHT_CLASS[density]} ${showLabel ? "gap-1.5 px-2" : ""}`;

  return (
    <ToolbarItem width={width} density={density} showCaption={showCaption}>
      <ToolbarPopover
      label="Layout"
      triggerTitle="Object layout: align, distribute, match size and layer order"
      menuWidth={244}
      triggerClassName={`${shell} ${CONTROL_IDLE}`}
      triggerActiveClassName={`${shell} ${CONTROL_ACTIVE}`}
      trigger={
        showLabel ? (
          <>
            <Icon path={ICONS.layout} size={iconSize(density)} />
            <span className="flex-1 text-left">Layout</span>
            <Icon path={ICONS.chevron} size={12} strokeWidth={2.2} />
          </>
        ) : (
          <Icon path={ICONS.layout} size={iconSize(density)} />
        )
      }
    >
      {(close) => {
        const act = (run: () => void) => () => {
          run();
          close();
        };
        return (
          <div className="grid">
            <ToolbarMenuSection title={alignTarget}>
              <div className="grid grid-cols-2 gap-0.5">
                <ToolbarMenuItem label="Left" icon={<Icon path={ICONS.objectLeft} size={15} />} disabled={!can.alignLeft.enabled} hint={can.alignLeft.reason} onSelect={act(() => onAlign("left"))} />
                <ToolbarMenuItem label="Top" icon={<Icon path={ICONS.objectTop} size={15} />} disabled={!can.alignTop.enabled} hint={can.alignTop.reason} onSelect={act(() => onAlign("top"))} />
                <ToolbarMenuItem label="Centre" icon={<Icon path={ICONS.objectCenterH} size={15} />} disabled={!can.alignCenter.enabled} hint={can.alignCenter.reason} onSelect={act(() => onAlign("center"))} />
                <ToolbarMenuItem label="Middle" icon={<Icon path={ICONS.objectCenterV} size={15} />} disabled={!can.alignMiddle.enabled} hint={can.alignMiddle.reason} onSelect={act(() => onAlign("middle"))} />
                <ToolbarMenuItem label="Right" icon={<Icon path={ICONS.objectRight} size={15} />} disabled={!can.alignRight.enabled} hint={can.alignRight.reason} onSelect={act(() => onAlign("right"))} />
                <ToolbarMenuItem label="Bottom" icon={<Icon path={ICONS.objectBottom} size={15} />} disabled={!can.alignBottom.enabled} hint={can.alignBottom.reason} onSelect={act(() => onAlign("bottom"))} />
              </div>
            </ToolbarMenuSection>

            <ToolbarMenuSection title="Centre on card">
              <ToolbarMenuItem label="Centre horizontally on card" icon={<Icon path={ICONS.cardH} size={15} />} disabled={!can.centerOnCardHorizontal.enabled} hint={can.centerOnCardHorizontal.reason} onSelect={act(() => onAlign("centerOnCardHorizontal"))} />
              <ToolbarMenuItem label="Centre vertically on card" icon={<Icon path={ICONS.cardV} size={15} />} disabled={!can.centerOnCardVertical.enabled} hint={can.centerOnCardVertical.reason} onSelect={act(() => onAlign("centerOnCardVertical"))} />
              <ToolbarMenuItem label="Centre completely on card" icon={<Icon path={ICONS.card} size={15} />} disabled={!can.centerOnCard.enabled} hint={can.centerOnCard.reason} onSelect={act(() => onAlign("centerOnCard"))} />
            </ToolbarMenuSection>

            <ToolbarMenuSection title="Distribute">
              <ToolbarMenuItem label="Distribute horizontally" icon={<Icon path={ICONS.distributeH} size={15} />} disabled={!can.distributeHorizontal.enabled} hint={can.distributeHorizontal.reason} onSelect={act(() => onDistribute("horizontal", "centers"))} />
              <ToolbarMenuItem label="Distribute vertically" icon={<Icon path={ICONS.distributeV} size={15} />} disabled={!can.distributeVertical.enabled} hint={can.distributeVertical.reason} onSelect={act(() => onDistribute("vertical", "centers"))} />
              <ToolbarMenuItem label="Equal horizontal spacing" icon={<Icon path={ICONS.distributeH} size={15} />} disabled={!can.spacingHorizontal.enabled} hint={can.spacingHorizontal.reason} onSelect={act(() => onDistribute("horizontal", "spacing"))} />
              <ToolbarMenuItem label="Equal vertical spacing" icon={<Icon path={ICONS.distributeV} size={15} />} disabled={!can.spacingVertical.enabled} hint={can.spacingVertical.reason} onSelect={act(() => onDistribute("vertical", "spacing"))} />
            </ToolbarMenuSection>

            <ToolbarMenuSection title="Size">
              <ToolbarMenuItem label="Match width" icon={<Icon path={ICONS.matchSize} size={15} />} disabled={!can.matchWidth.enabled} hint={can.matchWidth.reason} onSelect={act(() => onMatchSize("width"))} />
              <ToolbarMenuItem label="Match height" icon={<Icon path={ICONS.matchSize} size={15} />} disabled={!can.matchHeight.enabled} hint={can.matchHeight.reason} onSelect={act(() => onMatchSize("height"))} />
              <ToolbarMenuItem label="Match size" icon={<Icon path={ICONS.matchSize} size={15} />} disabled={!can.matchSize.enabled} hint={can.matchSize.reason} onSelect={act(() => onMatchSize("both"))} />
            </ToolbarMenuSection>

            <ToolbarMenuSection title="Layer order">
              <ToolbarMenuItem label="Bring to front" icon={<Icon path={ICONS.bringToFront} size={15} />} disabled={!can.bringToFront.enabled} hint={can.bringToFront.reason} onSelect={act(() => onLayerOrder("bringToFront"))} />
              <ToolbarMenuItem label="Bring forward" icon={<Icon path={ICONS.bringForward} size={15} />} disabled={!can.bringForward.enabled} hint={can.bringForward.reason} onSelect={act(() => onLayerOrder("bringForward"))} />
              <ToolbarMenuItem label="Send backward" icon={<Icon path={ICONS.sendBackward} size={15} />} disabled={!can.sendBackward.enabled} hint={can.sendBackward.reason} onSelect={act(() => onLayerOrder("sendBackward"))} />
              <ToolbarMenuItem label="Send to back" icon={<Icon path={ICONS.sendToBack} size={15} />} disabled={!can.sendToBack.enabled} hint={can.sendToBack.reason} onSelect={act(() => onLayerOrder("sendToBack"))} />
            </ToolbarMenuSection>

            {groupAction && (selectionCount > 1 || isGroup) && (
              <ToolbarMenuSection title="Grouping">
                {isGroup ? (
                  <>
                    <ToolbarMenuItem
                      label="Ungroup"
                      icon={<Icon path={ICONS.ungroup} size={15} />}
                      disabled={!groupAction.ungroup.enabled}
                      hint={groupAction.ungroup.reason}
                      onSelect={act(onUngroup)}
                    />
                    {onEnterGroup && (
                      <ToolbarMenuItem
                        label="Edit group"
                        icon={<Icon path={ICONS.group} size={15} />}
                        hint="Edit the objects inside this group without ungrouping"
                        onSelect={act(onEnterGroup)}
                      />
                    )}
                  </>
                ) : (
                  <ToolbarMenuItem
                    label="Group objects"
                    icon={<Icon path={ICONS.group} size={15} />}
                    disabled={!groupAction.group.enabled}
                    hint={groupAction.group.reason}
                    onSelect={act(onGroup)}
                  />
                )}
              </ToolbarMenuSection>
            )}
          </div>
        );
      }}
      </ToolbarPopover>
    </ToolbarItem>
  );
}

/* ---------------------------------------------------------------- shell ---- */

function useAvailableWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  const measure = useCallback(() => {
    const node = ref.current;
    if (node) setWidth(node.getBoundingClientRect().width);
  }, [ref]);

  // Measured before paint so the first frame already uses the right density,
  // and re-measured after every render with no dependency guard. Setting the
  // same width is a no-op in React, so this cannot loop — but it does make the
  // toolbar self-correcting when the workspace changes without a window resize
  // or a ResizeObserver callback (a panel animating open, for instance).
  useLayoutEffect(() => {
    measure();
  });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // ResizeObserver — not a media query — because the workspace shrinks when
    // the inspector or the layers panel changes width, with no viewport change
    // and no breakpoint crossed (spec §6).
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(node);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, ref]);

  return width;
}

export default function AdminContextToolbar(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const availableWidth = useAvailableWidth(hostRef);

  const selectedLayers = props.selectedLayers?.length ? props.selectedLayers : props.layer ? [props.layer] : [];
  const showTextControls = selectedLayers.length > 0 && selectedLayers.every((layer) => layer?.type === "text");

  const fontFamily = sharedTextStyleValue(selectedLayers, "fontFamily", TEXT_TOOLBAR_DEFAULTS.fontFamily as string);
  const fontSize = sharedTextStyleValue(selectedLayers, "fontSize", TEXT_TOOLBAR_DEFAULTS.fontSize as number);
  const fontWeight = sharedTextStyleValue(selectedLayers, "fontWeight", TEXT_TOOLBAR_DEFAULTS.fontWeight as string);
  const fontStyle = sharedTextStyleValue(selectedLayers, "fontStyle", TEXT_TOOLBAR_DEFAULTS.fontStyle as string);
  const color = sharedTextStyleValue(selectedLayers, "color", TEXT_TOOLBAR_DEFAULTS.color as string);
  const textAlign = sharedTextStyleValue(selectedLayers, "textAlign", TEXT_TOOLBAR_DEFAULTS.textAlign as string);
  const verticalAlign = sharedTextStyleValue(selectedLayers, "verticalAlign", TEXT_TOOLBAR_DEFAULTS.verticalAlign as string);
  const letterSpacing = sharedTextStyleValue(selectedLayers, "letterSpacing", TEXT_TOOLBAR_DEFAULTS.letterSpacing as number);
  const lineHeight = sharedTextStyleValue(selectedLayers, "lineHeight", TEXT_TOOLBAR_DEFAULTS.lineHeight as number);

  // The weight the renderer will actually use — the toolbar must never show a
  // weight the font cannot draw (spec §10).
  const effectiveWeight = nearestSupportedWeight(String(fontFamily.value), fontWeight.value);
  const weightOptions = useMemo(() => resolveWeightOptions(String(fontFamily.value)), [fontFamily.value]);
  const italic = fontStyle.value === "italic" && !fontStyle.mixed;
  const bold = isBoldWeight(effectiveWeight) && !fontWeight.mixed;

  const canVerticalAlign = selectedLayers.some((layer) => verticalAlignAffectsCanvas(layer?.textStyle, layer?.text));
  const isGroup = props.layer?.type === "group" && props.selectionCount === 1;
  // Group is offered whenever it could apply — several objects, or one group
  // to break apart. A blocked action still renders, disabled, with the reason
  // in its tooltip rather than vanishing (spec: Selection rules).
  const groupAction = props.groupAction;
  const showGrouping = Boolean(groupAction) && (props.selectionCount > 1 || isGroup);

  const plan: ToolbarPlan = useMemo(
    () =>
      planTextToolbar({
        // Before the first measurement, assume a roomy workspace so the toolbar
        // does not visibly collapse and re-expand on mount.
        availableWidth: availableWidth || 1120,
        showTextControls,
        selectionCount: props.selectionCount,
        editing: Boolean(props.editingText),
        canVerticalAlign,
        showGrouping,
      }),
    [availableWidth, showTextControls, props.selectionCount, props.editingText, canVerticalAlign, showGrouping],
  );

  const shows = (id: ToolbarControlId) => plan.inline.includes(id);
  const density = plan.density;
  const swatches = props.approvedColors?.length ? props.approvedColors.slice(0, 16) : FALLBACK_SWATCHES;

  const patch = props.onStylePatch;
  const preview = props.onStylePreview || props.onStylePatch;
  const cancel = props.onStyleCancel || (() => {});

  // Every control renders at exactly the width the planner budgeted, so the
  // painted row can never be wider than the workspace it was planned for.
  const size = (id: ToolbarControlId) => controlWidth(id, density);
  const caption = plan.showFieldLabels;
  const dropdownTrigger = (extra = "px-2") =>
    `${CONTROL_BASE} w-full ${CONTROL_HEIGHT_CLASS[density]} ${extra} justify-between gap-1 text-left ${CONTROL_IDLE}`;

  const fontGroup: React.ReactNode[] = [];
  if (showTextControls) {
    if (shows("editing")) {
      fontGroup.push(
        <ToolbarItem key="editing" width={size("editing")} density={density} showCaption={caption}>
          <span
            style={{ height: CONTROL_HEIGHT[density] }}
            className={`${CONTROL_BASE} w-full gap-1.5 border-[#303839] bg-[#303839] text-white ${caption ? "px-2" : ""}`}
            title="Inline text editing is active"
          >
            <Icon path={ICONS.pencil} size={iconSize(density)} strokeWidth={2} />
            {caption && <span className="text-[10px] font-extrabold uppercase tracking-[0.1em]">Editing</span>}
          </span>
        </ToolbarItem>,
      );
    }
    if (shows("fontFamily")) {
      fontGroup.push(
        <ToolbarItem key="fontFamily" width={size("fontFamily")} density={density} showCaption={caption} caption="Font">
          <ToolbarDropdown
            label="Font"
            value={String(fontFamily.value)}
            mixed={fontFamily.mixed}
            onChange={(next: string) => patch({ fontFamily: next })}
            options={FONT_OPTIONS}
            previewFont
            searchable={FONT_OPTIONS.length > 6}
            menuWidth={264}
            className="w-full"
            hideLabel
            triggerClassName={dropdownTrigger()}
          />
        </ToolbarItem>,
      );
    }
    if (shows("fontSize")) {
      fontGroup.push(
        <ToolbarNumberField
          key="fontSize"
          label="Font size"
          caption="Size"
          value={Number(fontSize.value)}
          mixed={fontSize.mixed}
          rules={FONT_SIZE_RULES}
          density={density}
          showCaption={caption}
          width={size("fontSize")}
          onPreview={(next) => preview({ fontSize: next })}
          onCommit={(next) => patch({ fontSize: next })}
          onCancel={cancel}
        />,
      );
    }
    if (shows("fontWeight")) {
      fontGroup.push(
        <ToolbarItem key="fontWeight" width={size("fontWeight")} density={density} showCaption={caption} caption="Weight">
          <ToolbarDropdown
            label="Weight"
            value={effectiveWeight}
            mixed={fontWeight.mixed}
            onChange={(next: string) => patch({ fontWeight: next })}
            options={weightOptions.map((option) => ({
              value: option.value,
              label: option.label,
              disabled: option.disabled,
              note: "no cut",
            }))}
            searchable={false}
            menuWidth={214}
            className="w-full"
            hideLabel
            triggerClassName={dropdownTrigger()}
          />
        </ToolbarItem>,
      );
    }
    if (shows("textColor")) {
      fontGroup.push(
        <TextColorControl
          key="textColor"
          value={String(color.value)}
          mixed={color.mixed}
          density={density}
          width={size("textColor")}
          showCaption={caption}
          swatches={swatches}
          onPreview={(next) => preview({ color: next })}
          onCommit={(next) => patch({ color: next })}
        />,
      );
    }
    if (shows("bold")) {
      fontGroup.push(
        <ToolbarIconButton
          key="bold"
          label="Bold"
          hint={`Bold (${boldWeightForFont(String(fontFamily.value))})`}
          density={density}
          width={size("bold")}
          showCaption={caption}
          active={bold}
          mixed={fontWeight.mixed}
          onClick={() =>
            patch({
              fontWeight: bold
                ? regularWeightForFont(String(fontFamily.value))
                : boldWeightForFont(String(fontFamily.value)),
            })
          }
        >
          <span className="text-[14px] font-black leading-none">B</span>
        </ToolbarIconButton>,
      );
    }
    if (shows("italic")) {
      fontGroup.push(
        <ToolbarIconButton
          key="italic"
          label="Italic"
          hint="Italic"
          density={density}
          width={size("italic")}
          showCaption={caption}
          active={italic}
          mixed={fontStyle.mixed}
          onClick={() => patch({ fontStyle: italic ? "normal" : "italic" })}
        >
          <span className="font-serif text-[15px] italic leading-none">I</span>
        </ToolbarIconButton>,
      );
    }
  }

  const paragraphGroup: React.ReactNode[] = [];
  if (showTextControls) {
    if (shows("textAlign")) {
      paragraphGroup.push(
        <HorizontalAlignControl
          key="textAlign"
          value={String(textAlign.value)}
          mixed={textAlign.mixed}
          mode={plan.alignmentMode}
          density={density}
          width={size("textAlign")}
          showCaption={caption}
          onChange={(next) => patch({ textAlign: next })}
        />,
      );
    }
    if (shows("verticalAlign")) {
      paragraphGroup.push(
        <VerticalAlignControl
          key="verticalAlign"
          value={String(verticalAlign.value)}
          mixed={verticalAlign.mixed}
          enabled={canVerticalAlign}
          reason="the text box grows with its text, so there is no space to align inside"
          density={density}
          width={size("verticalAlign")}
          showCaption={caption}
          onChange={(next) => patch({ verticalAlign: next })}
        />,
      );
    }
    if (shows("letterSpacing")) {
      paragraphGroup.push(
        <ToolbarNumberField
          key="letterSpacing"
          label="Letter spacing"
          caption="Spacing"
          value={Number(letterSpacing.value)}
          mixed={letterSpacing.mixed}
          rules={LETTER_SPACING_RULES}
          density={density}
          showCaption={caption}
          width={size("letterSpacing")}
          onPreview={(next) => preview({ letterSpacing: next })}
          onCommit={(next) => patch({ letterSpacing: next })}
          onCancel={cancel}
          onReset={() => patch({ letterSpacing: 0 })}
          resetLabel="Reset letter spacing to 0"
        />,
      );
    }
    if (shows("lineHeight")) {
      paragraphGroup.push(
        <ToolbarNumberField
          key="lineHeight"
          label="Line height"
          caption="Line"
          value={Number(lineHeight.value)}
          mixed={lineHeight.mixed}
          rules={LINE_HEIGHT_RULES}
          density={density}
          showCaption={caption}
          width={size("lineHeight")}
          onPreview={(next) => preview({ lineHeight: next })}
          onCommit={(next) => patch({ lineHeight: next })}
          onCancel={cancel}
          onReset={() => patch({ lineHeight: TEXT_TOOLBAR_DEFAULTS.lineHeight })}
          resetLabel={`Reset line height to ${TEXT_TOOLBAR_DEFAULTS.lineHeight}`}
        />,
      );
    }
  }

  const objectGroup: React.ReactNode[] = [];
  if (shows("grouping") && groupAction) {
    // One object selected and it is a group -> Ungroup. Otherwise -> Group.
    const ungroupMode = isGroup;
    const state = ungroupMode ? groupAction.ungroup : groupAction.group;
    objectGroup.push(
      <ToolbarItem key="grouping" width={size("grouping")} density={density} showCaption={caption}>
        <button
          type="button"
          aria-label={ungroupMode ? "Ungroup" : "Group"}
          aria-disabled={!state.enabled}
          title={state.reason}
          disabled={!state.enabled}
          onClick={ungroupMode ? props.onUngroup : props.onGroup}
          style={{ height: CONTROL_HEIGHT[density] }}
          className={`${CONTROL_BASE} w-full ${plan.showFieldLabels ? "gap-1.5 px-2" : ""} ${controlState({ disabled: !state.enabled })}`}
        >
          <Icon path={ungroupMode ? ICONS.ungroup : ICONS.group} size={iconSize(density)} />
          {plan.showFieldLabels && <span>{ungroupMode ? "Ungroup" : "Group"}</span>}
        </button>
      </ToolbarItem>,
    );
  }
  if (shows("layout")) {
    objectGroup.push(
      <LayoutMenu
        key="layout"
        density={density}
        showLabel={plan.showFieldLabels}
        width={size("layout")}
        showCaption={caption}
        selectionCount={props.selectionCount}
        canTransformSelection={props.canTransformSelection !== false}
        isGroup={isGroup}
        groupAction={groupAction}
        onEnterGroup={props.onEnterGroup}
        onAlign={props.onAlign}
        onDistribute={props.onDistribute}
        onMatchSize={props.onMatchSize}
        onGroup={props.onGroup}
        onUngroup={props.onUngroup}
        onLayerOrder={props.onLayerOrder}
      />,
    );
  }
  if (plan.showMore) {
    objectGroup.push(
      <ToolbarItem key="more" width={size("delete")} density={density} showCaption={caption}>
      <ToolbarPopover
        label="More text options"
        triggerTitle="More text options"
        menuWidth={248}
        align="end"
        triggerClassName={`${CONTROL_BASE} w-full ${CONTROL_HEIGHT_CLASS[density]} ${CONTROL_IDLE}`}
        triggerActiveClassName={`${CONTROL_BASE} w-full ${CONTROL_HEIGHT_CLASS[density]} ${CONTROL_ACTIVE}`}
        trigger={<Icon path={ICONS.more} size={18} strokeWidth={2.6} />}
      >
        {(close) => {
          const act = (run: () => void) => () => {
            run();
            close();
          };
          return (
            <div className="grid">
              {plan.overflow.includes("fontWeight") && (
                <ToolbarMenuSection title="Font weight">
                  {weightOptions.map((option) => (
                    <ToolbarMenuItem
                      key={option.value}
                      label={option.label}
                      disabled={option.disabled}
                      hint={option.disabled ? `${String(fontFamily.value)} has no ${option.label} cut` : `Use ${option.label}`}
                      active={!fontWeight.mixed && option.value === effectiveWeight}
                      onSelect={act(() => patch({ fontWeight: option.value }))}
                    />
                  ))}
                </ToolbarMenuSection>
              )}
              {plan.overflow.includes("verticalAlign") && (
                <ToolbarMenuSection title="Vertical text alignment">
                  {VERTICAL_ALIGN.map((option) => (
                    <ToolbarMenuItem
                      key={option.value}
                      label={option.label}
                      icon={<Icon path={option.path} size={15} />}
                      disabled={!canVerticalAlign}
                      hint={canVerticalAlign ? option.label : "The text box grows with its text, so there is no space to align inside"}
                      active={!verticalAlign.mixed && option.value === verticalAlign.value}
                      onSelect={act(() => patch({ verticalAlign: option.value }))}
                    />
                  ))}
                </ToolbarMenuSection>
              )}
              {showTextControls && (
                <ToolbarMenuSection title="Reset">
                  <ToolbarMenuItem label="Reset letter spacing" hint="Set letter spacing back to 0" onSelect={act(() => patch({ letterSpacing: 0 }))} />
                  <ToolbarMenuItem label="Reset line height" hint={`Set line height back to ${TEXT_TOOLBAR_DEFAULTS.lineHeight}`} onSelect={act(() => patch({ lineHeight: TEXT_TOOLBAR_DEFAULTS.lineHeight }))} />
                </ToolbarMenuSection>
              )}
              {(plan.overflow.includes("duplicate") || (plan.overflow.includes("grouping") && groupAction)) && (
                <ToolbarMenuSection title="Object">
                  {plan.overflow.includes("grouping") && groupAction && (
                    isGroup ? (
                      <ToolbarMenuItem label="Ungroup" icon={<Icon path={ICONS.ungroup} size={15} />} disabled={!groupAction.ungroup.enabled} hint={groupAction.ungroup.reason} onSelect={act(props.onUngroup)} />
                    ) : (
                      <ToolbarMenuItem label="Group objects" icon={<Icon path={ICONS.group} size={15} />} disabled={!groupAction.group.enabled} hint={groupAction.group.reason} onSelect={act(props.onGroup)} />
                    )
                  )}
                  {plan.overflow.includes("duplicate") && (
                    <ToolbarMenuItem label="Duplicate" icon={<Icon path={ICONS.duplicate} size={15} />} hint="Duplicate the selection" onSelect={act(props.onDuplicate)} />
                  )}
                </ToolbarMenuSection>
              )}
            </div>
          );
        }}
      </ToolbarPopover>
      </ToolbarItem>,
    );
  }
  if (shows("duplicate")) {
    objectGroup.push(
      <ToolbarIconButton
        key="duplicate"
        label="Duplicate"
        hint={props.selectionCount === 1 ? "Duplicate the selected object" : `Duplicate ${props.selectionCount} selected objects`}
        path={ICONS.duplicate}
        density={density}
        width={size("duplicate")}
        showCaption={caption}
        onClick={props.onDuplicate}
      />,
    );
  }

  const deleteLabel =
    props.selectionCount === 1 ? "Delete the selected object" : `Delete ${props.selectionCount} selected objects`;
  objectGroup.push(
    <ToolbarIconButton
      key="delete"
      label={deleteLabel}
      hint={deleteLabel}
      path={ICONS.trash}
      density={density}
      width={size("delete")}
      showCaption={caption}
      danger
      onClick={props.onDelete}
    />,
  );

  // Three groups — font, paragraph, object — with one thin divider between
  // them. No other dividers: the shared control shell already separates the
  // individual controls (spec §26).
  const groups = [fontGroup, paragraphGroup, objectGroup].filter((group) => group.length > 0);

  return (
    <div ref={hostRef} className="pointer-events-none flex w-full justify-center">
      <div
        data-customizer-text-interaction
        data-admin-text-toolbar
        data-toolbar-density={density}
        data-toolbar-rows={plan.rows}
        role="toolbar"
        aria-label="Selection formatting and layout"
        style={{ gap: CONTROL_GAP, padding: 6 }}
        className={`pointer-events-auto flex max-w-full items-center rounded-xl border border-[#303839]/12 bg-white shadow-[0_6px_20px_rgba(48,56,57,0.10)] ${
          plan.rows === 2 ? "flex-wrap justify-center" : ""
        }`}
      >
        {groups.map((group, index) => (
          <div key={index} className="flex items-center" style={{ gap: CONTROL_GAP }}>
            {index > 0 && <span className="mr-1 flex items-center"><Divider density={density} /></span>}
            {group}
          </div>
        ))}

        {props.selectionCount > 1 && (
          <span className="ml-1 shrink-0 rounded-full bg-[#F4ECEC] px-2 py-1 text-[10px] font-bold text-[#303839]/70">
            {props.selectionCount} selected
          </span>
        )}
      </div>
    </div>
  );
}
