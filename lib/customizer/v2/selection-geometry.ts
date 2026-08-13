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
 * Does the marquee touch this object at all? Exact for rotated objects: the
 * separating axis theorem is evaluated on the world axes (the object's rotated
 * AABB against the box) and then on the object's own axes (the box's corners
 * projected into the object's local frame). Two convex quads that separate on
 * none of those four axes overlap.
 *
 * The rect may be drawn in any direction — it is normalized first.
 */
export function rectIntersectsTransformedLayer(rect: SelectionRect, layer: any): boolean {
  const marquee = normalizeSelectionRect(rect);
  const bounds = transformedLayerBounds(layer);
  if (bounds.right < marquee.left || bounds.left > marquee.right) return false;
  if (bounds.bottom < marquee.top || bounds.top > marquee.bottom) return false;

  const rotation = Number(layer?.rotation) || 0;
  if (!rotation) return true;

  const centerX = Number(layer?.x) || 0;
  const centerY = Number(layer?.y) || 0;
  const radians = (-rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfW = Math.abs(Number(layer?.width) || 0) / 2;
  const halfH = Math.abs(Number(layer?.height) || 0) / 2;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const corners: Array<[number, number]> = [
    [marquee.left, marquee.top],
    [marquee.right, marquee.top],
    [marquee.right, marquee.bottom],
    [marquee.left, marquee.bottom],
  ];
  for (const [pointX, pointY] of corners) {
    const dx = pointX - centerX;
    const dy = pointY - centerY;
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;
    minX = Math.min(minX, localX);
    maxX = Math.max(maxX, localX);
    minY = Math.min(minY, localY);
    maxY = Math.max(maxY, localY);
  }
  return maxX >= -halfW && minX <= halfW && maxY >= -halfH && minY <= halfH;
}

/**
 * Marquee semantics: an object joins the selection as soon as the box TOUCHES
 * it — brushing across three objects selects all three, and the box may be
 * dragged in any direction (down-right, up-left, or across).
 *
 * Requiring full enclosure, as this used to, meant a sweep only ever picked up
 * whatever it completely swallowed, which is why the marquee felt like it only
 * worked in one direction.
 *
 * Full-page backgrounds are skipped: every marquee overlaps them, so touch
 * semantics would otherwise drag the page background into every selection.
 * They stay selectable by clicking them or through the layers panel.
 *
 * Permission/page/group filtering stays with the caller so Admin and Customer
 * can share this exact geometry without sharing policy.
 */
export function marqueeSelectedLayerIds(rect: SelectionRect, layers: any[]): string[] {
  return layers
    .filter((layer: any) => {
      if (!layer || layer.hidden || layer.type === "background") return false;
      return rectIntersectsTransformedLayer(rect, layer);
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
