import { describe, it, expect } from "vitest";
import { renderCustomizationPages, buildPrintPdf, RenderError } from "../server/render";
import { buildPageSvg } from "../svg";
import { createServerMeasure } from "../server/server-fonts";

// A tiny valid PNG (1x1 red pixel) used as an embedded photo.
const RED_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const template = {
  id: "t-render",
  version: 1,
  canvasWidthPx: 750,
  canvasHeightPx: 1050,
  cardWidthIn: 5,
  cardHeightIn: 7,
  dpi: 150,
  defaultPage: "front",
  pages: [
    { id: "front", label: "Front", enabled: true, backgroundColor: "#F8F6F1" },
    { id: "back", label: "Back", enabled: true, backgroundColor: "#ffffff" },
  ],
  fields: [
    { id: "names", label: "Names", type: "text" },
    { id: "photo", label: "Photo", type: "image" },
  ],
  layers: [
    {
      id: "title",
      name: "Title",
      page: "front",
      type: "text",
      fieldId: "names",
      customerEditable: true,
      x: 375,
      y: 200,
      width: 600,
      height: 160,
      zIndex: 5,
      text: "A very long headline that must wrap across lines",
      textStyle: { fontFamily: "Cormorant Garamond", fontSize: 44, multiline: true, textAlign: "center" },
    },
    {
      id: "photo",
      name: "Photo",
      page: "front",
      type: "image",
      fieldId: "photo",
      customerEditable: true,
      maskShape: "arch",
      x: 375,
      y: 640,
      width: 400,
      height: 500,
      zIndex: 4,
    },
  ],
  safeArea: { top: 40, right: 40, bottom: 40, left: 40 },
  bleed: { top: 20, right: 20, bottom: 20, left: 20 },
  settings: {},
};

const values = { names: "Ayesha & Omar", photo: { url: RED_PIXEL, zoom: 1.4, offsetX: 10 } };

describe("server render pipeline", () => {
  it("renders every enabled page to a valid PNG at print size with bleed", async () => {
    const pages = await renderCustomizationPages({
      template,
      values,
      editorState: null,
      mode: "print",
      includeBleed: true,
    });
    expect(pages).toHaveLength(2);
    for (const page of pages) {
      // PNG signature
      expect(page.png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(page.checksum).toHaveLength(64);
    }
    // 750px canvas + 20px bleed each side.
    expect(pages[0].widthPx).toBe(790);
    expect(pages[0].heightPx).toBe(1090);
    expect(pages[0].dpi).toBe(150);
  });

  it("print SVG contains no watermark, guides, or placeholder frames", () => {
    const svg = buildPageSvg({
      template: { ...template, layers: [{ ...template.layers[1], fieldId: "photo" }] },
      values: {}, // photo empty → placeholder in preview, nothing in print
      editorState: null,
      pageId: "front",
      measure: createServerMeasure(),
      mode: "print",
      watermark: "SHOULD NOT APPEAR",
    });
    expect(svg).not.toContain("SHOULD NOT APPEAR");
    expect(svg).not.toContain("stroke-dasharray=\"14 12\""); // placeholder frame
  });

  it("preview mode adds the watermark pattern", () => {
    const svg = buildPageSvg({
      template,
      values,
      editorState: null,
      pageId: "front",
      measure: createServerMeasure(),
      mode: "preview",
      watermark: "HUSNALOGY PREVIEW",
    });
    expect(svg).toContain("HUSNALOGY PREVIEW");
  });

  it("uses the shared arch mask in server SVG output", () => {
    const svg = buildPageSvg({
      template,
      values,
      editorState: null,
      pageId: "front",
      measure: createServerMeasure(),
      mode: "print",
    });
    expect(svg).toContain("clipPath");
    expect(svg).toMatch(/A 200 /); // arch cap arc for the 400px-wide frame
  });

  it("refuses untrusted remote assets", async () => {
    await expect(
      renderCustomizationPages({
        template,
        values: { ...values, photo: { url: "https://evil.example.com/x.png" } },
        editorState: null,
        mode: "print",
      }),
    ).rejects.toThrowError(RenderError);
  });

  it("fails print jobs that depend on non-server fonts instead of substituting", async () => {
    const badTemplate = {
      ...template,
      layers: [
        { ...template.layers[0], textStyle: { ...template.layers[0].textStyle, fontFamily: "Georgia" } },
        template.layers[1],
      ],
    };
    await expect(
      renderCustomizationPages({ template: badTemplate, values, editorState: null, mode: "print" }),
    ).rejects.toThrow(/fonts unavailable/i);
  });

  it("builds a print PDF at the exact physical size including bleed", async () => {
    const pages = await renderCustomizationPages({
      template,
      values,
      editorState: null,
      mode: "print",
      includeBleed: true,
    });
    const { pdf, checksum } = await buildPrintPdf(pages, {
      widthIn: 5,
      heightIn: 7,
      dpi: 150,
      bleedPx: { top: 20, right: 20, bottom: 20, left: 20 },
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(checksum).toHaveLength(64);
    // 5in + 40px/150dpi bleed ≈ 5.267in → 379.2pt page width.
    const { PDFDocument } = await import("pdf-lib");
    const parsed = await PDFDocument.load(pdf);
    expect(parsed.getPageCount()).toBe(2);
    const { width, height } = parsed.getPage(0).getSize();
    expect(width).toBeCloseTo((5 + 40 / 150) * 72, 1);
    expect(height).toBeCloseTo((7 + 40 / 150) * 72, 1);
  });

  it("renders independent grid slots and grouped layers through PNG and PDF", async () => {
    const gridAndGroupTemplate = {
      ...template,
      layers: [
        {
          id: "group", name: "Grouped decoration", page: "front", type: "group", childIds: ["group-shape"],
          x: 375, y: 100, width: 200, height: 80, rotation: 0, opacity: 0.5, zIndex: 1,
        },
        {
          id: "group-shape", name: "Decoration", page: "front", type: "shape", shape: "rectangle", groupId: "group",
          x: 375, y: 100, width: 200, height: 80, rotation: 0, opacity: 0.8, zIndex: 2, fill: "#303839",
        },
        {
          id: "grid", name: "Photos", page: "front", type: "grid", x: 375, y: 600, width: 620, height: 500,
          rotation: 5, opacity: 1, zIndex: 3, gap: 12, padding: 10, cornerRadius: 18, borderWidth: 2,
          borderColor: "#303839", backgroundColor: "#F8F6F1",
          slots: [
            { id: "one", x: 0, y: 0, width: 0.5, height: 1, src: RED_PIXEL, transform: { zoom: 1, offsetX: 0, offsetY: 0, rotation: 0, flipX: false, flipY: false, fitMode: "cover" }, mask: { kind: "circle" } },
            { id: "two", x: 0.5, y: 0, width: 0.5, height: 1, src: RED_PIXEL, transform: { zoom: 1.2, offsetX: 5, offsetY: -3, rotation: 90, flipX: true, flipY: false, fitMode: "cover" }, mask: { kind: "arch-top" } },
          ],
        },
      ],
    };
    const pages = await renderCustomizationPages({ template: gridAndGroupTemplate, values: {}, editorState: null, mode: "print", pageIds: ["front"] });
    expect(pages).toHaveLength(1);
    expect(pages[0].png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const { pdf } = await buildPrintPdf(pages, { widthIn: 5, heightIn: 7, dpi: 150, bleedPx: { top: 0, right: 0, bottom: 0, left: 0 } });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
