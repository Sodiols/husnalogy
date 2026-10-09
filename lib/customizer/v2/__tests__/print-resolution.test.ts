/**
 * Effective print resolution of placed photos (docs/PRINT_QUALITY_AUDIT.md D5).
 *
 * Before: the check existed in preflight but no caller supplied image sizes,
 * so it never ran for photo layers; its formula ignored the crop rectangle and
 * contain-fit; and checkout would have refused orders the moment it did run.
 */
import { describe, expect, it } from "vitest";
import { buildPageSvg } from "../svg";
import { resolveCustomerDocument, templateToDocument } from "../document";
import { runPreflight } from "../preflight";
import {
  DEFAULT_PRINT_QUALITY,
  LOW_RESOLUTION_CUSTOMER_MESSAGE,
  effectiveImagePpi,
  imageQualityLevel,
  layerSourceDimensions,
  measuredPxPerInch,
  normalizePrintQualitySettings,
  printQualityThresholds,
} from "../print-resolution";

const card = { frameWidth: 1500, frameHeight: 2100, dpi: 300 }; // a full 5 × 7 in card at 300 DPI

describe("effectiveImagePpi", () => {
  it("is source pixels per printed inch", () => {
    expect(effectiveImagePpi({ ...card, sourceWidth: 1500, sourceHeight: 2100 })).toBeCloseTo(300);
    expect(effectiveImagePpi({ ...card, sourceWidth: 3000, sourceHeight: 4200 })).toBeCloseTo(600);
    expect(effectiveImagePpi({ ...card, sourceWidth: 750, sourceHeight: 1050 })).toBeCloseTo(150);
  });

  it("zooming in spreads fewer pixels over the same inches", () => {
    expect(effectiveImagePpi({ ...card, transform: { zoom: 2 }, sourceWidth: 3000, sourceHeight: 4200 })).toBeCloseTo(300);
  });

  it("a crop to half the frame doubles the magnification", () => {
    const full = effectiveImagePpi({ ...card, sourceWidth: 3000, sourceHeight: 4200 })!;
    const cropped = effectiveImagePpi({ ...card, transform: { cropX: 0.25, cropY: 0.25, cropWidth: 0.5, cropHeight: 0.5 }, sourceWidth: 3000, sourceHeight: 4200 })!;
    expect(cropped).toBeCloseTo(full / 2);
  });

  it("cover uses the tighter axis, contain the looser one", () => {
    const wide = { frameWidth: 1000, frameHeight: 1000, dpi: 300, sourceWidth: 3000, sourceHeight: 1000 };
    expect(effectiveImagePpi({ ...wide, fitMode: "cover" })).toBeCloseTo(300);
    expect(effectiveImagePpi({ ...wide, fitMode: "contain" })).toBeCloseTo(900);
  });

  it("unknown sizes give no answer instead of a guess", () => {
    expect(effectiveImagePpi({ ...card, sourceWidth: 0, sourceHeight: 2100 })).toBeNull();
    expect(effectiveImagePpi({ ...card, dpi: 0, sourceWidth: 10, sourceHeight: 10 })).toBeNull();
  });

  it("matches the box the production SVG actually draws", () => {
    const template = {
      canvasWidthPx: 1500, canvasHeightPx: 2100, dpi: 300, defaultPage: "front",
      pages: [{ id: "front", label: "Front", enabled: true }], fields: [],
      layers: [{ id: "p", name: "P", page: "front", type: "image", src: "https://x/p.jpg", x: 750, y: 1050, width: 1000, height: 800, zIndex: 1, imageTransform: { zoom: 1.5, offsetX: 40, cropX: 0.1, cropY: 0.2, cropWidth: 0.6, cropHeight: 0.6 } }],
    };
    const svg = buildPageSvg({ template, values: {}, editorState: null, pageId: "front", mode: "print" });
    const width = Number(/<image href="https:\/\/x\/p\.jpg"[^>]* width="([\d.]+)"/.exec(svg)?.[1]);
    const ppi = effectiveImagePpi({ frameWidth: 1000, frameHeight: 800, dpi: 300, transform: { zoom: 1.5, offsetX: 40, cropX: 0.1, cropY: 0.2, cropWidth: 0.6, cropHeight: 0.6 }, sourceWidth: 4000, sourceHeight: 3200 })!;
    // 4000 × 3200 matches the frame's 5:4 shape, so the draw width alone fixes the scale.
    expect(ppi).toBeCloseTo(300 / (width / 4000), 6);
  });
});

