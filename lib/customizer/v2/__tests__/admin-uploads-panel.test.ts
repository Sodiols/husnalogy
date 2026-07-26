import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { newImageLayerFromAdminAsset } from "@/app/admin/dashboard/design-builder/builder-utils";
import { stripAdminAssetUrls } from "../../server/admin-assets";

const root = process.cwd();
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

describe("administrator uploads panel contract", () => {
  it("opens as a persistent contextual tool instead of opening the picker from the rail", () => {
    const rail = read("app/admin/dashboard/design-builder/AdminToolRail.tsx");
    const builder = read("app/admin/dashboard/design-builder/AdminDesignBuilder.tsx");
    expect(rail).toContain('label="Uploads"');
    expect(rail).toContain('props.onSelectTool("uploads")');
    expect(rail).not.toContain("imageInput");
    expect(builder).toContain('activeTool === "uploads"');
    expect(builder).toContain("<AdminUploadsPanel");
  });

  it("loads the global library with search and pagination and reuses saved assets", () => {
    const panel = read("app/admin/dashboard/design-builder/AdminUploadsPanel.tsx");
    expect(panel).toContain("/api/admin/customizer/assets?");
    expect(panel).toContain('query.set("search"');
    expect(panel).toContain("page + 1");
    expect(panel).toContain("Load more");
    expect(panel).not.toContain("productId");
    expect(panel).not.toContain("templateId");
    expect(panel).toContain("onInsertAsset(asset)");
  });

  it("uploads through the shared helper and exposes progress, retry, duplicate, and safe delete states", () => {
    const panel = read("app/admin/dashboard/design-builder/AdminUploadsPanel.tsx");
    expect(panel).toContain('uploadBuilderImage(file, "image"');
    expect(panel).toContain("onProgress: setUploadProgress");
    expect(panel).toContain("Retry {retryFile.name}");
    expect(panel).toContain("asset.duplicate");
    expect(panel).toContain('body: JSON.stringify({ archived: true })');
    expect(panel).toContain('method: "DELETE"');
    expect(panel).toContain("payload.usage");
  });

  it("creates an image layer with permanent paths and only an ephemeral preview URL", () => {
    const layer = newImageLayerFromAdminAsset(
      { canvasWidthPx: 1500, canvasHeightPx: 2100, layers: [] },
      "front",
      {
        id: "11111111-1111-4111-8111-111111111111",
        title: "Family photo",
        url: "https://signed.test/editor?token=temporary",
        editorUrl: "https://signed.test/editor?token=temporary",
        thumbnailUrl: "https://signed.test/thumb?token=temporary",
        bucket: "customizer-elements",
        originalPath: "assets/a/original/photo.png",
        editorPath: "assets/a/editor/editor.webp",
        thumbnailPath: "assets/a/thumbnail/thumbnail.webp",
        originalFilename: "photo.png",
        mimeType: "image/png",
        width: 2000,
        height: 1000,
      },
    );
    expect(layer.assetId).toBe("11111111-1111-4111-8111-111111111111");
    expect(layer.bucket).toBe("customizer-elements");
    expect(layer.originalPath).toContain("/original/");
    expect(layer.editorPath).toContain("/editor/");
    expect(layer.thumbnailPath).toContain("/thumbnail/");
    expect(layer.width / layer.height).toBeCloseTo(2, 1);
    expect((stripAdminAssetUrls(layer) as any).src).toBeUndefined();
  });
});

describe("customer upload deletion contract", () => {
  it("shows a persistent icon action with confirmation and keeps storage metadata synchronized", () => {
    const panel = read("app/components/customizer/CustomerUploadsPanel.tsx");
    const route = read("app/api/customizer/library/[id]/route.ts");
    expect(panel).toContain("window.confirm");
    expect(panel).toContain("Delete ${asset.fileName} from library");
    expect(panel).toContain("deletingId === asset.id");
    expect(route).toContain('from("customer_asset_library").delete()');
    expect(route).toContain('from("customer_asset_library").insert(asset)');
    expect(route).toContain("storageError");
  });
});
