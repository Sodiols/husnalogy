/**
 * Visual parity: what the editors show (Chromium) vs what production prints
 * (render-ready images + resvg), on the SAME page SVG.
 *
 *   HUSNALOGY_VISUAL_PARITY=1 npx vitest run lib/customizer/v2/__tests__/visual-parity.browser.test.ts
 *
 * Browser side: the studio's/customer's EDITOR VARIANT of each photo (sharp:
 * orientation applied, sRGB, WebP q88 — exactly what both editors draw).
 * Production side: the ORIGINAL bytes through renderReadyDataUri + resvg —
 * exactly what the print worker does. Fonts: the same TTF bytes in both.
 * A control run feeds the original bytes to resvg WITHOUT normalization (the
 * pipeline before this fix) to prove the comparison detects the defects.
 *
 * Writes images and metrics to docs/validation/2026-10-09-print-quality/.
 * Tolerances are about rasterization (Skia vs tiny-skia antialiasing, WebP
 * preview compression), not geometry: photos MAE ≤ 4/255 with ≥ 99 % of pixels
 * within 32 levels; text ink bounds within 1 px and total ink (summed
 * darkness, i.e. glyph weight) within 6 %. Chromium runs with grayscale
 * antialiasing and no hinting, as on paper.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "@playwright/test";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPageSvg } from "../svg";
import { renderReadyDataUri } from "../server/render-image";

const ENABLED = process.env.HUSNALOGY_VISUAL_PARITY === "1";
const OUT = join(process.cwd(), "docs", "validation", "2026-10-09-print-quality");
const FONT_DIR = join(process.cwd(), "app", "brand-fonts");
const FONTS = [
  { family: "Cormorant Garamond", style: "normal", weight: 400, file: "CormorantGaramond-400.ttf" },
  { family: "Cormorant Garamond", style: "italic", weight: 400, file: "CormorantGaramond-400-italic.ttf" },
  { family: "Cormorant Garamond", style: "normal", weight: 600, file: "CormorantGaramond-600.ttf" },
  { family: "Inter", style: "normal", weight: 400, file: "Inter-400.ttf" },
];

const dataUri = (buffer: Buffer, mime: string) => `data:${mime};base64,${buffer.toString("base64")}`;
const editorVariant = async (buffer: Buffer) => dataUri(await sharp(buffer).rotate().webp({ quality: 88 }).toBuffer(), "image/webp");

/** A photo-like image: smooth gradients, edges and a little texture. */
async function photoLike(width: number, height: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3c9a8"/><stop offset="1" stop-color="#6d8fb3"/></linearGradient>
    <radialGradient id="sun" cx="0.3" cy="0.25" r="0.3"><stop offset="0" stop-color="#fff4c2"/><stop offset="1" stop-color="#fff4c2" stop-opacity="0"/></radialGradient></defs>
    <rect width="100%" height="100%" fill="url(#sky)"/><rect width="100%" height="100%" fill="url(#sun)"/>
    <ellipse cx="${width * 0.5}" cy="${height * 0.95}" rx="${width * 0.7}" ry="${height * 0.25}" fill="#3e5a3a"/>
    <circle cx="${width * 0.42}" cy="${height * 0.55}" r="${Math.min(width, height) * 0.09}" fill="#2b2b2b"/>
    <circle cx="${width * 0.58}" cy="${height * 0.53}" r="${Math.min(width, height) * 0.085}" fill="#f2efe9"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

type Fixture = { name: string; template: any; values: any; browserHref: Record<string, string>; productionHref: Record<string, string>; legacyHref?: Record<string, string>; text?: boolean };

const page = (w: number, h: number, layers: any[], background = "#ffffff") => ({
  canvasWidthPx: w, canvasHeightPx: h, dpi: 300, cardWidthIn: w / 300, cardHeightIn: h / 300, defaultPage: "front",
  pages: [{ id: "front", label: "Front", enabled: true, backgroundColor: background }], fields: [], layers,
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, bleed: { top: 0, right: 0, bottom: 0, left: 0 }, settings: {},
});
const imageLayer = (id: string, src: string, extra: Record<string, unknown>) => ({ id, name: id, page: "front", type: "image", src, zIndex: 1, ...extra });

async function fixtures(): Promise<Fixture[]> {
  const list: Fixture[] = [];

  // 1. Portrait phone photo: stored landscape with EXIF orientation 6.
  const upright = await photoLike(600, 900);
  const sideways = await sharp(await sharp(upright).rotate(-90).jpeg({ quality: 92 }).toBuffer()).withMetadata({ orientation: 6 }).toBuffer();
  list.push({
    name: "portrait-phone-photo",
    template: page(600, 900, [imageLayer("photo", "P1", { x: 300, y: 450, width: 600, height: 900 })]),
    values: {},
    browserHref: { P1: await editorVariant(sideways) },
    productionHref: { P1: await renderReadyDataUri(dataUri(sideways, "image/jpeg")) },
    legacyHref: { P1: dataUri(sideways, "image/jpeg") },
  });

  // 2. Display-P3 photo with the saturated colours wedding photos have
  //    (roses, greenery, gold) — where P3 and sRGB differ most.
  const flowers = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><circle cx="150" cy="200" r="110" fill="#c2185b"/><circle cx="330" cy="170" r="95" fill="#00a86b"/><circle cx="480" cy="250" r="90" fill="#e0a100"/><circle cx="250" cy="330" r="60" fill="#d81b60"/></svg>`);
  const colourful = await sharp(await photoLike(600, 400)).composite([{ input: flowers }]).toBuffer();
  const p3 = await sharp(colourful).withIccProfile("p3").jpeg({ quality: 95 }).toBuffer();
  list.push({
    name: "display-p3-photo",
    template: page(600, 400, [imageLayer("photo", "P2", { x: 300, y: 200, width: 600, height: 400 })]),
    values: {},
    browserHref: { P2: await editorVariant(p3) },
    productionHref: { P2: await renderReadyDataUri(dataUri(p3, "image/jpeg")) },
    legacyHref: { P2: dataUri(p3, "image/jpeg") },
  });

  // 3. Transparent PNG over a coloured page.
  const ornament = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><circle cx="200" cy="200" r="150" fill="#b8860b" fill-opacity="0.6"/><path d="M200 60 L230 170 L340 200 L230 230 L200 340 L170 230 L60 200 L170 170 Z" fill="#7b1e3a"/></svg>`)).png().toBuffer();
  list.push({
    name: "transparent-png",
    template: page(600, 600, [imageLayer("ornament", "P3", { x: 300, y: 300, width: 400, height: 400, fitMode: "contain" })], "#efe6d8"),
    values: {},
    browserHref: { P3: await editorVariant(ornament) },
    productionHref: { P3: await renderReadyDataUri(dataUri(ornament, "image/png")) },
  });

  // 4. Cropped photograph: crop rectangle + zoom + offset in an arch frame.
  const wide = await photoLike(1200, 800);
  list.push({
    name: "cropped-photo",
    template: page(600, 750, [imageLayer("photo", "P4", { x: 300, y: 375, width: 480, height: 600, maskShape: "arch", imageTransform: { zoom: 1.3, offsetX: -20, offsetY: 15, cropX: 0.15, cropY: 0.1, cropWidth: 0.6, cropHeight: 0.75 } })]),
    values: {},
    browserHref: { P4: await editorVariant(wide) },
    productionHref: { P4: await renderReadyDataUri(dataUri(wide, "image/jpeg")) },
  });

  // 5. Small wedding-invitation typography (a 2.5 × 1 in strip at 300 DPI).
  const text = (id: string, y: number, size: number, value: string, style: Record<string, unknown> = {}) => ({
    id, name: id, page: "front", type: "text", x: 375, y, width: 700, height: size * 1.6, zIndex: 2, text: value,
    textStyle: { fontFamily: "Cormorant Garamond", fontSize: size, textAlign: "center", color: "#303839", ...style },
  });
  list.push({
    name: "small-typography",
    template: page(750, 300, [
      text("names", 70, 42, "Ayesha & Omar", { fontWeight: 600 }),
      text("invite", 150, 25, "request the pleasure of your company", { fontStyle: "italic" }), // 6 pt at 300 DPI
      text("date", 205, 21, "Saturday, the fourteenth of November · Dhaka"), // 5 pt
      text("rsvp", 255, 17, "RSVP by 1 November · ayesha.omar@example.test", { fontFamily: "Inter" }), // 4 pt
    ]),
    values: {},
    browserHref: {},
    productionHref: {},
    text: true,
  });
  return list;
}

