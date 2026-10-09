/**
 * Production prints what the editor showed (docs/PRINT_QUALITY_AUDIT.md D1, D2).
 *
 * resvg draws image bytes literally: it ignored EXIF orientation (portrait
 * phone photos printed sideways and squeezed into the frame) and embedded
 * colour profiles (Display P3 / Adobe RGB / CMYK printed with wrong colours).
 * These tests build images whose correct appearance is known exactly, render
 * them through the real production renderer, and read the output pixels.
 */
import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPrintPdf, renderCustomizationPages } from "../server/render";
import { iccProfileDescription, renderImageDecision, renderReadyImage } from "../server/render-image";
import { installGoogleFontsHarness, resetGoogleFontsHarness } from "./google-fonts-test-harness";

const sha256 = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
const dataUri = (buffer: Buffer, mime: string) => `data:${mime};base64,${buffer.toString("base64")}`;

/** 200×100 stored pixels: left half red, right half blue. */
function redBlueRaw() {
  const raw = Buffer.alloc(200 * 100 * 3);
  for (let y = 0; y < 100; y += 1) for (let x = 0; x < 200; x += 1) {
    const i = (y * 200 + x) * 3;
    if (x < 100) raw[i] = 255; else raw[i + 2] = 255;
  }
  return raw;
}
/** A phone-style JPEG: stored landscape, tagged "rotate 90° clockwise" (orientation 6). Displays 100 wide × 200 tall: red on top, blue below. */
const sidewaysJpeg = () => sharp(redBlueRaw(), { raw: { width: 200, height: 100, channels: 3 } }).jpeg({ quality: 95 }).withMetadata({ orientation: 6 }).toBuffer();
/** sRGB (40,200,60) stored in a Display-P3 file, as an iPhone would. */
const p3Jpeg = () => sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 40, g: 200, b: 60 } } }).jpeg({ quality: 100 }).withIccProfile("p3").toBuffer();

async function pixels(png: Buffer) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return (x: number, y: number) => {
    const i = (Math.round(y) * info.width + Math.round(x)) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
}
const near = (actual: number[], expected: number[], tolerance: number) => actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance);

/** One full-bleed photo frame on a 100×200 portrait card. */
function photoTemplate(fitMode: "cover" | "contain" = "cover") {
  return {
    id: "t-fidelity", version: 1, canvasWidthPx: 100, canvasHeightPx: 200, cardWidthIn: 1, cardHeightIn: 2, dpi: 100,
    defaultPage: "front", pages: [{ id: "front", label: "Front", enabled: true, backgroundColor: "#ffffff" }],
    fields: [{ id: "photo", label: "Photo", type: "image" }],
    layers: [{ id: "photo", name: "Photo", page: "front", type: "image", fieldId: "photo", customerEditable: true, x: 50, y: 100, width: 100, height: 200, zIndex: 1, fitMode }],
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, bleed: { top: 0, right: 0, bottom: 0, left: 0 }, settings: {},
  };
}

