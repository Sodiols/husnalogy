/**
 * ONE permission resolver for both customizer surfaces (spec §41, §58).
 *
 * Before this module the customer workspace and the admin canvas each carried
 * their own `canMove` / `canResize` / `canRotate` closures. They agreed by
 * accident, not by construction, which is exactly the wrong property for the
 * thing that decides whether a customer may move a locked logo.
 *
 * The rules themselves are unchanged — this is the extraction of the two
 * existing implementations into a single shared one, parameterised by SURFACE:
 *
 *   customer — template layers obey `customerEditable` + the permission bundle;
 *              layers the customer added themselves obey their own `locked`.
 *   admin    — everything is editable except `locked` / `adminEditable: false`.
 *
 * Nothing here is authoritative on its own. The browser hides controls with it;
 * the SERVER re-validates every committed change (spec §58). A capability of
 * `true` is permission to *attempt*, never permission to *persist*.
 */

import { getDescendantIds } from "../groups";
import { getLayerPermissions } from "@/app/components/customizer/customizer-utils";

export type InteractionSurface = "customer" | "admin";

export type LayerCapabilities = {
  /** May the pointer target this object at all? */
  selectable: boolean;
  movable: boolean;
  resizable: boolean;
  rotatable: boolean;
  /** Double click opens the inline DOM text editor. */
  editableText: boolean;
  /** Corner drag changes the real font size rather than the box (spec §14). */
  scalesFontOnCorner: boolean;
  deletable: boolean;
  duplicable: boolean;
};

const NOTHING: LayerCapabilities = {
  selectable: false,
  movable: false,
  resizable: false,
  rotatable: false,
  editableText: false,
  scalesFontOnCorner: false,
  deletable: false,
  duplicable: false,
};

/**
 * A group is only as permissive as its least permissive descendant: dragging a
 * group must never move a member the surface may not move (spec §18, §20).
 */
export function logicalMembers(layers: readonly any[], layer: any): any[] {
  if (layer?.type !== "group") return [layer];
  const ids = new Set([layer.id, ...getDescendantIds(layers as any[], layer.id)]);
  const members = (layers as any[]).filter((candidate) => ids.has(candidate?.id));
  return members.length ? members : [layer];
}

/** Customer-side transform lock, matching the pre-existing customer rule. */
function customerTransformLocked(layer: any): boolean {
  return Boolean(
    (layer?.isUserLayer && layer?.locked) ||
      layer?.customerLocked ||
      layer?.positionLocked ||
      layer?.customerInteractionDisabled,
  );
}

function adminTransformLocked(layer: any): boolean {
  return Boolean(layer?.locked || layer?.adminEditable === false);
}

/** Capability of ONE object, ignoring group membership. */
function ownCapabilities(layer: any, surface: InteractionSurface): LayerCapabilities {
  if (!layer) return NOTHING;

  if (surface === "admin") {
    const locked = adminTransformLocked(layer);
    const isText = layer.type === "text";
    return {
      // Locked objects stay clickable so admin can select and unlock them.
      selectable: true,
      movable: !locked,
      resizable: !locked,
      rotatable: !locked,
      editableText: isText && !locked,
      scalesFontOnCorner: isText && !locked,
      deletable: !locked,
      duplicable: !locked,
    };
  }

  const locked = customerTransformLocked(layer);
  // A customer's own object carries no template permission bundle: it is theirs.
  if (layer.isUserLayer) {
    return {
      selectable: true,
      movable: !locked,
      resizable: !locked,
      rotatable: !locked,
      editableText: layer.type === "text",
      scalesFontOnCorner: layer.type === "text" && !locked,
      deletable: !layer.locked,
      duplicable: !layer.locked,
    };
  }

  const permissions = getLayerPermissions(layer);
  const isText = layer.type === "text";
  return {
    selectable: true,
    movable: !locked && Boolean(permissions.move),
    resizable: !locked && Boolean(permissions.resize),
    rotatable: !locked && Boolean(permissions.rotate),
    editableText: isText && Boolean(permissions.editContent),
    scalesFontOnCorner:
      isText && !locked && Boolean(permissions.resize) && Boolean(permissions.changeFontSize),
    deletable: Boolean(permissions.delete),
    duplicable: Boolean(permissions.duplicate),
  };
}

/**
 * Capabilities of an object as the canvas sees it: its own permissions,
 * intersected with every descendant's when it is a group.
 */
export function resolveLayerCapabilities(
  layer: any,
  options: { surface: InteractionSurface; layers?: readonly any[] },
): LayerCapabilities {
  if (!layer) return NOTHING;
  const own = ownCapabilities(layer, options.surface);
  if (layer.type !== "group" || !options.layers?.length) return own;

  const members = logicalMembers(options.layers, layer);
  return members.reduce<LayerCapabilities>((accumulated, member) => {
    if (member?.id === layer.id) return accumulated;
    const memberCapabilities = ownCapabilities(member, options.surface);
    return {
      selectable: accumulated.selectable,
      movable: accumulated.movable && memberCapabilities.movable,
      resizable: accumulated.resizable && memberCapabilities.resizable,
      rotatable: accumulated.rotatable && memberCapabilities.rotatable,
      // A group is never a text edit target.
      editableText: false,
      scalesFontOnCorner: false,
      deletable: accumulated.deletable && memberCapabilities.deletable,
      duplicable: accumulated.duplicable && memberCapabilities.duplicable,
    };
  }, own);
}

/**
 * Capabilities of a MULTI selection (spec §18).
 *
 * Deliberately all-or-nothing: a group operation that silently skipped the one
 * prohibited member would move the other objects out of the arrangement the
 * customer set up, with no way to tell that it happened.
 */
export function resolveSelectionCapabilities(
  selectedIds: readonly string[],
  layers: readonly any[],
  surface: InteractionSurface,
): LayerCapabilities {
  if (!selectedIds.length) return NOTHING;
  const resolved = selectedIds.map((id) => (layers as any[]).find((layer) => layer?.id === id));
  // A member that is not on this page / not interactive fails the whole set.
  if (resolved.some((layer) => !layer)) return NOTHING;

  return resolved.reduce<LayerCapabilities>((accumulated, layer, index) => {
    const capabilities = resolveLayerCapabilities(layer, { surface, layers });
    if (index === 0) return capabilities;
    return {
      selectable: accumulated.selectable && capabilities.selectable,
      movable: accumulated.movable && capabilities.movable,
      resizable: accumulated.resizable && capabilities.resizable,
      rotatable: accumulated.rotatable && capabilities.rotatable,
      editableText: false,
      scalesFontOnCorner: false,
      deletable: accumulated.deletable && capabilities.deletable,
      duplicable: accumulated.duplicable && capabilities.duplicable,
    };
  }, NOTHING);
}
