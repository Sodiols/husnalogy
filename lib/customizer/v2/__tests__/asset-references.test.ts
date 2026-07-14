import { describe, expect, it } from "vitest";
import {
  assetReferenceHashMaterial,
  collectCustomerAssetReferences,
  hydratePrivateAssetUrls,
  stripEphemeralAssetUrls,
  type CustomerAssetReference,
} from "../asset-references";
import { canActorAccessAsset } from "../../server/private-assets";

const reference: CustomerAssetReference = {
  version: 1,
  assetId: "asset-a",
  ownerId: "customer-a",
  bucket: "customer-uploads",
  storagePath: "customer-a/customizer/photo/original.jpg",
  editorStoragePath: "customer-a/customizer/photo/editor.webp",
  thumbnailStoragePath: "customer-a/customizer/photo/thumb.webp",
  originalFileName: "photo.jpg",
  mimeType: "image/jpeg",
  fileSize: 1234,
  width: 2000,
  height: 1400,
  checksum: "abc",
  createdAt: "2026-07-14T00:00:00.000Z",
};

describe("permanent customer asset references", () => {
  it("removes temporary URLs from normal, grid and background images", () => {
    const payload = {
      normal: { assetReference: reference, signedUrl: "https://old.test/a?token=expired", url: "https://old.test/a" },
      grid: { assetReference: reference, src: "https://old.test/grid?token=expired", transform: { zoom: 2 } },
      background: { assetReference: reference, src: "https://old.test/background?token=expired", type: "background" },
    };
    const stored: any = stripEphemeralAssetUrls(payload);
    expect(stored.normal.signedUrl).toBeUndefined();
    expect(stored.grid.src).toBeUndefined();
    expect(stored.background.src).toBeUndefined();
    expect(collectCustomerAssetReferences(stored)).toEqual([reference]);
  });

  it("refreshes every private image through one resolver after old URLs expire", async () => {
    const payload = {
      normal: { assetReference: reference, signedUrl: "expired" },
      grid: { assetReference: reference, src: "expired" },
      background: { assetReference: reference, src: "expired" },
    };
    let calls = 0;
    const hydrated: any = await hydratePrivateAssetUrls(payload, async (asset, variant) => {
      calls += 1;
      return { reference: asset, variant, signedUrl: "https://fresh.test/editor", expiresAt: "2099-01-01T00:00:00.000Z" };
    });
    expect(calls).toBe(1);
    expect(hydrated.normal.signedUrl).toBe("https://fresh.test/editor");
    expect(hydrated.grid.src).toBe("https://fresh.test/editor");
    expect(hydrated.background.src).toBe("https://fresh.test/editor");
  });

  it("keeps hashes stable across signed URL token changes and enforces ownership", () => {
    const first = { assetReference: reference, signedUrl: "https://x.test/a?token=one" };
    const second = { assetReference: reference, signedUrl: "https://x.test/a?token=two" };
    expect(assetReferenceHashMaterial(first)).toEqual(assetReferenceHashMaterial(second));
    expect(canActorAccessAsset("customer-a", { userId: "customer-a" })).toBe(true);
    expect(canActorAccessAsset("customer-a", { userId: "customer-b" })).toBe(false);
    expect(canActorAccessAsset("customer-a", { administrator: true })).toBe(true);
    expect(canActorAccessAsset("customer-a", { productionWorker: true })).toBe(true);
  });
});
