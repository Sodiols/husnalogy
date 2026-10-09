// Library picker tiles (the studio's Uploads panel, phone dialog and media
// manager). A tile only PREVIEWS an asset — inserting hands the studio the
// asset's identity, which places its editor/original variants, so a tile's
// URL never becomes a design's image.
//
// Tile URLs are short-lived signed links. A tile that failed used to stay
// failed forever: its error flag survived a refreshed URL. These helpers give
// the tile an ordered list of preview URLs, tell the panel when the signed
// links are about to lapse, and merge freshly signed rows in place.

export type LibraryTileAsset = {
  id: string;
  thumbnailUrl?: string;
  editorUrl?: string;
  url?: string;
  expiresAt?: string | number | null;
};

/** Preview URLs to try, smallest first. Never used to insert — only to show the tile. */
export function libraryTileCandidates(asset: LibraryTileAsset): string[] {
  const urls = [asset.thumbnailUrl, asset.editorUrl, asset.url].map((value) => String(value || "").trim()).filter(Boolean);
  return [...new Set(urls)];
}

/** A stable key for "these are the URLs this tile has" — a change resets its failure state. */
export function libraryTileSourceKey(asset: LibraryTileAsset): string {
  return `${asset.id}|${libraryTileCandidates(asset).join("|")}`;
}

const expiryMs = (value: LibraryTileAsset["expiresAt"]): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * How long until the panel should re-sign its rows: `marginMs` before the
 * earliest FUTURE expiry (never sooner than `minimumMs`), or null when no row
 * carries one. Already-lapsed links are left to the tiles' own failure
 * handling, so a row the server keeps returning with a past expiry can never
 * turn this into a refresh loop.
 */
export function libraryRefreshDelayMs(assets: LibraryTileAsset[], now: number, marginMs = 60_000, minimumMs = 5_000): number | null {
  const expiries = assets.map((asset) => expiryMs(asset.expiresAt)).filter((value): value is number => value !== null && value > now);
  if (!expiries.length) return null;
  return Math.max(minimumMs, Math.min(...expiries) - marginMs - now);
}

/** Freshly signed rows replace the old ones in place; order, and rows not in the refresh, are kept. */
export function mergeRefreshedLibraryAssets<T extends { id: string }>(current: T[], fresh: T[]): T[] {
  if (!fresh.length) return current;
  const byId = new Map(fresh.map((asset) => [asset.id, asset]));
  let changed = false;
  const next = current.map((asset) => {
    const replacement = byId.get(asset.id);
    if (!replacement || replacement === asset) return asset;
    changed = true;
    return replacement;
  });
  return changed ? next : current;
}
