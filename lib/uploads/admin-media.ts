/**
 * Admin / designer PRODUCT MEDIA (product images, mockups, videos, site
 * assets): the one place that decides what an upload IS and how large it may
 * be. Server-only.
 *
 * Nothing the browser says is trusted: the file name, its extension and its
 * Content-Type are ignored. The type is decided from the bytes, images must
 * fully decode within dimension/pixel limits and are re-encoded (orientation
 * applied, EXIF/GPS and any appended bytes dropped), and videos must be a
 * structurally complete container of an allowed kind. The stored Content-Type
 * and file extension come from that verdict.
 *
 * LIMITS. Uploads stream through the Node process (lib/http/read-body), which
 * holds the request body and a parsed copy in memory. The request cap is kept
 * at a size that is safe for a small Hostinger Node instance, and the per-file
 * caps fit inside it — the UI, the route and the Storage buckets all quote
 * these same numbers.
 */
import sharp, { type Metadata } from "sharp";

const MB = 1024 * 1024;

/** One admin media request (all files plus form overhead). */
export const ADMIN_MEDIA_MAX_REQUEST_BYTES = 35 * MB;
/** One product image / mockup / site image. */
export const ADMIN_IMAGE_MAX_BYTES = 15 * MB;
/** One product video. Larger videos need a direct-to-Storage upload, which is not built. */
export const ADMIN_VIDEO_MAX_BYTES = 30 * MB;
export const ADMIN_IMAGE_MAX_DIMENSION = 12_000;
export const ADMIN_IMAGE_MAX_PIXELS = 60_000_000;

export const formatMegabytes = (bytes: number) => `${Math.round(bytes / MB)} MB`;

export type ImageKind = "jpeg" | "png" | "webp" | "gif" | "avif";
export type VideoKind = "mp4" | "mov" | "webm" | "avi";

const IMAGE_MIME: Record<ImageKind, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif" };
const IMAGE_EXTENSION: Record<ImageKind, string> = { jpeg: "jpg", png: "png", webp: "webp", gif: "gif", avif: "avif" };
const VIDEO_MIME: Record<VideoKind, string> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", avi: "video/x-msvideo" };

export class MediaRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaRejected";
  }
}

const ascii = (bytes: Buffer, start: number, end: number) => bytes.subarray(start, end).toString("latin1");

/** The image format named by the bytes themselves, or null. */
export function sniffImageKind(bytes: Buffer): ImageKind | null {
  if (bytes.length < 16) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return "gif";
  if (ascii(bytes, 4, 8) === "ftyp" && /^(avif|avis)$/.test(ascii(bytes, 8, 12))) return "avif";
  return null;
}

export type NormalizedImage = { data: Buffer; contentType: string; extension: string; width: number; height: number };

/**
 * Decode and re-encode an image upload. Throws MediaRejected with a message
 * the admin can act on; never trusts the browser's name or type.
 */
export async function normalizeAdminImage(bytes: Buffer): Promise<NormalizedImage> {
  if (!bytes.length) throw new MediaRejected("The file is empty.");
  if (bytes.length > ADMIN_IMAGE_MAX_BYTES) throw new MediaRejected(`Images must be ${formatMegabytes(ADMIN_IMAGE_MAX_BYTES)} or smaller.`);
  const kind = sniffImageKind(bytes);
  if (!kind) throw new MediaRejected("Unsupported image. Use JPG, PNG, WebP, GIF or AVIF.");
  const animated = kind === "gif" || kind === "webp";
  let meta: Metadata;
  try {
    meta = await sharp(bytes, { limitInputPixels: ADMIN_IMAGE_MAX_PIXELS }).metadata();
  } catch {
    throw new MediaRejected("This image could not be read. It may be damaged.");
  }
  const width = meta.width || 0;
  const height = meta.pageHeight || meta.height || 0;
  if (!width || !height) throw new MediaRejected("This image could not be read. It may be damaged.");
  if (width > ADMIN_IMAGE_MAX_DIMENSION || height > ADMIN_IMAGE_MAX_DIMENSION || width * height > ADMIN_IMAGE_MAX_PIXELS) {
    throw new MediaRejected(`Images larger than ${ADMIN_IMAGE_MAX_DIMENSION}px per side or 60 megapixels are not supported.`);
  }
  try {
    const pipeline = sharp(bytes, { limitInputPixels: ADMIN_IMAGE_MAX_PIXELS, failOn: "error", animated: animated && (meta.pages || 1) > 1 }).rotate();
    const data =
      kind === "jpeg"
        ? await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer()
        : kind === "png"
          ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
          : kind === "webp"
            ? await pipeline.webp({ quality: 90 }).toBuffer()
            : kind === "gif"
              ? await pipeline.gif().toBuffer()
              : await pipeline.avif({ quality: 60 }).toBuffer();
    // sharp drops EXIF/XMP/ICC-comment metadata unless asked to keep it, and
    // everything after the image data (polyglot payloads) is gone.
    return { data, contentType: IMAGE_MIME[kind], extension: IMAGE_EXTENSION[kind], width, height };
  } catch {
    throw new MediaRejected("This image could not be processed. Try exporting it again.");
  }
}