function fontFaceCss() {
  return FONTS.map((font) => `@font-face{font-family:'${font.family}';font-style:${font.style};font-weight:${font.weight};src:url(data:font/ttf;base64,${readFileSync(join(FONT_DIR, font.file)).toString("base64")}) format('truetype');}`).join("");
}

function svgFor(fixture: Fixture, hrefMap: Record<string, string>) {
  return buildPageSvg({ template: fixture.template, values: fixture.values, editorState: null, pageId: "front", mode: "print", hrefMap });
}

function production(svg: string, width: number) {
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { fontFiles: FONTS.map((font) => join(FONT_DIR, font.file)), loadSystemFonts: false, defaultFontFamily: "Cormorant Garamond" }, background: "#ffffff" });
  return Buffer.from(resvg.render().asPng());
}

async function browserRender(browser: Browser, svg: string, width: number, height: number) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const tab = await context.newPage();
  const withFonts = svg.replace(/^(<svg[^>]*>)/, `$1<style>${fontFaceCss()}</style>`);
  await tab.setContent(`<!doctype html><html><body style="margin:0;background:#fff">${withFonts}</body></html>`);
  await tab.evaluate(async () => { await (document as any).fonts.ready; await Promise.all([...document.images].map((image) => image.decode?.().catch(() => undefined))); });
  await tab.waitForTimeout(150);
  const shot = await tab.locator("svg").first().screenshot({ omitBackground: false });
  await context.close();
  return shot;
}