describe("thresholds", () => {
  it("defaults to 300 PPI excellent, under 200 low, never blocking", () => {
    const thresholds = printQualityThresholds(undefined);
    expect(thresholds).toEqual(DEFAULT_PRINT_QUALITY);
    expect(imageQualityLevel(320, thresholds)).toBe("excellent");
    expect(imageQualityLevel(240, thresholds)).toBe("acceptable");
    expect(imageQualityLevel(150, thresholds)).toBe("low");
  });

  it("are configurable per product", () => {
    const poster = printQualityThresholds({ minImagePpi: 120, recommendedImagePpi: 150 });
    expect(imageQualityLevel(130, poster)).toBe("acceptable");
    expect(normalizePrintQualitySettings({ minImagePpi: "250", junk: 1, blockLowResolution: true })).toEqual({ minImagePpi: 250, blockLowResolution: true });
    expect(normalizePrintQualitySettings({})).toBeUndefined();
    expect(normalizePrintQualitySettings(null)).toBeUndefined();
  });

  it("finds a photo's size from the data the design already carries", () => {
    expect(layerSourceDimensions({ assetReference: { width: 4032, height: 3024 } })).toEqual({ width: 4032, height: 3024 });
    expect(layerSourceDimensions({ sourceWidth: 1200, sourceHeight: 800 })).toEqual({ width: 1200, height: 800 });
    expect(layerSourceDimensions({ metadata: { width: 900, height: 600 } })).toEqual({ width: 900, height: 600 });
    expect(layerSourceDimensions({ assetId: "a1" }, [{ id: "a1", width: 640, height: 480 }])).toEqual({ width: 640, height: 480 });
    expect(layerSourceDimensions({ assetId: "nope" })).toBeNull();
  });
});

describe("preflight now checks every photo", () => {
  const template = {
    id: "t-ppi", version: 1, canvasWidthPx: 1500, canvasHeightPx: 2100, cardWidthIn: 5, cardHeightIn: 7, dpi: 300,
    pages: [{ id: "front", label: "Front", enabled: true }],
    fields: [{ id: "photo", label: "Photo", type: "image" }],
    layers: [{ id: "photo_layer", name: "Photo", page: "front", type: "image", fieldId: "photo", customerEditable: true, x: 750, y: 1050, width: 1200, height: 1500 }],
  };
  const photo = (width: number, height: number, extra: Record<string, unknown> = {}) => ({
    photo: { url: "https://x.supabase.co/p.jpg", assetId: "lib-1", assetReference: { version: 1, assetId: "lib-1", ownerId: "u", bucket: "customer-uploads", storagePath: "u/p.jpg", originalFileName: "p.jpg", mimeType: "image/jpeg", fileSize: 1, width, height, createdAt: "" }, ...extra },
  });
  const check = (values: any, settings: any = {}, block = false) => {
    const { document } = templateToDocument({ ...template, settings });
    return runPreflight(resolveCustomerDocument(document, values, null), { blockOnLowResolution: block });
  };
  const lowRes = (result: ReturnType<typeof runPreflight>) => result.issues.find((issue) => issue.code === "low-resolution-image");

  it("warns in plain language from the photo's own size — no caller has to supply it", () => {
    // 1200 × 1500 frame = 4 × 5 in: an 800 × 1000 photo gives 200 PPI... a 600 × 750 one gives 150.
    const issue = lowRes(check(photo(600, 750)));
    expect(issue?.severity).toBe("warning");
    expect(issue?.message).toContain(LOW_RESOLUTION_CUSTOMER_MESSAGE);
    expect(lowRes(check(photo(2400, 3000)))).toBeUndefined();
  });

  it("updates when the customer zooms in on the photo", () => {
    expect(lowRes(check(photo(1200, 1500)))).toBeUndefined(); // 300 PPI
    const editorState = { layerOverrides: { photo_layer: { imageTransform: { zoom: 2 } } }, userLayers: [] };
    const { document } = templateToDocument(template);
    const zoomed = runPreflight(resolveCustomerDocument(document, photo(1200, 1500), editorState as any));
    expect(lowRes(zoomed)).toBeTruthy(); // 150 PPI
  });

  it("checkout warns but does not refuse the order, unless the product requires it", () => {
    expect(check(photo(600, 750), {}, true).blocking).toBe(false);
    const strict = check(photo(600, 750), { printQuality: { blockLowResolution: true } }, true);
    expect(lowRes(strict)?.severity).toBe("error");
    expect(strict.blocking).toBe(true);
  });

  it("uses the product's own minimum", () => {
    expect(lowRes(check(photo(600, 750), { printQuality: { minImagePpi: 120 } }))).toBeUndefined();
  });

  it("old documents without print settings serialize exactly as before", () => {
    const { document } = templateToDocument(template);
    expect("printQuality" in document.settings).toBe(false);
  });
});

