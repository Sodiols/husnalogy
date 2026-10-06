import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  CARD_SIZE_PRESETS,
  artboardOf,
  canvasPixelsFor,
  isArtboardConsistent,
  matchCardSizePreset,
  resizeTemplateArtboard,
  scaleLayerContent,
} from "../artboard";
import { normalizeCustomizerTemplate } from "@/lib/customizer";
import { normalizeDocumentV2, templateToDocument } from "../document";
import { templateFromVersionSnapshot } from "@/lib/customizer/versions";
import { buildPrintPdf, renderCustomizationPages } from "../server/render";
import { installGoogleFontsHarness, resetGoogleFontsHarness } from "./google-fonts-test-harness";

const five = () =>
  normalizeCustomizerTemplate({
    id: "tpl",
    version: 1,
    canvasWidthPx: 1500,
    canvasHeightPx: 2100,
    cardWidthIn: 5,
    cardHeightIn: 7,
    dpi: 300,
    pages: [{ id: "front", label: "Front", enabled: true, backgroundColor: "#ffffff" }],
    safeArea: { top: 90, right: 90, bottom: 90, left: 90 },
    bleed: { top: 30, right: 30, bottom: 30, left: 30 },
    guides: [
      { id: "g1", pageId: "front", axis: "vertical", position: 750 },
      { id: "g2", pageId: "front", axis: "horizontal", position: 1050 },
    ],
    layers: [
      {
        id: "title", page: "front", type: "text", text: "Ayesha & Omar", x: 750, y: 300, width: 1100, height: 160, zIndex: 2,
        textStyle: { fontFamily: "Playfair Display", fontSize: 96, minFontSize: 20, maxFontSize: 200, letterSpacing: 4, lineHeight: 1.2 },
      },
      { id: "box", page: "front", type: "shape", shape: "rounded-rectangle", x: 400, y: 1200, width: 500, height: 300, strokeWidth: 6, borderRadius: 40, zIndex: 3, rotation: 15 },
      { id: "photo", page: "front", type: "image", x: 1000, y: 1500, width: 600, height: 800, borderWidth: 10, zIndex: 4, imageTransform: { zoom: 1.5, offsetX: 40, offsetY: -20, cropX: 0.1, cropY: 0, cropWidth: 0.8, cropHeight: 1 } },
      { id: "grid", page: "front", type: "grid", x: 750, y: 1850, width: 1200, height: 300, gap: 20, padding: 10, cornerRadius: 12, zIndex: 5, slots: [{ id: "s1", x: 0, y: 0, width: 1, height: 1, transform: { zoom: 1, offsetX: 30, offsetY: 0 } }] },
      { id: "bg", page: "front", type: "background", x: 750, y: 1050, width: 1500, height: 2100, color: "#eeeeee", zIndex: -10 },
    ],
  });

describe("card size presets", () => {
  it("5 × 7 and 3.5 × 5 at 300 DPI are 1500 × 2100 and 1050 × 1500 pixels", () => {
    const byId = Object.fromEntries(CARD_SIZE_PRESETS.map((preset) => [preset.id, preset]));
    expect([canvasPixelsFor(byId["5x7"].widthIn, 300), canvasPixelsFor(byId["5x7"].heightIn, 300)]).toEqual([1500, 2100]);
    expect([canvasPixelsFor(byId["3.5x5"].widthIn, 300), canvasPixelsFor(byId["3.5x5"].heightIn, 300)]).toEqual([1050, 1500]);
  });

  it("recognises a preset in either orientation, and anything else as custom", () => {
    expect(matchCardSizePreset({ widthIn: 3.5, heightIn: 5 })?.id).toBe("3.5x5");
    expect(matchCardSizePreset({ widthIn: 7, heightIn: 5 })?.id).toBe("5x7");
    expect(matchCardSizePreset({ widthIn: 6, heightIn: 8 })).toBeNull();
  });

  it("existing 5 × 7 templates are consistent and unchanged by reading them", () => {
    const template = five();
    expect(isArtboardConsistent(template)).toBe(true);
    expect(matchCardSizePreset(artboardOf(template))?.id).toBe("5x7");
  });
});

