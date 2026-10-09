/**
 * Lossless JPEG metadata removal: the compressed picture is copied byte for
 * byte, only metadata segments and trailing bytes are left out.
 */
import sharp, { type JpegOptions } from "sharp";
import { describe, expect, it } from "vitest";
import { orientationExifSegment, stripJpegMetadata, stripJpegMetadataVerified } from "../jpeg-lossless";

const LIMIT = 60_000_000;
const art = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#2d4a6b"/><circle cx="160" cy="100" r="70" fill="#f0c987"/><text x="20" y="40" font-size="28" fill="#fff">wedding</text></svg>');
const photo = (options: JpegOptions = {}) => sharp(art).jpeg({ quality: 90, ...options });
const pixels = (buffer: Buffer) => sharp(buffer).raw().toBuffer();

describe("stripJpegMetadata", () => {
  it("drops EXIF/GPS and comments, keeps decoded pixels identical", async () => {
    const source = await photo().withExif({ IFD0: { Make: "PrivateCam", ImageDescription: "GPS 23.81N 90.41E" } }).toBuffer();
    const stripped = await stripJpegMetadataVerified(source, LIMIT);
    expect(stripped).not.toBeNull();
    expect(stripped!.includes(Buffer.from("PrivateCam"))).toBe(false);
    expect((await sharp(stripped!).metadata()).exif).toBeUndefined();
    expect((await pixels(stripped!)).equals(await pixels(source))).toBe(true);
    expect(stripped!.length).toBeLessThan(source.length);
  });

  it("keeps the colour profile and the orientation", async () => {
    const source = await photo().withIccProfile("p3").withMetadata({ orientation: 6 }).toBuffer();
    const stripped = await stripJpegMetadataVerified(source, LIMIT);
    const meta = await sharp(stripped!).metadata();
    expect(meta.icc).toBeTruthy();
    expect(meta.orientation).toBe(6);
    expect(meta.exif!.length).toBeLessThan(64); // only the orientation tag remains
  });

  it("removes a payload appended after the image", async () => {
    const source = await photo().toBuffer();
    const polyglot = Buffer.concat([source, Buffer.from("PK\u0003\u0004<html><script>alert(1)</script>", "latin1")]);
    const stripped = await stripJpegMetadataVerified(polyglot, LIMIT);
    expect(stripped!.includes(Buffer.from("<script>"))).toBe(false);
    expect(stripped!.subarray(-2).equals(Buffer.from([0xff, 0xd9]))).toBe(true);
  });

  it("handles progressive JPEGs (several scans with tables between them)", async () => {
    const source = await photo({ progressive: true }).withExif({ IFD0: { Make: "PrivateCam" } }).toBuffer();
    const stripped = await stripJpegMetadataVerified(source, LIMIT);
    expect(stripped).not.toBeNull();
    expect((await pixels(stripped!)).equals(await pixels(source))).toBe(true);
    expect((await sharp(stripped!).metadata()).isProgressive).toBe(true);
  });

  it("refuses what it does not understand, so the caller re-encodes", async () => {
    const source = await photo().toBuffer();
    expect(stripJpegMetadata(Buffer.from("not a jpeg"))).toBeNull();
    expect(stripJpegMetadata(source.subarray(0, Math.floor(source.length / 2)))).toBeNull(); // truncated
    expect(stripJpegMetadata(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull(); // no frame or scan
    expect(await stripJpegMetadataVerified(await sharp(art).png().toBuffer(), LIMIT)).toBeNull();
  });

  it("writes a valid orientation-only EXIF block", async () => {
    const segment = orientationExifSegment(8);
    expect(segment.length).toBe(36);
    const source = await photo().toBuffer();
    const tagged = Buffer.concat([source.subarray(0, 2), segment, source.subarray(2)]);
    expect((await sharp(tagged).metadata()).orientation).toBe(8);
  });
});
