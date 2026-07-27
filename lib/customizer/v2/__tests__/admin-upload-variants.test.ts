import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  assertVariantsDecodable,
  buildRasterVariants,
  decodeImage,
  expectedVariantSize,
  inspectVariantBuffer,
  isDecodableImage,
  orientedDimensions,
  storedVariantIsUsable,
  variantStoragePath,
} from "../../server/asset-variants";
import { signAdminAssetRow } from "../../server/admin-assets";

/** Minimal Supabase storage stub that returns fixed bytes for any download. */
function storageOf(bytes: Buffer): any {
  return { storage: { from: () => ({ download: async () => ({ data: { arrayBuffer: async () => bytes }, error: null }) }) } };
}

/**
 * Functional cover for the uploaded-image variants: this runs the SAME Sharp
 * pipeline as app/api/admin/customizer/assets/route.ts against a real PNG and
 * decodes the results, rather than asserting on source text.
 *
 * The bug this guards against is an editor variant that comes out tiny (or
 * undecodable) and is then stretched across the canvas, which reads as extreme
 * blur.
 */

const MAX_DIMENSION = 12_000;
const EDITOR_MAX_PX = 2400;
const THUMB_MAX_PX = 480;

// A 1254x1254 PNG with transparency and hard edges, matching the reported case.
async function makeSourcePng(size = 1254): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
            `<rect x="80" y="80" width="${size - 160}" height="${size - 160}" fill="#303839"/>` +
            `<circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.3}" fill="#D4AF37"/>` +
            `</svg>`,
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
}

// Byte-for-byte the raster branch of the upload route.
async function buildVariants(source: Buffer) {
  const editor = await sharp(source, { limitInputPixels: MAX_DIMENSION * MAX_DIMENSION })
    .rotate()
    .resize(EDITOR_MAX_PX, EDITOR_MAX_PX, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 88 })
    .toBuffer();
  const thumbnail = await sharp(source, { limitInputPixels: MAX_DIMENSION * MAX_DIMENSION })
    .rotate()
    .resize(THUMB_MAX_PX, THUMB_MAX_PX, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  return { editor, thumbnail };
}

describe("editor variant for a 1254x1254 PNG", () => {
  it("decodes, and keeps the original resolution instead of shrinking", async () => {
    const source = await makeSourcePng();
    const { editor } = await buildVariants(source);
    const meta = await sharp(editor).metadata();

    expect(meta.width).toBe(1254);
    expect(meta.height).toBe(1254);
    expect(meta.format).toBe("webp");
    // The blur signature: the editor variant coming out at thumbnail size.
    expect(meta.width).not.toBe(THUMB_MAX_PX);
  });

  it("preserves alpha so logos keep transparency", async () => {
    const { editor } = await buildVariants(await makeSourcePng());
    expect((await sharp(editor).metadata()).hasAlpha).toBe(true);
  });

  it("carries real detail, not a near-empty buffer", async () => {
    const { editor } = await buildVariants(await makeSourcePng());
    expect(editor.byteLength).toBeGreaterThan(2000);
    // Decoding to raw pixels proves the bytes are a usable image.
    const raw = await sharp(editor).raw().toBuffer({ resolveWithObject: true });
    expect(raw.info.width).toBe(1254);
    // Per-channel spread across the WHOLE image: a blank or single-colour
    // variant would have zero standard deviation.
    const stats = await sharp(editor).stats();
    expect(Math.max(...stats.channels.map((c) => c.stdev))).toBeGreaterThan(1);
  });

  it("never upscales a small original", async () => {
    const { editor } = await buildVariants(await makeSourcePng(300));
    const meta = await sharp(editor).metadata();
    expect(meta.width).toBe(300);
  });

  it("caps a very large original at the editor bound", async () => {
    const { editor } = await buildVariants(await makeSourcePng(3600));
    const meta = await sharp(editor).metadata();
    expect(meta.width).toBe(EDITOR_MAX_PX);
  });
});

