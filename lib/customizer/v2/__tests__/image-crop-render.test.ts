import { describe, expect, it } from "vitest";
import { buildPageSvg } from "../svg";

// Spec §16 + §3: the crop rectangle must actually reach production output, and
// it must do so WITHOUT changing a single existing document's rendering.
//
// `cropX/cropY/cropWidth/cropHeight` were stored, validated, migrated and
// snapshotted into orders, but no renderer read them. These tests pin both
// halves: artwork with no crop renders byte-identically to before, and a real
// crop moves the image in the emitted SVG that feeds resvg -> PNG -> PDF.

const template = {
  canvasWidthPx: 1000,
  canvasHeightPx: 1000,
  pages: [{ id: "front", label: "Front", enabled: true }],
  fields: [],
  settings: {},
  layers: [
    {
      id: "photo",
      name: "Photo",
      page: "front",
      type: "image",
      x: 500,
      y: 500,
      width: 400,
      height: 300,
      src: "https://example.com/photo.jpg",
      customerEditable: false,
    },
  ],
};

const renderWith = (imageTransform: Record<string, number> | null) =>
  buildPageSvg({
    template: {
      ...template,
      layers: [{ ...template.layers[0], ...(imageTransform ? { imageTransform } : {}) }],
    },
    pageId: "front",
    mode: "print",
  });

const imageAttrs = (svg: string) => {
  const match = svg.match(/<image href="[^"]*photo\.jpg"([^/]*)\/>/);
  if (!match) throw new Error("no photo <image> element in output");
  const attrs: Record<string, number> = {};
  for (const key of ["x", "y", "width", "height"]) {
    const found = match[1].match(new RegExp(`\\b${key}="(-?[0-9.]+)"`));
    if (found) attrs[key] = Number(found[1]);
  }
  return attrs;
};

describe("existing artwork is unaffected", () => {
  it("renders identically with no imageTransform at all", () => {
    const attrs = imageAttrs(renderWith(null));
    // The frame is 400x300 centred at (500,500).
    expect(attrs).toEqual({ x: 300, y: 350, width: 400, height: 300 });
  });

  it("renders identically with the stored all-zero crop default", () => {
    const withDefault = renderWith({ cropX: 0, cropY: 0, cropWidth: 0, cropHeight: 0 });
    expect(withDefault).toBe(renderWith(null));
  });

  it("still honours zoom and offset exactly as before", () => {
    const attrs = imageAttrs(renderWith({ zoom: 2, offsetX: 50, offsetY: -20 }));
    // x: 300 - (800-400)/2 + 50 = 150 ; y: 350 - (600-300)/2 - 20 = 180
    expect(attrs).toEqual({ x: 150, y: 180, width: 800, height: 600 });
  });

  it("treats a full-frame crop as no crop", () => {
    const full = renderWith({ cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1 });
    expect(full).toBe(renderWith(null));
  });
});

describe("a real crop reaches the print SVG", () => {
  it("scales the image up when the crop selects part of the frame", () => {
    const attrs = imageAttrs(renderWith({ cropX: 0.25, cropY: 0.25, cropWidth: 0.5, cropHeight: 0.5 }));
    expect(attrs.width).toBe(800);
    expect(attrs.height).toBe(600);
  });

  it("keeps a centred crop centred, so nothing drifts off the frame", () => {
    const attrs = imageAttrs(renderWith({ cropX: 0.25, cropY: 0.25, cropWidth: 0.5, cropHeight: 0.5 }));
    expect(attrs.x + attrs.width / 2).toBeCloseTo(500, 6);
    expect(attrs.y + attrs.height / 2).toBeCloseTo(500, 6);
  });

  it("pulls the image left when the crop selects the right half", () => {
    const left = imageAttrs(renderWith({ cropX: 0, cropY: 0.25, cropWidth: 0.5, cropHeight: 0.5 }));
    const right = imageAttrs(renderWith({ cropX: 0.5, cropY: 0.25, cropWidth: 0.5, cropHeight: 0.5 }));
    expect(right.x).toBeLessThan(left.x);
  });

  it("never stretches the photo", () => {
    const attrs = imageAttrs(renderWith({ cropX: 0, cropY: 0, cropWidth: 0.25, cropHeight: 0.75 }));
    // 400/300 is the frame ratio; the drawn image must keep it.
    expect(attrs.width / attrs.height).toBeCloseTo(400 / 300, 6);
  });

  it("keeps the crop inside the existing mask clip", () => {
    const svg = renderWith({ cropX: 0.25, cropY: 0.25, cropWidth: 0.5, cropHeight: 0.5 });
    // The clip path is what stops an enlarged image bleeding past the frame.
    expect(svg).toMatch(/<g clip-path="url\(#[^"]+\)">/);
  });
});