async function compare(a: Buffer, b: Buffer) {
  const [first, second] = await Promise.all([sharp(a).removeAlpha().raw().toBuffer({ resolveWithObject: true }), sharp(b).removeAlpha().raw().toBuffer({ resolveWithObject: true })]);
  expect([first.info.width, first.info.height]).toEqual([second.info.width, second.info.height]);
  const { width, height } = first.info;
  let sum = 0, squared = 0, within = 0;
  // Total ink: summed darkness (255 − mean channel) — the glyph area actually
  // covered, independent of how each engine spreads it over edge pixels.
  const inkAmount = [0, 0];
  const diff = Buffer.alloc(width * height);
  const ink = (data: Buffer, i: number) => data[i] + data[i + 1] + data[i + 2] < 3 * 160;
  const bounds = [{ minX: Infinity, minY: Infinity, maxX: -1, maxY: -1, count: 0 }, { minX: Infinity, minY: Infinity, maxX: -1, maxY: -1, count: 0 }];
  for (let p = 0; p < width * height; p += 1) {
    const i = p * 3;
    let max = 0;
    for (let c = 0; c < 3; c += 1) {
      const d = Math.abs(first.data[i + c] - second.data[i + c]);
      sum += d; squared += d * d; if (d > max) max = d;
    }
    if (max <= 32) within += 1;
    inkAmount[0] += 255 - (first.data[i] + first.data[i + 1] + first.data[i + 2]) / 3;
    inkAmount[1] += 255 - (second.data[i] + second.data[i + 1] + second.data[i + 2]) / 3;
    diff[p] = Math.min(255, max * 4);
    [first.data, second.data].forEach((data, index) => {
      if (!ink(data, i)) return;
      const box = bounds[index];
      const x = p % width, y = Math.floor(p / width);
      box.count += 1; box.minX = Math.min(box.minX, x); box.minY = Math.min(box.minY, y); box.maxX = Math.max(box.maxX, x); box.maxY = Math.max(box.maxY, y);
    });
  }
  const n = width * height * 3;
  const mse = squared / n;
  return {
    width, height,
    mae: sum / n,
    psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse),
    within32: within / (width * height),
    inkBoundsDelta: Math.max(...(["minX", "minY", "maxX", "maxY"] as const).map((key) => Math.abs(bounds[0][key] - bounds[1][key]))),
    inkCoverageRatio: bounds[1].count / Math.max(1, bounds[0].count),
    inkAmountRatio: inkAmount[1] / Math.max(1, inkAmount[0]),
    diffImage: await sharp(diff, { raw: { width, height, channels: 1 } }).png().toBuffer(),
  };
}

