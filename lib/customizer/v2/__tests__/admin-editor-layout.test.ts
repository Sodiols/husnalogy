import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const builder = read("app/admin/dashboard/design-builder/AdminDesignBuilder.tsx");
const header = read("app/admin/dashboard/design-builder/AdminBuilderHeader.tsx");
const panel = read("app/admin/dashboard/design-builder/AdminPropertiesPanel.tsx");
const layers = read("app/admin/dashboard/design-builder/AdminLayersPanel.tsx");
const pages = read("app/admin/dashboard/design-builder/AdminPagesPanel.tsx");
const rail = read("app/admin/dashboard/design-builder/AdminToolRail.tsx");

/**
 * The admin editor is a four-area layout: header, a floating tool rail with
 * one side panel beside it (layers + pages, uploads, elements…), canvas, and a
 * light inspector on the right.
 * These assertions pin the structure so a later refactor cannot silently drop a
 * region or a feature back out of it.
 */

describe("four-area editor layout", () => {
  it("puts layers and pages in their own side panels, beside the tool rail", () => {
    const sidebar = builder.slice(builder.indexOf("Left: the floating tool rail"), builder.indexOf("<main"));
    expect(sidebar).toContain("<AdminToolRail");
    expect(sidebar).toContain('sidePanel === "layers"');
    expect(sidebar).toContain('sidePanel === "pages"');
    expect(sidebar).toContain("<AdminLayersPanel");
    expect(sidebar).toContain("<AdminPagesPanel");
    // Uploads and the elements library open in the same side panel.
    expect(sidebar).toContain("<AdminUploadsPanel");
    expect(sidebar).toContain("CustomerElementsPanel");
  });

  it("puts the properties inspector on the right", () => {
    const inspector = builder.slice(builder.indexOf("Right inspector"));
    expect(inspector).toContain("border-l");
    expect(inspector).toContain("<AdminPropertiesPanel");
  });

  it("keeps the canvas between the two sidebars", () => {
    expect(builder.indexOf("Left: the floating tool rail")).toBeLessThan(builder.indexOf("<main"));
    expect(builder.indexOf("<main")).toBeLessThan(builder.indexOf("Right inspector"));
  });

  it("keeps the left sidebar reachable at every width", () => {
    const sidebar = builder.slice(builder.indexOf("Left workspace sidebar"), builder.indexOf("<main"));
    // A `hidden lg:flex` sidebar would strand layers and pages on small screens.
    expect(sidebar).not.toContain("hidden w-[");
  });
});

describe("header keeps every action", () => {
  it("retains back, save draft, preview and publish", () => {
    expect(header).toContain("onBack");
    expect(header).toContain("onSaveDraft");
    expect(header).toContain('onTabChange("preview")');
    expect(header).toContain("onPublish");
    expect(header).toContain("onUndo");
    expect(header).toContain("onRedo");
  });

  it("keeps all six section tabs", () => {
    for (const label of ["Design", "Fields", "Product Options", "Customer Preview", "Mockups", "Settings"]) {
      expect(header).toContain(label);
    }
  });

  it("still surfaces status chips and save status", () => {
    expect(header).toContain("statusChips.map");
    expect(header).toContain("saveStatusLabel");
  });
});

describe("inspector tabs route rather than remove settings", () => {
  it("offers Design, Settings and Advanced", () => {
    expect(panel).toContain('{ id: "design", label: "Design" }');
    expect(panel).toContain('{ id: "settings", label: "Settings" }');
    expect(panel).toContain('{ id: "advanced", label: "Advanced" }');
  });

  it("puts photo crop and opacity with the image, not in a separate tab", () => {
    // Crop moved out of Advanced and next to the photo it acts on; the filters
    // section is gone from the panel entirely. Both still write the SAME
    // document properties, so saved templates are unaffected.
    expect(panel).toContain('<Section title="Crop" collapsible');
    expect(panel).toContain("<OpacityField layer={layer} onLayerPatch={onLayerPatch} />");
    expect(panel).not.toContain('<Section title="Image filters"');
    expect(panel).not.toContain('<Section title="Image crop defaults"');
  });

  it("keeps every layer-type section, just tab-routed", () => {
    for (const section of [
      '<Section title="Text">',
      '<Section title="Image / photo area">',
      '<Section title="Photo grid">',
      '<Section title="Element">',
      '<Section title="QR code">',
      '<Section title="Background">',
      '<Section title="Group behaviour"',
      '<Section title="Customer access" subtle>',
    ]) {
      expect(panel).toContain(section);
    }
  });

  it("declares the tab state before the early return", () => {
    // Hook order must stay stable when nothing is selected.
    expect(panel.indexOf("useState(\"design\")")).toBeLessThan(panel.indexOf("if (!layer)"));
  });

  it("keeps the text sizing control with all four modes", () => {
    expect(panel).toContain('value={getTextAutoSizeMode(style)}');
    for (const label of ["Auto width (single line)", "Fixed width", "Auto height", "Shrink to fit"]) {
      expect(panel).toContain(label);
    }
  });
});

