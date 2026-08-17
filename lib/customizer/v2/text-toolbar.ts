// Contextual text toolbar logic (admin design builder).
//
// Everything the selected-text toolbar needs to decide *what* to show and
// *which value is current* lives here as pure functions so it can be unit
// tested in node — the toolbar component itself only renders the result.
//
// Units are the canonical document units and must never be converted:
//   fontSize      px
//   letterSpacing px   (canvas, preview, SVG/PNG and PDF all read px)
//   lineHeight    unitless multiplier of fontSize

import { getFontByFamily } from "./fonts";

/* ---------------------------------------------------------------- values -- */

/** Canonical fallbacks. These MUST match the renderer fallbacks so the toolbar
 *  never shows a value the canvas is not actually drawing. */
import { DEFAULT_LETTER_SPACING, DEFAULT_LINE_HEIGHT } from "./text-layout";

export const TEXT_TOOLBAR_DEFAULTS = {
  fontFamily: "Cormorant Garamond",
  fontSize: 48,
  fontWeight: "400",
  fontStyle: "normal",
  color: "#303839",
  textAlign: "center",
  verticalAlign: "middle",
  letterSpacing: DEFAULT_LETTER_SPACING,
  lineHeight: DEFAULT_LINE_HEIGHT,
} as const;

export const FONT_SIZE_RULES = { minimum: 4, maximum: 500, step: 1, largeStep: 10 } as const;

/**
 * Font-size bounds for ONE layer (spec §15).
 *
 * A layer may narrow the range with its own `minFontSize` / `maxFontSize`, and
 * the save validator clamps to exactly this window before raising
 * `font-size-out-of-range`. The customer toolbar used to hardcode 10–400
 * instead, which was wrong at both ends: it refused sizes the template allowed
 * (above 400) and offered sizes the server would clamp away (below a layer's
 * own minimum, or under 10 where the template permitted 4).
 */
export function resolveFontSizeBounds(
  style: Record<string, unknown> | null | undefined,
): { minimum: number; maximum: number } {
  const minimum = Math.max(FONT_SIZE_RULES.minimum, Number(style?.minFontSize) || FONT_SIZE_RULES.minimum);
  const maximum = Math.max(minimum, Number(style?.maxFontSize) || FONT_SIZE_RULES.maximum);
  return { minimum, maximum };
}
export const LETTER_SPACING_RULES = { minimum: -20, maximum: 100, step: 0.1, largeStep: 1 } as const;
export const LINE_HEIGHT_RULES = { minimum: 0.5, maximum: 4, step: 0.05, largeStep: 0.25 } as const;

export type SharedValue<T> = { value: T; mixed: boolean };

type StyleBearer = { textStyle?: Record<string, unknown> | null } | null | undefined;

/**
 * Resolve one style property across the selection.
 *
 * Uses a nullish check, never a truthy fallback: a stored letterSpacing of 0
 * is a real value and must survive as 0. Numeric fallbacks only apply when the
 * stored value is absent or not finite.
 */
export function sharedTextStyleValue<T>(
  layers: StyleBearer[],
  key: string,
  fallback: T,
): SharedValue<T> {
  const values = (layers || []).map((layer) => {
    const raw = layer?.textStyle?.[key];
    if (raw === undefined || raw === null || raw === "") return fallback;
    if (typeof fallback === "number") {
      const parsed = Number(raw);
      return (Number.isFinite(parsed) ? parsed : fallback) as unknown as T;
    }
    return raw as unknown as T;
  });
  if (!values.length) return { value: fallback, mixed: false };
  return { value: values[0], mixed: values.some((value) => value !== values[0]) };
}

/* --------------------------------------------------------------- weights -- */

export type WeightOption = { value: string; label: string; disabled: boolean };

const WEIGHT_LABELS: Array<{ value: string; label: string }> = [
  { value: "300", label: "Light" },
  { value: "400", label: "Regular" },
  { value: "500", label: "Medium" },
  { value: "600", label: "Semibold" },
  { value: "700", label: "Bold" },
];

