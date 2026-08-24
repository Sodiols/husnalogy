import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { renderCustomizationPages, buildPrintPdf } from "../server/render";
import { collectFontDependencies } from "../google-fonts";
import { resolveFontsForStyles } from "../server/google-font-files";
import { preloadFontsForStyles, createServerMeasureFromCatalog, collectTextStyles } from "../server/server-fonts";
import {
  TEST_CATALOG,
  installGoogleFontsHarness,
  requestedFontUrls,
  resetGoogleFontsHarness,
} from "./google-fonts-test-harness";

// Mandatory production-rendering coverage for the Google Fonts architecture
// (spec §34). Covers a serif, a sans-serif and a script/display family, plus a
// bold and an italic variant, and asserts the pipeline actually resolved and
// used those exact families — not merely that rendering returned something.

const template = {
  id: "t-google-fonts",
  version: 1,
  canvasWidthPx: 900,
  canvasHeightPx: 1200,
  cardWidthIn: 6,
  cardHeightIn: 8,
  dpi: 150,
  defaultPage: "front",
  pages: [{ id: "front", label: "Front", enabled: true, backgroundColor: "#ffffff" }],
  fields: [],
  layers: [
    {
      id: "serif-bold",
      name: "Serif bold",
      page: "front",
      type: "text",
      x: 450,
      y: 200,
      width: 800,
      height: 120,
      zIndex: 1,
      text: "Ayesha & Omar",
      textStyle: { fontFamily: "Playfair Display", fontWeight: "700", fontSize: 56, textAlign: "center" },
    },
    {
      id: "sans-regular",
      name: "Sans regular",
      page: "front",
      type: "text",
      x: 450,
      y: 400,
      width: 800,
      height: 100,
      zIndex: 2,
      text: "Saturday the twelfth of October",
      textStyle: { fontFamily: "Montserrat", fontWeight: "400", fontSize: 32, textAlign: "center" },
    },
    {
      id: "sans-italic",
      name: "Sans italic",
      page: "front",
      type: "text",
      x: 450,
      y: 560,
      width: 800,
      height: 90,
      zIndex: 3,
      text: "at half past four in the afternoon",
      textStyle: { fontFamily: "Montserrat", fontStyle: "italic", fontWeight: "400", fontSize: 28, textAlign: "center" },
    },
    {
      id: "script",
      name: "Script",
      page: "front",
      type: "text",
      x: 450,
      y: 760,
      width: 800,
      height: 120,
      zIndex: 4,
      text: "Celebrate with us",
      textStyle: { fontFamily: "Dancing Script", fontWeight: "400", fontSize: 44, textAlign: "center" },
    },
  ],
  safeArea: { top: 40, right: 40, bottom: 40, left: 40 },
  bleed: { top: 20, right: 20, bottom: 20, left: 20 },
  settings: {},
};

beforeEach(() => {
  installGoogleFontsHarness();
});
afterEach(() => {
  resetGoogleFontsHarness();
});

describe("Google Fonts dependency resolution", () => {
  it("resolves exactly the families and variants the design uses", () => {
    const styles = collectTextStyles(template, null);
    const { dependencies, missingFamilies } = collectFontDependencies(TEST_CATALOG, styles);

    expect(missingFamilies).toEqual([]);
    const described = dependencies.map((d) => `${d.family} ${d.weight} ${d.style}`).sort();
    expect(described).toEqual([
      "Dancing Script 400 normal",
      "Montserrat 400 italic",
      "Montserrat 400 normal",
      "Playfair Display 700 normal",
    ]);
  });

  it("downloads only the required variants — never the whole library", async () => {
    const styles = collectTextStyles(template, null);
    const resolved = await resolveFontsForStyles(TEST_CATALOG, styles);

    expect(resolved.filePaths).toHaveLength(4);
    // One download per distinct variant, and nothing else.
    expect(requestedFontUrls).toHaveLength(4);
    expect(requestedFontUrls.every((url) => url.startsWith("https://fonts.gstatic.com/"))).toBe(true);
    // The catalog has more families/variants than the design uses.
    expect(TEST_CATALOG.length).toBeGreaterThan(3);
  });

  it("reuses a cached font file instead of downloading it twice", async () => {
    const styles = collectTextStyles(template, null);
    await resolveFontsForStyles(TEST_CATALOG, styles);
    const afterFirst = requestedFontUrls.length;
    await resolveFontsForStyles(TEST_CATALOG, styles);
    expect(requestedFontUrls.length).toBe(afterFirst);
  });
});