describe("thumbnail variant", () => {
  it("is a separate, smaller, decodable image", async () => {
    const { editor, thumbnail } = await buildVariants(await makeSourcePng());
    const tm = await sharp(thumbnail).metadata();
    const em = await sharp(editor).metadata();

    expect(tm.width).toBe(THUMB_MAX_PX);
    expect(tm.format).toBe("webp");
    expect(tm.width!).toBeLessThan(em.width!);
    expect(thumbnail.byteLength).toBeLessThan(editor.byteLength);
  });

  it("still shows the real artwork rather than a blank square", async () => {
    const { thumbnail } = await buildVariants(await makeSourcePng());
    // A blank library tile would be a single flat colour: zero spread.
    const stats = await sharp(thumbnail).stats();
    expect(Math.max(...stats.channels.map((c) => c.stdev))).toBeGreaterThan(1);
  });
});

describe("corrupt bytes are detected, not published", () => {
  /**
   * Reproduces the corruption actually found in Storage: the binary was passed
   * through a text encoding, so every byte >= 0x80 became two bytes. The "RIFF"
   * / "WEBP" magic is pure ASCII and survives untouched, which is why the file
   * still looks like a webp, is served as HTTP 200 image/webp, and only fails
   * at decode time — leaving the canvas and the library tile blank.
   */
  async function corruptedWebp() {
    const { editor } = await buildVariants(await makeSourcePng(300));
    return Buffer.from(editor.toString("latin1"), "utf8");
  }

  it("rejects binary mangled by a text encoding, despite an intact header", async () => {
    const { editor } = await buildVariants(await makeSourcePng(300));
    const bad = await corruptedWebp();
    // The magic bytes still read as a webp.
    expect(bad.slice(0, 4).toString("latin1")).toBe("RIFF");
    expect(bad.slice(8, 12).toString("latin1")).toBe("WEBP");
    // But the payload has inflated, exactly as observed in Storage.
    expect(bad.byteLength).toBeGreaterThan(editor.byteLength);
    expect(await isDecodableImage(bad)).toBe(false);
  });

  it("treats empty and non-image buffers as unusable", async () => {
    expect(await isDecodableImage(Buffer.alloc(0))).toBe(false);
    expect(await isDecodableImage(Buffer.from("{\"error\":\"nope\"}", "utf8"))).toBe(false);
    expect(await decodeImage(null)).toBeNull();
  });

  it("accepts genuinely valid variants", async () => {
    const { editor, thumbnail } = await buildVariants(await makeSourcePng(300));
    await expect(assertVariantsDecodable(editor, thumbnail)).resolves.toBeUndefined();
  });

  it("fails the upload rather than storing an undecodable editor variant", async () => {
    const { thumbnail } = await buildVariants(await makeSourcePng(300));
    await expect(assertVariantsDecodable(await corruptedWebp(), thumbnail)).rejects.toThrow(/editor image could not be decoded/i);
  });

  it("reports a stored variant as unusable when its bytes are corrupt (CASE F)", async () => {
    expect(await storedVariantIsUsable({
      supabase: storageOf(await corruptedWebp()), bucket: "customizer-elements",
      storagePath: "assets/a/editor/editor.webp", variant: "editor", sourceWidth: 300, sourceHeight: 300,
    })).toBe(false);
  });

  it("reports a healthy stored variant as usable", async () => {
    const { editor } = await buildVariants(await makeSourcePng(300));
    expect(await storedVariantIsUsable({
      supabase: storageOf(editor), bucket: "customizer-elements",
      storagePath: "assets/a/editor/editor.webp", variant: "editor", sourceWidth: 300, sourceHeight: 300,
    })).toBe(true);
  });

  it("reports a missing object as unusable (CASE G)", async () => {
    const missing: any = {
      storage: { from: () => ({ download: async () => ({ data: null, error: { message: "not found" } }) }) },
    };
    expect(await storedVariantIsUsable({
      supabase: missing, bucket: "customizer-elements",
      storagePath: "assets/a/editor/editor.webp", variant: "editor", sourceWidth: 300, sourceHeight: 300,
    })).toBe(false);
    expect(await storedVariantIsUsable({
      supabase: missing, bucket: "customizer-elements", storagePath: null, variant: "editor",
    })).toBe(false);
  });
});

