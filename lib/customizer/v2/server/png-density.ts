// Physical resolution for print PNGs.
//
// resvg writes PNGs without a pHYs chunk, so print software opens a
// 1575 × 2175 px print file at 72 DPI (21.9 × 30.2 in) instead of 5.25 × 7.25 in.
// This inserts the standard pHYs chunk directly after IHDR — no re-encode, the
// image data is untouched — replacing any existing one.

import { crc32 } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const METRES_PER_INCH = 0.0254;

/** The PNG with its pixel density set (pixels per inch on each axis). */
export function withPngDensity(png: Buffer, ppiX: number, ppiY = ppiX): Buffer {
  if (png.length < 33 || !png.subarray(0, 8).equals(SIGNATURE) || png.toString("latin1", 12, 16) !== "IHDR") {
    throw new Error("Not a PNG.");
  }
  const chunks: Buffer[] = [png.subarray(0, 33)]; // signature + IHDR
  const data = Buffer.alloc(9);
  data.writeUInt32BE(Math.round(ppiX / METRES_PER_INCH), 0);
  data.writeUInt32BE(Math.round(ppiY / METRES_PER_INCH), 4);
  data.writeUInt8(1, 8); // unit: metre
  const body = Buffer.concat([Buffer.from("pHYs", "latin1"), data]);
  const chunk = Buffer.alloc(4 + body.length + 4);
  chunk.writeUInt32BE(data.length, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body) >>> 0, 4 + body.length);
  chunks.push(chunk);

  let offset = 33;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("latin1", offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > png.length) throw new Error("Truncated PNG.");
    if (type !== "pHYs") chunks.push(png.subarray(offset, end));
    offset = end;
    if (type === "IEND") break;
  }
  return Buffer.concat(chunks);
}

/** The pixel density a PNG declares, in pixels per inch, or null. */
export function pngDensity(png: Buffer): { x: number; y: number } | null {
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("latin1", offset + 4, offset + 8);
    if (type === "pHYs" && length === 9 && png[offset + 16] === 1) {
      return { x: png.readUInt32BE(offset + 8) * METRES_PER_INCH, y: png.readUInt32BE(offset + 12) * METRES_PER_INCH };
    }
    if (type === "IDAT" || type === "IEND") return null;
    offset += 12 + length;
  }
  return null;
}