describe.skipIf(!ENABLED)("visual parity: editor (Chromium) vs production (resvg)", () => {
  let browser: Browser;
  const results: Record<string, any> = {};
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    // sRGB output; grayscale antialiasing and no hinting, as on paper (LCD subpixel
    // text and hinting are screen-only techniques).
    browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--disable-lcd-text", "--font-render-hinting=none"] });
  }, 120_000);
  afterAll(async () => {
    await browser?.close();
    if (Object.keys(results).length) writeFileSync(join(OUT, "visual-parity.json"), JSON.stringify(results, null, 2));
  });

  it("every fixture matches within rasterization tolerance; the unfixed pipeline does not", async () => {
    for (const fixture of await fixtures()) {
      const { canvasWidthPx: width, canvasHeightPx: height } = fixture.template;
      const browserPng = await browserRender(browser, svgFor(fixture, fixture.browserHref), width, height);
      const productionPng = production(svgFor(fixture, fixture.productionHref), width);
      const metrics = await compare(browserPng, productionPng);
      writeFileSync(join(OUT, `${fixture.name}.browser.png`), browserPng);
      writeFileSync(join(OUT, `${fixture.name}.production.png`), productionPng);
      writeFileSync(join(OUT, `${fixture.name}.diff.png`), metrics.diffImage);
      const entry: any = { width, height, mae: +metrics.mae.toFixed(3), psnrDb: +metrics.psnr.toFixed(2), pixelsWithin32: +metrics.within32.toFixed(5), inkBoundsDeltaPx: metrics.inkBoundsDelta, inkCoverageRatio: +metrics.inkCoverageRatio.toFixed(4), inkAmountRatio: +metrics.inkAmountRatio.toFixed(4) };
      if (fixture.legacyHref) {
        const legacyPng = production(svgFor(fixture, fixture.legacyHref), width);
        writeFileSync(join(OUT, `${fixture.name}.before-fix.png`), legacyPng);
        const legacy = await compare(browserPng, legacyPng);
        entry.beforeFix = { mae: +legacy.mae.toFixed(3), psnrDb: +legacy.psnr.toFixed(2), pixelsWithin32: +legacy.within32.toFixed(5) };
        // The control must fail what the fixed pipeline passes.
        expect(legacy.mae > 4 || legacy.within32 < 0.99, `${fixture.name}: control did not detect the defect`).toBe(true);
      }
      results[fixture.name] = entry;
      if (fixture.text) {
        expect(metrics.inkBoundsDelta, fixture.name).toBeLessThanOrEqual(1);
        // Same glyph weight: total ink within 6 %.
        expect(Math.abs(1 - metrics.inkAmountRatio), fixture.name).toBeLessThanOrEqual(0.06);
      } else {
        expect(metrics.mae, fixture.name).toBeLessThanOrEqual(4);
        expect(metrics.within32, fixture.name).toBeGreaterThanOrEqual(0.99);
      }
    }
  }, 180_000);
});
