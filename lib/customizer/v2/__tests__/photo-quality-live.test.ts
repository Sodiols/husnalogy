/**
 * The Customer Customizer's live photo-quality warning (photo-quality.ts):
 * the same transform the canvas draws, recomputed on every edit.
 */
import { describe, expect, it } from "vitest";
import { lowResolutionPhotos } from "@/app/components/customizer/photo-quality";

const field = { id: "photo", label: "Your photo", type: "image" };
// A 4 × 5 in frame at 300 DPI.
const frame = { id: "photo_layer", name: "Photo", type: "image", fieldId: "photo", customerEditable: true, x: 600, y: 750, width: 1200, height: 1500 };
const value = (width: number, height: number) => ({
  url: "https://x.supabase.co/signed/p.webp",
  assetId: "lib-1",
  width,
  height,
  assetReference: { version: 1, assetId: "lib-1", ownerId: "u", bucket: "customer-uploads", storagePath: "u/original.jpg", originalFileName: "p.jpg", mimeType: "image/jpeg", fileSize: 1, width, height, createdAt: "" },
});
const check = (layers: any[], values: Record<string, any>, settings: any = null) =>
  lowResolutionPhotos({ layers, fields: [field], values, dpi: 300, settings });

describe("live photo-quality warning", () => {
  it("flags a photo too small for its frame, not one that is large enough", () => {
    expect(check([frame], { photo: value(600, 750) })).toEqual([{ layerId: "photo_layer", name: "Photo", ppi: 150 }]);
    expect(check([frame], { photo: value(2400, 3000) })).toEqual([]);
  });

  it("appears when the customer zooms in, disappears when they zoom back out", () => {
    const zoomed = { ...frame, imageTransform: { zoom: 2 } };
    expect(check([frame], { photo: value(1200, 1500) })).toEqual([]);
    expect(check([zoomed], { photo: value(1200, 1500) })[0]?.ppi).toBeCloseTo(150);
  });

  it("follows a crop and a resized frame", () => {
    const cropped = { ...frame, imageTransform: { cropX: 0.25, cropY: 0.25, cropWidth: 0.5, cropHeight: 0.5 } };
    expect(check([frame], { photo: value(1400, 1750) })).toEqual([]); // 350 PPI
    expect(check([cropped], { photo: value(1400, 1750) })[0]?.ppi).toBeCloseTo(175);
    const smaller = { ...frame, width: 600, height: 750 };
    expect(check([smaller], { photo: value(600, 750) })).toEqual([]);
  });

  it("ignores template artwork the customer cannot change, and empty frames", () => {
    const artwork = { ...frame, customerEditable: false, src: "https://x/art.png", sourceWidth: 100, sourceHeight: 100 };
    expect(check([artwork], {})).toEqual([]);
    expect(check([frame], {})).toEqual([]);
  });

  it("covers photos the customer put into a frame they added", () => {
    const userFrame = { id: "u1", name: "My frame", type: "frame", isUserLayer: true, x: 300, y: 300, width: 600, height: 600, src: "https://x/u.webp", assetReference: { width: 200, height: 200 } };
    expect(check([userFrame], {})[0]?.layerId).toBe("u1");
  });

  it("uses the product's threshold", () => {
    expect(check([frame], { photo: value(600, 750) }, { printQuality: { minImagePpi: 120 } })).toEqual([]);
  });
});
