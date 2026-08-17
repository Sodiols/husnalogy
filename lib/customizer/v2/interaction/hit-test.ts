/**
 * Pointer hit resolution for the shared interaction layer (spec §29).
 *
 * Konva's scene graph does the cheap work — it knows which node the pointer
 * landed on — but "which node" is not the same question as "which object should
 * this gesture act on". That answer depends on Husnalogy policy: group scope,
 * grid slots, hidden layers, locked layers and the customer permission model.
 *
 * This module owns that policy, for both surfaces, as pure functions.
 */

import { pointInsideTransformedLayer, marqueeSelectedLayerIds, type SelectionRect } from "../selection-geometry";
import { resolveHitExtents } from "./handles";

export type HitCandidate = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  hidden?: boolean;
  type?: string;
  /** Excluded from pointer targeting but still visible. */
  interactionDisabled?: boolean;
  /** Group this object belongs to, if any. */
  groupId?: string | null;
};

export type HitOptions = {
  /**
   * The group the user has entered (spec §20). Inside a group scope only its
   * members are targetable; outside it, a member's clicks resolve to the group.
   */
  editingGroupId?: string | null;
  /**
   * Document scale, used to give hairline objects a usable pointer target
   * without changing the artwork.
   */
  scale?: number;
};

/**
 * Is this object a legitimate pointer target right now?
 *
 * Hidden and interaction-disabled objects are never targets — including for
 * marquee, so a locked background cannot be swept into a selection the customer
 * is then told they may not move.
 */
export function isTargetable(candidate: HitCandidate, options: HitOptions = {}): boolean {
  if (!candidate || candidate.hidden || candidate.interactionDisabled) return false;
  const editingGroupId = options.editingGroupId ?? null;
  if (candidate.type === "group" && editingGroupId === candidate.id) return false;
  if (candidate.groupId && candidate.groupId !== editingGroupId) return false;
  return true;
}

/**
 * The object under a document point, or null.
 *
 * Later entries win, because the layer array is painted back-to-front: the
 * object drawn LAST is the one visually on top, and clicking must select what
 * the eye sees.
 */
export function hitTestPoint(
  x: number,
  y: number,
  candidates: readonly HitCandidate[],
  options: HitOptions = {},
): HitCandidate | null {
  const scale = Number(options.scale) || 1;
  let hit: HitCandidate | null = null;
  for (const candidate of candidates) {
    if (!isTargetable(candidate, options)) continue;
    // Thin objects get a minimum screen-sized target. Padding the hit box here
    // rather than in the renderer keeps the printed artwork untouched.
    const extents = resolveHitExtents(candidate.width, candidate.height, scale);
    const padded = { ...candidate, width: extents.width, height: extents.height };
    if (pointInsideTransformedLayer(x, y, padded)) hit = candidate;
  }
  return hit;
}

/**
 * Marquee result, filtered by the same targeting policy as clicking.
 *
 * `marqueeSelectedLayerIds` owns the geometry (touch semantics, rotated boxes,
 * full-page backgrounds); this adds the policy the geometry deliberately does
 * not know about.
 */
export function hitTestMarquee(
  rect: SelectionRect,
  candidates: readonly HitCandidate[],
  options: HitOptions = {},
): string[] {
  const targetable = candidates.filter((candidate) => isTargetable(candidate, options));
  return marqueeSelectedLayerIds(rect, targetable as any[]);
}

/**
 * Clicking a group member selects the GROUP, unless the user has entered that
 * group. Nested groups resolve to the outermost one not already entered, so a
 * single click never reaches three levels deep by accident.
 */
export function resolveSelectionTarget(
  hitId: string,
  layers: readonly HitCandidate[],
  editingGroupId: string | null = null,
): string | null {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  let current = byId.get(hitId);
  if (!current) return null;

  const seen = new Set<string>();
  while (current?.groupId && current.groupId !== editingGroupId) {
    if (seen.has(current.id)) break; // corrupt parent cycle: stop rather than hang
    seen.add(current.id);
    const parent = byId.get(current.groupId);
    if (!parent) break;
    current = parent;
  }
  return current?.id ?? hitId;
}
