// The Husnalogy customizer's visual language, in one place (spec §7, §8).
//
// The customizer UI grew across many components, and the audit that produced
// this module found the surface had drifted in three measurable ways:
//
//   * FOUR competing interactive control heights (h-11, h-10, h-12, h-9),
//     colliding inside a single toolbar row — `CustomerImageToolbar` drew 44px
//     icon buttons beside 48px numeric steppers, so the row did not line up.
//   * EIGHT competing border radii across the same surfaces.
//   * Five interactive components with no focus-visible treatment at all, so
//     keyboard users had nothing to follow.
//
// These are not style opinions, they are inconsistencies — §7 asks for
// consistent control heights, radius and spacing, and clear hover/active/
// selected/disabled/focus states. Components import from here so the answer to
// "how tall is a control?" has exactly one source.
//
// Palette (spec §8): charcoal is the ink, soft rose the page behind the canvas,
// gold ONLY an accent for focus and selection — never a fill for large areas,
// never a glow, never a gradient.

export const HUSNALOGY_COLORS = {
  /** Primary ink and solid button fill. */
  charcoal: "#303839",
  /** Soft background behind the workspace. */
  soft: "#F4ECEC",
  /** Accent only: focus rings, selection outlines, active markers. */
  gold: "#D4AF37",
  /** Application surfaces are white and used generously. */
  surface: "#ffffff",
} as const;

/**
 * Canonical interactive control height, in Tailwind units and pixels.
 *
 * 44px is both the dominant existing value and the WCAG 2.5.8 minimum target
 * size, so standardising on it improves consistency and accessibility at once.
 */
export const CONTROL_HEIGHT_CLASS = "h-11";
export const CONTROL_MIN_HEIGHT_CLASS = "min-h-11";
export const CONTROL_HEIGHT_PX = 44;

/** Radius scale. Controls share one radius; only pills and chips differ. */
export const RADIUS = {
  /** Buttons, inputs, steppers, menu items. */
  control: "rounded-lg",
  /** Cards, panels, popovers. */
  surface: "rounded-xl",
  /** Pills: toolbar shells and chips. */
  pill: "rounded-full",
} as const;

/**
 * One focus treatment everywhere. `focus-visible` (not `focus`) so a pointer
 * click never paints a ring, while keyboard traversal always does.
 */
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]";

/** Focus treatment for a control sitting on a dark/charcoal surface. */
export const FOCUS_RING_ON_DARK =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] focus-visible:ring-offset-1 focus-visible:ring-offset-[#303839]";

/** Destructive controls keep their own ring so the meaning is not colour-only. */
export const FOCUS_RING_DANGER =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400";

/**
 * Restrained elevation (§8: "restrained shadows only when they communicate
 * depth or layering"). Three steps, no glow, no coloured shadow.
 */
export const SHADOW = {
  /** Resting card / panel. */
  resting: "shadow-[0_4px_20px_rgba(48,56,57,0.05)]",
  /** Floating toolbar above the canvas. */
  floating: "shadow-[0_6px_24px_rgba(48,56,57,0.14)]",
  /** Menus and popovers, the topmost layer. */
  overlay: "shadow-[0_18px_50px_rgba(48,56,57,0.18)]",
} as const;

/**
 * The complete class list for a standard toolbar control: matching height,
 * radius, focus ring and disabled treatment. Used so buttons, selects and
 * numeric fields in one toolbar share a visual rhythm (spec §15).
 */
export const TOOLBAR_CONTROL = [
  CONTROL_HEIGHT_CLASS,
  RADIUS.control,
  "shrink-0",
  "bg-white",
  "text-xs",
  "font-bold",
  "text-[#303839]",
  "transition-colors",
  "hover:bg-[#303839]/5",
  FOCUS_RING,
  "disabled:cursor-not-allowed",
  "disabled:opacity-35",
].join(" ");

/** Square icon-only toolbar button, same height as every other control. */
export const TOOLBAR_ICON_BUTTON = [
  CONTROL_HEIGHT_CLASS,
  "w-11",
  RADIUS.control,
  "grid",
  "shrink-0",
  "place-items-center",
  "transition-colors",
  FOCUS_RING,
].join(" ");

/**
 * Every interactive height used in the customizer, so a lint-style test can
 * assert nothing new drifts in.
 */
export const ALLOWED_CONTROL_HEIGHTS = [CONTROL_HEIGHT_CLASS, CONTROL_MIN_HEIGHT_CLASS] as const;
