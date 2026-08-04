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

export function normalizeCanonicalText(value: unknown): string {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}

export function normalizeInlineText(value: unknown, multiline: boolean): string {
  const normalized = normalizeCanonicalText(value);
  return multiline ? normalized : normalized.replace(/\n+/g, " ");
}

export function isEmptyText(value: unknown): boolean {
  return normalizeCanonicalText(value).trim().length === 0;
}

// Field types that can never hold a line break, whatever the linked layer says.
const SINGLE_VALUE_FIELD_TYPES = new Set(["select", "checkbox", "number", "date", "time", "image", "file"]);

// Whether a customer text field accepts line breaks (spec §18).
//
// Both the field type and the linked layer's textStyle.multiline are
// authoritative: a field typed "text" whose layer allows multiple lines must
// still offer a real multi-line control, otherwise pressing Enter in the form
// could never produce the line break the layer is configured to render. Form
// editing, inline canvas editing, persistence and preflight all read this one
// answer, so they cannot disagree.
export function isMultilineTextField(
  field: { type?: string } | null | undefined,
  layer?: { textStyle?: { multiline?: unknown } } | null,
): boolean {
  if (field?.type === "textarea") return true;
  if (field?.type && SINGLE_VALUE_FIELD_TYPES.has(field.type)) return false;
  return Boolean(layer?.textStyle?.multiline);
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
