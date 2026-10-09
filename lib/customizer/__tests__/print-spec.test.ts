/**
 * Physical print specification: raster size, bleed and PDF page size from one
 * function (docs/PRINT_QUALITY_AUDIT.md D6).
 */
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { printSpec, printSpecIssues } from "@/lib/customizer/print-spec";
import { validateCustomizerTemplateDetailed } from "@/lib/customizer";
import { buildPrintPdf } from "@/lib/customizer/v2/server/render";

const card = (overrides: Record<string, unknown> = {}) => ({
  cardWidthIn: 5, cardHeightIn: 7, dpi: 300, canvasWidthPx: 1500, canvasHeightPx: 2100,
  bleed: { top: 37.5, right: 37.5, bottom: 37.5, left: 37.5 }, ...overrides,
});

describe("printSpec", () => {
  it("5 × 7 in at 300 DPI with 0.125 in bleed: 1500 × 2100 trim, 1575 × 2175 full bleed", () => {
    const spec = printSpec(card());
    expect([spec.canvasWidthPx, spec.canvasHeightPx]).toEqual([1500, 2100]);
    expect([spec.rasterWidthPx, spec.rasterHeightPx]).toEqual([1575, 2175]);
    expect(spec.bleedIn).toEqual({ top: 0.125, right: 0.125, bottom: 0.125, left: 0.125 });
    expect([spec.pageWidthPt, spec.pageHeightPt]).toEqual([5.25 * 72, 7.25 * 72]);
  });

  it("600 PPI doubles the pixels, not the paper", () => {
    const spec = printSpec(card({ dpi: 600, canvasWidthPx: 3000, canvasHeightPx: 4200, bleed: { top: 75, right: 75, bottom: 75, left: 75 } }));
    expect([spec.canvasWidthPx, spec.canvasHeightPx]).toEqual([3000, 4200]);
    expect([spec.pageWidthPt, spec.pageHeightPt]).toEqual([5.25 * 72, 7.25 * 72]);
  });

  it("landscape cards keep their own width and height", () => {
    const spec = printSpec(card({ cardWidthIn: 7, cardHeightIn: 5, canvasWidthPx: 2100, canvasHeightPx: 1500, bleed: {} }));
    expect([spec.pageWidthPt, spec.pageHeightPt]).toEqual([7 * 72, 5 * 72]);
  });

  it("the PDF page is exactly the trim plus bleed", async () => {
    const png = await sharp({ create: { width: 1575, height: 2175, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const spec = printSpec(card());
    const { pdf } = await buildPrintPdf(
      [{ pageId: "front", png, widthPx: 1575, heightPx: 2175, dpi: 300, checksum: "" }, { pageId: "back", png, widthPx: 1575, heightPx: 2175, dpi: 300, checksum: "" }],
      { widthIn: spec.trimWidthIn, heightIn: spec.trimHeightIn, dpi: spec.dpi, bleedPx: spec.bleedPx, pxPerInch: { x: spec.pxPerInchX, y: spec.pxPerInchY } },
    );
    const document = await PDFDocument.load(pdf);
    expect(document.getPageCount()).toBe(2);
    for (const page of document.getPages()) {
      expect(page.getWidth()).toBeCloseTo(378, 6);
      expect(page.getHeight()).toBeCloseTo(522, 6);
    }
  });
});

describe("publish checks for the physical size", () => {
  it("accepts consistent templates, including the live 4.99 × 7 in one", () => {
    expect(printSpecIssues(card())).toEqual({ errors: [], warnings: [] });
    expect(printSpecIssues(card({ cardWidthIn: 4.99, canvasWidthPx: 1497 }))).toEqual({ errors: [], warnings: [] });
  });

  it("refuses a canvas whose shape would stretch the print", () => {
    const issues = printSpecIssues(card({ cardHeightIn: 7.5 }));
    expect(issues.errors[0]).toMatch(/stretched/);
    const publish = validateCustomizerTemplateDetailed({
      ...card({ cardHeightIn: 7.5 }),
      pages: [{ id: "front", label: "Front", enabled: true }], layers: [], fields: [],
    });
    expect(publish.errors.some((message) => message.includes("stretched"))).toBe(true);
  });

  it("warns when the pixels do not match the declared DPI", () => {
    const issues = printSpecIssues(card({ canvasWidthPx: 1000, canvasHeightPx: 1400 }));
    expect(issues.errors).toEqual([]);
    expect(issues.warnings[0]).toMatch(/200 pixels per inch, not the 300 DPI/);
  });

  it("leaves templates without a stated card size alone", () => {
    expect(printSpecIssues({ canvasWidthPx: 1000, canvasHeightPx: 1000, dpi: 300 })).toEqual({ errors: [], warnings: [] });
  });
});
