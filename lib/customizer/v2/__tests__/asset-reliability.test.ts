// P0 image reliability: durable identity, URL-free recovery, fresh server
// hydration and new-upload variant validation.
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { assetIdentityOf, signedUrlExpiry, stripRuntimeAssetUrls } from "../asset-identity";
import { clearStudioRecovery, readStudioRecovery, studioRecoveryDiffers, studioRecoveryKey, writeStudioRecovery } from "@/lib/customizer/studio-recovery";
import { hydrateAdminAssetUrls } from "@/lib/customizer/server/admin-assets";
import { assertVariantsSized, buildRasterVariants } from "@/lib/customizer/server/asset-variants";
import { resolveLayerImage } from "@/app/components/customizer/customizer-utils";
import { isAdminCroppableLayer } from "@/app/admin/dashboard/design-builder/builder-utils";

const ASSET = "6f1c1c5e-3b2a-4f7e-9a10-0c4a2b7d9e11";
const jwt = (exp: number) => `h.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.s`;
const signed = (path: string, exp: number) => `https://proj.supabase.co/storage/v1/object/sign/customizer-elements/${path}?token=${jwt(exp)}`;

/** An image layer exactly as the studio holds it: identity + geometry + hydrated credentials. */
const hydratedPhoto = (exp = 1_900_000_000) => ({
  id: "photo",
  type: "image",
  page: "front",
  x: 420,
  y: 610,
  width: 640,
  height: 480,
  rotation: 12,
  zIndex: 3,
  assetId: ASSET,
  bucket: "customizer-elements",
  path: `assets/${ASSET}/original/photo.jpg`,
  originalPath: `assets/${ASSET}/original/photo.jpg`,
  editorPath: `assets/${ASSET}/editor/editor-abc.webp`,
  thumbnailPath: `assets/${ASSET}/thumbnail/thumbnail-def.webp`,
  sourceWidth: 4000,
  sourceHeight: 3000,
  imageTransform: { zoom: 1.6, offsetX: 24, offsetY: -8, cropX: 0.1, cropY: 0.05, cropWidth: 0.7, cropHeight: 0.7, flipX: true, rotation: 5 },
  mask: { kind: "rounded", radius: 40 },
  src: signed(`assets/${ASSET}/editor/editor-abc.webp`, exp),
  url: signed(`assets/${ASSET}/original/photo.jpg`, exp),
  originalUrl: signed(`assets/${ASSET}/original/photo.jpg`, exp),
  editorUrl: signed(`assets/${ASSET}/editor/editor-abc.webp`, exp),
  thumbnailUrl: signed(`assets/${ASSET}/thumbnail/thumbnail-def.webp`, exp),
  expiresAt: new Date(exp * 1000).toISOString(),
});

const DESIGN_KEYS = ["id", "x", "y", "width", "height", "rotation", "zIndex", "page", "assetId", "bucket", "originalPath", "editorPath", "thumbnailPath", "imageTransform", "mask"];
const designOf = (layer: any) => Object.fromEntries(DESIGN_KEYS.map((key) => [key, layer[key]]));

describe("a signed URL is not an image identity", () => {
  it("recognises library assets and customer uploads by their durable identity", () => {
    expect(assetIdentityOf(hydratedPhoto())).toEqual({ kind: "library", key: `library:${ASSET}`, assetId: ASSET });
    const upload = { assetReference: { version: 1, assetId: "up-1", ownerId: "user-1", bucket: "customer-uploads", storagePath: "user-1/customizer/p/original.jpg" }, signedUrl: "https://x" };
    expect(assetIdentityOf(upload)).toMatchObject({ kind: "customer", key: "customer:up-1" });
    // Pictures with no identity (data URLs, legacy external URLs) have none.
    expect(assetIdentityOf({ src: "data:image/png;base64,AAA" })).toBeNull();
    expect(assetIdentityOf({ assetId: "not-a-uuid", src: "x" })).toBeNull();
  });

  it("reads a signed URL's expiry from its own token", () => {
    expect(signedUrlExpiry(signed("a.webp", 1_700_000_000))).toBe(1_700_000_000_000);
    expect(signedUrlExpiry("https://example.com/a.png")).toBeNull();
    expect(signedUrlExpiry("data:image/png;base64,AAA")).toBeNull();
  });

  it("stripping credentials keeps every design property — position, size, rotation, crop, mask, identity", () => {
    const stripped = stripRuntimeAssetUrls({ layers: [hydratedPhoto()] }).layers[0] as any;
    for (const key of ["src", "url", "originalUrl", "editorUrl", "thumbnailUrl", "expiresAt"]) expect(stripped).not.toHaveProperty(key);
    expect(designOf(stripped)).toEqual(designOf(hydratedPhoto()));
  });

  it("a photo with an identity but no URL is still a picture: drawn, croppable, resolved by identity", () => {
    const stripped = stripRuntimeAssetUrls({ layers: [hydratedPhoto()] }).layers[0];
    const image = resolveLayerImage(stripped, null, {});
    expect(image).toMatchObject({ source: "layer", url: "", zoom: 1.6, flipX: true, imageRotation: 5 });
    expect(assetIdentityOf(image!.asset)).toMatchObject({ kind: "library", assetId: ASSET });
    expect(isAdminCroppableLayer(stripped)).toBe(true);
  });
});

