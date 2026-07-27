import { createHash } from "node:crypto";
import sharp from "sharp";

// The single authoritative implementation of admin customizer asset variants:
// dimensions, quality, orientation, decoding, and validation. The upload route,
// the duplicate-repair path and the repair script all go through here so their
// behaviour cannot drift apart.
//
// Two properties matter and are easy to get wrong:
//
//  1. A variant that merely DECODES is not necessarily correct. A legacy
//     480x480 editor file decodes perfectly, and stretching it across a large
//     canvas is exactly the blur this module exists to prevent. Validation is
//     therefore resolution aware.
//  2. Storage objects are cached for a year. Rewriting bytes at a fixed path
//     leaves browsers and CDNs serving the old image, so generated variants
//     live at content-addressed paths and a repair produces a NEW path.

export const ASSET_MAX_DIMENSION = 12_000;
export const ASSET_EDITOR_MAX_PX = 2400;
export const ASSET_THUMB_MAX_PX = 480;

/** Bumped when generation rules change, so old variants can be identified. */
export const VARIANT_GENERATION_VERSION = 2;

// Codecs and rounding can shift a dimension by a pixel; anything beyond this is
// a genuinely wrong-sized variant rather than a rounding artefact.
const SIZE_TOLERANCE_RATIO = 0.98;

export type VariantKind = "editor" | "thumbnail";

export type AssetVariants = {
  editorBuffer: Buffer;
  thumbnailBuffer: Buffer;
  editorMime: string;
  editorExtension: string;
  /** Source dimensions AFTER EXIF orientation is applied. */
  width: number;
  height: number;
  editorWidth: number;
  editorHeight: number;
  thumbnailWidth: number;
  thumbnailHeight: number;
};

const limits = { limitInputPixels: ASSET_MAX_DIMENSION * ASSET_MAX_DIMENSION };

export function variantMaxPx(variant: VariantKind): number {
  return variant === "editor" ? ASSET_EDITOR_MAX_PX : ASSET_THUMB_MAX_PX;
}

/**
 * The size a variant SHOULD be: scaled to fit inside the bound, never enlarged.
 * Mirrors sharp's `fit: "inside", withoutEnlargement: true`.
 */
export function expectedVariantSize(sourceWidth: number, sourceHeight: number, maxPx: number) {
  const width = Math.max(1, Math.round(sourceWidth));
  const height = Math.max(1, Math.round(sourceHeight));
  const longest = Math.max(width, height);
  if (!longest || longest <= maxPx) return { width, height };
  const scale = maxPx / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Source dimensions with EXIF orientation applied.
 *
 * sharp reports pre-rotation metadata, so a phone photo tagged 90 degrees would
 * otherwise be recorded transposed and the layer would be created with an
 * inverted aspect ratio.
 */
export async function orientedDimensions(source: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(source, limits).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  const swap = typeof meta.orientation === "number" && meta.orientation >= 5 && meta.orientation <= 8;
  return swap ? { width: height, height: width } : { width, height };
}

export async function decodeImage(buffer: Buffer | null | undefined) {
  if (!buffer?.byteLength) return null;
  try {
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height) return null;
    return { width: meta.width, height: meta.height, format: String(meta.format || "") };
  } catch {
    return null;
  }
}

export async function isDecodableImage(buffer: Buffer | null | undefined): Promise<boolean> {
  return (await decodeImage(buffer)) !== null;
}

export async function assertVariantsDecodable(editorBuffer: Buffer, thumbnailBuffer: Buffer) {
  if (!(await decodeImage(editorBuffer))) throw new Error("The optimized editor image could not be decoded after generation.");
  if (!(await decodeImage(thumbnailBuffer))) throw new Error("The generated thumbnail could not be decoded after generation.");
}

/* ----------------------------------------------------------- generation -- */

export async function buildRasterVariants(source: Buffer): Promise<AssetVariants> {
  const { width, height } = await orientedDimensions(source);
  if (!width || !height || width > ASSET_MAX_DIMENSION || height > ASSET_MAX_DIMENSION) {
    throw new Error(`Images must be readable and no larger than ${ASSET_MAX_DIMENSION}px per side.`);
  }

  const editorBuffer = await sharp(source, limits)
    .rotate()
    .resize(ASSET_EDITOR_MAX_PX, ASSET_EDITOR_MAX_PX, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 88 })
    .toBuffer();
  const thumbnailBuffer = await sharp(source, limits)
    .rotate()
    .resize(ASSET_THUMB_MAX_PX, ASSET_THUMB_MAX_PX, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  await assertVariantsDecodable(editorBuffer, thumbnailBuffer);
  const editorMeta = (await decodeImage(editorBuffer))!;
  const thumbnailMeta = (await decodeImage(thumbnailBuffer))!;

  return {
    editorBuffer,
    thumbnailBuffer,
    editorMime: "image/webp",
    editorExtension: "webp",
    width,
    height,
    editorWidth: editorMeta.width,
    editorHeight: editorMeta.height,
    thumbnailWidth: thumbnailMeta.width,
    thumbnailHeight: thumbnailMeta.height,
  };
}

