// The ONE answer to "where is this page's safe area?".
//
// A page may carry its own `safeArea` (Front and Back can differ); otherwise
// it inherits the template's. Before this module the editors, previews, text
// layout and the server SVG read only the template-level insets while print
// preflight (through the canonical document) read the page's own — so a page
// with its own safe area wrapped text at one width on screen and was checked
// against another for print. Every consumer now asks here.
//
// All values are document pixels of the page itself. Zoom and the viewport
// never enter: callers convert to screen space afterwards, so the logical
// result (where text wraps, what preflight flags) is the same at any zoom.

export type SafeInsets = { top: number; right: number; bottom: number; left: number };
export type SafeAreaBounds = { left: number; top: number; right: number; bottom: number };
export type ResolvedPageSafeArea = {
  pageId: string;
  /** Page size in document px. */
  width: number;
  height: number;
  /** Distance of the safe edge from each page edge. */
  insets: SafeInsets;
  /** The safe rectangle in page coordinates. */
  bounds: SafeAreaBounds;
  /** Whether the page defines its own insets (rather than inheriting the template's). */
  ownInsets: boolean;
};

const ZERO: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function positive(value: unknown, fallback: number): number {
  const n = finite(value);
  return n !== null && n > 0 ? n : fallback;
}

/** Whether a value is a usable inset object (at least one numeric side). */
export function isSafeInsets(value: unknown): value is Partial<SafeInsets> {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return ["top", "right", "bottom", "left"].some((side) => finite(v[side]) !== null);
}

function insetsFrom(value: unknown, fallback: SafeInsets): SafeInsets {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const side = (key: keyof SafeInsets) => {
    const n = finite(v[key]);
    return n === null ? fallback[key] : Math.max(0, n);
  };
  return { top: side("top"), right: side("right"), bottom: side("bottom"), left: side("left") };
}

function findPage(template: any, pageId?: string | null) {
  const pages = Array.isArray(template?.pages) ? template.pages : [];
  return (
    (pageId ? pages.find((page: any) => page?.id === pageId) : null) ||
    pages.find((page: any) => page?.id === template?.defaultPage || page?.id === template?.defaultPageId) ||
    pages[0] ||
    null
  );
}

/**
 * The safe area of `pageId` (default page when omitted) in a studio/legacy
 * template or a canonical document's flat equivalent.
 */
export function resolvePageSafeArea(template: any, pageId?: string | null): ResolvedPageSafeArea {
  const page = findPage(template, pageId);
  const width = positive(page?.widthPx, positive(template?.canvasWidthPx ?? template?.canvas?.widthPx, 1500));
  const height = positive(page?.heightPx, positive(template?.canvasHeightPx ?? template?.canvas?.heightPx, 2100));
  const inherited = insetsFrom(template?.safeArea, ZERO);
  const ownInsets = isSafeInsets(page?.safeArea);
  const insets = ownInsets ? insetsFrom(page.safeArea, inherited) : inherited;
  return {
    pageId: String(page?.id || pageId || ""),
    width,
    height,
    insets,
    bounds: { left: insets.left, top: insets.top, right: width - insets.right, bottom: height - insets.bottom },
    ownInsets,
  };
}

/** The safe rectangle of a page — the bound auto-width text grows to and wraps at. */
export function pageSafeBounds(template: any, pageId?: string | null): SafeAreaBounds {
  return resolvePageSafeArea(template, pageId).bounds;
}

/** The safe insets of a page (what snapping and the safe-area guide draw). */
export function pageSafeInsets(template: any, pageId?: string | null): SafeInsets {
  return resolvePageSafeArea(template, pageId).insets;
}

/**
 * Template command: give one page its own safe area, or (`insets` null) let it
 * inherit the template's again. Unknown pages leave the template unchanged.
 */
export function setPageSafeArea(template: any, pageId: string, insets: Partial<SafeInsets> | null) {
  const pages = Array.isArray(template?.pages) ? template.pages : [];
  const target = pages.find((page: any) => page?.id === pageId);
  if (!target) return template;
  // Already inheriting: nothing to change (no undo step).
  if (!insets && !("safeArea" in target)) return template;
  return {
    ...template,
    pages: pages.map((page: any) => {
      if (page?.id !== pageId) return page;
      if (!insets) {
        const { safeArea: _removed, ...rest } = page;
        return rest;
      }
      return { ...page, safeArea: insetsFrom(insets, resolvePageSafeArea(template, pageId).insets) };
    }),
  };
}
