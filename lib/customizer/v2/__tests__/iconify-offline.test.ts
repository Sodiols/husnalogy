import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { renderCustomizationPages, buildPrintPdf } from "../server/render";
import { __resetIconifyCaches } from "../server/iconify";
import { installGoogleFontsHarness, resetGoogleFontsHarness } from "./google-fonts-test-harness";

// MANDATORY long-term independence check (spec §55, §76).
//
// An Iconify graphic that has already been imported is an ordinary Husnalogy
// asset with its own stored bytes. With EVERY Iconify origin hard-failed, the
// design must still open and still render to PNG and PDF.
//
// The test proves that by failing any request to an Iconify host outright: if
// the render pipeline touched Iconify at all, these would throw.

const IMPORTED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#303839" d="M12 21S4 13.6 4 8.8A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 8 2.8C20 13.6 12 21 12 21Z"/></svg>`;
const IMPORTED_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(IMPORTED_SVG, "utf8").toString("base64")}`;

/** Every host we must NOT contact once an element is imported. */
const ICONIFY_HOSTS = [/api\.iconify\.design/i, /iconify/i];

let iconifyCalls: string[] = [];

const template = {
  id: "t-iconify-offline",
  version: 1,
  canvasWidthPx: 600,
  canvasHeightPx: 800,
  cardWidthIn: 4,
  cardHeightIn: 6,
  dpi: 150,
  defaultPage: "front",
  pages: [{ id: "front", label: "Front", enabled: true, backgroundColor: "#ffffff" }],
  fields: [],
  layers: [
    {
      id: "title",
      name: "Title",
      page: "front",
      type: "text",
      x: 300,
      y: 150,
      width: 500,
      height: 90,
      zIndex: 1,
      text: "With this graphic",
      textStyle: { fontFamily: "Playfair Display", fontWeight: "400", fontSize: 36, textAlign: "center" },
    },
    {
      // The imported Iconify graphic, now an ordinary element layer whose
      // source is Husnalogy's own stored copy.
      id: "imported-graphic",
      name: "Heart",
      page: "front",
      type: "element",
      assetId: "11111111-1111-4111-8111-111111111111",
      src: IMPORTED_DATA_URI,
      x: 300,
      y: 450,
      width: 220,
      height: 220,
      zIndex: 2,
      tintColor: "",
    },
  ],
  safeArea: { top: 20, right: 20, bottom: 20, left: 20 },
  bleed: { top: 10, right: 10, bottom: 10, left: 10 },
  settings: {},
};

beforeEach(() => {
  iconifyCalls = [];
  __resetIconifyCaches();

  // Fonts still resolve (that is a separate subsystem); Iconify is dead.
  const fontFetch = installGoogleFontsHarness();
  const passthrough = fontFetch.getMockImplementation()!;
  fontFetch.mockImplementation(async (input: any, init?: any) => {
    const requested = String(typeof input === "string" ? input : input?.url || "");
    if (ICONIFY_HOSTS.some((pattern) => pattern.test(requested))) {
      iconifyCalls.push(requested);
      throw new Error("Iconify is unavailable (offline independence test).");
    }
    return passthrough(input, init);
  });
});

afterEach(() => {
  resetGoogleFontsHarness();
  vi.restoreAllMocks();
});

describe("a design using an imported Iconify graphic works with Iconify offline", () => {
  it("renders a preview PNG without contacting Iconify", async () => {
    const pages = await renderCustomizationPages({
      template,
      values: {},
      editorState: null,
      mode: "preview",
      previewWidth: 400,
    });

    expect(pages).toHaveLength(1);
    const meta = await sharp(pages[0].png).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(400);
    expect(iconifyCalls, "the render must never call Iconify").toEqual([]);
  });

  it("renders a print PNG without contacting Iconify", async () => {
    const pages = await renderCustomizationPages({
      template,
      values: {},
      editorState: null,
      mode: "print",
      includeBleed: true,
    });

    const meta = await sharp(pages[0].png).metadata();
    expect(meta.width).toBe(620); // 600 canvas + 10 bleed each side
    expect(meta.height).toBe(820);
    expect(iconifyCalls).toEqual([]);
  });

  it("builds a print PDF without contacting Iconify", async () => {
    const pages = await renderCustomizationPages({
      template,
      values: {},
      editorState: null,
      mode: "print",
      includeBleed: true,
    });
    const { pdf, checksum } = await buildPrintPdf(pages, {
      widthIn: 4,
      heightIn: 6,
      dpi: 150,
      bleedPx: { top: 10, right: 10, bottom: 10, left: 10 },
    });

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(checksum).toMatch(/^[a-f0-9]{64}$/);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
    expect(iconifyCalls).toEqual([]);
  });

  it("actually draws the graphic — the page is not blank", async () => {
    const pages = await renderCustomizationPages({
      template,
      values: {},
      editorState: null,
      mode: "print",
    });
    const stats = await sharp(pages[0].png).stats();
    expect(Math.max(...stats.channels.map((channel) => channel.stdev))).toBeGreaterThan(1);
  });

  it("renders a tinted imported graphic offline", async () => {
    const tinted = {
      ...template,
      layers: [template.layers[0], { ...template.layers[1], tintColor: "#B08D2A" }],
    };
    const pages = await renderCustomizationPages({ template: tinted, values: {}, editorState: null, mode: "print" });
    expect(pages[0].png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(iconifyCalls).toEqual([]);
  });

  it("renders a rotated, flipped, semi-transparent imported graphic offline", async () => {
    const transformed = {
      ...template,
      layers: [
        template.layers[0],
        { ...template.layers[1], rotation: 30, flipX: true, flipY: true, opacity: 0.5 },
      ],
    };
    const pages = await renderCustomizationPages({ template: transformed, values: {}, editorState: null, mode: "print" });
    expect(pages[0].png.byteLength).toBeGreaterThan(0);
    expect(iconifyCalls).toEqual([]);
  });

  it("renders an imported graphic added as a CUSTOMER layer offline", async () => {
    const editorState = {
      layerOverrides: {},
      userLayers: [{
        id: "user-element",
        type: "element",
        page: "front",
        assetId: "22222222-2222-4222-8222-222222222222",
        src: IMPORTED_DATA_URI,
        x: 300, y: 620, width: 120, height: 120, zIndex: 5,
      }],
    };
    const pages = await renderCustomizationPages({ template, values: {}, editorState: editorState as any, mode: "print" });
    expect(pages[0].png.byteLength).toBeGreaterThan(0);
    expect(iconifyCalls).toEqual([]);
  });
});

describe("the renderer contains no Iconify dependency at all", () => {
  it("never imports the Iconify service from the render pipeline", async () => {
    const fs = await import("node:fs");
    for (const file of [
      "lib/customizer/v2/server/render.ts",
      "lib/customizer/v2/svg.ts",
      "lib/customizer/render-jobs.ts",
      "lib/customizer/order-snapshots.ts",
    ]) {
      const source = fs.readFileSync(file, "utf8");
      expect(source, `${file} must not depend on Iconify`).not.toMatch(/iconify/i);
    }
  });
});