describe("render-ready images", () => {
  it("applies EXIF orientation at full resolution", async () => {
    const ready = await renderReadyImage(await sidewaysJpeg(), "image/jpeg");
    expect(ready.normalized).toBe(true);
    expect(ready.reasons).toContain("exif-orientation-6");
    const meta = await sharp(ready.buffer).metadata();
    expect([meta.width, meta.height]).toEqual([100, 200]);
    expect(meta.orientation ?? 1).toBe(1);
    const at = await pixels(ready.buffer);
    expect(near(at(50, 40), [255, 0, 0], 40)).toBe(true);
    expect(near(at(50, 160), [0, 0, 255], 40)).toBe(true);
  });

  it("converts a Display-P3 photo to the sRGB colour the browser shows", async () => {
    const source = await p3Jpeg();
    expect(iccProfileDescription((await sharp(source).metadata()).icc)).toMatch(/P3/i);
    const ready = await renderReadyImage(source, "image/jpeg");
    expect(ready.reasons).toContain("icc-profile");
    const at = await pixels(ready.buffer);
    expect(near(at(20, 20), [40, 200, 60], 3)).toBe(true);
  });

  it("converts CMYK to sRGB", async () => {
    const cmyk = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 200, g: 40, b: 40 } } }).toColourspace("cmyk").jpeg({ quality: 100 }).toBuffer();
    expect((await sharp(cmyk).metadata()).space).toBe("cmyk");
    const ready = await renderReadyImage(cmyk, "image/jpeg");
    expect(ready.normalized).toBe(true);
    expect((await sharp(ready.buffer).metadata()).space).toBe("srgb");
  });

  it("passes upright sRGB images through untouched — same bytes, no re-encode", async () => {
    const plain = await sharp({ create: { width: 30, height: 20, channels: 3, background: "#336699" } }).jpeg({ quality: 90 }).toBuffer();
    const tagged = await sharp(plain).withIccProfile("srgb").toBuffer();
    expect(iccProfileDescription((await sharp(tagged).metadata()).icc)).toMatch(/sRGB/i);
    for (const source of [plain, tagged]) {
      const ready = await renderReadyImage(source, "image/jpeg");
      expect(ready.normalized).toBe(false);
      expect(ready.buffer).toBe(source);
    }
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>');
    expect((await renderReadyImage(svg, "image/svg+xml")).buffer).toBe(svg);
  });

  it("keeps transparency and never resizes", async () => {
    const transparent = await sharp({ create: { width: 64, height: 32, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } }).png().withMetadata({ orientation: 8 }).toBuffer();
    const ready = await renderReadyImage(transparent, "image/png");
    const meta = await sharp(ready.buffer).metadata();
    expect(ready.mime).toBe("image/png");
    expect(meta.hasAlpha).toBe(true);
    expect([meta.width, meta.height]).toEqual([32, 64]);
  });

  it("decides from metadata alone", () => {
    expect(renderImageDecision({ orientation: 1, space: "srgb" } as any).normalize).toBe(false);
    expect(renderImageDecision({ orientation: 3, space: "srgb" } as any).normalize).toBe(true);
    expect(renderImageDecision({ space: "cmyk" } as any).normalize).toBe(true);
    expect(renderImageDecision({ space: "b-w" } as any).normalize).toBe(false);
  });
});

describe("the production renderer prints what the editor shows", () => {
  beforeEach(() => { installGoogleFontsHarness(); });
  afterEach(() => { resetGoogleFontsHarness(); });

  it("a sideways-stored phone photo prints upright, unstretched", async () => {
    const original = await sidewaysJpeg();
    const before = sha256(original);
    const [page] = await renderCustomizationPages({ template: photoTemplate(), values: { photo: { url: dataUri(original, "image/jpeg") } }, editorState: null, mode: "print" });
    const at = await pixels(page.png);
    expect(near(at(50, 40), [255, 0, 0], 40)).toBe(true);
    expect(near(at(50, 160), [0, 0, 255], 40)).toBe(true);
    // Unrotated it would have been red on the left and blue on the right.
    expect(near(at(15, 100), at(85, 100), 40)).toBe(true);
    // The original itself is untouched.
    expect(sha256(original)).toBe(before);
  });

  it("pinned (order snapshot) originals get the same treatment, and stay byte-identical", async () => {
    const original = await sidewaysJpeg();
    const before = sha256(original);
    const ref = "https://example.invalid/storage/v1/object/original.jpg";
    const pinned = { [ref]: dataUri(original, "image/jpeg") };
    const [page] = await renderCustomizationPages({ template: photoTemplate("contain"), values: { photo: { url: ref } }, editorState: null, mode: "print", imageData: pinned });
    const at = await pixels(page.png);
    expect(near(at(50, 40), [255, 0, 0], 40)).toBe(true);
    expect(near(at(50, 160), [0, 0, 255], 40)).toBe(true);
    expect(sha256(Buffer.from(pinned[ref].split(",")[1], "base64"))).toBe(before);
  });

  it("a Display-P3 photo prints in its true colour", async () => {
    const [page] = await renderCustomizationPages({ template: photoTemplate(), values: { photo: { url: dataUri(await p3Jpeg(), "image/jpeg") } }, editorState: null, mode: "print" });
    const at = await pixels(page.png);
    expect(near(at(50, 100), [40, 200, 60], 4)).toBe(true);
  });

  it("the print PDF carries the corrected page", async () => {
    const pages = await renderCustomizationPages({ template: photoTemplate(), values: { photo: { url: dataUri(await sidewaysJpeg(), "image/jpeg") } }, editorState: null, mode: "print" });
    const { pdf } = await buildPrintPdf(pages, { widthIn: 1, heightIn: 2, dpi: 100, bleedPx: { top: 0, right: 0, bottom: 0, left: 0 } });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pages[0].widthPx).toBe(100);
    expect(pages[0].heightPx).toBe(200);
  });
});
