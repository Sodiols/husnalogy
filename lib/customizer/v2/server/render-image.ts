// Render-ready copies of raster images. Server-only.
//
// The production renderer (resvg) and the mockup compositor (sharp) draw the
// bytes they are given literally. Browsers do not: they honour two pieces of
// metadata that resvg ignores (docs/PRINT_QUALITY_AUDIT.md D1, D2):
//
//   * EXIF orientation. Phones store most portrait photos sideways with an
//     orientation tag. The editor shows them upright; resvg drew them
//     sideways, and `preserveAspectRatio` then fitted the wrong aspect ratio
//     into the frame.
//   * Embedded colour profiles (Display P3, Adobe RGB, CMYK). The editor shows
//     colour-managed sRGB; resvg read the raw numbers as sRGB, so prints came
//     out duller or shifted.
//
// This module gives the renderer what the customer saw: the SAME pixels at
// the SAME full resolution, oriented and converted to sRGB. It works on an
// in-memory copy only — stored originals are never touched — and an image
// that is already upright and sRGB passes through byte for byte.

import sharp, { type Metadata } from "sharp";

/** Decoding bound for render inputs (uploads are limited far below this). */
const RENDER_IMAGE_MAX_PIXELS = 100_000_000;

/** sRGB-family profiles need no conversion. */
const SRGB_DESCRIPTION = /\bs\s*rgb\b/i;

/**
 * The profile description (ICC `desc` tag), or "" when it cannot be read.
 * Handles v2 (`desc`, ASCII) and v4 (`mluc`, UTF-16BE) encodings.
 */
export function iccProfileDescription(icc: Buffer | undefined | null): string {
  if (!icc || icc.length < 132) return "";
  try {
    const count = icc.readUInt32BE(128);
    for (let index = 0; index < Math.min(count, 100); index += 1) {
      const entry = 132 + index * 12;
      if (entry + 12 > icc.length) break;
      if (icc.toString("ascii", entry, entry + 4) !== "desc") continue;
      const offset = icc.readUInt32BE(entry + 4);
      const size = icc.readUInt32BE(entry + 8);
      if (offset + Math.min(size, 12) > icc.length || size < 12) return "";
      const type = icc.toString("ascii", offset, offset + 4);
      if (type === "desc") {
        const length = icc.readUInt32BE(offset + 8);
        const start = offset + 12;
        return icc.toString("latin1", start, Math.min(start + length, icc.length, offset + size)).replace(/\0+$/, "");
      }
      if (type === "mluc") {
        const records = icc.readUInt32BE(offset + 8);
        if (!records) return "";
        const recordLength = icc.readUInt32BE(offset + 20);
        const stringOffset = icc.readUInt32BE(offset + 24);
        const start = offset + stringOffset;
        const end = Math.min(start + recordLength, icc.length);
        const text = Buffer.from(icc.subarray(start, end));
        // UTF-16BE → swap to LE for Node's decoder.
        for (let byte = 0; byte + 1 < text.length; byte += 2) [text[byte], text[byte + 1]] = [text[byte + 1], text[byte]];
        return text.toString("utf16le").replace(/\0+$/, "");
      }
      return "";
    }
  } catch {
    return "";
  }
  return "";
}

export type RenderImageDecision = { normalize: boolean; reasons: string[] };

/** Why (or whether) an image must be normalized before it can be drawn literally. */
export function renderImageDecision(meta: Metadata): RenderImageDecision {
  const reasons: string[] = [];
  if (typeof meta.orientation === "number" && meta.orientation > 1) reasons.push(`exif-orientation-${meta.orientation}`);
  if (meta.space && meta.space !== "srgb" && meta.space !== "b-w" && meta.space !== "rgb16" && meta.space !== "grey16") reasons.push(`colour-space-${meta.space}`);
  if (meta.icc && !SRGB_DESCRIPTION.test(iccProfileDescription(meta.icc))) reasons.push("icc-profile");
  return { normalize: reasons.length > 0, reasons };
}

export type RenderImage = { buffer: Buffer; mime: string; normalized: boolean; reasons: string[] };

/**
 * A render-ready copy of `buffer`. Vector and animated images, and images that
 * are already upright sRGB, are returned unchanged (same Buffer).
 *
 * The copy keeps every pixel: no resizing. Transparent images and lossless
 * sources become PNG; opaque JPEG photos become JPEG at quality 100 with full
 * (4:4:4) chroma — visually lossless and a fraction of a full-size PNG, which
 * matters for a 24-megapixel photo inlined into a render.
 */
export async function renderReadyImage(buffer: Buffer, mime: string): Promise<RenderImage> {
  const type = String(mime || "").toLowerCase();
  if (type === "image/svg+xml" || type === "image/gif") return { buffer, mime: type, normalized: false, reasons: [] };

  const meta = await sharp(buffer, { limitInputPixels: RENDER_IMAGE_MAX_PIXELS }).metadata();
  const decision = renderImageDecision(meta);
  if (!decision.normalize) return { buffer, mime: type, normalized: false, reasons: [] };

  // `.rotate()` applies the EXIF orientation; sharp's default output converts
  // through the embedded profile to sRGB and drops the (now applied) metadata.
  const pipeline = sharp(buffer, { limitInputPixels: RENDER_IMAGE_MAX_PIXELS }).rotate();
  const opaqueJpeg = meta.format === "jpeg" && !meta.hasAlpha;
  const output = opaqueJpeg
    ? await pipeline.jpeg({ quality: 100, chromaSubsampling: "4:4:4", mozjpeg: false }).toBuffer()
    : await pipeline.png({ compressionLevel: 6 }).toBuffer();
  return { buffer: output, mime: opaqueJpeg ? "image/jpeg" : "image/png", normalized: true, reasons: decision.reasons };
}

const DATA_URI = /^data:([^;,]+);base64,([\s\S]+)$/;

/** `renderReadyImage` for a base64 data URI; anything else is returned as is. */
export async function renderReadyDataUri(dataUri: string): Promise<string> {
  const match = DATA_URI.exec(dataUri);
  if (!match) return dataUri;
  const source = Buffer.from(match[2], "base64");
  const ready = await renderReadyImage(source, match[1]);
  return ready.normalized ? `data:${ready.mime};base64,${ready.buffer.toString("base64")}` : dataUri;
}
