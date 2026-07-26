import { describe, it, expect } from "vitest";
import { calculateCustomizationPrice, validateSelectedOptions } from "../pricing";
import { runPreflight } from "../preflight";
import { templateToDocument, resolveCustomerDocument } from "../document";

const product = {
  price: 100,
  salePrice: 80,
  currency: "BDT",
  paperOptions: ["Matte", { label: "Pearl", surcharge: 25 }],
  sizeOptions: ["5x7", "4x6 +$10"],
  envelopeOptions: [],
};

describe("server pricing", () => {
  it("uses sale price as the base", () => {
    const pricing = calculateCustomizationPrice(product, {}, 1);
    expect(pricing.basePrice).toBe(80);
    expect(pricing.unitPrice).toBe(80);
  });

  it("adds surcharges from rich and legacy string options", () => {
    const pricing = calculateCustomizationPrice(product, { paper: "Pearl +$25.00", size: "4x6 +$10" }, 3);
    expect(pricing.optionsTotal).toBe(35);
    expect(pricing.unitPrice).toBe(115);
    expect(pricing.subtotal).toBe(345);
    expect(pricing.optionSurcharges.map((s) => s.key).sort()).toEqual(["paper", "size"]);
  });

  it("clamps quantity into a sane range", () => {
    expect(calculateCustomizationPrice(product, {}, -5).quantity).toBe(1);
    expect(calculateCustomizationPrice(product, {}, 99999).quantity).toBe(9999);
  });

  it("validates selections against configured lists", () => {
    expect(validateSelectedOptions(product, { paper: "Matte" }).ok).toBe(true);
    expect(validateSelectedOptions(product, { paper: "Pearl +$25.00" }).ok).toBe(true);
    const bad = validateSelectedOptions(product, { paper: "Gold Leaf" });
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]).toContain("Gold Leaf");
  });
});

const template = {
  id: "t1",
  version: 1,
  canvasWidthPx: 1500,
  canvasHeightPx: 2100,
  dpi: 300,
  pages: [{ id: "front", label: "Front", enabled: true }],
  fields: [
    { id: "names", label: "Names", type: "text", required: true },
    { id: "photo", label: "Photo", type: "image", required: true },
  ],
  layers: [
    {
      id: "names_layer",
      name: "Names",
      page: "front",
      type: "text",
      fieldId: "names",
      customerEditable: true,
      x: 750,
      y: 300,
      width: 400,
      height: 60,
      text: "",
      textStyle: { fontFamily: "Cormorant Garamond", fontSize: 48, multiline: false },
    },
    {
      id: "photo_layer",
      name: "Photo",
      page: "front",
      type: "image",
      fieldId: "photo",
      customerEditable: true,
      x: 750,
      y: 1200,
      width: 600,
      height: 800,
      maskShape: "arch",
    },
  ],
  safeArea: { top: 90, right: 90, bottom: 90, left: 90 },
  bleed: { top: 45, right: 45, bottom: 45, left: 45 },
};

describe("preflight", () => {
  it("blocks on missing required text and photo", () => {
    const { document } = templateToDocument(template);
    const result = runPreflight(document);
    expect(result.blocking).toBe(true);
    expect(result.issues.map((i) => i.code)).toContain("missing-required-text");
    expect(result.issues.map((i) => i.code)).toContain("missing-required-image");
  });

  it("passes once required content exists", () => {
    const { document } = templateToDocument(template);
    const resolved = resolveCustomerDocument(
      document,
      { names: "A & B", photo: { url: "https://x.supabase.co/p.jpg" } },
      null,
    );
    const result = runPreflight(resolved);
    expect(result.issues.map((i) => i.code)).not.toContain("missing-required-text");
    expect(result.issues.map((i) => i.code)).not.toContain("missing-required-image");
    expect(result.blocking).toBe(false);
  });

  it("warns on low-resolution photos", () => {
    const { document } = templateToDocument(template);
    const resolved = resolveCustomerDocument(
      document,
      { names: "A & B", photo: { url: "https://x.supabase.co/tiny.jpg" } },
      null,
    );
    const result = runPreflight(resolved, {
      imageDimensions: { "https://x.supabase.co/tiny.jpg": { width: 200, height: 260 } },
    });
    expect(result.issues.map((i) => i.code)).toContain("low-resolution-image");
  });

  it("flags fonts that are not in the registry", () => {
    const custom = {
      ...template,
      layers: [
        {
          ...template.layers[0],
          text: "hello",
          textStyle: { fontFamily: "Comic Sans MS", fontSize: 48 },
        },
        template.layers[1],
      ],
    };
    const { document } = templateToDocument(custom);
    const result = runPreflight(document);
    expect(result.issues.map((i) => i.code)).toContain("unknown-font");
  });
});
