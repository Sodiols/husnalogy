import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { layerDisplayName, layerKindLabel } from "@/lib/customizer/v2/layer-label";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("the Layers panel names a layer by what a person sees", () => {
  it("a text layer with a studio-given name reads as its words", () => {
    expect(layerDisplayName({ id: "t1", type: "text", name: "Text", text: "wedding" })).toBe("wedding");
    expect(layerDisplayName({ id: "t2", type: "text", name: "Body text", text: "Join us\nfor dinner" })).toBe("Join us");
    expect(layerDisplayName({ id: "t3", type: "text", name: "Text copy copy", text: "  thank   you " })).toBe("thank you");
  });

  it("a name the admin chose wins", () => {
    expect(layerDisplayName({ id: "t1", type: "text", name: "Bride", text: "Anna" })).toBe("Bride");
  });

  it("empty text keeps its name", () => {
    expect(layerDisplayName({ id: "t1", type: "text", name: "Heading", text: "" })).toBe("Heading");
  });

  it("never shows a raw id", () => {
    expect(layerDisplayName({ id: "img_8f3k2", type: "image", name: "img_8f3k2" })).toBe("Image");
    expect(layerDisplayName({ id: "s_1", type: "shape", name: "" })).toBe("Shape");
    expect(layerDisplayName({ id: "q", type: "qrCode" })).toBe("QR code");
    expect(layerKindLabel({ type: "unknown" })).toBe("Layer");
  });

  it("is what the panel shows, with a real picture for picture layers", () => {
    const panel = read("app/admin/dashboard/design-builder/AdminLayersPanel.tsx");
    expect(panel).toContain("const label = layerDisplayName(layer);");
    expect(panel).toContain("useCanvasImageSource(");
    expect(panel).toContain("<LayerThumbnail layer={layer} />");
  });
});

describe("Pages is its own left-side view of page cards", () => {
  it("is on the rail after Layers and hosts the pages panel", () => {
    const rail = read("app/admin/dashboard/design-builder/AdminToolRail.tsx");
    expect(rail.indexOf('id: "pages"')).toBeGreaterThan(rail.indexOf('id: "layers"'));
    const builder = read("app/admin/dashboard/design-builder/AdminDesignBuilder.tsx");
    const pagesView = builder.slice(builder.indexOf('sidePanel === "pages" && ('));
    expect(pagesView).toContain('<div id="admin-pages-section">');
    expect(pagesView).toContain("<AdminPagesPanel");
  });

  it("draws each card's thumbnail with the shared renderer, above its name", () => {
    const pages = read("app/admin/dashboard/design-builder/AdminPagesPanel.tsx");
    expect(pages.indexOf("<CustomizerPreview")).toBeLessThan(pages.indexOf("data-page-label"));
    expect(pages).toContain("aria-pressed={active}");
  });
});
