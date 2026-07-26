import sharp from "sharp";

// Shared variant generation for admin customizer assets, used by the upload
// route and by the repair script so both produce byte-identical results.
//
// Every generated buffer is decoded again before it is handed back. Storage
// happily accepts corrupt bytes and serves them with a 200 and the right
// content-type, so "the upload succeeded" says nothing about whether the
// browser can actually display the file — the only reliable check is a decode.

export const ASSET_MAX_DIMENSION = 12_000;
export const ASSET_EDITOR_MAX_PX = 2400;
export const ASSET_THUMB_MAX_PX = 480;

export type AssetVariants = {
  editorBuffer: Buffer;
  thumbnailBuffer: Buffer;
  editorMime: string;
  editorExtension: string;
  width: number;
  height: number;
};

const limits = { limitInputPixels: ASSET_MAX_DIMENSION * ASSET_MAX_DIMENSION };

/** Decodes a buffer, returning null when the bytes are not a usable image. */
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

/**
 * Build the editor and thumbnail variants for a raster upload.
 * Throws when either variant cannot be decoded after generation.
 */
export async function buildRasterVariants(source: Buffer): Promise<AssetVariants> {
  const meta = await sharp(source, limits).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
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
  return { editorBuffer, thumbnailBuffer, editorMime: "image/webp", editorExtension: "webp", width, height };
}

/** SVG keeps its sanitized source as the editor variant; only the thumbnail is rasterized. */
export async function buildSvgVariants(sanitizedSvg: Buffer): Promise<AssetVariants> {
  const meta = await sharp(sanitizedSvg, limits).metadata();
  const thumbnailBuffer = await sharp(sanitizedSvg, limits)
    .resize(ASSET_THUMB_MAX_PX, ASSET_THUMB_MAX_PX, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  if (!(await isDecodableImage(thumbnailBuffer))) {
    throw new Error("The generated thumbnail could not be decoded.");
  }
  return {
    editorBuffer: sanitizedSvg,
    thumbnailBuffer,
    editorMime: "image/svg+xml",
    editorExtension: "svg",
    width: meta.width || 0,
    height: meta.height || 0,
  };
}

export async function assertVariantsDecodable(editorBuffer: Buffer, thumbnailBuffer: Buffer) {
  const editor = await decodeImage(editorBuffer);
  if (!editor) throw new Error("The optimized editor image could not be decoded after generation.");
  const thumbnail = await decodeImage(thumbnailBuffer);
  if (!thumbnail) throw new Error("The generated thumbnail could not be decoded after generation.");
}

/**
 * Confirm a stored variant is present AND decodable.
 *
 * Used before reusing an existing asset: a row can point at an object that
 * exists but holds corrupt bytes, which is exactly how a broken image survives
 * a re-upload when checksum matching short-circuits regeneration.
 */
export async function storedVariantIsUsable(
  supabase: any,
  bucket: string,
  storagePath: string | null | undefined,
): Promise<boolean> {
  if (!storagePath) return false;
  try {
    const { data, error } = await supabase.storage.from(bucket).download(storagePath);
    if (error || !data) return false;
    const buffer = Buffer.from(await data.arrayBuffer());
    // SVG is text, not something sharp decodes as a raster.
    if (storagePath.endsWith(".svg")) return buffer.byteLength > 0;
    return await isDecodableImage(buffer);
  } catch {
    return false;
  }
}
