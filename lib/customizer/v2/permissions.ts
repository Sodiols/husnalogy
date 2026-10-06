// One customer permission model for every surface (spec §18).
//
// The admin builder exposes a single "Customer editable" checkbox plus a few
// targeted restrictions ("Keep grid position fixed for customers", "Position
// locked for customers", "Customer interaction disabled", and the legacy
// allowZoom / allowReposition image flags). Those restrictions used to be
// thrown away: both normalizers rebuilt the whole permission object from
// customerEditable alone, so a saved or published layer could never carry an
// explicit `false`.
//
// The model is now:
//
//   STORED  (normalizeStoredCustomerPermissions) — what a template layer keeps.
//     - customerEditable false        → every key false. Editing off denies.
//     - an explicit boolean           → kept as-is (a restriction survives).
//     - a missing key                 → compatibility default: true, except
//       zoomImage when allowZoom === false, repositionImage when
//       allowReposition === false, and cropImage when either is false
//       (cropImage is the umbrella that implies zoom AND reposition in
//       resolveImageCropCapabilities, so it cannot stay on when one is off).
//
//   EFFECTIVE (resolveCustomerPermissions) — what the customer may do now.
//     The stored set, then the layer-level switches folded in:
//     - allowZoom / allowReposition === false always deny their action, and
//       with it the cropImage umbrella that would otherwise re-grant it
//     - positionLocked denies move, resize, rotate and changeLayerOrder
//     - customerInteractionDisabled denies everything
//
// The browser (`getLayerPermissions`) and the server validator both call
// `resolveCustomerPermissions`, so a control the UI hides is exactly a change
// the server rejects. Pure module: no React, no network.

import { ALL_PERMISSION_KEYS, type CustomerPermissions } from "./types";

export const CUSTOMER_PERMISSION_KEY_LIST: ReadonlyArray<keyof CustomerPermissions> = ALL_PERMISSION_KEYS;

/** Actions that change where the object itself sits on the card. */
export const POSITION_PERMISSION_KEYS = ["move", "resize", "rotate", "changeLayerOrder"] as const;

type PermissionLayerLike = {
  customerEditable?: unknown;
  customerPermissions?: unknown;
  allowZoom?: unknown;
  allowReposition?: unknown;
  positionLocked?: unknown;
  customerInteractionDisabled?: unknown;
} | null | undefined;

function explicitBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export function permissionBundle(value: boolean): Record<string, boolean> {
  return Object.fromEntries(CUSTOMER_PERMISSION_KEY_LIST.map((key) => [key, value]));
}

/** The permission object a template layer stores. See the module header. */
export function normalizeStoredCustomerPermissions(input: unknown, layer: PermissionLayerLike = {}): Record<string, boolean> {
  if (!layer?.customerEditable || explicitBoolean(layer.customerEditable) === false) return permissionBundle(false);
  const source = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const zoomOff = explicitBoolean(layer.allowZoom) === false;
  const repositionOff = explicitBoolean(layer.allowReposition) === false;
  const defaults: Record<string, boolean> = {
    ...permissionBundle(true),
    zoomImage: !zoomOff,
    repositionImage: !repositionOff,
    cropImage: !(zoomOff || repositionOff),
  };
  const out: Record<string, boolean> = {};
  for (const key of CUSTOMER_PERMISSION_KEY_LIST) {
    const explicit = explicitBoolean(source[key]);
    out[key] = explicit === undefined ? defaults[key] : explicit;
  }
  return out;
}

/** What the customer may do with this template layer right now. */
export function resolveCustomerPermissions(layer: PermissionLayerLike): Record<string, boolean> {
  const permissions = normalizeStoredCustomerPermissions(layer?.customerPermissions, layer);
  if (explicitBoolean(layer?.customerInteractionDisabled) === true) return permissionBundle(false);
  const zoomOff = explicitBoolean(layer?.allowZoom) === false;
  const repositionOff = explicitBoolean(layer?.allowReposition) === false;
  if (zoomOff) permissions.zoomImage = false;
  if (repositionOff) permissions.repositionImage = false;
  if (zoomOff || repositionOff) permissions.cropImage = false;
  if (explicitBoolean(layer?.positionLocked) === true) {
    for (const key of POSITION_PERMISSION_KEYS) permissions[key] = false;
  }
  return permissions;
}
