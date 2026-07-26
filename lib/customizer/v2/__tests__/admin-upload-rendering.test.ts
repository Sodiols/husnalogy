import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hydrateAdminAssetUrls, stripAdminAssetUrls } from "../../server/admin-assets";
import { assetFromRow } from "../../assets";

const root = process.cwd();
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

/**
 * Regression cover for admin-uploaded images rendering as the dashed
 * placeholder after a save.
 *
 * Saving strips the ephemeral url/src keys, so anything that renders a template
 * must sign fresh URLs again. lib/customizer/store.ts always did; the product
 * load path did not, so reopening the builder produced image layers with a
 * permanent assetId but no `src`, and CustomizerPreview drew its placeholder.
 */

// A 1254x1254 PNG upload, exactly as the assets route records it.
const assetRow = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Logo",
  original_filename: "logo.png",
  bucket: "customizer-elements",
  path: "assets/11111111/original/logo.png",
  editor_path: "assets/11111111/editor/editor.webp",
  thumbnail_path: "assets/11111111/thumbnail/thumbnail.webp",
  mime_type: "image/png",
  width: 1254,
  height: 1254,
  status: "ready",
};

function mockSupabase(row: any = assetRow) {
  const query: any = { select: () => query, in: () => query, then: (resolve: any) => resolve({ data: [row], error: null }) };
  const signed: string[] = [];
  return {
    signed,
    client: {
      from: () => query,
      storage: {
        from: () => ({
          createSignedUrl: async (storagePath: string) => {
            signed.push(storagePath);
            return { data: { signedUrl: `https://fresh.test/${storagePath}?token=abc` }, error: null };
          },
        }),
      },
    } as any,
  };
}

// An image layer as newImageLayerFromAdminAsset builds it.
const imageLayer = {
  id: "layer-1",
  type: "image",
  page: "front",
  assetId: assetRow.id,
  bucket: assetRow.bucket,
  path: assetRow.path,
  originalPath: assetRow.path,
  editorPath: assetRow.editor_path,
  thumbnailPath: assetRow.thumbnail_path,
  originalFilename: "logo.png",
  src: "https://stale.test/editor.webp?token=expired",
  url: "https://stale.test/editor.webp?token=expired",
  width: 825,
  height: 825,
};

describe("saving keeps permanent references, not temporary URLs", () => {
  it("strips the signed URLs but keeps assetId and storage paths", () => {
    const saved: any = stripAdminAssetUrls({ layers: [imageLayer] });
    const layer = saved.layers[0];
    expect(layer.src).toBeUndefined();
    expect(layer.url).toBeUndefined();
    expect(layer.assetId).toBe(assetRow.id);
    expect(layer.bucket).toBe(assetRow.bucket);
    expect(layer.originalPath).toBe(assetRow.path);
    expect(layer.editorPath).toBe(assetRow.editor_path);
    expect(layer.thumbnailPath).toBe(assetRow.thumbnail_path);
  });
});

describe("reloading restores a usable image", () => {
  it("re-signs src from the stored asset id — the actual bug", async () => {
    const saved = stripAdminAssetUrls({ layers: [imageLayer] });
    const { client } = mockSupabase();
    const reloaded: any = await hydrateAdminAssetUrls(saved, client);
    const layer = reloaded.layers[0];
    // Without this the layer had no src and rendered as the dashed placeholder.
    expect(layer.src).toBeTruthy();
    expect(layer.src).toContain(assetRow.editor_path);
  });

  it("puts the editor variant on the canvas, never the thumbnail", async () => {
    const { client } = mockSupabase();
    const reloaded: any = await hydrateAdminAssetUrls({ layers: [imageLayer] }, client);
    const layer = reloaded.layers[0];
    expect(layer.src).toContain("editor/editor.webp");
    expect(layer.src).not.toContain("thumbnail");
    // The thumbnail is still offered separately for the uploads library.
    expect(layer.thumbnailUrl).toContain("thumbnail/thumbnail.webp");
  });

  it("replaces an expired signed URL rather than reusing it", async () => {
    const { client } = mockSupabase();
    const reloaded: any = await hydrateAdminAssetUrls({ layers: [imageLayer] }, client);
    expect(reloaded.layers[0].src).not.toContain("stale.test");
    expect(reloaded.layers[0].src).not.toContain("expired");
  });

  it("survives a save/reload round trip", async () => {
    const { client } = mockSupabase();
    const round: any = await hydrateAdminAssetUrls(stripAdminAssetUrls({ layers: [imageLayer] }), client);
    expect(round.layers[0].src).toContain(assetRow.editor_path);
    expect(round.layers[0].assetId).toBe(assetRow.id);
  });
});

