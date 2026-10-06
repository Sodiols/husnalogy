import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { isSvgElement, normalizeTintColour } from "../element-colour";
import { normalizeCustomizerTemplate, normalizeUserLayer } from "@/lib/customizer";
import { templateToDocument } from "../document";
import { renderCustomizationPages } from "../server/render";
import { validateCustomerState } from "../validate";
import { installGoogleFontsHarness, resetGoogleFontsHarness } from "./google-fonts-test-harness";

/** Two colours, a stroked circle, and a fully transparent gap between them. */
const MULTICOLOUR_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">' +
    '<rect x="0" y="0" width="80" height="100" fill="#ff0000"/>' +
    '<rect x="120" y="0" width="80" height="50" fill="#0000ff"/>' +
    '<circle cx="160" cy="80" r="15" fill="none" stroke="#ffff00" stroke-width="6"/>' +
    "</svg>",
)}`;

describe("which elements can be recoloured", () => {
  it("every SVG — by type, by data URL, or by its stored path — and nothing else", () => {
    expect(isSvgElement({ type: "element", mimeType: "image/svg+xml" })).toBe(true);
    expect(isSvgElement({ type: "element", src: MULTICOLOUR_SVG })).toBe(true);
    expect(isSvgElement({ type: "element", originalPath: "elements/floral-border.svg" })).toBe(true);
    expect(isSvgElement({ type: "element", src: "https://signed.test/el/wreath.svg?token=abc" })).toBe(true);
    expect(isSvgElement({ type: "element", mimeType: "image/png", originalPath: "x.png" })).toBe(false);
    expect(isSvgElement({ type: "image", mimeType: "image/svg+xml" })).toBe(false);
  });

  it("a tint is a hex colour or Original — nothing else", () => {
    expect(normalizeTintColour("")).toBe("");
    expect(normalizeTintColour(undefined)).toBe("");
    expect(normalizeTintColour("#D4AF37")).toBe("#d4af37");
    expect(normalizeTintColour("red")).toBeNull();
    expect(normalizeTintColour("none")).toBeNull();
    expect(normalizeTintColour('#fff" onload="x')).toBeNull();
  });

  it("the SVG type survives the customer layer, the template and the published document", () => {
    expect(normalizeUserLayer({ type: "element", src: "x", mimeType: "image/svg+xml", tintColor: "" })).toMatchObject({ mimeType: "image/svg+xml", tintColor: "" });
    const template = normalizeCustomizerTemplate({
      pages: [{ id: "front", enabled: true }],
      layers: [{ id: "el", page: "front", type: "element", src: "x", mimeType: "image/svg+xml", x: 10, y: 10, width: 10, height: 10 }],
    });
    expect(template.layers[0].mimeType).toBe("image/svg+xml");
    expect((templateToDocument(template).document.layers[0] as any).mimeType).toBe("image/svg+xml");
  });
});

describe("server rendering of a recoloured multicolour SVG", () => {
  afterEach(() => {
    resetGoogleFontsHarness();
    vi.restoreAllMocks();
  });

  async function render(tintColor: string) {
    installGoogleFontsHarness();
    const template = normalizeCustomizerTemplate({
      id: "t", version: 1, canvasWidthPx: 200, canvasHeightPx: 100, cardWidthIn: 2, cardHeightIn: 1, dpi: 100,
      pages: [{ id: "front", label: "Front", enabled: true, backgroundColor: "#ffffff" }],
      layers: [{ id: "el", page: "front", type: "element", src: MULTICOLOUR_SVG, mimeType: "image/svg+xml", tintColor, x: 100, y: 50, width: 200, height: 100, zIndex: 1 }],
    });
    const [page] = await renderCustomizationPages({ template, values: {}, editorState: null, mode: "print", pageIds: ["front"] });
    const { data, info } = await sharp(page.png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return (x: number, y: number) => {
      const offset = (y * info.width + x) * info.channels;
      return [data[offset], data[offset + 1], data[offset + 2]];
    };
  }

  it("turns every colour — fill and stroke — into the chosen one, and leaves transparent areas untouched", async () => {
    const pixel = await render("#00aa00");
    expect(pixel(40, 50)).toEqual([0, 170, 0]); // was red
    expect(pixel(160, 25)).toEqual([0, 170, 0]); // was blue
    expect(pixel(160, 65)).toEqual([0, 170, 0]); // was the yellow stroke
    expect(pixel(100, 50)).toEqual([255, 255, 255]); // transparent gap: still the page
    expect(pixel(160, 80)).toEqual([255, 255, 255]); // inside the unfilled circle
  });

  it("Original keeps the artwork's own colours", async () => {
    const pixel = await render("");
    expect(pixel(40, 50)).toEqual([255, 0, 0]);
    expect(pixel(160, 25)).toEqual([0, 0, 255]);
  });
});

describe("server validation of element colours", () => {
  const template = (settings: Record<string, unknown> = {}) =>
    normalizeCustomizerTemplate({
      pages: [{ id: "front", enabled: true }],
      layers: [],
      settings: { allowCustomerElements: true, ...settings },
    });
  const element = (tintColor: string) => ({ id: "u1", type: "element", page: "front", src: "x", tintColor, x: 50, y: 50, width: 40, height: 40 });

  it("keeps a valid colour and Original", () => {
    for (const tint of ["#d4af37", ""]) {
      const result = validateCustomerState(template(), { values: {}, editorState: { userLayers: [element(tint)] } });
      expect(result.sanitizedEditorState.userLayers[0].tintColor).toBe(tint);
    }
  });

  it("resets anything that is not a colour to Original", () => {
    const result = validateCustomerState(template(), { values: {}, editorState: { userLayers: [element("url(#x)")] } });
    expect(result.violations.map((violation) => violation.code)).toContain("invalid-tint");
    expect(result.sanitizedEditorState.userLayers[0].tintColor).toBe("");
  });

  it("holds a tint to the template palette; Original is always allowed", () => {
    const outside = validateCustomerState(template({ allowedCustomerColors: ["#d4af37"] }), { values: {}, editorState: { userLayers: [element("#123456")] } });
    expect(outside.violations.map((violation) => violation.code)).toContain("color-not-allowed-by-template");
    const original = validateCustomerState(template({ allowedCustomerColors: ["#d4af37"] }), { values: {}, editorState: { userLayers: [element("")] } });
    expect(original.violations.map((violation) => violation.code)).not.toContain("color-not-allowed-by-template");
  });
});
