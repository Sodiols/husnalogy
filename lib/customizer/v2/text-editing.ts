// Shared, renderer-agnostic text editing helpers.
//
// Canvas components own pointer events and the canonical document owners own
// persistence/history, but both Admin and Customer use these exact placement
// presets and newline rules.

export const TEXT_PLACEMENT_DRAG_THRESHOLD_PX = 4;

export type TextPlacementPreset = "heading" | "subheading" | "body";

export type TextPlacementStyle = {
  name: string;
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
  return {
    ...current,
    multiline: true,
    autoSizeMode: "height",
    fitMode: "auto-height",
  };
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
): TextPlacementStyle {
  const width = Math.max(240, Number(canvasWidth) || 1500);
  const height = Math.max(240, Number(canvasHeight) || 2100);
  if (preset === "heading") {
    const fontSize = Math.max(48, Math.round(width / 16));
    return {
      name: "Heading",
      fontSize,
      width: Math.round(width * 0.62),
      height: Math.round(fontSize * 1.3),
      multiline: false,
      textAlign: "center",
      lineHeight: 1.1,
      letterSpacing: 1.5,
    };
  }
  if (preset === "subheading") {
    const fontSize = Math.max(36, Math.round(width / 22));
    return {
      name: "Subheading",
      fontSize,
      width: Math.round(width * 0.56),
      height: Math.round(fontSize * 1.35),
      multiline: false,
      textAlign: "center",
      lineHeight: 1.15,
      letterSpacing: 0.8,
    };
  }
  const fontSize = Math.max(28, Math.round(width / 28));
  return {
    name: "Body text",
    fontSize,
    width: Math.round(width * 0.48),
    height: Math.min(Math.round(height * 0.2), Math.round(fontSize * 4.8)),
    multiline: true,
    textAlign: "left",
    lineHeight: 1.25,
    letterSpacing: 0,
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