describe("resizeTemplateArtboard — 5 × 7 to 3.5 × 5", () => {
  const before = five();
  const { template: after, scale, offsetX, offsetY } = resizeTemplateArtboard(before, { widthIn: 3.5, heightIn: 5, dpi: 300 });
  const layer = (id: string) => after.layers.find((item: any) => item.id === id);
  const original = (id: string) => before.layers.find((item: any) => item.id === id);

  it("sets inches, DPI and pixels together", () => {
    expect([after.cardWidthIn, after.cardHeightIn, after.dpi, after.canvasWidthPx, after.canvasHeightPx]).toEqual([3.5, 5, 300, 1050, 1500]);
    expect(isArtboardConsistent(after)).toBe(true);
  });

  it("uses ONE uniform scale (no distortion) and centres the design", () => {
    // 1050/1500 = 0.7 across, 1500/2100 = 0.714 down: the smaller wins.
    expect(scale).toBeCloseTo(0.7, 6);
    expect(offsetX).toBeCloseTo(0, 6);
    expect(offsetY).toBeCloseTo((1500 - 2100 * 0.7) / 2, 6);
    for (const id of ["title", "box", "photo", "grid"]) {
      const ratioBefore = original(id).width / original(id).height;
      const ratioAfter = layer(id).width / layer(id).height;
      expect(ratioAfter).toBeCloseTo(ratioBefore, 2);
    }
    expect(layer("title").x).toBeCloseTo(750 * 0.7, 2);
    expect(layer("title").y).toBeCloseTo(300 * 0.7 + offsetY, 2);
    expect(layer("box").rotation).toBe(15);
  });

  it("scales what objects DRAW, not just their boxes", () => {
    expect(layer("title").textStyle.fontSize).toBeCloseTo(96 * 0.7, 2);
    expect(layer("title").textStyle.minFontSize).toBeCloseTo(20 * 0.7, 2);
    expect(layer("title").textStyle.letterSpacing).toBeCloseTo(4 * 0.7, 2);
    expect(layer("title").textStyle.lineHeight).toBe(1.2);
    expect(layer("box").strokeWidth).toBeCloseTo(6 * 0.7, 2);
    expect(layer("box").borderRadius).toBeCloseTo(40 * 0.7, 2);
    expect(layer("photo").borderWidth).toBeCloseTo(7, 2);
    expect(layer("photo").imageTransform).toMatchObject({ zoom: 1.5, offsetX: 28, offsetY: -14, cropX: 0.1, cropWidth: 0.8 });
    expect(layer("grid")).toMatchObject({ gap: 14, padding: 7, cornerRadius: 8.4 });
    expect(layer("grid").slots[0].transform.offsetX).toBeCloseTo(21, 2);
  });

  it("a background still covers the whole new page", () => {
    expect(layer("bg")).toMatchObject({ x: 525, y: 750, width: 1050, height: 1500 });
  });

  it("guides follow the design; print margins stay the same physical size", () => {
    expect(after.guides.find((guide: any) => guide.id === "g1").position).toBeCloseTo(750 * 0.7 + offsetX, 2);
    expect(after.guides.find((guide: any) => guide.id === "g2").position).toBeCloseTo(1050 * 0.7 + offsetY, 2);
    // 90px at 300 DPI is 0.3in on every card size.
    expect(after.safeArea).toEqual(before.safeArea);
    expect(after.bleed).toEqual(before.bleed);
  });

  it("does not mutate the template it was given", () => {
    expect(before.canvasWidthPx).toBe(1500);
    expect(original("title").textStyle.fontSize).toBe(96);
  });

  it("changing only the DPI keeps the design visually identical", () => {
    const { template: hi, scale: dpiScale } = resizeTemplateArtboard(before, { widthIn: 5, heightIn: 7, dpi: 600 });
    expect([hi.canvasWidthPx, hi.canvasHeightPx]).toEqual([3000, 4200]);
    expect(dpiScale).toBe(2);
    expect(hi.safeArea.top).toBe(180);
    expect(hi.layers.find((item: any) => item.id === "title").textStyle.fontSize).toBe(192);
  });

  it("scaleLayerContent leaves a layer untouched at factor 1", () => {
    const text = original("title");
    expect(scaleLayerContent(text, 1)).toBe(text);
  });
});

describe("a 3.5 × 5 card through persistence, publishing and the server renderer", () => {
  const small = () => resizeTemplateArtboard(five(), { widthIn: 3.5, heightIn: 5, dpi: 300 }).template;

  it("survives normalisation (the Design Studio save) unchanged", () => {
    const saved = normalizeCustomizerTemplate(small());
    expect([saved.cardWidthIn, saved.cardHeightIn, saved.dpi, saved.canvasWidthPx, saved.canvasHeightPx]).toEqual([3.5, 5, 300, 1050, 1500]);
  });

  it("round-trips through the published version document with its physical size", () => {
    const { document } = templateToDocument(small());
    expect(document.canvas).toMatchObject({ widthPx: 1050, heightPx: 1500, widthIn: 3.5, heightIn: 5, dpi: 300 });
    const published = templateFromVersionSnapshot({
      id: "v1", templateId: "tpl", productId: "p", version: 2, document, displayVersion: "1.1",
    } as any);
    expect([published.cardWidthIn, published.cardHeightIn, published.dpi, published.canvasWidthPx, published.canvasHeightPx]).toEqual([3.5, 5, 300, 1050, 1500]);
    expect(normalizeDocumentV2(document as any).document.canvas).toMatchObject({ widthPx: 1050, heightPx: 1500, widthIn: 3.5, heightIn: 5 });
  });

  it("renders print pages at 1050 × 1500 (+ bleed) and a PDF page of 3.5 × 5 in (+ bleed)", async () => {
    installGoogleFontsHarness();
    try {
      await renderAndCheck();
    } finally {
      resetGoogleFontsHarness();
      vi.restoreAllMocks();
    }
  });

  async function renderAndCheck() {
    // The photo has no picture: print renders nothing for it, and nothing is fetched.
    const template = { ...small(), layers: small().layers.filter((layer: any) => layer.type !== "image") };
    const pages = await renderCustomizationPages({ template, values: {}, editorState: null, mode: "print", includeBleed: true, pageIds: ["front"] });
    expect(pages[0].widthPx).toBe(1050 + 60);
    expect(pages[0].heightPx).toBe(1500 + 60);
    expect(pages[0].dpi).toBe(300);
    const { pdf } = await buildPrintPdf(pages, { widthIn: 3.5, heightIn: 5, dpi: 300, bleedPx: template.bleed });
    const page = (await PDFDocument.load(pdf)).getPage(0);
    // 30px bleed at 300 DPI is 0.1in per side.
    expect(page.getWidth()).toBeCloseTo((3.5 + 0.2) * 72, 3);
    expect(page.getHeight()).toBeCloseTo((5 + 0.2) * 72, 3);
  }
});