function supportedWeights(fontFamily: string | undefined): string[] {
  const font = getFontByFamily(fontFamily || TEXT_TOOLBAR_DEFAULTS.fontFamily);
  const weights = font?.supportedWeights?.length ? font.supportedWeights : ["400", "700"];
  return [...weights];
}

/** Weight choices for a font. Unsupported weights stay visible but disabled so
 *  the admin can see the font simply has no such cut (spec §10). */
export function resolveWeightOptions(fontFamily: string | undefined): WeightOption[] {
  const supported = new Set(supportedWeights(fontFamily));
  return WEIGHT_LABELS.map((entry) => ({ ...entry, disabled: !supported.has(entry.value) }));
}

/** Nearest weight the font can actually render — this is what the renderer
 *  resolves to, so the toolbar must show the same thing. */
export function nearestSupportedWeight(fontFamily: string | undefined, weight: unknown): string {
  const supported = supportedWeights(fontFamily);
  const requested = Number(weight) || 400;
  if (supported.includes(String(requested))) return String(requested);
  return supported
    .slice()
    .sort((a, b) => Math.abs(Number(a) - requested) - Math.abs(Number(b) - requested) || Number(a) - Number(b))[0]
    || "400";
}

/** The weight the Bold button applies for this font (700 where available). */
export function boldWeightForFont(fontFamily: string | undefined): string {
  const supported = supportedWeights(fontFamily).map(Number).sort((a, b) => a - b);
  const bold = supported.filter((weight) => weight >= 700)[0];
  return String(bold ?? supported[supported.length - 1] ?? 700);
}

/** The weight the Bold button returns to when toggled off. */
export function regularWeightForFont(fontFamily: string | undefined): string {
  const supported = supportedWeights(fontFamily).map(Number).sort((a, b) => a - b);
  const regular = supported.filter((weight) => weight <= 400).pop();
  return String(regular ?? supported[0] ?? 400);
}

export function isBoldWeight(weight: unknown): boolean {
  return (Number(weight) || 400) >= 600;
}

/* ------------------------------------------------------------- alignment -- */

const CANONICAL_TEXT = (value: unknown) => String(value ?? "").replace(/\r\n?/g, "\n");

/**
 * A single-line, fixed-fit text box hugs its glyphs (the builder re-measures
 * the width on every edit), so horizontal alignment inside that box cannot
 * move anything. Callers use this to explain the no-op rather than pretend.
 */
export function horizontalAlignAffectsCanvas(
  style: Record<string, unknown> | null | undefined,
  text?: unknown,
): boolean {
  const multiline = Boolean(style?.multiline);
  const fitMode = String(style?.fitMode || "fixed");
  return multiline || CANONICAL_TEXT(text).includes("\n") || fitMode !== "fixed";
}

/**
 * Vertical alignment only means something when the box is taller than the text.
 * Auto-height and auto-width single-line boxes are exactly as tall as their
 * lines, so the control is disabled with an explanation (spec §14).
 */
export function verticalAlignAffectsCanvas(
  style: Record<string, unknown> | null | undefined,
  text?: unknown,
): boolean {
  const fitMode = String(style?.fitMode || "fixed");
  if (fitMode === "auto-height") return false;
  const multiline = Boolean(style?.multiline);
  const hasBreak = CANONICAL_TEXT(text).includes("\n");
  // Single line + fixed fit = auto-width box that also hugs its height.
  if (!multiline && !hasBreak && fitMode === "fixed") return false;
  return true;
}

/* ------------------------------------------------------- layout actions --- */

export type LayoutActionId =
  | "alignLeft" | "alignCenter" | "alignRight"
  | "alignTop" | "alignMiddle" | "alignBottom"
  | "centerOnCardHorizontal" | "centerOnCardVertical" | "centerOnCard"
  | "distributeHorizontal" | "distributeVertical"
  | "spacingHorizontal" | "spacingVertical"
  | "matchWidth" | "matchHeight" | "matchSize"
  | "bringToFront" | "bringForward" | "sendBackward" | "sendToBack"
  | "group" | "ungroup";

export type LayoutAvailability = { enabled: boolean; reason: string };

