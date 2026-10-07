// Shared, renderer-agnostic text editing helpers.
//
// Canvas components own pointer events and the canonical document owners own
// persistence/history, but both Admin and Customer use these exact placement
// presets and newline rules.

import { newTextFontSize } from "./type-units";
import {
  DEFAULT_LETTER_SPACING,
  DEFAULT_LINE_HEIGHT,
  autoWidthPadding,
  getSingleLineTextBox,
  isAutoWidthText,
  isSafeWidthText,
  type MeasureFn,
} from "./text-layout";

export const TEXT_PLACEMENT_DRAG_THRESHOLD_PX = 4;

/**
 * "text" is the STANDARD new text: one line, auto width (its box hugs the
 * words), 17 pt, centred. The others are the Add Text panel's explicit styles.
 */
export type TextPlacementPreset = "text" | "heading" | "subheading" | "body";

export type TextPlacementStyle = {
  name: string;
  /** How the new object sizes itself (text-layout AUTO_SIZE_MODES). */
  autoSizeMode: "safe-width" | "width" | "height";
  fontSize: number;
  width: number;
  height: number;
  multiline: boolean;
  textAlign: "left" | "center";
  lineHeight: number;
  letterSpacing: number;
};

/* --------------------------------------------------- editor key handling -- */

// Keyboard contract while a customizer text editor has focus. Shared by the
// inline canvas editor (customer AND admin) and every customizer text panel so
// the behaviour cannot drift between surfaces.
//
//   Enter            allowed    -> a real line break; NEVER commits or closes
//                    disallowed -> stays open and reports the permission limit
//   Ctrl/Cmd + Enter            -> commit and close, exactly like Done, and the
//                                  caller must preventDefault so no extra line
//                                  break is inserted
//   Escape                      -> cancel out of editing
//
// IME composition is respected: committing while a candidate window is open
// would drop half-typed Bangla/Arabic/CJK input, so composing keystrokes are
// always "none".
export type TextEditorKeyLike = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
};

export type TextEditorKeyAction = "commit" | "newline" | "blocked-newline" | "cancel" | "none";

function isComposingEvent(event: TextEditorKeyLike): boolean {
  if (event?.isComposing || event?.nativeEvent?.isComposing) return true;
  // Safari/older Chrome report an in-progress composition as keyCode 229.
  return event?.keyCode === 229 || event?.nativeEvent?.keyCode === 229;
}

export function isCommitTextShortcut(event: TextEditorKeyLike): boolean {
  if (!event || event.key !== "Enter") return false;
  if (isComposingEvent(event)) return false;
  // Cmd on macOS, Ctrl everywhere else. Both are accepted on both platforms so
  // the shortcut is never unavailable.
  return Boolean(event.ctrlKey || event.metaKey);
}

export function resolveTextEditorKeyAction(
  event: TextEditorKeyLike,
  allowMultiline: boolean,
): TextEditorKeyAction {
  if (!event) return "none";
  if (isComposingEvent(event)) return "none";
  if (event.key === "Escape") return "cancel";
  if (event.key !== "Enter") return "none";
  if (event.ctrlKey || event.metaKey) return "commit";
  // Plain (or Shift/Alt) Enter always belongs to the text editor. A field that
  // forbids multiline blocks the break but deliberately stays open.
  return allowMultiline ? "newline" : "blocked-newline";
}

export type TextSelection = {
  start: number;
  end: number;
};

export type TextInsertion = {
  value: string;
  caret: number;
};

/** Insert a real newline without relying on a form/input default action. */
export function insertTextNewline(value: unknown, selection: TextSelection): TextInsertion {
  const text = normalizeCanonicalText(value);
  const start = Math.max(0, Math.min(text.length, Math.floor(Number(selection.start) || 0)));
  const end = Math.max(start, Math.min(text.length, Math.floor(Number(selection.end) || start)));
  return {
    value: `${text.slice(0, start)}\n${text.slice(end)}`,
    caret: start + 1,
  };
}

export function countTextLines(value: unknown): number {
  return normalizeCanonicalText(value).split("\n").length;
}

export type TextEditLimits = {
  maxLines?: number;
  maxLength?: number;
};

export type TextLimitResult = {
  value: string;
  limitedBy: "lines" | "characters" | null;
};

/**
 * Apply configured editing limits without trimming valid leading, internal, or
 * trailing newlines. This is shared by typing, paste, and Enter insertion.
 */