/* ------------------------------------------------------------- video -- */

// ISO base media (MP4/MOV) major brands accepted as video.
const MP4_BRANDS = new Set(["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "dash", "MSNV", "f4v "]);
const QUICKTIME_BRANDS = new Set(["qt  "]);

/**
 * Walk the top-level boxes of an ISO BMFF file. The boxes must tile the file
 * exactly (no garbage before, between or after them), the first must be
 * `ftyp` with an allowed brand, and a `moov` box (the movie header) must exist.
 */
function inspectIsoBmff(bytes: Buffer): VideoKind | null {
  if (ascii(bytes, 4, 8) !== "ftyp") return null;
  const brand = ascii(bytes, 8, 12);
  const kind: VideoKind | null = MP4_BRANDS.has(brand) ? "mp4" : QUICKTIME_BRANDS.has(brand) ? "mov" : null;
  if (!kind) return null;
  let offset = 0;
  let sawMoov = false;
  let boxes = 0;
  while (offset < bytes.length) {
    if (bytes.length - offset < 8 || ++boxes > 10_000) return null;
    let size = bytes.readUInt32BE(offset);
    const type = ascii(bytes, offset + 4, offset + 8);
    if (!/^[\x20-\x7e]{4}$/.test(type)) return null;
    if (size === 1) {
      if (bytes.length - offset < 16) return null;
      const large = bytes.readBigUInt64BE(offset + 8);
      if (large > BigInt(bytes.length - offset)) return null;
      size = Number(large);
    } else if (size === 0) {
      size = bytes.length - offset;
    }
    if (size < 8 || offset + size > bytes.length) return null;
    if (type === "moov") sawMoov = true;
    offset += size;
  }
  return offset === bytes.length && sawMoov ? kind : null;
}

/** Read an EBML variable-length integer (size) at `offset`. */
function readVint(bytes: Buffer, offset: number): { value: number; length: number } | null {
  const first = bytes[offset];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length += 1;
  if (length > 8 || offset + length > bytes.length) return null;
  let value = first & (0xff >> length);
  for (let index = 1; index < length; index += 1) value = value * 256 + bytes[offset + index];
  return { value, length };
}

/** A Matroska/WebM file whose EBML header declares DocType "webm". */
function inspectWebm(bytes: Buffer): VideoKind | null {
  if (bytes.subarray(0, 4).toString("hex") !== "1a45dfa3") return null;
  const headerSize = readVint(bytes, 4);
  if (!headerSize) return null;
  const start = 4 + headerSize.length;
  const end = Math.min(bytes.length, start + headerSize.value);
  for (let offset = start; offset + 2 < end; ) {
    // DocType element id 0x4282.
    if (bytes[offset] === 0x42 && bytes[offset + 1] === 0x82) {
      const size = readVint(bytes, offset + 2);
      if (!size) return null;
      const valueStart = offset + 2 + size.length;
      return ascii(bytes, valueStart, valueStart + size.value) === "webm" ? "webm" : null;
    }
    offset += 1;
  }
  return null;
}

/** RIFF AVI whose declared size matches the file. */
function inspectAvi(bytes: Buffer): VideoKind | null {
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 12) !== "AVI ") return null;
  return bytes.readUInt32LE(4) + 8 === bytes.length ? "avi" : null;
}

export type ValidatedVideo = { contentType: string; extension: VideoKind };

/**
 * Accept a video only when its container is structurally valid. Codec-level
 * inspection would need ffprobe, which the deployment does not ship; product
 * videos are admin/designer uploads and are served as plain files, never
 * transcoded on the server.
 */
export function validateAdminVideo(bytes: Buffer): ValidatedVideo {
  if (!bytes.length) throw new MediaRejected("The file is empty.");
  if (bytes.length > ADMIN_VIDEO_MAX_BYTES) throw new MediaRejected(`Videos must be ${formatMegabytes(ADMIN_VIDEO_MAX_BYTES)} or smaller.`);
  if (bytes.length < 16) throw new MediaRejected("Unsupported video. Use MP4, MOV or WebM.");
  const kind = inspectIsoBmff(bytes) || inspectWebm(bytes) || inspectAvi(bytes);
  if (!kind) throw new MediaRejected("Unsupported or damaged video. Use MP4, MOV or WebM.");
  return { contentType: VIDEO_MIME[kind], extension: kind };
}