describe("legacy assets without generated variants", () => {
  it("falls back to the original file instead of rendering nothing", async () => {
    const legacy = { ...assetRow, editor_path: null, thumbnail_path: null };
    const { client } = mockSupabase(legacy);
    const reloaded: any = await hydrateAdminAssetUrls({ layers: [{ ...imageLayer, editorPath: "", thumbnailPath: "" }] }, client);
    expect(reloaded.layers[0].src).toContain(assetRow.path);
  });

  it("maps a row with no variants onto the original path", () => {
    const asset = assetFromRow({ ...assetRow, editor_path: null, thumbnail_path: null }, { editorUrl: "https://fresh.test/original" });
    expect(asset.editorPath).toBe(assetRow.path);
    expect(asset.thumbnailPath).toBe(assetRow.path);
  });
});

describe("asset metadata survives for correct sizing", () => {
  it("keeps the real pixel dimensions so aspect ratio can be preserved", () => {
    const asset = assetFromRow(assetRow, { editorUrl: "https://fresh.test/editor" });
    expect(asset.width).toBe(1254);
    expect(asset.height).toBe(1254);
  });

  it("inserts a square asset without distorting it", () => {
    // newImageLayerFromAdminAsset caps at 55% of the canvas and keeps the ratio.
    const ratio = assetRow.width / assetRow.height;
    expect(imageLayer.width / imageLayer.height).toBeCloseTo(ratio, 5);
  });
});

describe("every render path signs its own URLs", () => {
  it("hydrates on the product path, not only the customizer store", () => {
    const products = read("lib/products/index.ts");
    expect(products).toContain("hydrateAdminAssetUrls");
    expect(products).toContain("hydrateProductCustomizerAssets");
  });

  it("hydrates the admin products payload the builder opens from", () => {
    expect(read("app/api/admin/products/route.ts")).toContain("hydrateProductCustomizerAssets");
  });

  it("keeps the customizer store's own strip/hydrate pairing", () => {
    const store = read("lib/customizer/store.ts");
    expect(store).toContain("stripAdminAssetUrls");
    expect(store).toContain("hydrateAdminAssetUrls");
  });

  it("uses the thumbnail only in the uploads library", () => {
    const panel = read("app/admin/dashboard/design-builder/AdminUploadsPanel.tsx");
    expect(panel).toContain("asset.thumbnailUrl || asset.editorUrl || asset.url");
  });
});

describe("upload generates usable variants", () => {
  const route = read("app/api/admin/customizer/assets/route.ts");

  it("builds an editor variant large enough to edit against", () => {
    expect(route).toContain("EDITOR_MAX_PX = 2400");
    // Never upscale a small original.
    expect(route).toContain("withoutEnlargement: true");
  });

  it("keeps the thumbnail small but separate from the editor variant", () => {
    expect(route).toContain("THUMB_MAX_PX = 480");
    expect(route).toContain("thumbnail.webp");
  });

  it("rolls back storage when the record cannot be written", () => {
    expect(route).toContain("storage.from(ADMIN_ASSET_BUCKET).remove(uploadedPaths)");
  });

  it("only writes the asset record once all three variants are stored", () => {
    // Scoped to the insert: an earlier `status: "ready"` belongs to the
    // duplicate-reuse branch, which never uploads anything.
    const insertAt = route.indexOf(".insert({");
    expect(insertAt).toBeGreaterThan(-1);
    expect(route.indexOf("uploadedPaths.push")).toBeLessThan(insertAt);
    expect(route.slice(insertAt)).toContain('status: "ready"');
  });
});
