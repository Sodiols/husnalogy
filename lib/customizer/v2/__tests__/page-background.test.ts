import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PAGE_BACKGROUND_IMAGE_KEYS,
  pageHasBackgroundImage,
  removePageBackgroundImage,
  setPageBackgroundImage,
} from "../page-background";
import { hydrateAdminAssetUrls, stripAdminAssetUrls } from "../../server/admin-assets";
import { buildPageSvg } from "../svg";
import { templateToDocument } from "../document";
import { normalizeCustomizerTemplate } from "../..";

const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");

const ASSET_ID = "22222222-2222-4222-8222-222222222222";
const row = {
  id: ASSET_ID,
  title: "Confetti",
  original_filename: "confetti.png",
  bucket: "customizer-elements",
  path: "assets/2222/original/confetti.png",
  editor_path: "assets/2222/editor/editor.webp",
  thumbnail_path: "assets/2222/thumbnail/thumbnail.webp",
  mime_type: "image/png",
  width: 2000,
  height: 2800,
  status: "ready",
};

function mockSupabase() {
  const query: any = { select: () => query, in: () => query, then: (resolve: any) => resolve({ data: [row], error: null }) };
  return {
    from: () => query,
    storage: { from: () => ({ createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://fresh.test/${p}?token=t` }, error: null }) }) },
  } as any;
}

const asset = {
  id: ASSET_ID,
  url: "https://signed.test/editor.webp?token=1",
  editorUrl: "https://signed.test/editor.webp?token=1",
  bucket: row.bucket,
  originalPath: row.path,
  editorPath: row.editor_path,
  thumbnailPath: row.thumbnail_path,
};

const template = () => ({
  enabled: true,
  canvasWidthPx: 1500,
  canvasHeightPx: 2100,
  cardWidthIn: 5,
  cardHeightIn: 7,
  dpi: 300,
  defaultPage: "front",
  pages: [
    { id: "front", label: "Front", enabled: true, backgroundColor: "#f0e0d0" },
    { id: "back", label: "Back", enabled: true, backgroundColor: "#000000" },
  ],
  fields: [],
  layers: [{ id: "t1", page: "front", type: "text", text: "Hi", x: 750, y: 700, width: 300, height: 80, zIndex: 1, textStyle: { fontSize: 40 } }],
});

const front = (t: any) => t.pages.find((p: any) => p.id === "front");
const back = (t: any) => t.pages.find((p: any) => p.id === "back");

describe("page background picture: one command sets and removes every reference", () => {
  it("setting writes URL, identity and storage paths on that page only", () => {
    const next = setPageBackgroundImage(template(), "front", asset);
    expect(front(next)).toMatchObject({
      backgroundImage: asset.editorUrl,
      backgroundAssetId: ASSET_ID,
      bucket: row.bucket,
      originalPath: row.path,
      editorPath: row.editor_path,
      thumbnailPath: row.thumbnail_path,
      backgroundColor: "#f0e0d0",
    });
    expect(pageHasBackgroundImage(back(next))).toBe(false);
  });

  it("removal clears the identity too, not just the URL (the reported defect), and keeps the colour", () => {
    const set = setPageBackgroundImage(template(), "front", asset);
    const removed = removePageBackgroundImage(set, "front");
    for (const key of PAGE_BACKGROUND_IMAGE_KEYS) expect(front(removed)).not.toHaveProperty(key);
    expect(front(removed).backgroundColor).toBe("#f0e0d0");
    expect(front(removed).label).toBe("Front");
    expect(pageHasBackgroundImage(front(removed))).toBe(false);
    // Layers and the other page untouched.
    expect(removed.layers).toBe(set.layers);
    expect(back(removed)).toBe(back(set));
  });

  it("removal also clears what server hydration copied onto the page (assetId, signed URLs, thumbnail)", async () => {
    const saved = stripAdminAssetUrls(setPageBackgroundImage(template(), "front", asset));
    const hydrated: any = await hydrateAdminAssetUrls(saved, mockSupabase());
    expect(front(hydrated).assetId).toBe(ASSET_ID);
    expect(front(hydrated).thumbnail).toContain("thumbnail");
    const removed = removePageBackgroundImage(hydrated, "front");
    for (const key of PAGE_BACKGROUND_IMAGE_KEYS) expect(front(removed)).not.toHaveProperty(key);
  });

  it("a removed background is not re-signed back on reload (the reappearing image)", async () => {
    const saved = stripAdminAssetUrls(removePageBackgroundImage(setPageBackgroundImage(template(), "front", asset), "front"));
    const reloaded: any = await hydrateAdminAssetUrls(saved, mockSupabase());
    expect(front(reloaded).backgroundImage || "").toBe("");
    expect(front(reloaded).backgroundAssetId).toBeUndefined();
  });

  it("the old URL-only removal really did bring it back, so the test above is meaningful", async () => {
    const set = setPageBackgroundImage(template(), "front", asset);
    const urlOnly = { ...set, pages: set.pages.map((p: any) => (p.id === "front" ? { ...p, backgroundImage: "" } : p)) };
    const reloaded: any = await hydrateAdminAssetUrls(stripAdminAssetUrls(urlOnly), mockSupabase());
    expect(front(reloaded).backgroundImage).toContain("editor/editor.webp");
  });

  it("an id-only background (recovered design, URLs stripped) still counts as present and is removable", () => {
    const idOnly = { ...template(), pages: [{ ...template().pages[0], backgroundAssetId: ASSET_ID }, template().pages[1]] };
    expect(pageHasBackgroundImage(front(idOnly))).toBe(true);
    expect(pageHasBackgroundImage(front(removePageBackgroundImage(idOnly, "front")))).toBe(false);
  });

  it("replacing a background leaves nothing of the previous picture", () => {
    const first = setPageBackgroundImage(template(), "front", { ...asset, thumbnailPath: "old/thumb.webp" });
    const withRuntime = { ...first, pages: first.pages.map((p: any) => (p.id === "front" ? { ...p, thumbnail: "https://old/thumb", originalUrl: "https://old/orig" } : p)) };
    const replaced = setPageBackgroundImage(withRuntime, "front", { id: "33333333-3333-4333-8333-333333333333", url: "https://new/editor.webp" });
    expect(front(replaced)).toMatchObject({ backgroundAssetId: "33333333-3333-4333-8333-333333333333", backgroundImage: "https://new/editor.webp" });
    expect(front(replaced)).not.toHaveProperty("thumbnail");
    expect(front(replaced)).not.toHaveProperty("originalUrl");
    expect(front(replaced)).not.toHaveProperty("thumbnailPath");
  });

  it("no-op commands return the same template (no undo entry, no unsaved flag)", () => {
    const t = template();
    expect(removePageBackgroundImage(t, "front")).toBe(t);
    expect(removePageBackgroundImage(t, "missing")).toBe(t);
    expect(setPageBackgroundImage(t, "missing", asset)).toBe(t);
  });

  it("refuses an asset with no usable image instead of writing an invalid background", () => {
    expect(() => setPageBackgroundImage(template(), "front", { id: ASSET_ID })).toThrow();
  });

  it("Front and Back stay independent through set/remove on each", () => {
    let t: any = setPageBackgroundImage(template(), "front", asset);
    t = setPageBackgroundImage(t, "back", { ...asset, id: "44444444-4444-4444-8444-444444444444" });
    t = removePageBackgroundImage(t, "front");
    expect(pageHasBackgroundImage(front(t))).toBe(false);
    expect(back(t).backgroundAssetId).toBe("44444444-4444-4444-8444-444444444444");
  });
});

describe("removed backgrounds stay removed in published and rendered output", () => {
  it("published template and canonical document carry no background reference", () => {
    const removed = removePageBackgroundImage(setPageBackgroundImage(template(), "front", asset), "front");
    const normalized: any = normalizeCustomizerTemplate(removed);
    const page = normalized.pages.find((p: any) => p.id === "front");
    expect(page.backgroundImage || "").toBe("");
    expect(page.backgroundAssetId || "").toBe("");
    expect(page.thumbnail || "").toBe("");
    const doc = templateToDocument(normalized).document;
    const docPage = doc.pages.find((p) => p.id === "front")!;
    expect(docPage.backgroundAssetId).toBeUndefined();
    expect(docPage.backgroundImage).toBeUndefined();
  });

  it("server SVG draws the picture when set and only the colour after removal", () => {
    const set = setPageBackgroundImage(template(), "front", asset);
    expect(buildPageSvg({ template: set, pageId: "front", mode: "print" })).toContain(`href="${asset.editorUrl}"`);
    const removed = removePageBackgroundImage(set, "front");
    const svg = buildPageSvg({ template: removed, pageId: "front", mode: "print" });
    expect(svg).not.toContain("<image");
    expect(svg).toContain('fill="#f0e0d0"');
  });
});

describe("every studio entry point uses the shared command", () => {
  it("neither panel patches background fields by hand any more", () => {
    for (const file of ["AdminPagesPanel.tsx", "AdminBackgroundPanel.tsx"]) {
      const source = read(`app/admin/dashboard/design-builder/${file}`);
      expect(source).not.toMatch(/onPatchPage\([^)]*backgroundImage/);
      expect(source).not.toMatch(/backgroundAssetId:\s*asset/);
      expect(source).toContain("onRemoveBackgroundImage(page.id)");
      expect(source).toContain("pageHasBackgroundImage(page)");
    }
    const builder = read("app/admin/dashboard/design-builder/AdminDesignBuilder.tsx");
    expect(builder).toContain("removePageBackgroundImage(tRef.current, pageId)");
    expect(builder).toContain("setPageBackgroundImage(tRef.current, pageId, asset)");
  });
});
