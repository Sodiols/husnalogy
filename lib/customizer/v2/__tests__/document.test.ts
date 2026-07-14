import { describe, it, expect } from "vitest";
import { templateToDocument, migrateCustomizerDocument, resolveCustomerDocument } from "../document";
import type { ImageLayer, TextLayer } from "../types";

const legacyTemplate = {
  id: "tpl-1",
  version: 3,
  canvasWidthPx: 1500,
  canvasHeightPx: 2100,
  cardWidthIn: 5,
  cardHeightIn: 7,
  dpi: 300,
  orientation: "portrait",
  pages: [
    { id: "front", label: "Front", enabled: true, backgroundColor: "#ffffff" },
    { id: "back", label: "Back", enabled: false },
  ],
  fields: [
    { id: "names", label: "Names", type: "text", required: true },
    { id: "photo", label: "Photo", type: "image" },
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
      y: 400,
      width: 1100,
      height: 120,
      zIndex: 5,
      text: "Ayesha & Omar",
      textStyle: { fontFamily: "Cormorant Garamond", fontSize: 72, textAlign: "center" },
    },
    {
      id: "photo_layer",
      name: "Photo",
      page: "front",
      type: "image",
      fieldId: "photo",
      customerEditable: true,
      allowZoom: false,
      allowReposition: true,
      maskShape: "arch",
      x: 750,
      y: 1100,
      width: 700,
      height: 900,
      zIndex: 3,
    },
    { id: "orphan", name: "Orphan", page: "missing-page", type: "shape", x: 0, y: 0, width: 10, height: 10 },
  ],
  safeArea: { top: 90, right: 90, bottom: 90, left: 90 },
  bleed: { top: 45, right: 45, bottom: 45, left: 45 },
  settings: { allowCustomerText: true },
};

describe("V1 → V2 document migration", () => {
  it("migrates canvas, pages, fields, and layers", () => {
    const { document } = templateToDocument(legacyTemplate);
    expect(document.schemaVersion).toBe(3);
    expect(document.templateId).toBe("tpl-1");
    expect(document.canvas.widthPx).toBe(1500);
    expect(document.pages).toHaveLength(2);
    expect(document.pages[0].safeArea.top).toBe(90);
    expect(document.pages[0].allowCustomerText).toBe(true);
    expect(document.fields).toHaveLength(2);
    expect(document.layers).toHaveLength(3);
  });

  it("maps customerEditable into the complete permission model", () => {
    const { document } = templateToDocument(legacyTemplate);
    const photo = document.layers.find((l) => l.id === "photo_layer") as ImageLayer;
    expect(photo.customerPermissions.replaceImage).toBe(true);
    expect(photo.customerPermissions.zoomImage).toBe(true);
    expect(photo.customerPermissions.repositionImage).toBe(true);
    expect(photo.customerPermissions.cropImage).toBe(true);
    expect(photo.customerPermissions.move).toBe(true);
    expect(photo.customerPermissions.select).toBe(true);

    const text = document.layers.find((l) => l.id === "names_layer") as TextLayer;
    expect(text.customerPermissions.editContent).toBe(true);
    expect(text.customerPermissions.changeFont).toBe(true);
  });

  it("maps the legacy arch mask onto the V2 arch-top shape", () => {
    const { document } = templateToDocument(legacyTemplate);
    const photo = document.layers.find((l) => l.id === "photo_layer") as ImageLayer;
    expect(photo.mask.kind).toBe("arch-top");
  });

  it("repairs layers pointing at missing pages and reports a warning", () => {
    const { document, warnings } = templateToDocument(legacyTemplate);
    const orphan = document.layers.find((l) => l.id === "orphan");
    expect(orphan?.pageId).toBe("front");
    expect(warnings.some((w) => w.code === "layer-page")).toBe(true);
  });

  it("migrateCustomizerDocument rejects unsupported version pairs", () => {
    expect(() => migrateCustomizerDocument({}, 5, 2)).toThrow(/Unsupported/);
  });

  it("v2 documents re-normalize through the same entry point", () => {
    const { document } = templateToDocument(legacyTemplate);
    const { document: again } = migrateCustomizerDocument(document as any, 3, 3);
    expect(again.layers).toHaveLength(document.layers.length);
    expect(again.canvas.widthPx).toBe(1500);
  });
});

describe("customer document resolution", () => {
  it("applies customer values and permitted overrides", () => {
    const { document } = templateToDocument(legacyTemplate);
    const resolved = resolveCustomerDocument(
      document,
      { names: "Fatima & Hasan" },
      {
        layerOverrides: { names_layer: { transform: { rotation: 10 } } },
        userLayers: [
          { id: "u1", type: "text", page: "front", text: "PS: bring gifts", x: 700, y: 1900, width: 500, height: 80, zIndex: 40 },
        ],
      },
    );
    const text = resolved.layers.find((l) => l.id === "names_layer") as TextLayer;
    expect(text.text).toBe("Fatima & Hasan");
    expect(text.rotation).toBe(10);
    const user = resolved.layers.find((l) => l.id === "u1") as TextLayer;
    expect(user).toBeTruthy();
    expect(user.metadata.isUserLayer).toBe(true);
  });

  it("fills image layers from uploaded values including crop data", () => {
    const { document } = templateToDocument(legacyTemplate);
    const resolved = resolveCustomerDocument(
      document,
      { photo: { url: "https://example.supabase.co/x.jpg", zoom: 2, offsetX: 15, flipX: true } },
      null,
    );
    const photo = resolved.layers.find((l) => l.id === "photo_layer") as ImageLayer;
    expect(photo.src).toContain("x.jpg");
    expect(photo.transform.zoom).toBe(2);
    expect(photo.transform.offsetX).toBe(15);
    expect(photo.transform.flipX).toBe(true);
  });
});
