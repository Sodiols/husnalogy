import { describe, expect, it } from "vitest";
import { SHAPE_LIBRARY, customPathInBox, libraryShapeGeometry, sanitizeCustomPath, searchShapeLibrary } from "../shape-library";
import { findClipMaskPair, maskForShape } from "../clipping-mask";
import { normalizeCustomizerTemplate } from "@/lib/customizer";
import { templateToDocument } from "../document";
import { buildPageSvg } from "../svg";

const layerFor = (id: string) => {
  const entry = SHAPE_LIBRARY.find((shape) => shape.id === id)!;
  return { id: `s-${id}`, type: "shape", page: "front", x: 400, y: 400, fill: "#cccccc", ...libraryShapeGeometry(entry, 300) };
};

describe("the Shapes library", () => {
  it("is a real collection: ~50 unique shapes, each with a name and search words", () => {
    expect(SHAPE_LIBRARY.length).toBeGreaterThanOrEqual(45);
    expect(new Set(SHAPE_LIBRARY.map((shape) => shape.id)).size).toBe(SHAPE_LIBRARY.length);
    for (const shape of SHAPE_LIBRARY) {
      expect(shape.label.length).toBeGreaterThan(2);
      expect(shape.aspect).toBeGreaterThan(0);
    }
  });

  it("every custom outline is valid vector path data", () => {
    for (const shape of SHAPE_LIBRARY) {
      if (shape.shape !== "custom") continue;
      expect(sanitizeCustomPath(shape.pathData), shape.id).not.toBeNull();
    }
  });

  it("every shape can clip a photo — the mask engine draws its exact outline", () => {
    const photo = { id: "p", type: "image", page: "front", src: "x", x: 400, y: 400, width: 300, height: 300 };
    for (const shape of SHAPE_LIBRARY) {
      const layer = layerFor(shape.id);
      expect(maskForShape(layer), shape.id).not.toBeNull();
      expect(findClipMaskPair([photo, layer]), shape.id).not.toBeNull();
    }
    expect(maskForShape(layerFor("heart"))).toMatchObject({ kind: "path", viewBoxWidth: 100, viewBoxHeight: 100 });
  });

  it("inserts at a sensible size that keeps each shape's proportions", () => {
    const tag = libraryShapeGeometry(SHAPE_LIBRARY.find((shape) => shape.id === "tag")!, 500);
    expect(tag).toMatchObject({ width: 500, height: 192, shape: "custom", name: "Pointed label" });
    const capsule = libraryShapeGeometry(SHAPE_LIBRARY.find((shape) => shape.id === "capsule")!, 500);
    expect(capsule).toMatchObject({ width: 300, height: 500, shape: "rounded-rectangle", borderRadius: 150 });
  });

  it("search is case-insensitive over names and keywords", () => {
    const ids = (query: string) => searchShapeLibrary(query).map((shape) => shape.id);
    expect(ids("HEART")).toEqual(expect.arrayContaining(["heart", "heart-round", "heart-tilted"]));
    expect(ids("star")).toEqual(expect.arrayContaining(["star", "star-6", "sparkle", "star-round"]));
    for (const query of ["circle", "rectangle", "arrow", "brush", "arch", "oval", "badge", "ribbon", "hexagon"]) expect(ids(query).length, query).toBeGreaterThan(0);
    expect(ids("zebra")).toEqual([]);
    expect(ids("")).toHaveLength(SHAPE_LIBRARY.length);
  });
});

describe("custom shapes are real, persistent, renderable shapes", () => {
  it("rejects anything that is not plain absolute path data", () => {
    expect(sanitizeCustomPath('M0 0 L10 10 Z"/><script>')).toBeNull();
    expect(sanitizeCustomPath("M0 0 a10 10 0 1 1 5 5 Z")).toBeNull();
    expect(sanitizeCustomPath("M0 0 L1e400 0 L5 5 Z")).toBeNull();
    expect(sanitizeCustomPath("")).toBeNull();
  });

  it("maps every coordinate into the layer's box", () => {
    expect(customPathInBox("M0 0 L100 0 L100 100 Z", { x: 10, y: 20, width: 200, height: 50 })).toBe("M10 20 L210 20 L210 70 Z");
  });

  it("survives save (template), publish (document) and the server/print renderer", () => {
    const template = normalizeCustomizerTemplate({
      canvasWidthPx: 800,
      canvasHeightPx: 800,
      pages: [{ id: "front", enabled: true }],
      layers: [layerFor("heart"), { ...layerFor("star"), x: 200 }, { id: "bad", type: "shape", page: "front", shape: "custom", pathData: "<svg>", x: 10, y: 10, width: 10, height: 10 }],
    });
    const heart = template.layers.find((layer: any) => layer.libraryShapeId === "heart");
    expect(heart).toMatchObject({ shape: "custom", libraryShapeId: "heart" });
    const source = SHAPE_LIBRARY.find((shape) => shape.id === "heart")!;
    expect(heart.pathData).toBe(sanitizeCustomPath(source.shape === "custom" ? source.pathData : ""));
    // A corrupt outline never reaches a renderer: it falls back to a rectangle.
    expect(template.layers.find((layer: any) => layer.id === "bad")).toMatchObject({ shape: "rectangle" });
    expect(template.layers.find((layer: any) => layer.id === "bad")).not.toHaveProperty("pathData");

    const published = templateToDocument(template).document.layers.find((layer: any) => layer.id === heart.id) as any;
    expect(published).toMatchObject({ shape: "custom", pathData: heart.pathData });

    const svg = buildPageSvg({ template, pageId: "front", mode: "print" });
    // The heart's first point (50,96 in its box) lands inside the layer's box.
    const box = { x: 400 - heart.width / 2, y: 400 - heart.height / 2 };
    expect(svg).toContain(`d="M${Math.round((box.x + 0.5 * heart.width) * 100) / 100} ${Math.round((box.y + 0.96 * heart.height) * 100) / 100}`);
    expect(svg).toContain('fill="#cccccc"');
  });
});
