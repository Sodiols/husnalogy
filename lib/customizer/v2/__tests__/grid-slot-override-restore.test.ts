import { describe, expect, it } from "vitest";
import { normalizeEditorState } from "@/lib/customizer";
import { mergeGridSlotOverrides, normalizeGridSlot } from "../grids";

const templateSlot = normalizeGridSlot({ id: "s1", x: 0, y: 0, width: 1, height: 1, src: "https://cdn.test/template-photo.jpg", transform: { zoom: 1 } }, 0);

describe("restoring a grid slot override (Point 8 regression)", () => {
  it("a crop-only override stays crop-only, so the template's photo survives a reload", () => {
    const restored = normalizeEditorState({ layerOverrides: { grid: { gridSlots: { s1: { transform: { zoom: 1.7, offsetX: 12 } } } } } });
    expect(restored.layerOverrides.grid.gridSlots.s1).toEqual({
      transform: { zoom: 1.7, offsetX: 12, offsetY: 0, rotation: 0, flipX: false, flipY: false, fitMode: "cover" },
    });
    const [merged] = mergeGridSlotOverrides([templateSlot], restored.layerOverrides.grid.gridSlots);
    expect(merged.src).toBe("https://cdn.test/template-photo.jpg");
    expect(merged.transform.zoom).toBe(1.7);
  });

  it("a replaced photo keeps its permanent reference fields", () => {
    const assetReference = { version: 1, assetId: "a1", ownerId: "u1", bucket: "customer-uploads", storagePath: "u1/o.jpg" };
    const restored = normalizeEditorState({
      layerOverrides: {
        grid: { gridSlots: { s1: { assetId: "a1", src: "", bucket: "customer-uploads", path: "u1/e.webp", originalPath: "u1/o.jpg", ownerId: "u1", assetReference, metadata: { width: 10 }, transform: { zoom: 1 } } } },
      },
    });
    expect(restored.layerOverrides.grid.gridSlots.s1).toMatchObject({ assetId: "a1", path: "u1/e.webp", originalPath: "u1/o.jpg", ownerId: "u1", assetReference, metadata: { width: 10 } });
  });

  it("an explicitly cleared slot stays cleared", () => {
    const restored = normalizeEditorState({ layerOverrides: { grid: { gridSlots: { s1: { assetId: "", src: "", bucket: "", path: "" } } } } });
    const [merged] = mergeGridSlotOverrides([templateSlot], restored.layerOverrides.grid.gridSlots);
    expect(merged.src).toBe("");
  });
});
