import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { libraryRefreshDelayMs, libraryTileCandidates, libraryTileSourceKey, mergeRefreshedLibraryAssets } from "../library-thumbnail";

const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");

describe("library picker tiles", () => {
  it("try the thumbnail, then the larger previews, without duplicates", () => {
    expect(libraryTileCandidates({ id: "a", thumbnailUrl: "t", editorUrl: "e", url: "e" })).toEqual(["t", "e"]);
    expect(libraryTileCandidates({ id: "a", url: " u " })).toEqual(["u"]);
    expect(libraryTileCandidates({ id: "a" })).toEqual([]);
  });

  it("a re-signed row has a different source key, so its failure state resets", () => {
    const before = libraryTileSourceKey({ id: "a", thumbnailUrl: "t?token=1" });
    expect(libraryTileSourceKey({ id: "a", thumbnailUrl: "t?token=2" })).not.toBe(before);
    expect(libraryTileSourceKey({ id: "a", thumbnailUrl: "t?token=1" })).toBe(before);
  });

  it("schedules a re-sign before the earliest future expiry, never for lapsed links", () => {
    const now = 1_000_000;
    expect(libraryRefreshDelayMs([{ id: "a", expiresAt: now + 600_000 }, { id: "b", expiresAt: now + 120_000 }], now)).toBe(60_000);
    expect(libraryRefreshDelayMs([{ id: "a", expiresAt: new Date(now + 10_000).toISOString() }], now, 60_000, 15_000)).toBe(15_000);
    expect(libraryRefreshDelayMs([{ id: "a", expiresAt: now - 1 }], now)).toBeNull();
    expect(libraryRefreshDelayMs([{ id: "a" }, { id: "b", expiresAt: "nonsense" }], now)).toBeNull();
  });

  it("merges re-signed rows in place, keeping order and rows that were not refreshed", () => {
    const a = { id: "a", url: "1" };
    const b = { id: "b", url: "1" };
    const current = [a, b];
    const merged = mergeRefreshedLibraryAssets(current, [{ id: "b", url: "2" }, { id: "z", url: "9" }]);
    expect(merged.map((entry) => `${entry.id}${entry.url}`)).toEqual(["a1", "b2"]);
    expect(merged[0]).toBe(a);
    expect(mergeRefreshedLibraryAssets(current, [])).toBe(current);
  });

  it("tiles are keyed to their URLs and inserting uses the asset, never a preview URL", () => {
    const thumb = read("app/admin/dashboard/design-builder/LibraryThumb.tsx");
    expect(thumb).toContain("const current = attempt.key === sourceKey ? attempt : { key: sourceKey, index: 0, loaded: false };");
    const panel = read("app/admin/dashboard/design-builder/AdminUploadsPanel.tsx");
    expect(panel).toContain("onPick={() => onInsertAsset(asset)}");
    expect(panel).not.toMatch(/useState\(false\);\s*const src = asset\.thumbnailUrl/);
  });
});
