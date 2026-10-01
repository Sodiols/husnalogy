import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { assertRenderBounds, PRODUCTION_RENDER_LIMITS, ProductionLimitError, RENDER_SAFETY_LIMITS, renderBoundsErrors } from "@/lib/customizer/production-limits";
import { makeProductionInput, productionIntegrityHash, readProductionSnapshot } from "@/lib/customizer/production-input";
import { pinProductionInput, type ProductionStorage } from "@/lib/customizer/server/production-assets";
import { validateCustomizerTemplateDetailed } from "@/lib/customizer";
import { parseCheckoutRequest } from "@/lib/orders/checkout-schema";
import { CURRENT_TERMS_VERSION } from "@/lib/orders/checkout-policy";

/** A printable template at a physical size (inches) and dpi, with 1/8" bleed. */
function printTemplate(widthIn: number, heightIn: number, dpi: number, pages = 1, extra: Record<string, unknown> = {}) {
  const bleed = Math.round(dpi / 8);
  return {
    canvasWidthPx: Math.round(widthIn * dpi),
    canvasHeightPx: Math.round(heightIn * dpi),
    cardWidthIn: widthIn,
    cardHeightIn: heightIn,
    dpi,
    bleed: { top: bleed, right: bleed, bottom: bleed, left: bleed },
    pages: Array.from({ length: pages }, (_, index) => ({ id: index === 0 ? "front" : `page${index}`, enabled: true })),
    layers: [{ id: "name", page: "front", type: "text", text: "Approved", x: 10, y: 10, width: 100, height: 20, textStyle: { fontFamily: "Inter", fontSize: 12 } }],
    fields: [],
    featureFlags: { customizer_v2_server_rendering: true },
    ...extra,
  };
}

const refusingStorage = (): ProductionStorage & { puts: number } => {
  const state = { puts: 0 };
  return Object.assign(state, { async put() { state.puts += 1; }, async get(): Promise<Buffer> { throw new Error("nothing stored"); } });
};

