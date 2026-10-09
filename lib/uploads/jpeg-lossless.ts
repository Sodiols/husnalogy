// Remove private metadata from a JPEG WITHOUT re-compressing it.
//
// Customer photos must lose their camera/GPS metadata and anything hidden
// after the image (polyglot payloads) before they are stored. Re-encoding does
// that, but every JPEG re-encode throws away detail (measured: quality 95 ≈
// 39 dB PSNR on a detailed photo). A JPEG is a sequence of marker segments;
// the compressed picture and the tables needed to decode it can be copied
// byte for byte while only the metadata segments are left out:
//
//   kept     SOI, APP0 (JFIF), APP2 ICC_PROFILE (colour), APP14 (Adobe colour
//            transform), DQT, DHT, DRI, SOFn, SOS + entropy-coded data, EOI
//   dropped  APP1 (EXIF / XMP — camera, GPS, thumbnails), APP3–APP13, APP15,
//            COM, and every byte after EOI
//   added    a minimal EXIF block holding ONLY the orientation, when the photo
//            had one, so it still displays upright everywhere
//
// The caller must confirm the result decodes to exactly the same pixels
// (`stripJpegMetadataVerified`) and fall back to re-encoding otherwise.

import sharp from "sharp";

const isRst = (marker: number) => marker >= 0xd0 && marker <= 0xd7;
const isApp = (marker: number) => marker >= 0xe0 && marker <= 0xef;

/** APPn markers kept: JFIF (E0), ICC profile (E2, identified below), Adobe (EE). */
function keepSegment(marker: number, payload: Buffer): boolean {
  if (marker === 0xfe) return false; // COM
  if (!isApp(marker)) return true;
  if (marker === 0xe0) return payload.subarray(0, 5).toString("latin1") === "JFIF\0";
  if (marker === 0xe2) return payload.subarray(0, 12).toString("latin1") === "ICC_PROFILE\0";
  if (marker === 0xee) return payload.subarray(0, 5).toString("latin1") === "Adobe";
  return false;
}

/** A 34-byte APP1 EXIF segment carrying only Orientation (tag 0x0112). */
export function orientationExifSegment(orientation: number): Buffer {
  const segment = Buffer.alloc(36);
  segment.writeUInt16BE(0xffe1, 0);
  segment.writeUInt16BE(34, 2); // length excludes the marker itself
  segment.write("Exif\0\0", 4, "latin1");
  segment.write("MM", 10, "latin1"); // TIFF header, big-endian
  segment.writeUInt16BE(0x002a, 12);
  segment.writeUInt32BE(8, 14); // IFD0 offset from TIFF start
  segment.writeUInt16BE(1, 18); // one entry
  segment.writeUInt16BE(0x0112, 20); // Orientation
  segment.writeUInt16BE(3, 22); // SHORT
  segment.writeUInt32BE(1, 24); // count
  segment.writeUInt16BE(orientation, 28); // value, left-justified
  segment.writeUInt32BE(0, 32); // no next IFD
  return segment;
}

/**
 * The JPEG with metadata segments and trailing bytes removed, or null when the
 * structure is not a well-formed baseline/progressive JPEG this code
 * understands (the caller then re-encodes).
 */
export function stripJpegMetadata(buffer: Buffer, orientation = 1): Buffer | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  const parts: Buffer[] = [buffer.subarray(0, 2)];
  let insertedExif = !(orientation > 1 && orientation <= 8);
  let offset = 2;
  let sawFrame = false;
  let sawScan = false;

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    // Fill bytes (0xFF padding) may precede a marker.
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) return null;
    const marker = buffer[offset];
    const markerStart = offset - 1;
    offset += 1;

    if (marker === 0xd9) {
      // EOI: everything after it is discarded.
      if (!sawFrame || !sawScan) return null;
      parts.push(Buffer.from([0xff, 0xd9]));
      return Buffer.concat(parts);
    }
    if (marker === 0xd8 || isRst(marker) || marker === 0x01 || marker === 0x00) return null;
    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return null;
    const segmentEnd = offset + length;
    const payload = buffer.subarray(offset + 2, segmentEnd);

    if (!insertedExif && !(marker === 0xe0 && keepSegment(marker, payload))) {
      parts.push(orientationExifSegment(orientation));
      insertedExif = true;
    }
    if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) sawFrame = true;
    if (keepSegment(marker, payload)) parts.push(buffer.subarray(markerStart, segmentEnd));
    offset = segmentEnd;

    if (marker === 0xda) {
      // SOS: copy the entropy-coded data up to the next real marker.
      sawScan = true;
      let scan = offset;
      while (scan + 1 < buffer.length) {
        if (buffer[scan] === 0xff) {
          const next = buffer[scan + 1];
          if (next === 0x00 || isRst(next) || next === 0xff) {
            scan += next === 0xff ? 1 : 2;
            continue;
          }
          break;
        }
        scan += 1;
      }
      if (scan + 1 >= buffer.length) return null;
      parts.push(buffer.subarray(offset, scan));
      offset = scan;
    }
  }
  return null;
}

/**
 * `stripJpegMetadata`, accepted only if it decodes to exactly the same pixels
 * as the upload (orientation not applied to either, so the comparison is of
 * the stored data itself). Returns null when the caller must re-encode.
 */
export async function stripJpegMetadataVerified(buffer: Buffer, limitInputPixels: number): Promise<Buffer | null> {
  const meta = await sharp(buffer, { limitInputPixels }).metadata();
  if (meta.format !== "jpeg") return null;
  const stripped = stripJpegMetadata(buffer, Number(meta.orientation) || 1);
  if (!stripped) return null;
  try {
    const decode = (input: Buffer) => sharp(input, { limitInputPixels, failOn: "error" }).raw().toBuffer({ resolveWithObject: true });
    const [before, after] = await Promise.all([decode(buffer), decode(stripped)]);
    if (before.info.width !== after.info.width || before.info.height !== after.info.height || before.info.channels !== after.info.channels) return null;
    if (!before.data.equals(after.data)) return null;
    const strippedMeta = await sharp(stripped, { limitInputPixels }).metadata();
    if ((Number(strippedMeta.orientation) || 1) !== (Number(meta.orientation) || 1)) return null;
    return stripped;
  } catch {
    return null;
  }
}