describe("layers and pages read on the white side panel", () => {
  it("themes the layers list for a light background", () => {
    // Light-grey layer cards with dark text, as in the reference.
    expect(layers).toContain("bg-[#F2F3F5]");
    expect(layers).toContain("text-[#1f2425]");
    expect(layers).not.toMatch(/(?<![\w:-])text-white(?![\w-])/);
  });

  it("themes the pages thumbnails for a light background", () => {
    expect(pages).toContain("border-[#303839]/12");
    expect(pages).not.toContain("border-white/");
  });

  it("keeps every page and layer action", () => {
    for (const handler of ["onAddPage", "onDuplicatePage", "onRenamePage", "onMovePage", "onDeletePage", "onPatchPage"]) {
      expect(pages).toContain(handler);
    }
    // The Layers panel organises; it no longer destroys. Deleting lives on the
    // context toolbar, where it acts on the selected object deliberately.
    for (const handler of ["onSelect", "onLayerPatch", "onReorderToTarget", "onDuplicate"]) {
      expect(layers).toContain(handler);
    }
    expect(layers).not.toContain("onRemove");
  });

  it("offers exactly hide, lock and copy on a layer row", () => {
    // Named as the row reads (layerDisplayName), never by a raw id.
    expect(layers).toContain("aria-label={layer.hidden ? `Show ${label}` : `Hide ${label}`}");
    expect(layers).toContain("aria-label={layer.locked ? `Unlock ${label}` : `Lock ${label}`}");
    expect(layers).toContain("aria-label={`Duplicate ${label}`}");
    expect(layers).not.toContain("aria-label={`Delete ${label}`}");
  });
});

describe("tool rail keeps every tool", () => {
  it("offers the reference tools in order", () => {
    const order = ["edit", "text", "uploads", "background", "elements", "icons", "options", "moment", "layers", "pages"];
    const positions = order.map((id) => rail.indexOf(`id: "${id}"`));
    expect(positions.every((position) => position > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("keeps every former rail tool reachable", () => {
    // Shapes, lines, frames and QR codes are added from Elements…
    expect(builder).toContain("onAddShape={addShape}");
    expect(builder).toContain("onAddLine={addLineStyle}");
    expect(builder).toContain("onAddFrame={addFrameWithMask}");
    expect(builder).toContain("onAddQRCode={() => addQRCode()}");
    // …guides and the hand tool sit in the canvas bar, pages with the layers.
    expect(builder).toContain("addGuide(axis)");
    expect(builder).toContain('dispatchTool({ type: "togglePan" })');
    expect(builder).toContain('id="admin-pages-section"');
  });
});

describe("canvas controls survive the restyle", () => {
  it("keeps zoom, fit, snap, safe area and bleed", () => {
    expect(builder).toContain("<CustomizerZoomControls");
    expect(builder).toContain("onFit={fitToPage}");
    expect(builder).toContain("onActualSize={resetViewport}");
    expect(builder).toContain("setSnapEnabled");
    expect(builder).toContain("showSafeArea: !settings.showSafeArea");
    expect(builder).toContain("showBleed: !settings.showBleed");
  });

  it("keeps the selection context toolbar", () => {
    expect(builder).toContain("<AdminContextToolbar");
  });
});
