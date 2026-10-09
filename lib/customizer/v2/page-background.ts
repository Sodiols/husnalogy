// A page's background picture is several fields, not one: the delivery URL
// (`backgroundImage`), the library identity the server re-signs it from
// (`backgroundAssetId`), the storage paths, and the runtime values hydration
// copies onto the page (`assetId`, `src`, `thumbnail`, signed URLs…). Clearing
// only the URL left the identity behind, and the next load re-signed the
// picture straight back. Every editor path sets and removes a page background
// through these helpers, so the whole set always changes together.

/** Every page field that belongs to its background picture. The colour is not one of them. */
export const PAGE_BACKGROUND_IMAGE_KEYS = [
  "backgroundImage",
  "backgroundAssetId",
  "bucket",
  "path",
  "originalPath",
  "editorPath",
  "thumbnailPath",
  "thumbnail",
  // Copied onto the page by asset hydration (lib/customizer/server/admin-assets.ts).
  "assetId",
  "src",
  "url",
  "signedUrl",
  "editorUrl",
  "originalUrl",
  "thumbnailUrl",
  "expiresAt",
] as const;

/** The library asset a background is chosen from (an upload result or a library row). */
export type PageBackgroundAsset = {
  id: string;
  url?: string;
  editorUrl?: string;
  bucket?: string;
  originalPath?: string;
  editorPath?: string;
  thumbnailPath?: string;
};

/**
 * Whether the page shows a background picture. A recovered or freshly loaded
 * design may carry only the durable identity (URLs are stripped before local
 * storage), so the identity alone counts.
 */
export function pageHasBackgroundImage(page: any): boolean {
  return Boolean(page && (String(page.backgroundImage || "").trim() || String(page.backgroundAssetId || "").trim()));
}

/** The page without any trace of its background picture; colour and everything else kept. */
export function withoutPageBackgroundImage<T extends Record<string, any>>(page: T): T {
  const next: Record<string, any> = { ...page };
  for (const key of PAGE_BACKGROUND_IMAGE_KEYS) delete next[key];
  return next as T;
}

/** The page showing `asset` as its background; nothing of a previous picture survives. */
export function withPageBackgroundImage<T extends Record<string, any>>(page: T, asset: PageBackgroundAsset): T {
  const url = String(asset.editorUrl || asset.url || "");
  if (!asset.id || !url) throw new Error("A background needs a library asset with a usable image.");
  return {
    ...withoutPageBackgroundImage(page),
    backgroundImage: url,
    backgroundAssetId: asset.id,
    ...(asset.bucket ? { bucket: asset.bucket } : {}),
    ...(asset.originalPath ? { originalPath: asset.originalPath } : {}),
    ...(asset.editorPath ? { editorPath: asset.editorPath } : {}),
    ...(asset.thumbnailPath ? { thumbnailPath: asset.thumbnailPath } : {}),
  };
}

function mapPage(template: any, pageId: string, change: (page: any) => any) {
  const pages = Array.isArray(template?.pages) ? template.pages : [];
  if (!pages.some((page: any) => page?.id === pageId)) return template;
  return { ...template, pages: pages.map((page: any) => (page?.id === pageId ? change(page) : page)) };
}

/** Template command: remove one page's background picture (one undo step for the caller). */
export function removePageBackgroundImage(template: any, pageId: string) {
  const page = (template?.pages || []).find((entry: any) => entry?.id === pageId);
  if (!page || !PAGE_BACKGROUND_IMAGE_KEYS.some((key) => key in page)) return template;
  return mapPage(template, pageId, withoutPageBackgroundImage);
}

/** Template command: make `asset` one page's background picture. Unknown pages are left alone. */
export function setPageBackgroundImage(template: any, pageId: string, asset: PageBackgroundAsset) {
  return mapPage(template, pageId, (page) => withPageBackgroundImage(page, asset));
}
