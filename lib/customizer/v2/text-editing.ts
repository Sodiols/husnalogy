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
