import { resolveGroupBounds, rotatedAxisHalfExtents } from "./groups";
import { resolveTextBox, type MeasureFn, type SafeBounds } from "./text-layout";

export type SelectionRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type ClientRectLike = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export const SELECTION_DRAG_THRESHOLD_PX = 4;

export function normalizeSelectionRect(rect: SelectionRect): SelectionRect {
  return {
    left: Math.min(rect.left, rect.right),
    right: Math.max(rect.left, rect.right),
    top: Math.min(rect.top, rect.bottom),
    bottom: Math.max(rect.top, rect.bottom),
  };
}

export function transformedLayerBounds(layer: any): SelectionRect {
  const { halfW, halfH } = rotatedAxisHalfExtents(layer);
  const x = Number(layer?.x) || 0;
  const y = Number(layer?.y) || 0;
  return {
    left: x - halfW,
    right: x + halfW,
    top: y - halfH,
    bottom: y + halfH,
  };
}

export function pointInsideTransformedLayer(x: number, y: number, layer: any) {
  const centerX = Number(layer?.x) || 0;
  const centerY = Number(layer?.y) || 0;
  const radians = (-(Number(layer?.rotation) || 0) * Math.PI) / 180;
  const dx = x - centerX;
  const dy = y - centerY;
  const localX = dx * Math.cos(radians) - dy * Math.sin(radians);
  const localY = dx * Math.sin(radians) + dy * Math.cos(radians);
  return (
    Math.abs(localX) <= Math.abs(Number(layer?.width) || 0) / 2 &&
    Math.abs(localY) <= Math.abs(Number(layer?.height) || 0) / 2
  );
}

/**
 * Professional editor marquee semantics: an object joins the selection only
 * when its complete transformed AABB is enclosed by the document-space box.
 * Permission/page/group filtering stays with the caller so Admin and Customer
 * can share this exact geometry without sharing policy.
 */
export function fullyEnclosedLayerIds(rect: SelectionRect, layers: any[]): string[] {
  const marquee = normalizeSelectionRect(rect);
  return layers
    .filter((layer: any) => {
      if (!layer || layer.hidden) return false;
      const box = transformedLayerBounds(layer);
      return (
        box.left >= marquee.left &&
        box.right <= marquee.right &&
        box.top >= marquee.top &&
        box.bottom <= marquee.bottom
      );
    })
    .map((layer: any) => layer.id);
}

export function selectionBounds(layers: any[], selectedIds?: string[]) {
  return resolveGroupBounds(layers, selectedIds);
}

export function pointerExceededDragThreshold(
  startClientX: number,
  startClientY: number,
  clientX: number,
  clientY: number,
  threshold = SELECTION_DRAG_THRESHOLD_PX,
) {
  return Math.hypot(clientX - startClientX, clientY - startClientY) >= threshold;
}

/**
 * Converts a screen pointer into document coordinates. The optional rotation
 * handles a canvas embedded in a rotated product area by inverse-rotating the
 * pointer around the rendered surface centre before removing zoom.
 */
export function clientPointToDocument(
  clientX: number,
  clientY: number,
  rect: ClientRectLike,
  displayWidth: number,
  displayHeight: number,
  scale: number,
  rotation = 0,
) {
  const safeScale = Math.max(Math.abs(scale), 1e-6);
  if (!rotation) {
    return {
      x: (clientX - rect.left) / safeScale,
      y: (clientY - rect.top) / safeScale,
    };
  }

  const centerClientX = rect.left + rect.width / 2;
  const centerClientY = rect.top + rect.height / 2;
  const radians = (-rotation * Math.PI) / 180;
  const dx = clientX - centerClientX;
  const dy = clientY - centerClientY;
  const localX = dx * Math.cos(radians) - dy * Math.sin(radians);
  const localY = dx * Math.sin(radians) + dy * Math.cos(radians);
  return {
    x: (localX + displayWidth / 2) / safeScale,
    y: (localY + displayHeight / 2) / safeScale,
  };
}

export function resolveLayerSelectionGeometry(
  layer: any,
  options: {
    text?: string;
    measure: MeasureFn;
    safeBounds: SafeBounds;
  },
) {
  if (layer?.type !== "text") return layer;
  const style = layer.textStyle || {};
  const text = String(options.text ?? layer.text ?? "");
  const box = resolveTextBox(
    {
      x: layer.x,
      y: layer.y,
      width: layer.width,
      height: layer.height,
      text,
      fontFamily: style.fontFamily || "Cormorant Garamond",
      fontSize: Number(style.fontSize) || 48,
      fontWeight: style.fontWeight || "400",
      fontStyle: style.fontStyle === "italic" ? "italic" : "normal",
      letterSpacing: Number(style.letterSpacing) || 0,
      lineHeight: Number(style.lineHeight) || 1.15,
      uppercase: Boolean(style.uppercase),
      multiline: Boolean(style.multiline),
      textAlign: style.textAlign || "center",
      verticalAlign: style.verticalAlign || "middle",
      autoSizeMode: style.autoSizeMode,
      fitMode: style.fitMode,
    },
    options.measure,
    options.safeBounds,
  );
  const geometryChanged =
    box.x !== layer.x ||
    box.y !== layer.y ||
    box.width !== layer.width ||
    box.height !== layer.height;
  if (!geometryChanged) return { ...layer, resolvedText: text };
  return {
    ...layer,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    resolvedText: text,
    ...(box.autoWidth ? { autoWidthClamped: box.clampedBySafeArea } : {}),
  };
}