/**
 * Which layout actions are genuinely usable for this selection.
 *
 * The previous toolbar greyed out every alignment icon whenever fewer than two
 * objects were selected, which hid working behaviour: one object aligns to the
 * card. Only actions that truly need several objects are disabled here.
 */
export function layoutActionAvailability(input: {
  selectionCount: number;
  canTransform: boolean;
  isGroup?: boolean;
}): Record<LayoutActionId, LayoutAvailability> {
  const { selectionCount, canTransform, isGroup = false } = input;
  const empty: LayoutAvailability = { enabled: false, reason: "Select an object." };
  const locked: LayoutAvailability = { enabled: false, reason: "The selection is locked." };
  const needTwo: LayoutAvailability = { enabled: false, reason: "Select at least two objects." };
  const needThree: LayoutAvailability = { enabled: false, reason: "Select at least three objects." };
  const ok = (reason: string): LayoutAvailability => ({ enabled: true, reason });

  const gate = (allowed: boolean, blocked: LayoutAvailability, reason: string): LayoutAvailability => {
    if (selectionCount < 1) return empty;
    if (!canTransform) return locked;
    return allowed ? ok(reason) : blocked;
  };

  const alignTarget = selectionCount >= 2 ? "the selection" : "the card";
  const align = (edge: string) => gate(true, needTwo, `Align ${edge} to ${alignTarget}`);
  const distribute = gate(selectionCount >= 3, needThree, "Space objects evenly");
  const match = (what: string) => gate(selectionCount >= 2, needTwo, `Match ${what} of every selected object`);
  const order = gate(true, needTwo, "Change stacking order");

  return {
    alignLeft: align("left edges"),
    alignCenter: align("horizontal centres"),
    alignRight: align("right edges"),
    alignTop: align("top edges"),
    alignMiddle: align("vertical centres"),
    alignBottom: align("bottom edges"),
    centerOnCardHorizontal: gate(true, needTwo, "Centre horizontally on the card"),
    centerOnCardVertical: gate(true, needTwo, "Centre vertically on the card"),
    centerOnCard: gate(true, needTwo, "Centre on the card"),
    distributeHorizontal: distribute,
    distributeVertical: distribute,
    spacingHorizontal: distribute,
    spacingVertical: distribute,
    matchWidth: match("the width"),
    matchHeight: match("the height"),
    matchSize: match("the size"),
    bringToFront: order,
    bringForward: order,
    sendBackward: order,
    sendToBack: order,
    group: gate(selectionCount >= 2, needTwo, "Group the selected objects"),
    ungroup: gate(isGroup && selectionCount === 1, { enabled: false, reason: "Select one group." }, "Ungroup"),
  };
}

/* ----------------------------------------------------- responsive layout -- */

export type ToolbarControlId =
  | "editing"
  | "fontFamily"
  | "fontSize"
  | "fontWeight"
  | "textColor"
  | "bold"
  | "italic"
  | "textAlign"
  | "verticalAlign"
  | "letterSpacing"
  | "lineHeight"
  | "grouping"
  | "layout"
  | "duplicate"
  | "delete";

export type ToolbarDensity = "comfortable" | "condensed" | "icon";

/**
 * One shared control height per density. Every trigger, stepper, segment and
 * icon button renders at exactly this height so the row reads as one component
 * system rather than a collection of boxes (spec §26).
 */
export const CONTROL_HEIGHT: Record<ToolbarDensity, number> = { comfortable: 36, condensed: 34, icon: 32 };

/** Height of the small uppercase caption row. Reserved for every control at
 *  comfortable density — including the ones with no caption — so SIZE,
 *  SPACING and LINE always sit on the same line. */
export const CAPTION_HEIGHT = 12;

/** Width of one stepper arrow button. */
export const STEPPER_BUTTON_WIDTH: Record<ToolbarDensity, number> = { comfortable: 28, condensed: 24, icon: 22 };

/**
 * Width of the editable number between the two arrows. Sized so the longest
 * real value stays fully visible and centred: "120" for size, "-1.5" and
 * "1.15" for the decimal fields. Never narrow enough to clip a digit.
 */
