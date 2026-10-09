// Whether a page's preview could look different between two template
// revisions. The studio's Pages panel draws one live preview per page; before
// this, every edit re-rendered all of them (measured: 2 + 2 × pages preview
// renders per edit — 42 for a 20-page design). Edits replace only the objects
// they change (immutable updates), so reference equality of the page, its
// layers and the template-wide inputs is an exact and cheap test.

/** Template-wide properties any page's drawing depends on. */
const SHARED_KEYS = [
  "canvasWidthPx",
  "canvasHeightPx",
  "cardWidthIn",
  "cardHeightIn",
  "dpi",
  "safeArea",
  "bleed",
  "settings",
  "fields",
  "assets",
  "defaultPage",
] as const;

function pageOf(template: any, pageId: string) {
  return (Array.isArray(template?.pages) ? template.pages : []).find((page: any) => page?.id === pageId) || null;
}

function layersOf(template: any, pageId: string): any[] {
  return (Array.isArray(template?.layers) ? template.layers : []).filter((layer: any) => (layer?.page ?? layer?.pageId) === pageId);
}

/** True when nothing that draws `pageId` changed between the two templates. */
export function pagePreviewUnchanged(previous: any, next: any, pageId: string): boolean {
  if (previous === next) return true;
  if (!previous || !next) return false;
  for (const key of SHARED_KEYS) if (previous[key] !== next[key]) return false;
  if (pageOf(previous, pageId) !== pageOf(next, pageId)) return false;
  const before = layersOf(previous, pageId);
  const after = layersOf(next, pageId);
  if (before.length !== after.length) return false;
  for (let index = 0; index < before.length; index += 1) if (before[index] !== after[index]) return false;
  return true;
}