export function applyTextEditLimits(value: unknown, limits: TextEditLimits = {}): TextLimitResult {
  let next = normalizeCanonicalText(value);
  let limitedBy: TextLimitResult["limitedBy"] = null;
  const maxLines = Math.max(0, Math.floor(Number(limits.maxLines) || 0));
  const maxLength = Math.max(0, Math.floor(Number(limits.maxLength) || 0));

  if (maxLines > 0) {
    const lines = next.split("\n");
    if (lines.length > maxLines) {
      next = lines.slice(0, maxLines).join("\n");
      limitedBy = "lines";
    }
  }
  if (maxLength > 0 && next.length > maxLength) {
    next = next.slice(0, maxLength);
    limitedBy = "characters";
  }
  return { value: next, limitedBy };
}

export const TEXT_EDITOR_SAFE_SELECTOR = [
  "[data-customizer-text-editor]",
  "[data-customizer-text-interaction]",
  "[data-customer-toolbar-dock]",
].join(",");

type ClosestTarget = { closest?: (selector: string) => unknown };

/** True for the editor, its toolbars, and popovers explicitly owned by them. */
export function isTextEditorSafeTarget(target: unknown): boolean {
  return Boolean((target as ClosestTarget | null)?.closest?.(TEXT_EDITOR_SAFE_SELECTOR));
}

export function normalizeCanonicalText(value: unknown): string {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}

export function hasManualTextLineBreak(value: unknown): boolean {
  return normalizeCanonicalText(value).includes("\n");
}

/**
 * A manual line break promotes a text object in place. The full style object is
 * returned so callers can update the text and its mode in one document write
 * without losing any typography, permissions, field binding, or transform.
 */
export function promoteTextStyleForValue(
  style: Record<string, any> | null | undefined,
  value: unknown,
): Record<string, any> {
  const current = { ...(style || {}) };
  if (!hasManualTextLineBreak(value)) return current;
  return { ...current, ...multilineTextPatch(current) };
}

/**
 * What turning a text object multi-line changes. "safe-width" text keeps its
 * mode — its box already follows its widest line and wraps only at the safe
 * area — so a line break never freezes it at the width of the line typed
 * before it. Every other mode becomes an auto-height paragraph, as before.
 */
export function multilineTextPatch(style: Record<string, any> | null | undefined): Record<string, any> {
  if (isSafeWidthText(style)) return { multiline: true };
  return { multiline: true, autoSizeMode: "height", fitMode: "auto-height" };
}

/** True when the style is already multi-line in the sense `multilineTextPatch` gives it. */
export function isMultilineTextStyle(style: Record<string, any> | null | undefined): boolean {
  const patch = multilineTextPatch(style);
  return Object.entries(patch).every(([key, value]) => style?.[key] === value);
}

export function canonicalTextLayerUpdate(
  value: unknown,
  style: Record<string, any> | null | undefined,
): { text: string; textStyle: Record<string, any> } {
  const text = normalizeCanonicalText(value);
  return {
    text,
    textStyle: promoteTextStyleForValue(style, text),
  };
}

export function normalizeInlineText(value: unknown, _multiline: boolean): string {
  // The value is canonical regardless of the layer's previous mode. A manual
  // newline promotes the layer; it is never rewritten as a space.
  return normalizeCanonicalText(value);
}

export function isEmptyText(value: unknown): boolean {
  return normalizeCanonicalText(value).trim().length === 0;
}

export function getTextPlacementStyle(
  preset: TextPlacementPreset,
  canvasWidth: number,
  canvasHeight: number,
  dpi?: unknown,
): TextPlacementStyle {
  const width = Math.max(240, Number(canvasWidth) || 1500);
  const height = Math.max(240, Number(canvasHeight) || 2100);
  if (preset === "text") {
    // The width is only a starting value: auto-width text is always measured
    // from its content, so the box hugs the words from the first keystroke.
    const fontSize = newTextFontSize(dpi);
    return {
      name: "Text",
      // The box is the words until the safe area, then it wraps.
      autoSizeMode: "safe-width",
      fontSize,
      width: Math.round(fontSize),
      height: Math.round(fontSize * DEFAULT_LINE_HEIGHT),
      multiline: false,
      textAlign: "center",
      lineHeight: DEFAULT_LINE_HEIGHT,
      letterSpacing: DEFAULT_LETTER_SPACING,
    };
  }
  if (preset === "heading") {
    const fontSize = Math.max(48, Math.round(width / 16));
    return {
      name: "Heading",
      autoSizeMode: "width",
      fontSize,
      width: Math.round(width * 0.62),
      height: Math.round(fontSize * 1.3),
      multiline: false,
      textAlign: "center",
      lineHeight: DEFAULT_LINE_HEIGHT,
      letterSpacing: DEFAULT_LETTER_SPACING,
    };
  }
  if (preset === "subheading") {
    const fontSize = Math.max(36, Math.round(width / 22));
    return {
      name: "Subheading",
      autoSizeMode: "width",
      fontSize,
      width: Math.round(width * 0.56),
      height: Math.round(fontSize * 1.35),
      multiline: false,
      textAlign: "center",
      lineHeight: DEFAULT_LINE_HEIGHT,
      letterSpacing: DEFAULT_LETTER_SPACING,
    };
  }
  const fontSize = Math.max(28, Math.round(width / 28));
  return {
    name: "Body text",
    autoSizeMode: "height",
    fontSize,
    width: Math.round(width * 0.48),
    height: Math.min(Math.round(height * 0.2), Math.round(fontSize * 4.8)),
    multiline: true,
    textAlign: "left",
    lineHeight: DEFAULT_LINE_HEIGHT,
    letterSpacing: DEFAULT_LETTER_SPACING,
  };
}