describe("production render limits: what Husnalogy actually supports", () => {
  it("accepts every stationery size at 300 dpi and posters up to 24 x 36 in at 200 dpi (bleed included)", () => {
    for (const [w, h, dpi] of [[5, 7, 300], [4.25, 5.5, 300], [6, 8, 300], [8.5, 11, 300], [12, 18, 300], [18, 24, 250], [24, 36, 200]]) {
      expect(renderBoundsErrors(printTemplate(w, h, dpi)), `${w}x${h}@${dpi}`).toEqual([]);
    }
  });

  it("accepts the exact maxima: 36 MP per page, 8,000 px per side, 600 dpi, 32 pages / 150 MP per design", () => {
    expect(renderBoundsErrors({ canvasWidthPx: 8000, canvasHeightPx: 4500, dpi: 600, pages: [{ id: "front" }] })).toEqual([]);
    const pages = Array.from({ length: 32 }, (_, index) => ({ id: `p${index}` }));
    expect(renderBoundsErrors({ canvasWidthPx: 2000, canvasHeightPx: 2343, dpi: 300, pages })).toEqual([]); // 149.95 MP
  });

  it("refuses one unit over each maximum with a clear reason", () => {
    expect(renderBoundsErrors({ canvasWidthPx: 6001, canvasHeightPx: 6000, dpi: 300, pages: [{ id: "front" }] }).join()).toMatch(/36\.0 MP per page/);
    expect(renderBoundsErrors({ canvasWidthPx: 8001, canvasHeightPx: 100, dpi: 300, pages: [{ id: "front" }] }).join()).toMatch(/8,000 px per side/);
    expect(renderBoundsErrors({ canvasWidthPx: 1000, canvasHeightPx: 1000, dpi: 601, pages: [{ id: "front" }] }).join()).toMatch(/between 72 and 600 dpi/);
    const pages33 = Array.from({ length: 33 }, (_, index) => ({ id: `p${index}` }));
    expect(renderBoundsErrors({ canvasWidthPx: 100, canvasHeightPx: 100, dpi: 300, pages: pages33 }).join()).toMatch(/at most 32 printed pages/);
    const pages32 = Array.from({ length: 32 }, (_, index) => ({ id: `p${index}` }));
    expect(renderBoundsErrors({ canvasWidthPx: 2000, canvasHeightPx: 2344, dpi: 300, pages: pages32 }).join()).toMatch(/150\.0 MP per design/);
  });

  it("24 x 36 in at 300 dpi is NOT supported, and says what is", () => {
    const errors = renderBoundsErrors(printTemplate(24, 36, 300));
    expect(errors.join(" ")).toMatch(/24 × 36 in at 200 dpi/);
    expect(() => assertRenderBounds(printTemplate(24, 36, 300))).toThrow(/SNAPSHOT_RENDER_LIMIT_EXCEEDED/);
  });

  it("refuses malicious dpi values", () => {
    for (const dpi of [0, -300, 71, 601, 100_000, Number.NaN, Number.POSITIVE_INFINITY, "300px", null]) {
      expect(renderBoundsErrors({ canvasWidthPx: 1000, canvasHeightPx: 1000, dpi, pages: [{ id: "front" }] }).join(), String(dpi)).toMatch(/dpi/);
    }
  });

  it("refuses enormous, negative and non-numeric canvases and bleeds", () => {
    expect(renderBoundsErrors({ canvasWidthPx: 1e9, canvasHeightPx: 1e9, dpi: 300, pages: [{ id: "front" }] }).length).toBeGreaterThan(0);
    expect(renderBoundsErrors({ canvasWidthPx: -1, canvasHeightPx: 100, dpi: 300, pages: [] }).length).toBeGreaterThan(0);
    expect(renderBoundsErrors({ canvasWidthPx: "wide", canvasHeightPx: 100, dpi: 300, pages: [] }).length).toBeGreaterThan(0);
    expect(renderBoundsErrors({ canvasWidthPx: 100, canvasHeightPx: 100, dpi: 300, pages: [], bleed: { left: -50 } }).join()).toMatch(/Bleed/);
  });

  it("checkout refuses an unsupported print size BEFORE downloading or storing anything", async () => {
    let downloads = 0;
    const storage = refusingStorage();
    const template = { ...printTemplate(24, 36, 300), layers: [{ id: "photo", page: "front", type: "image", src: "upload", x: 0, y: 0, width: 10, height: 10 }] };
    await expect(pinProductionInput("order-poster-300", makeProductionInput(template, {}, null), storage, { loadImage: async () => { downloads += 1; return Buffer.alloc(0); } })).rejects.toThrow(ProductionLimitError);
    await expect(pinProductionInput("order-huge", makeProductionInput({ ...template, canvasWidthPx: 1e9, canvasHeightPx: 1e9 }, {}, null), storage, { loadImage: async () => { downloads += 1; return Buffer.alloc(0); } })).rejects.toThrow(/cannot be produced automatically/);
    expect(downloads).toBe(0);
    expect(storage.puts).toBe(0);
  });

  it("the customer cannot choose dimensions: canvas size comes only from the PUBLISHED template", async () => {
    const published = { ...printTemplate(5, 7, 300), layers: [{ id: "photo", page: "front", type: "image", fieldId: "photo", customerEditable: true, src: "upload", x: 0, y: 0, width: 10, height: 10 }] };
    // A tampered design tries to smuggle an enormous canvas through values/editor state.
    const tamperedValues = { canvasWidthPx: 1e9, canvasHeightPx: 1e9, dpi: 100_000, photo: "upload" };
    const tamperedEditorState = { canvasWidthPx: 1e9, dpi: 100_000, template: { canvasWidthPx: 1e9 } };
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#ffffff" } }).png().toBuffer();
    const blobs = new Map<string, Buffer>();
    const pinned = await pinProductionInput("order-tampered", makeProductionInput(published, tamperedValues, tamperedEditorState), { async put(path, data) { blobs.set(path, data); }, async get(path) { return blobs.get(path)!; } }, { loadImage: async () => bytes });
    expect(pinned.template).toMatchObject({ canvasWidthPx: 1500, canvasHeightPx: 2100, dpi: 300 });
    const snapshot = { snapshotSchemaVersion: 1, production: pinned };
    expect(readProductionSnapshot({ snapshot, snapshot_schema_version: 1, production_mode: "automatic", order_id: "order-tampered", integrity_hash: productionIntegrityHash(snapshot) }).template.canvasWidthPx).toBe(1500);
    // And the checkout request cannot carry dimensions at all (strict schema).
    const request = parseCheckoutRequest({
      checkoutSubmissionId: "dimension-tamper-0000001", customerName: "A Customer", customerPhone: "01712345678", deliveryMethod: "store",
      acceptTerms: true, termsVersion: CURRENT_TERMS_VERSION,
      items: [{ productId: "p", quantity: 1, selectedOptions: {}, cartItemId: "8f14e45f-ceea-4f67-9b1a-2a3c4d5e6f71", canvasWidthPx: 1e9, dpi: 100_000 }],
    });
    expect(request.ok).toBe(false);
  });

  it("an already-accepted snapshot above the new limits (but within the renderer safety ceiling) stays renderable", () => {
    const historical = makeProductionInput(printTemplate(18, 24, 300), {}, null); // 39.6 MP: accepted before, not for new templates
    expect(renderBoundsErrors(historical.template).length).toBeGreaterThan(0);
    expect(renderBoundsErrors(historical.template, RENDER_SAFETY_LIMITS)).toEqual([]);
    const snapshot = { snapshotSchemaVersion: 1, production: historical };
    expect(() => readProductionSnapshot({ snapshot, snapshot_schema_version: 1, production_mode: "automatic", order_id: "order-old", integrity_hash: productionIntegrityHash(snapshot) })).not.toThrow();
  });

  it("admin publishing refuses an unsupported automatic print size, and only warns for manual production", () => {
    const blocked = validateCustomizerTemplateDetailed({ ...printTemplate(24, 36, 300), enabled: true, fields: [], pages: [{ id: "front", enabled: true }] });
    expect(blocked.errors.join("\n")).toMatch(/Print size: .*36\.0 MP per page/);
    const supported = validateCustomizerTemplateDetailed({ ...printTemplate(24, 36, 200), enabled: true, fields: [], pages: [{ id: "front", enabled: true }] });
    expect(supported.errors.filter((error) => error.startsWith("Print size"))).toEqual([]);
    const manual = validateCustomizerTemplateDetailed({ ...printTemplate(24, 36, 300, 1, { featureFlags: { customizer_v2_server_rendering: false } }), enabled: true, fields: [], pages: [{ id: "front", enabled: true }] });
    expect(manual.errors.filter((error) => error.startsWith("Print size"))).toEqual([]);
    expect(manual.warnings.join("\n")).toMatch(/manual production/);
  });

  it("the limits are internally consistent with the documented claims", () => {
    const poster = (24.25 * 200) * (36.25 * 200); // 24x36" at 200 dpi with 1/8" bleed
    expect(poster).toBeLessThanOrEqual(PRODUCTION_RENDER_LIMITS.maxPagePixels);
    expect(36.25 * 200).toBeLessThanOrEqual(PRODUCTION_RENDER_LIMITS.maxSidePx);
    expect((24.25 * 300) * (36.25 * 300)).toBeGreaterThan(PRODUCTION_RENDER_LIMITS.maxPagePixels);
    expect(PRODUCTION_RENDER_LIMITS.maxPagePixels).toBeLessThanOrEqual(RENDER_SAFETY_LIMITS.maxPagePixels);
  });
});
