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

import { DEFAULT_FONT_FAMILY, nearestWeight } from "./google-fonts";

/* ---------------------------------------------------------------- values -- */

/** Canonical fallbacks. These MUST match the renderer fallbacks so the toolbar
 *  never shows a value the canvas is not actually drawing. */
import { DEFAULT_LETTER_SPACING, DEFAULT_LINE_HEIGHT } from "./text-layout";

export const TEXT_TOOLBAR_DEFAULTS = {
  fontFamily: DEFAULT_FONT_FAMILY,
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

/** Human labels for the CSS weight scale. A family only ever offers the
 *  entries it genuinely has — these are labels, not an allowlist. */
const WEIGHT_LABELS: Record<string, string> = {
  "100": "Thin",
  "200": "Extra light",
  "300": "Light",
  "400": "Regular",
  "500": "Medium",
  "600": "Semibold",
  "700": "Bold",
  "800": "Extra bold",
  "900": "Black",
};

export function weightLabel(weight: string): string {
  return WEIGHT_LABELS[String(weight)] || String(weight);
}

/** Weights with no catalog information — used only before the catalog has
 *  loaded, and deliberately minimal so nothing unsupported is ever offered. */
const UNKNOWN_FAMILY_WEIGHTS = ["400", "700"];

function usableWeights(availableWeights: string[] | undefined): string[] {
  const weights = (availableWeights || []).filter(Boolean).map(String);
  return weights.length ? [...new Set(weights)].sort((a, b) => Number(a) - Number(b)) : [...UNKNOWN_FAMILY_WEIGHTS];
}

/**
 * Weight choices for a family, derived from the Google Fonts catalog rather
 * than a fixed list (spec §13). Only the weights the family actually ships
 * are offered, so the toolbar can never request a cut production lacks.
 */
export function resolveWeightOptions(availableWeights: string[] | undefined): WeightOption[] {
  return usableWeights(availableWeights).map((value) => ({
    value,
    label: weightLabel(value),
    disabled: false,
  }));
}

/** Nearest weight the family can actually render — this is what the renderer
 *  resolves to, so the toolbar must show the same thing. */
export function nearestSupportedWeight(availableWeights: string[] | undefined, weight: unknown): string {
  return nearestWeight(usableWeights(availableWeights), weight);
}

/** The weight the Bold button applies for this family (700 where available). */
export function boldWeightForFont(availableWeights: string[] | undefined): string {
  const supported = usableWeights(availableWeights).map(Number).sort((a, b) => a - b);
  const bold = supported.filter((weight) => weight >= 700)[0];
  return String(bold ?? supported[supported.length - 1] ?? 700);
}

/** The weight the Bold button returns to when toggled off. */
export function regularWeightForFont(availableWeights: string[] | undefined): string {
  const supported = usableWeights(availableWeights).map(Number).sort((a, b) => a - b);
  const regular = supported.filter((weight) => weight <= 400).pop();
  return String(regular ?? supported[0] ?? 400);
}

export function isBoldWeight(weight: unknown): boolean {
  return (Number(weight) || 400) >= 600;
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
