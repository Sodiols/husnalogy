// Which library pictures each studio panel lists.
//
// Every studio picture lives in one table, `customizer_assets`. The panels
// show different slices of it:
//
//   uploads   pictures an admin or designer uploaded themselves (Uploads
//             panel, upload from phone, the media manager, replacing an image
//             or a frame's fill). Never icons or elements: an Iconify icon is
//             imported into the library the moment it is placed on a design,
//             and must not then appear as if someone had uploaded it.
//   elements  the element library: uploaded elements and SVGs, and the
//             icons imported from an outside library (Iconify).
//
// Backgrounds (`background`) and mockup parts (`mockup`, `overlay`,
// `texture`) belong to their own panels and are in neither scope.

export type AdminAssetScope = "uploads" | "elements";

export const ADMIN_ASSET_SCOPES: Record<AdminAssetScope, { types: string[]; libraryImports: boolean }> = {
  uploads: { types: ["image", "frame"], libraryImports: false },
  elements: { types: ["element", "svg"], libraryImports: true },
};

/** A `scope` query value, or null when absent or unknown (then nothing is narrowed). */
export function parseAdminAssetScope(value: unknown): AdminAssetScope | null {
  return value === "uploads" || value === "elements" ? value : null;
}

/** Does an asset (API shape) belong to a scope? */
export function assetInScope(asset: { assetType?: string | null; sourceProvider?: string | null }, scope: AdminAssetScope): boolean {
  const rule = ADMIN_ASSET_SCOPES[scope];
  if (!rule.types.includes(String(asset.assetType || "image"))) return false;
  return rule.libraryImports || !asset.sourceProvider;
}