/** SVG stays vector: the sanitized source IS the editor variant. */
export async function buildSvgVariants(sanitizedSvg: Buffer): Promise<AssetVariants> {
  const { width, height } = await orientedDimensions(sanitizedSvg);
  const thumbnailBuffer = await sharp(sanitizedSvg, limits)
    .resize(ASSET_THUMB_MAX_PX, ASSET_THUMB_MAX_PX, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  const thumbnailMeta = await decodeImage(thumbnailBuffer);
  if (!thumbnailMeta) throw new Error("The generated thumbnail could not be decoded after generation.");

  return {
    editorBuffer: sanitizedSvg,
    thumbnailBuffer,
    editorMime: "image/svg+xml",
    editorExtension: "svg",
    width,
    height,
    editorWidth: width,
    editorHeight: height,
    thumbnailWidth: thumbnailMeta.width,
    thumbnailHeight: thumbnailMeta.height,
  };
}

/* -------------------------------------------------------- cache safety -- */

export function contentHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

/**
 * Content-addressed variant path. Because the hash changes whenever the bytes
 * change, a repaired variant lands on a NEW url and the year-long cache header
 * stays honest instead of pinning a stale image.
 */
export function variantStoragePath(assetId: string, variant: VariantKind, buffer: Buffer, extension = "webp") {
  return `assets/${assetId}/${variant}/${variant}-${contentHash(buffer)}.${extension}`;
}

/* -------------------------------------------------------- verification -- */

export type VariantInspection = {
  ok: boolean;
  reason: "ok" | "missing" | "unreadable" | "undecodable" | "too-small";
  width?: number;
  height?: number;
  format?: string;
  expectedWidth?: number;
  expectedHeight?: number;
};

/**
 * Is this buffer an acceptable `variant` for a source of the given size?
 *
 * Decodability alone is not enough: a 480x480 editor file for a 1254x1254
 * original decodes fine and still looks terrible on a full-size canvas.
 */
export async function inspectVariantBuffer(
  buffer: Buffer | null | undefined,
  variant: VariantKind,
  sourceWidth: number,
  sourceHeight: number,
): Promise<VariantInspection> {
  const decoded = await decodeImage(buffer);
  if (!decoded) return { ok: false, reason: "undecodable" };

  // Without trustworthy source dimensions, decodability is all we can assert.
  if (!sourceWidth || !sourceHeight) {
    return { ok: true, reason: "ok", width: decoded.width, height: decoded.height, format: decoded.format };
  }

  const expected = expectedVariantSize(sourceWidth, sourceHeight, variantMaxPx(variant));
  const longestActual = Math.max(decoded.width, decoded.height);
  const longestExpected = Math.max(expected.width, expected.height);
  // Only undersized variants are rejected: a larger-than-expected file still
  // has ample detail for its purpose.
  const ok = longestActual >= Math.floor(longestExpected * SIZE_TOLERANCE_RATIO);

  return {
    ok,
    reason: ok ? "ok" : "too-small",
    width: decoded.width,
    height: decoded.height,
    format: decoded.format,
    expectedWidth: expected.width,
    expectedHeight: expected.height,
  };
}

export type StoredVariantOptions = {
  supabase: any;
  bucket: string;
  storagePath: string | null | undefined;
  variant: VariantKind;
  sourceWidth?: number;
  sourceHeight?: number;
  /** SVG editor variants are vector and exempt from raster size checks. */
  vector?: boolean;
};

/** Download a stored variant and judge whether it is fit for its purpose. */
export async function inspectStoredVariant(options: StoredVariantOptions): Promise<VariantInspection> {
  const { supabase, bucket, storagePath, variant, sourceWidth = 0, sourceHeight = 0, vector = false } = options;
  if (!storagePath) return { ok: false, reason: "missing" };

  let buffer: Buffer;
  try {
    const { data, error } = await supabase.storage.from(bucket).download(storagePath);
    if (error || !data) return { ok: false, reason: "unreadable" };
    buffer = Buffer.from(await data.arrayBuffer());
  } catch {
    return { ok: false, reason: "unreadable" };
  }

  // A vector editor variant is resolution independent; only presence matters.
  if (vector || storagePath.endsWith(".svg")) {
    return buffer.byteLength > 0 ? { ok: true, reason: "ok" } : { ok: false, reason: "undecodable" };
  }
  return inspectVariantBuffer(buffer, variant, sourceWidth, sourceHeight);
}

/** Back-compatible boolean wrapper. */
export async function storedVariantIsUsable(options: StoredVariantOptions): Promise<boolean> {
  return (await inspectStoredVariant(options)).ok;
}