export const STEPPER_VALUE_WIDTH: Record<"fontSize" | "decimal", Record<ToolbarDensity, number>> = {
  fontSize: { comfortable: 56, condensed: 48, icon: 40 },
  decimal: { comfortable: 60, condensed: 52, icon: 44 },
};

function stepperWidth(kind: "fontSize" | "decimal", density: ToolbarDensity): number {
  return STEPPER_BUTTON_WIDTH[density] * 2 + STEPPER_VALUE_WIDTH[kind][density];
}

/**
 * Conservative advance widths for the toolbar's 12.5px bold tabular-numeric
 * face, rounded up from the measured values. Tabular figures mean every digit
 * shares one advance, so a value's width is a pure function of its characters
 * and the value column can be sized exactly rather than guessed.
 */
const NUMERIC_GLYPH_WIDTH = { digit: 8.5, dot: 5, minus: 5.5 } as const;

export function numericLabelWidth(text: string): number {
  return Array.from(String(text)).reduce((total, character) => {
    if (character === ".") return total + NUMERIC_GLYPH_WIDTH.dot;
    if (character === "-" || character === "−") return total + NUMERIC_GLYPH_WIDTH.minus;
    return total + NUMERIC_GLYPH_WIDTH.digit;
  }, 0);
}

/** True when a value renders completely inside its column — no clipped digit,
 *  no digit hidden under a stepper arrow. */
export function numericValueFits(
  text: string,
  kind: "fontSize" | "decimal",
  density: ToolbarDensity,
): boolean {
  return numericLabelWidth(text) <= STEPPER_VALUE_WIDTH[kind][density];
}

/**
 * Rendered width of each control at each density.
 *
 * These are not estimates: AdminContextToolbar sizes every control from this
 * table, so the planned row width and the painted row width are the same
 * number. That is what makes "the toolbar never overflows its workspace" a
 * property the tests can actually check.
 */
export const CONTROL_WIDTH: Record<ToolbarControlId, Record<ToolbarDensity, number>> = {
  editing: { comfortable: 92, condensed: 36, icon: 32 },
  // Comfortable fits "Cormorant Garamond" in full.
  fontFamily: { comfortable: 172, condensed: 124, icon: 96 },
  fontSize: {
    comfortable: stepperWidth("fontSize", "comfortable"),
    condensed: stepperWidth("fontSize", "condensed"),
    icon: stepperWidth("fontSize", "icon"),
  },
  // Fits "Semibold" without truncation.
  fontWeight: { comfortable: 96, condensed: 84, icon: 76 },
  textColor: { comfortable: 36, condensed: 34, icon: 30 },
  bold: { comfortable: 36, condensed: 34, icon: 30 },
  italic: { comfortable: 36, condensed: 34, icon: 30 },
  // Three equal segments at comfortable/condensed, one dropdown at icon.
  textAlign: { comfortable: 112, condensed: 96, icon: 40 },
  verticalAlign: { comfortable: 40, condensed: 36, icon: 32 },
  letterSpacing: {
    comfortable: stepperWidth("decimal", "comfortable"),
    condensed: stepperWidth("decimal", "condensed"),
    icon: stepperWidth("decimal", "icon"),
  },
  lineHeight: {
    comfortable: stepperWidth("decimal", "comfortable"),
    condensed: stepperWidth("decimal", "condensed"),
    icon: stepperWidth("decimal", "icon"),
  },
  // Icon + "Group"/"Ungroup" label when there is room; icon only otherwise.
  grouping: { comfortable: 96, condensed: 40, icon: 34 },
  layout: { comfortable: 92, condensed: 40, icon: 34 },
  duplicate: { comfortable: 36, condensed: 34, icon: 30 },
  delete: { comfortable: 36, condensed: 34, icon: 30 },
};

export function controlWidth(id: ToolbarControlId, density: ToolbarDensity): number {
  return CONTROL_WIDTH[id][density];
}

const MORE_BUTTON_WIDTH: Record<ToolbarDensity, number> = { comfortable: 36, condensed: 34, icon: 30 };
/** Flex gap between controls. */
export const CONTROL_GAP = 4;
/** Container chrome: horizontal padding, border and the two group dividers. */
const TOOLBAR_CHROME = 36;