describe("crash recovery never stores or restores a signed URL", () => {
  const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), removeItem: (key: string) => void data.delete(key), raw: data };
  };

  it("a snapshot is written without credentials and read back with every design property intact", () => {
    const storage = memory();
    const key = studioRecoveryKey("prod-1");
    writeStudioRecovery(storage, key, { productId: "prod-1", productName: "Card", template: { layers: [hydratedPhoto()] } });
    expect(storage.raw.get(key)).not.toContain("token=");
    const restored = readStudioRecovery(storage, key)!;
    expect(designOf((restored.template.layers as any[])[0])).toEqual(designOf(hydratedPhoto()));
    clearStudioRecovery(storage, key);
  });

  it("an old snapshot that still holds expired URLs is restored without them", () => {
    const storage = memory();
    const key = studioRecoveryKey("prod-1");
    storage.setItem(key, JSON.stringify({ productId: "prod-1", productName: "Card", savedAt: "2026-01-01", template: { layers: [hydratedPhoto(1_000)] } }));
    const restored = readStudioRecovery(storage, key)!.template.layers as any[];
    expect(restored[0]).not.toHaveProperty("src");
    expect(restored[0].assetId).toBe(ASSET);
  });

  it("fresher credentials alone never make a design look different", () => {
    const storage = memory();
    const key = studioRecoveryKey("prod-1");
    writeStudioRecovery(storage, key, { productId: "prod-1", productName: "Card", template: { layers: [hydratedPhoto(1_000)] } });
    const snapshot = readStudioRecovery(storage, key);
    expect(studioRecoveryDiffers(snapshot, { layers: [hydratedPhoto(1_999_999_999)] })).toBe(false);
    expect(studioRecoveryDiffers(snapshot, { layers: [{ ...hydratedPhoto(), x: 421 }] })).toBe(true);
  });
});

describe("server rendering resolves fresh credentials from identity", () => {
  it("replaces a stale stored URL with a freshly signed editor URL and changes nothing else", async () => {
    const issued: string[] = [];
    const supabase = {
      from: () => ({
        select: () => ({
          in: () => ({
            in: async () => ({
              data: [{ id: ASSET, bucket: "customizer-elements", path: `assets/${ASSET}/original/photo.jpg`, editor_path: `assets/${ASSET}/editor/editor-abc.webp`, thumbnail_path: `assets/${ASSET}/thumbnail/thumbnail-def.webp`, status: "ready", title: "Photo" }],
              error: null,
            }),
          }),
        }),
      }),
      storage: {
        from: () => ({
          createSignedUrl: async (path: string) => {
            issued.push(path);
            return { data: { signedUrl: `https://fresh/${path}?token=${jwt(2_000_000_000)}` }, error: null };
          },
        }),
      },
    };
    const stale = { ...hydratedPhoto(1_000) };
    const hydrated: any = await hydrateAdminAssetUrls({ layers: [stale] }, supabase, 3600, "studio");
    expect(hydrated.layers[0].src).toBe(`https://fresh/assets/${ASSET}/editor/editor-abc.webp?token=${jwt(2_000_000_000)}`);
    expect(hydrated.layers[0].originalUrl).toContain("/original/photo.jpg");
    // The thumbnail is never the canvas source.
    expect(hydrated.layers[0].src).not.toContain("thumbnail");
    expect(designOf(hydrated.layers[0])).toEqual(designOf(stale));
  });
});

describe("new uploads can never store a thumbnail-sized editor image", () => {
  it("generates a full-size editor variant for a large photo", async () => {
    const source = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#996633" } }).jpeg().toBuffer();
    const variants = await buildRasterVariants(source);
    expect([variants.editorWidth, variants.editorHeight]).toEqual([2400, 1600]);
    expect(Math.max(variants.thumbnailWidth, variants.thumbnailHeight)).toBe(480);
  });

  it("rejects an editor variant produced at thumbnail size", async () => {
    const thumb = await sharp({ create: { width: 480, height: 320, channels: 3, background: "#996633" } }).webp().toBuffer();
    await expect(assertVariantsSized(thumb, thumb, 3000, 2000)).rejects.toThrow(/needs about 2400x1600/);
  });
});