describe("server measurement uses real Google font metrics", () => {
  it("parses every required variant and measures with actual metrics", async () => {
    const styles = collectTextStyles(template, null);
    const { parsed, missingFamilies } = await preloadFontsForStyles(TEST_CATALOG, styles);

    expect(missingFamilies).toEqual([]);
    expect(parsed.size).toBe(4);

    const measure = createServerMeasureFromCatalog(TEST_CATALOG, parsed);
    const width = measure("Ayesha & Omar", {
      fontFamily: "Playfair Display",
      fontWeight: "700",
      fontStyle: "normal",
      fontSize: 56,
      letterSpacing: 0,
    } as any);

    // A real measurement, not a generic fallback estimate.
    expect(width).toBeGreaterThan(0);
    // Longer text must measure wider with the same font — proves the metrics
    // are text-dependent rather than a constant.
    const longer = measure("Ayesha & Omar and their families", {
      fontFamily: "Playfair Display",
      fontWeight: "700",
      fontStyle: "normal",
      fontSize: 56,
      letterSpacing: 0,
    } as any);
    expect(longer).toBeGreaterThan(width);
  });

  it("measures different families differently at the same size", async () => {
    const styles = collectTextStyles(template, null);
    const { parsed } = await preloadFontsForStyles(TEST_CATALOG, styles);
    const measure = createServerMeasureFromCatalog(TEST_CATALOG, parsed);

    const sample = "Handgloves";
    const base = { fontWeight: "400", fontStyle: "normal", fontSize: 40, letterSpacing: 0 };
    const serif = measure(sample, { ...base, fontFamily: "Playfair Display" } as any);
    const sans = measure(sample, { ...base, fontFamily: "Montserrat" } as any);

    expect(serif).toBeGreaterThan(0);
    expect(sans).toBeGreaterThan(0);
    // The harness backs serif and sans with genuinely different font files.
    expect(serif).not.toBe(sans);
  });
});

describe("production PNG and PDF with Google Fonts", () => {
  it("renders a print PNG using the requested Google families", async () => {
    const pages = await renderCustomizationPages({
      template,
      values: {},
      editorState: null,
      mode: "print",
      includeBleed: true,
    });

    expect(pages).toHaveLength(1);
    const meta = await sharp(pages[0].png).metadata();
    expect(meta.format).toBe("png");
    // Native canvas + bleed at print size.
    expect(meta.width).toBe(940);
    expect(meta.height).toBe(1240);

    // The render genuinely fetched the four required variants.
    const families = new Set(requestedFontUrls.map((url) => url.split("/s/")[1]?.split("/")[0]));
    expect(families).toContain("playfairdisplay");
    expect(families).toContain("montserrat");
    expect(families).toContain("dancingscript");
  });

  it("builds a print PDF at the exact physical size from those pages", async () => {
    const pages = await renderCustomizationPages({
      template,
      values: {},
      editorState: null,
      mode: "print",
      includeBleed: true,
    });

    const { pdf, checksum } = await buildPrintPdf(pages, {
      widthIn: 6,
      heightIn: 8,
      dpi: 150,
      bleedPx: { top: 20, right: 20, bottom: 20, left: 20 },
    });

    expect(checksum).toMatch(/^[a-f0-9]{64}$/);
    const parsed = await PDFDocument.load(pdf);
    expect(parsed.getPageCount()).toBe(1);

    const page = parsed.getPage(0);
    // 6in + bleed (20px @150dpi = 0.1333in each side) at 72pt/in.
    const expectedWidthPt = (6 + 40 / 150) * 72;
    const expectedHeightPt = (8 + 40 / 150) * 72;
    expect(page.getWidth()).toBeCloseTo(expectedWidthPt, 1);
    expect(page.getHeight()).toBeCloseTo(expectedHeightPt, 1);
  });

  it("produces a visually non-blank page — the text actually drew", async () => {
    const pages = await renderCustomizationPages({
      template,
      values: {},
      editorState: null,
      mode: "print",
    });

    // A page whose text failed to render would be a uniform white field.
    const stats = await sharp(pages[0].png).stats();
    const channelStdDev = stats.channels.map((channel) => channel.stdev);
    expect(Math.max(...channelStdDev)).toBeGreaterThan(1);
  });

  it("refuses to render when one family is not a Google Font", async () => {
    const mixed = {
      ...template,
      layers: [
        ...template.layers,
        {
          id: "legacy",
          name: "Legacy",
          page: "front",
          type: "text",
          x: 450,
          y: 1000,
          width: 800,
          height: 80,
          zIndex: 5,
          text: "legacy system font",
          textStyle: { fontFamily: "Comic Sans MS", fontSize: 24 },
        },
      ],
    };

    await expect(
      renderCustomizationPages({ template: mixed, values: {}, editorState: null, mode: "print" }),
    ).rejects.toMatchObject({ code: "FONT_FILE_MISSING" });
  });

  it("keeps preview renders on the same Google Fonts pipeline", async () => {
    const pages = await renderCustomizationPages({
      template,
      values: {},
      editorState: null,
      mode: "preview",
      previewWidth: 500,
      watermark: "HUSNALOGY PREVIEW",
    });

    expect(pages).toHaveLength(1);
    const meta = await sharp(pages[0].png).metadata();
    expect(meta.width).toBe(500);
    expect(requestedFontUrls.length).toBeGreaterThan(0);
  });
});
