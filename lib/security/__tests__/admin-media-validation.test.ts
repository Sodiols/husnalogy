/**
 * Admin product media is identified by its BYTES, decoded, size-bounded and
 * re-encoded — never trusted by name or Content-Type (Phase 9).
 */
import sharp from "sharp";
import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  ADMIN_IMAGE_MAX_BYTES,
  ADMIN_VIDEO_MAX_BYTES,
  MediaRejected,
  normalizeAdminImage,
  sniffImageKind,
  validateAdminVideo,
} from "@/lib/uploads/admin-media";

const box = (type: string, payload: Buffer = Buffer.alloc(0)) => {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, payload]);
};
const ftyp = (brand: string) => box("ftyp", Buffer.concat([Buffer.from(brand, "latin1"), Buffer.alloc(4), Buffer.from("isomiso2", "latin1")]));
const mp4 = (brand = "isom") => Buffer.concat([ftyp(brand), box("moov", Buffer.alloc(64, 1)), box("mdat", Buffer.alloc(512, 7))]);
const webm = (docType = "webm") => {
  const doc = Buffer.from(docType, "latin1");
  const element = Buffer.concat([Buffer.from([0x42, 0x82, 0x80 | doc.length]), doc]);
  return Buffer.concat([Buffer.from("1a45dfa3", "hex"), Buffer.from([0x80 | element.length]), element, Buffer.alloc(256, 3)]);
};
const avi = () => {
  const body = Buffer.concat([Buffer.from("AVI ", "latin1"), Buffer.alloc(200, 2)]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
};

const expectRejected = async (work: () => unknown) => {
  let caught: unknown = null;
  try {
    await work();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(MediaRejected);
};

async function photo(format: "jpeg" | "png" | "webp" | "gif" | "avif") {
  const base = sharp({ create: { width: 900, height: 600, channels: 3, background: "#7FA38B" } });
  if (format === "jpeg") return base.jpeg().withExif({ IFD0: { Make: "StudioCam", ImageDescription: "GPS 23.8N" } }).toBuffer();
  return base[format]().toBuffer();
}

describe("admin images", () => {
  for (const format of ["jpeg", "png", "webp", "gif", "avif"] as const) {
    it(`accepts a real ${format.toUpperCase()} and re-encodes it with type and extension from the bytes`, async () => {
      const result = await normalizeAdminImage(await photo(format));
      expect(result.contentType).toBe(`image/${format}`);
      expect([result.width, result.height]).toEqual([900, 600]);
      const meta = await sharp(result.data).metadata();
      expect(meta.format === format || (format === "jpeg" && meta.format === "jpeg") || (format === "avif" && meta.format === "heif")).toBe(true);
      expect(meta.exif).toBeUndefined();
    });
  }

  it("strips camera/GPS metadata and anything appended after the image (polyglot)", async () => {
    const polyglot = Buffer.concat([await photo("jpeg"), Buffer.from("PK\u0003\u0004 <script>alert(1)</script>", "latin1")]);
    const result = await normalizeAdminImage(polyglot);
    expect(result.data.includes(Buffer.from("StudioCam"))).toBe(false);
    expect(result.data.includes(Buffer.from("<script>"))).toBe(false);
  });

  it("ignores the browser's name and type entirely (sniffing decides)", async () => {
    expect(sniffImageKind(await photo("png"))).toBe("png");
    expect(sniffImageKind(Buffer.from("<html><body>not an image</body></html>"))).toBeNull();
    expect(sniffImageKind(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'))).toBeNull();
  });

  it("rejects spoofed, damaged, oversized and decompression-bomb images", async () => {
    await expectRejected(() => normalizeAdminImage(Buffer.from("<html><script>alert(1)</script></html>".padEnd(64, " "))));
    await expectRejected(() => normalizeAdminImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')));
    const png = await photo("png");
    await expectRejected(() => normalizeAdminImage(png.subarray(0, 100)));
    const bomb = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).png().toBuffer();
    bomb.writeUInt32BE(30000, 16);
    bomb.writeUInt32BE(30000, 20);
    bomb.writeUInt32BE(crc32(bomb.subarray(12, 29)) >>> 0, 29);
    await expectRejected(() => normalizeAdminImage(bomb));
    await expectRejected(() => normalizeAdminImage(Buffer.alloc(ADMIN_IMAGE_MAX_BYTES + 1, 0xff)));
    await expectRejected(() => normalizeAdminImage(Buffer.alloc(0)));
  });
});

describe("admin videos", () => {
  it("accepts structurally valid MP4, MOV, WebM and AVI, typed from the container", () => {
    expect(validateAdminVideo(mp4())).toEqual({ contentType: "video/mp4", extension: "mp4" });
    expect(validateAdminVideo(mp4("mp42"))).toEqual({ contentType: "video/mp4", extension: "mp4" });
    expect(validateAdminVideo(mp4("qt  "))).toEqual({ contentType: "video/quicktime", extension: "mov" });
    expect(validateAdminVideo(webm())).toEqual({ contentType: "video/webm", extension: "webm" });
    expect(validateAdminVideo(avi())).toEqual({ contentType: "video/x-msvideo", extension: "avi" });
  });

  it("rejects disguised files, wrong brands and damaged or padded containers", async () => {
    await expectRejected(() => validateAdminVideo(Buffer.from("<html><script>alert(1)</script></html>".padEnd(64, " "))));
    const jpeg = await photo("jpeg");
    await expectRejected(() => validateAdminVideo(jpeg));
    // An ftyp header alone is not a video: no movie header.
    await expectRejected(() => validateAdminVideo(Buffer.concat([ftyp("isom"), box("mdat", Buffer.alloc(64))])));
    // AVIF (an image) or an unknown brand is not a product video.
    await expectRejected(() => validateAdminVideo(Buffer.concat([ftyp("avif"), box("moov", Buffer.alloc(8))])));
    await expectRejected(() => validateAdminVideo(Buffer.concat([ftyp("zzzz"), box("moov", Buffer.alloc(8))])));
    // Bytes appended after the last box (a polyglot payload) or a truncated box.
    await expectRejected(() => validateAdminVideo(Buffer.concat([mp4(), Buffer.from("<?php system($_GET[1]); ?>")])));
    await expectRejected(() => validateAdminVideo(mp4().subarray(0, 100)));
    // Matroska that is not WebM, and an AVI whose declared size lies.
    await expectRejected(() => validateAdminVideo(webm("matroska")));
    const lying = avi();
    lying.writeUInt32LE(10, 4);
    await expectRejected(() => validateAdminVideo(lying));
  });

  it("enforces the declared video limit", async () => {
    const big = Buffer.alloc(ADMIN_VIDEO_MAX_BYTES + 1);
    await expectRejected(() => validateAdminVideo(big));
  });
});
