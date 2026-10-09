/**
 * The sanitized ORIGINAL keeps the picture (pixels, colour profile, bit depth)
 * and loses only metadata; the master path check refuses anything outside the
 * asset's own folder.
 */
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { masterPathFor, sanitizedOriginal, trustedMasterPath } from "../master-original";

const LIMIT = 60_000_000;
const storedValues = (buffer: Buffer) => sharp(buffer, { ignoreIcc: true }).raw().toBuffer();

describe("sanitizedOriginal", () => {
  it("PNG: same stored pixels and Display-P3 profile, metadata gone", async () => {
    const source = await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 40, g: 200, b: 60, alpha: 0.5 } } })
      .png().withIccProfile("p3").withExif({ IFD0: { Make: "PrivateCam" } }).toBuffer();
    const { buffer, method } = await sanitizedOriginal(source, "image/png", LIMIT);
    expect(method).toBe("lossless-reencode");
    const meta = await sharp(buffer).metadata();
    expect(meta.icc).toBeTruthy();
    expect(meta.exif).toBeUndefined();
    expect(meta.hasAlpha).toBe(true);
    expect((await storedValues(buffer)).equals(await storedValues(source))).toBe(true);
    expect(buffer.includes(Buffer.from("PrivateCam"))).toBe(false);
  });

  it("PNG: 16-bit stays 16-bit", async () => {
    const source = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } } }).toColourspace("rgb16").png().toBuffer();
    const { buffer } = await sanitizedOriginal(source, "image/png", LIMIT);
    expect((await sharp(buffer).metadata()).depth).toBe("ushort");
  });

  it("WebP: lossless, metadata gone", async () => {
    const source = await sharp({ create: { width: 20, height: 10, channels: 3, background: "#336699" } }).webp({ quality: 80 }).withExif({ IFD0: { Make: "PrivateCam" } }).toBuffer();
    const { buffer } = await sanitizedOriginal(source, "image/webp", LIMIT);
    expect((await sharp(buffer).raw().toBuffer()).equals(await sharp(source).raw().toBuffer())).toBe(true);
    expect((await sharp(buffer).metadata()).exif).toBeUndefined();
  });

  it("JPEG: the compressed picture is kept", async () => {
    const source = await sharp({ create: { width: 64, height: 40, channels: 3, background: "#aa5522" } }).jpeg({ quality: 85 }).withExif({ IFD0: { Make: "PrivateCam" } }).toBuffer();
    const { buffer, method } = await sanitizedOriginal(source, "image/jpeg", LIMIT);
    expect(method).toBe("jpeg-scan-preserved");
    expect((await sharp(buffer).raw().toBuffer()).equals(await sharp(source).raw().toBuffer())).toBe(true);
  });
});

describe("master paths", () => {
  it("sit beside the original", () => {
    expect(masterPathFor("u1/customizer/card/123-photo/original.jpg", "jpg")).toBe("u1/customizer/card/123-photo/master.jpg");
  });

  it("only paths in the asset's own folder are trusted", () => {
    expect(trustedMasterPath({ path: "u1/f/123-photo/original.jpg", metadata: { master: { path: "u1/f/123-photo/master.jpg" } } })).toBe("u1/f/123-photo/master.jpg");
    expect(trustedMasterPath({ path: "assets/abc/original/x.jpg", metadata: { master: { path: "assets/abc/master/x.jpg" } } })).toBe("assets/abc/master/x.jpg");
    expect(trustedMasterPath({ path: "u1/f/123-photo/original.jpg", metadata: { master: { path: "u2/other/master.jpg" } } })).toBeNull();
    expect(trustedMasterPath({ path: "u1/f/123-photo/original.jpg", metadata: { master: { path: "u1/f/123-photo/../../x" } } })).toBeNull();
    expect(trustedMasterPath({ path: "u1/f/123-photo/original.jpg", metadata: { master: { path: "u1/f/123-photo/original.jpg" } } })).toBeNull();
    expect(trustedMasterPath({ path: "u1/f/a/original.jpg", metadata: {} })).toBeNull();
    // Another photo of the same customer is not "its own folder".
    expect(trustedMasterPath({ path: "u1/f/a/original.jpg", metadata: { master: { path: "u1/f/b/master.jpg" } } })).toBeNull();
  });
});
