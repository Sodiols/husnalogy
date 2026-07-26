import { describe, expect, it } from "vitest";
import { createGridSlots, createGridSlotsFromPreset, GRID_PRESETS, getGridSlotRect, mergeGridSlotOverrides, validateGridGeometry } from "../grids";
import { templateToDocument, resolveCustomerDocument } from "../document";
import { runPreflight } from "../preflight";
import { buildPageSvg } from "../svg";
import { validateCustomerState } from "../validate";

const RED_PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function gridTemplate() {
  return {
    id: "grid-template",
    version: 1,
    canvasWidthPx: 1200,
    canvasHeightPx: 900,
    cardWidthIn: 4,
    cardHeightIn: 3,
    dpi: 300,
    defaultPage: "front",
    pages: [{ id: "front", label: "Front", enabled: true, backgroundColor: "#ffffff" }],
    fields: [],
    layers: [{
      id: "grid",
      name: "Gallery",
      page: "front",
      type: "grid",
      x: 600,
      y: 450,
      width: 1000,
      height: 700,
      rotation: 0,
      zIndex: 2,
      opacity: 1,
      columns: 2,
      rows: 1,
      gap: 20,
      padding: 30,
      cornerRadius: 20,
      borderColor: "#303839",
      borderWidth: 4,
      backgroundColor: "#F8F6F1",
      customerEditable: true,
      customerPermissions: { replaceImage: true, cropImage: true, zoomImage: true, repositionImage: true },
      slots: createGridSlots(2, 1).map((slot, index) => ({ ...slot, required: true, src: index === 0 ? RED_PIXEL : "", metadata: { width: 200, height: 200 }, mask: index === 0 ? { kind: "circle" } : { kind: "arch-top" } })),
    }],
    safeArea: { top: 20, right: 20, bottom: 20, left: 20 },
    bleed: { top: 0, right: 0, bottom: 0, left: 0 },
    settings: {},
  };
}

describe("photo grid engine", () => {
  it("creates stable normalized layouts and accounts for padding and gap", () => {
    expect(createGridSlots(3, 3)).toHaveLength(9);
    const slots = createGridSlots(2, 1);
    const rect = getGridSlotRect({ x: 500, y: 400, width: 800, height: 500, padding: 20, gap: 10 }, slots[0]);
    expect(rect.x).toBe(125);
    expect(rect.y).toBe(175);
    expect(rect.width).toBe(370);
    expect(rect.height).toBe(450);
  });

  it("keeps every expanded preset's advertised photo count and valid geometry", () => {
    for (const preset of GRID_PRESETS) {
      const slots = createGridSlotsFromPreset(preset.id);
      expect(slots, preset.id).toHaveLength(preset.photoCount);
      expect(validateGridGeometry({ slots }), preset.id).toEqual([]);
    }
    expect(createGridSlotsFromPreset("five-hero")[0]).toMatchObject({ width: 0.5, height: 1 });
  });

  it("merges independent slot photos and crop transforms without mutating siblings", () => {
    const slots = createGridSlots(2, 1);
    const resolved = mergeGridSlotOverrides(slots, {
      [slots[0].id]: { src: RED_PIXEL, path: "user/editor.webp", metadata: { width: 1800, height: 1200 }, transform: { zoom: 2, offsetX: 18 } },
    });
    expect(resolved[0].src).toBe(RED_PIXEL);
    expect(resolved[0].transform.zoom).toBe(2);
    expect(resolved[0].transform.offsetX).toBe(18);
    expect(resolved[0].metadata?.width).toBe(1800);
    expect(resolved[1].src).toBe("");
    expect(slots[0].src).toBe("");
  });

  it("migrates, restores, renders and preflights every slot independently", () => {
    const template = gridTemplate();
    const { document } = templateToDocument(template);
    expect(document.schemaVersion).toBe(4);
    expect(document.layers[0].type).toBe("grid");
    const secondId = (document.layers[0] as any).slots[1].id;
    const resolved = resolveCustomerDocument(document, {}, { layerOverrides: { grid: { gridSlots: { [secondId]: { src: RED_PIXEL, assetId: "customer-photo", bucket: "customer-uploads", path: "user/photo.webp", metadata: { width: 2400, height: 1800 }, transform: { zoom: 1.4 } } } } }, userLayers: [] });
    const preflight = runPreflight(resolved, { blockOnLowResolution: true });
    expect(preflight.issues.map((issue) => issue.code)).not.toContain("REQUIRED_GRID_SLOT_EMPTY");
    expect(preflight.issues.map((issue) => issue.code)).toContain("LOW_RESOLUTION_GRID_IMAGE");
    const svg = buildPageSvg({ template: { ...template, layers: resolved.layers.map((layer: any) => ({ ...layer, page: layer.pageId })) }, values: {}, editorState: null, pageId: "front", mode: "print" });
    expect((svg.match(/clipPath/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(svg).toContain(RED_PIXEL);
  });

  it("rejects broken geometry and forbidden customer slot changes", () => {
    const template = gridTemplate();
    const invalidLayer: any = { ...(template.layers[0] as any), slots: [{ ...(template.layers[0] as any).slots[0], x: 0.9, width: 0.4 }] };
    expect(validateGridGeometry(invalidLayer).map((issue) => issue.code)).toContain("GRID_SLOT_OUT_OF_BOUNDS");
    const locked = { ...template, layers: [{ ...(template.layers[0] as any), customerPermissions: { replaceImage: false, cropImage: false, zoomImage: false, repositionImage: false } }] };
    const slotId = (locked.layers[0] as any).slots[0].id;
    const result = validateCustomerState(locked, { values: {}, editorState: { layerOverrides: { grid: { gridSlots: { [slotId]: { src: RED_PIXEL, transform: { zoom: 2 } } } } }, userLayers: [] } });
    expect(result.violations.map((violation) => violation.code)).toEqual(expect.arrayContaining(["grid-replace-not-allowed", "grid-crop-not-allowed"]));
  });
});