export function textPlacementGestureIsClick(
  startClientX: number,
  startClientY: number,
  endClientX: number,
  endClientY: number,
  threshold = TEXT_PLACEMENT_DRAG_THRESHOLD_PX,
): boolean {
  return Math.hypot(endClientX - startClientX, endClientY - startClientY) <= threshold;
}

/* ---------------------------------------------- line breaks in auto width --
 * Auto-width text has no wrap width of its own: its box is the words. When a
 * line break turns it into a paragraph, the paragraph needs one — and the
 * stored width is the last single line's, so wrapping at it would break every
 * new word onto its own line. Instead, for the rest of that editing session,
 * the box follows the widest typed line (plus the auto-width padding), never
 * narrower than it was and never wider than the artboard.
 */

/** Whether this edit turns one-line auto-width text into multi-line text. */
export function becomesMultilineFromAutoWidth(
  style: Record<string, any> | null | undefined,
  previousText: unknown,
  nextText: unknown,
): boolean {
  return (
    isAutoWidthText(style) &&
    !hasManualTextLineBreak(previousText) &&
    hasManualTextLineBreak(nextText)
  );
}

/**
 * Moves a box's centre so its ALIGNED edge holds while its width changes:
 * left-aligned text grows rightward, right-aligned leftward, centred evenly.
 * The shift is along the box's own (rotated) horizontal axis.
 */
export function alignedEdgeShift(
  box: { x: number; y: number; width: number; rotation?: number },
  nextWidth: number,
  textAlign: unknown,
): { x: number; y: number } {
  const delta = nextWidth - box.width;
  const local = textAlign === "left" ? delta / 2 : textAlign === "right" ? -delta / 2 : 0;
  if (!local) return { x: box.x, y: box.y };
  const radians = ((Number(box.rotation) || 0) * Math.PI) / 180;
  return { x: box.x + local * Math.cos(radians), y: box.y + local * Math.sin(radians) };
}

/** The wrap box for text that became multi-line in this editing session. */
export function widenForTypedLines(
  layer: { x: number; y: number; width: number; rotation?: number; textStyle?: Record<string, any> | null },
  text: unknown,
  measure: MeasureFn,
  maxWidth?: number,
): { x: number; y: number; width: number } {
  const style = layer.textStyle || {};
  const fontSize = Math.max(4, Number(style.fontSize) || 16);
  const widest = getSingleLineTextBox(
    {
      text: String(text ?? ""),
      fontFamily: style.fontFamily,
      fontSize,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle === "italic" ? "italic" : "normal",
      letterSpacing: Number(style.letterSpacing) || 0,
      lineHeight: style.lineHeight,
      uppercase: Boolean(style.uppercase),
    },
    measure,
  ).width;
  const cap = Number(maxWidth) > 0 ? Number(maxWidth) : Number.POSITIVE_INFINITY;
  // The same allowance as an auto-width box: padding plus the trailing letter space.
  const allowance = autoWidthPadding(fontSize) + Math.max(0, Number(style.letterSpacing) || 0);
  const width = Math.ceil(Math.min(cap, Math.max(Number(layer.width) || 1, widest + allowance)));
  return { ...alignedEdgeShift(layer, width, style.textAlign), width };
}

/**
 * A gesture that changes a "safe-width" text's WIDTH by itself (a side
 * handle — a corner drag scales the type and carries a font size) is the admin
 * or customer choosing that width: the object becomes a fixed-width paragraph
 * that wraps at it, and the next keystroke keeps it. Returns the style patch
 * for that switch, or null when the gesture leaves the mode alone.
 */
export function manualWidthStylePatch(
  style: Record<string, any> | null | undefined,
  patch: { width?: unknown; textStyle?: Record<string, any> | null },
  currentWidth: number,
): Record<string, any> | null {
  if (!isSafeWidthText(style)) return null;
  if (patch.width === undefined || patch.textStyle?.fontSize !== undefined) return null;
  if (Math.abs(Number(patch.width) - Number(currentWidth)) < 1) return null;
  return { multiline: true, autoSizeMode: "height", fitMode: "auto-height" };
}