/**
 * Controls that must stay directly reachable, in the exact priority order of
 * spec §7. Delete is pinned separately — it never moves into More so it stays
 * one click away and visually separated from the formatting controls.
 */
export const REQUIRED_CONTROL_ORDER: ToolbarControlId[] = [
  "fontFamily",
  "fontSize",
  "textColor",
  "bold",
  "italic",
  "textAlign",
  "letterSpacing",
  "lineHeight",
  "layout",
];

/**
 * Everything that moves into More before any required control is touched,
 * least valuable last. Layer order, match size and distribution are
 * deliberately absent: they live permanently in the Layout menu (spec §19),
 * never as loose inline icons.
 *
 * Grouping ranks first: when a multiple selection makes Group meaningful it is
 * the action the user came for, so it survives every other optional control.
 */
const OPTIONAL_CONTROL_ORDER: ToolbarControlId[] = ["grouping", "fontWeight", "verticalAlign", "duplicate"];

export type ToolbarPlanInput = {
  /** Measured width of the workspace the toolbar may occupy, in CSS pixels. */
  availableWidth: number;
  /** Text controls only render for an all-text selection. */
  showTextControls: boolean;
  selectionCount: number;
  editing?: boolean;
  canVerticalAlign?: boolean;
  /** True whenever Group or Ungroup is meaningful for this selection, i.e.
   *  several objects are selected or the selection is a single group. */
  showGrouping?: boolean;
};

export type ToolbarPlan = {
  density: ToolbarDensity;
  rows: 1 | 2;
  inline: ToolbarControlId[];
  overflow: ToolbarControlId[];
  showMore: boolean;
  alignmentMode: "segmented" | "dropdown";
  showFieldLabels: boolean;
  /** Width the planned inline row needs; always <= availableWidth when rows===1. */
  estimatedWidth: number;
};

const DENSITY_ORDER: ToolbarDensity[] = ["comfortable", "condensed", "icon"];

function widthOf(controls: ToolbarControlId[], density: ToolbarDensity): number {
  return controls.reduce((total, id) => total + CONTROL_WIDTH[id][density] + CONTROL_GAP, 0);
}

/**
 * Decide the toolbar layout for the width actually available above the canvas.
 *
 * The toolbar never scrolls: anything that does not fit is moved into the
 * Layout or More menus, and only when even the required controls cannot fit at
 * the tightest density does it wrap to a second row.
 */
