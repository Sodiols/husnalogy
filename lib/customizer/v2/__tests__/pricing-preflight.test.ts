import { describe, it, expect } from "vitest";
import { runPreflight } from "../preflight";
import { templateToDocument, resolveCustomerDocument } from "../document";

// Server pricing moved to lib/orders/pricing-resolver.ts and is covered,
// with far stricter rules, by lib/orders/__tests__/pricing-resolver.test.ts.

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

  // Font identity is now checked against the trusted Google Fonts catalog.
  const googleFamilies = new Set(["playfair display", "montserrat", "inter"]);

  it("flags a family that is not an available Google Font", () => {
    const custom = {
      ...template,
      layers: [
        {
          ...template.layers[0],
          text: "hello",
          // A genuine system font, not a Google Font — production could not
          // reproduce it, so publishing must surface it (spec §23).
          textStyle: { fontFamily: "Comic Sans MS", fontSize: 48 },
        },
        template.layers[1],
      ],
    };
    const { document } = templateToDocument(custom);
    const result = runPreflight(document, { knownFontFamilies: googleFamilies });
    expect(result.issues.map((i) => i.code)).toContain("unknown-font");
    expect(result.issues.find((i) => i.code === "unknown-font")?.severity).toBe("error");
  });

  it("accepts a genuine Google Font family", () => {
    const custom = {
      ...template,
      layers: [
        { ...template.layers[0], text: "hello", textStyle: { fontFamily: "Playfair Display", fontSize: 48 } },
        template.layers[1],
      ],
    };
    const { document } = templateToDocument(custom);
    const result = runPreflight(document, { knownFontFamilies: googleFamilies });
    expect(result.issues.map((i) => i.code)).not.toContain("unknown-font");
  });

  it("matches family names case insensitively", () => {
    const custom = {
      ...template,
      layers: [
        { ...template.layers[0], text: "hello", textStyle: { fontFamily: "MONTSERRAT", fontSize: 48 } },
        template.layers[1],
      ],
    };
    const { document } = templateToDocument(custom);
    const result = runPreflight(document, { knownFontFamilies: googleFamilies });
    expect(result.issues.map((i) => i.code)).not.toContain("unknown-font");
  });

  it("does not assert font identity during a catalog outage", () => {
    // No catalog available: skip the identity check rather than flagging every
    // layer on the page (spec §28).
    const custom = {
      ...template,
      layers: [
        { ...template.layers[0], text: "hello", textStyle: { fontFamily: "Comic Sans MS", fontSize: 48 } },
        template.layers[1],
      ],
    };
    const { document } = templateToDocument(custom);
    expect(runPreflight(document).issues.map((i) => i.code)).not.toContain("unknown-font");
    expect(runPreflight(document, { knownFontFamilies: null }).issues.map((i) => i.code)).not.toContain("unknown-font");
  });
});