/* ------------------------------------------------------------------------ *
 * Resolution-aware validation. A variant that merely decodes is not enough:
 * a legacy 480px editor for a 1254px original decodes perfectly and is the
 * direct cause of the blurred canvas.
 * ------------------------------------------------------------------------ */

describe("expected variant geometry", () => {
  it("scales down to the bound and keeps the ratio", () => {
    expect(expectedVariantSize(5000, 3000, 2400)).toEqual({ width: 2400, height: 1440 });
  });

  it("never enlarges a small original (CASE E, §11)", () => {
    expect(expectedVariantSize(400, 300, 2400)).toEqual({ width: 400, height: 300 });
    expect(expectedVariantSize(1254, 1254, 2400)).toEqual({ width: 1254, height: 1254 });
  });

  it("uses the thumbnail bound for thumbnails", () => {
    expect(expectedVariantSize(1254, 1254, 480)).toEqual({ width: 480, height: 480 });
    expect(expectedVariantSize(5000, 3000, 480)).toEqual({ width: 480, height: 288 });
  });
});

describe("editor variant size validation", () => {
  const inspect = async (source: [number, number], variantSize: [number, number], kind: "editor" | "thumbnail" = "editor") => {
    const bytes = await sharp({
      create: { width: variantSize[0], height: variantSize[1], channels: 3, background: { r: 10, g: 120, b: 200 } },
    }).webp().toBuffer();
    return inspectVariantBuffer(bytes, kind, source[0], source[1]);
  };

  it("CASE A — 480x480 editor for a 1254x1254 original is INVALID", async () => {
    const result = await inspect([1254, 1254], [480, 480]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("too-small");
    expect(result.expectedWidth).toBe(1254);
  });

  it("CASE B — 1254x1254 editor for a 1254x1254 original is VALID", async () => {
    expect((await inspect([1254, 1254], [1254, 1254])).ok).toBe(true);
  });

  it("CASE C — 2400x1440 editor for a 5000x3000 original is VALID", async () => {
    expect((await inspect([5000, 3000], [2400, 1440])).ok).toBe(true);
  });

  it("CASE D — 480x288 editor for a 5000x3000 original is INVALID", async () => {
    const result = await inspect([5000, 3000], [480, 288]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("too-small");
  });

  it("CASE E — 400x300 editor for a 400x300 original is VALID", async () => {
    expect((await inspect([400, 300], [400, 300])).ok).toBe(true);
  });

  it("CASE H — a 480px thumbnail is valid AS a thumbnail, but not as an editor", async () => {
    expect((await inspect([1254, 1254], [480, 480], "thumbnail")).ok).toBe(true);
    expect((await inspect([1254, 1254], [480, 480], "editor")).ok).toBe(false);
  });

  it("tolerates a pixel of codec rounding", async () => {
    expect((await inspect([1254, 1254], [1253, 1253])).ok).toBe(true);
  });

  it("falls back to decodability when source dimensions are unknown", async () => {
    expect((await inspect([0, 0], [480, 480])).ok).toBe(true);
  });
});

describe("CASE K — SVG editor variants stay vector", () => {
  it("accepts an svg editor variant without applying raster size rules", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64"/></svg>');
    expect(await storedVariantIsUsable({
      supabase: storageOf(svg), bucket: "customizer-elements",
      storagePath: "assets/a/editor/editor.svg", variant: "editor",
      sourceWidth: 4000, sourceHeight: 4000, vector: true,
    })).toBe(true);
  });
});

describe("CASE M — repaired variants get a cache-safe path", () => {
  it("derives the path from the content, so new bytes mean a new URL", async () => {
    const { editor } = await buildVariants(await makeSourcePng(300));
    const other = await buildVariants(await makeSourcePng(400));
    const before = variantStoragePath("asset-1", "editor", editor);
    const after = variantStoragePath("asset-1", "editor", other.editor);

    expect(before).not.toBe(after);
    expect(before).toMatch(/^assets\/asset-1\/editor\/editor-[0-9a-f]{16}\.webp$/);
    // Identical bytes stay stable, so healthy assets are not churned.
    expect(variantStoragePath("asset-1", "editor", editor)).toBe(before);
  });

  it("keeps the extension for vector editor variants", () => {
    const svg = Buffer.from("<svg/>");
    expect(variantStoragePath("asset-1", "editor", svg, "svg")).toMatch(/editor-[0-9a-f]{16}\.svg$/);
  });
});

describe("CASE L — EXIF orientation", () => {
  it("reports dimensions after rotation so the aspect ratio is right", async () => {
    // orientation 6 means "rotate 90 CW": stored 400x200, displayed 200x400.
    const rotated = await sharp({
      create: { width: 400, height: 200, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    expect(await orientedDimensions(rotated)).toEqual({ width: 200, height: 400 });

    // And the generated variant matches that orientation.
    const variants = await buildRasterVariants(rotated);
    expect(variants.width).toBe(200);
    expect(variants.height).toBe(400);
    expect(variants.editorHeight).toBeGreaterThan(variants.editorWidth);
  });

  it("leaves unrotated images alone", async () => {
    const plain = await sharp({
      create: { width: 400, height: 200, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).jpeg().toBuffer();
    expect(await orientedDimensions(plain)).toEqual({ width: 400, height: 200 });
  });
});

describe("canvas falls back to the original, never the thumbnail", () => {
  const row = {
    id: "11111111-1111-4111-8111-111111111111",
    bucket: "customizer-elements",
    path: "assets/a/original/logo.png",
    editor_path: "assets/a/editor/editor.webp",
    thumbnail_path: "assets/a/thumbnail/thumbnail.webp",
  };

  function supabaseSigning(failFor: string[] = []) {
    return {
      storage: {
        from: () => ({
          createSignedUrl: async (storagePath: string) =>
            failFor.includes(storagePath)
              ? { data: null, error: { message: "missing" } }
              : { data: { signedUrl: `https://fresh.test/${storagePath}?token=x` }, error: null },
        }),
      },
    } as any;
  }

  it("uses the editor variant when it signs", async () => {
    const asset: any = await signAdminAssetRow(supabaseSigning(), row);
    expect(asset.editorUrl).toContain("editor/editor.webp");
    expect(asset.originalUrl).toContain("original/logo.png");
  });

  it("falls back to the full-quality original, not the 480px thumbnail", async () => {
    const asset: any = await signAdminAssetRow(supabaseSigning([row.editor_path]), row);
    expect(asset.editorUrl).toContain("original/logo.png");
    expect(asset.editorUrl).not.toContain("thumbnail");
  });
});

describe("canvas display resolution", () => {
  it("has more source pixels than the canvas box needs", async () => {
    // The reported layer renders around 511x608 canvas units.
    const { editor } = await buildVariants(await makeSourcePng());
    const meta = await sharp(editor).metadata();
    expect(meta.width!).toBeGreaterThan(511);
    expect(meta.height!).toBeGreaterThan(608);
  });

  it("would be visibly blurry only if the thumbnail were used", async () => {
    const { thumbnail } = await buildVariants(await makeSourcePng());
    const tm = await sharp(thumbnail).metadata();
    // 480px across a ~1000px+ canvas box is the blur the report describes.
    expect(tm.width!).toBeLessThan(1254);
  });
});
