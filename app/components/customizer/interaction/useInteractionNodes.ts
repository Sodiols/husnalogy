"use client";

/**
 * Husnalogy layers -> interaction nodes (spec §7).
 *
 * This is the one place either surface converts document objects into the
 * shape the shared Konva stage understands. It resolves three things the raw
 * layer array does not carry:
 *
 *   1. GEOMETRY. Auto-width text stores a width that goes stale the moment the
 *      customer types a longer name, so the selection frame has to come from
 *      the MEASURED glyph box — the same `resolveLayerSelectionGeometry` the
 *      renderer uses, so handles sit exactly on the type.
 *   2. PERMISSIONS, through the shared capability resolver, so admin and
 *      customer differ by policy rather than by code path.
 *   3. GROUP AND GRID structure, so clicking resolves to the right object.
 *
 * It is memoised on the inputs that actually change geometry. Recomputing text
 * measurement for a whole page on every pointer event was the single largest
 * cost in the old drag path, and it is why this hook exists rather than a plain
 * function call in the render body.
 */

import { useMemo } from "react";
import type { InteractionNode } from "./CustomizerInteractionStage";
import {
  resolveLayerCapabilities,
  type InteractionSurface,
} from "@/lib/customizer/v2/interaction/capabilities";
import { resolveLayerSelectionGeometry } from "@/lib/customizer/v2/selection-geometry";
import { isSingleLineAutoSizeText, type MeasureFn, type SafeBounds } from "@/lib/customizer/v2/text-layout";
import { getGridSlotRect, normalizeGridSlot } from "@/lib/customizer/v2/grids";

export type UseInteractionNodesInput = {
  surface: InteractionSurface;
  /** Effective layers for the active page, overrides already applied. */
  layers: readonly any[];
  /** Restricts targeting to the objects this surface allows (customer filter). */
  isTargetable?: (layer: any) => boolean;
  /** Resolved display text, used for measuring auto-width objects. */
  resolveText: (layer: any) => string;
  measure: MeasureFn;
  safeBounds: SafeBounds;
  editingGroupId?: string | null;
  /**
   * Bumped when webfonts finish loading and the real measurer replaces the
   * fallback — the only time measurement results change for identical input.
   */
  metricsRevision?: number;
};

export function useInteractionNodes({
  surface,
  layers,
  isTargetable,
  resolveText,
  measure,
  safeBounds,
  editingGroupId = null,
  metricsRevision = 0,
}: UseInteractionNodesInput): InteractionNode[] {
  return useMemo(() => {
    const targets = layers.filter((layer: any) => {
      if (!layer || layer.hidden) return false;
      if (isTargetable && !isTargetable(layer)) return false;
      // The group being edited stops being a target itself; its members become
      // targets instead (spec §20).
      if (layer.type === "group" && editingGroupId === layer.id) return false;
      return true;
    });

    return targets.map((layer: any): InteractionNode => {
      const resolved =
        layer.type === "text"
          ? resolveLayerSelectionGeometry(layer, {
              text: resolveText(layer),
              measure,
              safeBounds,
            })
          : layer;

      const style = layer.textStyle || {};
      const capabilities = resolveLayerCapabilities(layer, { surface, layers });

      const slots =
        layer.type === "grid" && Array.isArray(layer.slots)
          ? layer.slots.map((rawSlot: any, index: number) => {
              const slot = normalizeGridSlot(rawSlot, index);
              const rect = getGridSlotRect(layer, slot);
              return {
                id: slot.id,
                x: rect.centerX,
                y: rect.centerY,
                width: rect.width,
                height: rect.height,
              };
            })
          : undefined;

      return {
        id: layer.id,
        type: String(layer.type || ""),
        x: Number(resolved.x) || 0,
        y: Number(resolved.y) || 0,
        width: Math.abs(Number(resolved.width) || 0),
        height: Math.abs(Number(resolved.height) || 0),
        rotation: Number(layer.rotation) || 0,
        opacity: layer.opacity,
        hidden: Boolean(layer.hidden),
        groupId: layer.groupId ?? null,
        capabilities,
        singleLineAutoSize:
          layer.type === "text" && isSingleLineAutoSizeText(style, resolved.resolvedText ?? layer.text),
        fontSize: Number(style.fontSize) || undefined,
        letterSpacing: Number(style.letterSpacing) || 0,
        minFontSize: Number(style.minFontSize) || undefined,
        maxFontSize: Number(style.maxFontSize) || undefined,
        slots,
      };
    });
    // `resolveText` and `measure` are stable per surface; `metricsRevision`
    // stands in for the measurer swapping once fonts load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface, layers, isTargetable, safeBounds, editingGroupId, metricsRevision]);
}
