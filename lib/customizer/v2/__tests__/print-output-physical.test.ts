/**
 * Physical correctness of production print output, measured on real files:
 * PDF page size (trim + bleed), the embedded raster's pixel size and therefore
 * its physical resolution, PNG density metadata, and orientation.
 *
 * Documented limitation, asserted here so it cannot change silently: the print
 * PDF contains one raster image per page — text and shapes are rasterized at
 * the card's pixel density; the PDF has no fonts and no vector text.
 */
import { PDFDocument, PDFName, PDFRawStream, PDFDict } from "pdf-lib";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPrintPdf, renderCustomizationPages } from "../server/render";
import { pngDensity } from "../server/png-density";
import { printSpec } from "@/lib/customizer/print-spec";
import { installGoogleFontsHarness, resetGoogleFontsHarness } from "./google-fonts-test-harness";

function card(orientation: "portrait" | "landscape") {
  const [wIn, hIn] = orientation === "portrait" ? [5, 7] : [7, 5];
  const [w, h] = [wIn * 300, hIn * 300];
  return {
    id: `t-${orientation}`, version: 1, canvasWidthPx: w, canvasHeightPx: h, cardWidthIn: wIn, cardHeightIn: hIn, dpi: 300,
    defaultPage: "front",
    pages: [
      { id: "front", label: "Front", enabled: true, backgroundColor: "#ffffff" },
      { id: "back", label: "Back", enabled: true, backgroundColor: "#ffffff" },
    ],
    fields: [],
    layers: [
      // An orientation marker in the top-left corner of the trim.
      { id: "marker", name: "Marker", page: "front", type: "shape", shape: "rect", x: 100, y: 100, width: 200, height: 200, zIndex: 1, fill: "#d40000" },
      { id: "names", name: "Names", page: "front", type: "text", x: w / 2, y: h / 2, width: w * 0.8, height: 120, zIndex: 2, text: "Ayesha & Omar", textStyle: { fontFamily: "Playfair Display", fontSize: 36, textAlign: "center" } },
    ],
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    bleed: { top: 37.5, right: 37.5, bottom: 37.5, left: 37.5 },
    settings: {},
  };
}

function images(document: PDFDocument) {
  const found: Array<{ width: number; height: number }> = [];
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    const dict = object instanceof PDFRawStream ? object.dict : object instanceof PDFDict ? object : null;
    if (dict?.get(PDFName.of("Subtype"))?.toString() === "/Image") {
      found.push({ width: Number(dict.get(PDFName.of("Width"))?.toString()), height: Number(dict.get(PDFName.of("Height"))?.toString()) });
    }
  }
  return found;
}

describe("print output physical properties", () => {
  beforeEach(() => { installGoogleFontsHarness(); });
  afterEach(() => { resetGoogleFontsHarness(); });

  for (const orientation of ["portrait", "landscape"] as const) {
    it(`${orientation}: PDF page = trim + 0.125 in bleed, 300 px per inch, marker top-left, text rasterized`, async () => {
      const template = card(orientation);
      const spec = printSpec(template);
      const pages = await renderCustomizationPages({ template, values: {}, editorState: null, mode: "print", includeBleed: true });
      const [trimW, trimH] = orientation === "portrait" ? [5, 7] : [7, 5];

      for (const page of pages) {
        // Raster: (trim + bleed) × 300.
        expect([page.widthPx, page.heightPx]).toEqual([(trimW + 0.25) * 300, (trimH + 0.25) * 300]);
        expect(page.dpi).toBe(300);
        const density = pngDensity(page.png)!;
        expect(density.x).toBeCloseTo(300, 0);
        expect(density.y).toBeCloseTo(300, 0);
        // pHYs was inserted without touching the pixels.
        expect((await sharp(page.png).metadata()).density).toBe(300);
      }

      // Orientation: the marker sits 37.5 px (bleed) + 100 px into the top-left.
      const { data, info } = await sharp(pages[0].png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const at = (x: number, y: number) => data[(Math.round(y) * info.width + Math.round(x)) * info.channels];
      expect(at(37.5 + 100, 37.5 + 100)).toBeGreaterThan(180); // red channel inside the marker
      const g = data[(Math.round(37.5 + 100) * info.width + Math.round(37.5 + 100)) * info.channels + 1];
      expect(g).toBeLessThan(60);
      expect(at(info.width - 140, info.height - 140)).toBeGreaterThan(240); // white at the opposite corner

      const { pdf } = await buildPrintPdf(pages, { widthIn: spec.trimWidthIn, heightIn: spec.trimHeightIn, dpi: spec.dpi, bleedPx: spec.bleedPx, pxPerInch: { x: spec.pxPerInchX, y: spec.pxPerInchY } });
      const document = await PDFDocument.load(pdf);
      expect(document.getPageCount()).toBe(2);
      for (const pdfPage of document.getPages()) {
        expect(pdfPage.getWidth()).toBeCloseTo((trimW + 0.25) * 72, 6);
        expect(pdfPage.getHeight()).toBeCloseTo((trimH + 0.25) * 72, 6);
        expect(pdfPage.getWidth() > pdfPage.getHeight()).toBe(orientation === "landscape");
      }
      // One raster per page, at exactly page inches × 300.
      const embedded = images(document);
      expect(embedded).toHaveLength(2);
      for (const image of embedded) {
        expect(image.width / (trimW + 0.25)).toBeCloseTo(300, 6);
        expect(image.height / (trimH + 0.25)).toBeCloseTo(300, 6);
      }
      // Documented limitation: no fonts, so no vector text.
      const pdfText = Buffer.from(pdf).toString("latin1");
      expect(pdfText).not.toMatch(/\/Type\s*\/Font/);
    });
  }
});