describe("declared DPI that does not match the canvas (measured density wins)", () => {
  // Declares 300 DPI, but 1000 × 1400 px on a 5 × 7 in card is really 200 px per inch.
  const mismatched = {
    id: "t-mismatch", version: 1, canvasWidthPx: 1000, canvasHeightPx: 1400, cardWidthIn: 5, cardHeightIn: 7, dpi: 300,
    pages: [{ id: "front", label: "Front", enabled: true }],
    fields: [{ id: "photo", label: "Photo", type: "image" }],
    layers: [{ id: "photo_layer", name: "Photo", page: "front", type: "image", fieldId: "photo", customerEditable: true, x: 500, y: 700, width: 1000, height: 1250 }],
  };
  const values = { photo: { url: "https://x.supabase.co/p.jpg", assetReference: { version: 1, assetId: "a", ownerId: "u", bucket: "customer-uploads", storagePath: "u/p.jpg", originalFileName: "p", mimeType: "image/jpeg", fileSize: 1, width: 1000, height: 1250, createdAt: "" } } };

  it("measures pixels per printed inch from the canvas and the card", () => {
    expect(measuredPxPerInch({ widthPx: 1000, heightPx: 1400, widthIn: 5, heightIn: 7 })).toEqual({ x: 200, y: 200 });
    expect(measuredPxPerInch({ widthPx: 1000, heightPx: 1400 })).toBeNull();
  });

  it("a photo with one source pixel per canvas pixel prints at 200 PPI, not the declared 300", () => {
    const declaredOnly = effectiveImagePpi({ frameWidth: 1000, frameHeight: 1250, dpi: 300, sourceWidth: 1000, sourceHeight: 1250 });
    const measured = effectiveImagePpi({ frameWidth: 1000, frameHeight: 1250, dpi: 300, pxPerInch: { x: 200, y: 200 }, sourceWidth: 1000, sourceHeight: 1250 });
    expect(declaredOnly).toBeCloseTo(300);
    expect(measured).toBeCloseTo(200);
  });

  it("a stretched page reports its coarser axis", () => {
    expect(effectiveImagePpi({ frameWidth: 100, frameHeight: 100, dpi: 300, pxPerInch: { x: 300, y: 250 }, sourceWidth: 100, sourceHeight: 100 })).toBeCloseTo(250);
  });

  it("preflight uses the measured density: the photo is flagged against a 250 PPI minimum", () => {
    const { document } = templateToDocument({ ...mismatched, settings: { printQuality: { minImagePpi: 250 } } });
    expect(document.pages[0].widthIn).toBe(5);
    const result = runPreflight(resolveCustomerDocument(document, values, null));
    const issue = result.issues.find((entry) => entry.code === "low-resolution-image");
    expect(issue?.message).toContain("200 PPI");
    // With a consistent 300 px/in canvas the same photo would pass (1500 px frame width).
  });

  it("the live customer warning agrees", async () => {
    const { lowResolutionPhotos } = await import("@/app/components/customizer/photo-quality");
    const found = lowResolutionPhotos({ layers: mismatched.layers, fields: mismatched.fields, values, dpi: 300, physical: mismatched, settings: { printQuality: { minImagePpi: 250 } } });
    expect(found[0]?.ppi).toBeCloseTo(200);
    expect(lowResolutionPhotos({ layers: mismatched.layers, fields: mismatched.fields, values, dpi: 300, settings: { printQuality: { minImagePpi: 250 } } })).toEqual([]); // declared DPI alone would have missed it
  });
});