export function planTextToolbar(input: ToolbarPlanInput): ToolbarPlan {
  const available = Math.max(0, Number(input.availableWidth) || 0);
  const editing = Boolean(input.editing);
  const selectionCount = Math.max(0, Number(input.selectionCount) || 0);

  const required: ToolbarControlId[] = [];
  if (input.showTextControls) {
    if (editing) required.push("editing");
    required.push(...REQUIRED_CONTROL_ORDER);
  } else {
    required.push("layout");
  }
  required.push("delete");

  const optional = OPTIONAL_CONTROL_ORDER.filter((id) => {
    if (!input.showTextControls && (id === "fontWeight" || id === "verticalAlign")) return false;
    if (id === "verticalAlign") return Boolean(input.canVerticalAlign);
    if (id === "grouping") return Boolean(input.showGrouping);
    return true;
  });

  const budget = Math.max(0, available - TOOLBAR_CHROME);

  for (const density of DENSITY_ORDER) {
    // A zero width means the density has no room for that control at all, so
    // it goes straight to More without competing for inline space.
    const candidates = optional.filter((id) => CONTROL_WIDTH[id][density] > 0);
    const forcedOverflow = optional.filter((id) => CONTROL_WIDTH[id][density] <= 0);
    const requiredWidth = widthOf(required, density);
    const isLastDensity = density === DENSITY_ORDER[DENSITY_ORDER.length - 1];
    if (requiredWidth > budget && !isLastDensity) continue;

    // Pass 1 — everything fits, so no More button is needed at all.
    if (!forcedOverflow.length) {
      const total = requiredWidth + widthOf(candidates, density);
      if (total <= budget) {
        return plan(density, 1, [...required, ...candidates], [], total);
      }
    }

    // Pass 2 — a More button is required, so it is paid for up front and the
    // optional controls fill the remainder in strict priority order. The list
    // is a prefix: once one control does not fit, the rest follow it into More
    // so the visible set is always predictable.
    const moreWidth = MORE_BUTTON_WIDTH[density] + CONTROL_GAP;
    const inlineBudget = budget - moreWidth;
    const inline = [...required];
    const overflow: ToolbarControlId[] = [];
    let used = requiredWidth;
    let stopped = false;
    for (const id of candidates) {
      const width = CONTROL_WIDTH[id][density] + CONTROL_GAP;
      if (!stopped && used + width <= inlineBudget) {
        used += width;
        inline.push(id);
      } else {
        stopped = true;
        overflow.push(id);
      }
    }
    overflow.push(...forcedOverflow);

    const total = used + moreWidth;
    if (total <= budget) return plan(density, 1, inline, overflow, total);
    if (isLastDensity) return plan(density, 2, inline, overflow, total);
  }

  /* Unreachable: the final density always returns. Kept for exhaustiveness. */
  return plan("icon", 2, required, optional, widthOf(required, "icon"));

  function plan(
    density: ToolbarDensity,
    rows: 1 | 2,
    inlineControls: ToolbarControlId[],
    overflowControls: ToolbarControlId[],
    used: number,
  ): ToolbarPlan {
    return {
      density,
      rows,
      inline: sortForRender(inlineControls),
      overflow: sortForRender(overflowControls),
      showMore: overflowControls.length > 0,
      alignmentMode: density === "icon" ? "dropdown" : "segmented",
      showFieldLabels: density === "comfortable",
      estimatedWidth: used + TOOLBAR_CHROME,
    };
  }
}

/** Stable left-to-right render order, independent of the fitting order. */
const RENDER_ORDER: ToolbarControlId[] = [
  "editing",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "textColor",
  "bold",
  "italic",
  "textAlign",
  "verticalAlign",
  "letterSpacing",
  "lineHeight",
  "grouping",
  "layout",
  "duplicate",
  "delete",
];

function sortForRender(controls: ToolbarControlId[]): ToolbarControlId[] {
  const present = new Set(controls);
  return RENDER_ORDER.filter((id) => present.has(id));
}

/* ------------------------------------------------------------- popovers --- */

export type PopoverPlacementInput = {
  anchor: { left: number; right: number; top: number; bottom: number };
  menu: { width: number; height: number };
  viewport: { width: number; height: number };
  margin?: number;
  gap?: number;
  align?: "start" | "center" | "end";
};

export type PopoverPlacement = { left: number; top: number; maxHeight: number; placement: "below" | "above" };

/**
 * Clamp a portalled menu inside the viewport, flipping above the trigger when
 * there is more room there. Used by every toolbar popover so no menu can be
 * clipped by the canvas, the inspector, or the window edge (spec §20).
 */
export function planPopoverPlacement(input: PopoverPlacementInput): PopoverPlacement {
  const margin = input.margin ?? 12;
  const gap = input.gap ?? 8;
  const { anchor, menu, viewport } = input;
  const spaceBelow = viewport.height - anchor.bottom - gap - margin;
  const spaceAbove = anchor.top - gap - margin;
  const placement: "below" | "above" =
    menu.height <= spaceBelow || spaceBelow >= spaceAbove ? "below" : "above";

  const maxHeight = Math.max(160, Math.min(menu.height, placement === "below" ? spaceBelow : spaceAbove));
  const top = placement === "below" ? anchor.bottom + gap : Math.max(margin, anchor.top - gap - maxHeight);

  const anchorWidth = anchor.right - anchor.left;
  const preferredLeft =
    input.align === "center"
      ? anchor.left + anchorWidth / 2 - menu.width / 2
      : input.align === "end"
        ? anchor.right - menu.width
        : anchor.left;
  const maxLeft = Math.max(margin, viewport.width - menu.width - margin);
  const left = Math.min(Math.max(margin, preferredLeft), maxLeft);

  return { left, top, maxHeight, placement };
}
