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
 * The admin editor redesign is a four-area layout: header, dark workspace
 * sidebar (tools + layers + pages), canvas, and a light inspector on the right.
 * These assertions pin the structure so a later refactor cannot silently drop a
 * region or a feature back out of it.
 */

describe("four-area editor layout", () => {
  it("puts layers and pages together in the dark left sidebar", () => {
    const sidebar = builder.slice(builder.indexOf("Left workspace sidebar"), builder.indexOf("<main"));
    expect(sidebar).toContain("bg-[#2A3132]");
    expect(sidebar).toContain("<AdminLayersPanel");
    expect(sidebar).toContain("<AdminPagesPanel");
  });

  it("puts the properties inspector on the right", () => {
    const inspector = builder.slice(builder.indexOf("Right inspector"));
    expect(inspector).toContain("border-l");
    expect(inspector).toContain("<AdminPropertiesPanel");
    expect(inspector).toContain("<AdminUploadsPanel");
    expect(inspector).toContain("CustomerElementsPanel");
  });

  it("keeps the canvas between the two sidebars", () => {
    expect(builder.indexOf("Left workspace sidebar")).toBeLessThan(builder.indexOf("<main"));
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

  it("keeps every layer-type section, just tab-routed", () => {
    for (const section of [
      '<Section title="Text">',
      '<Section title="Image / photo area">',
      '<Section title="Photo grid">',
      '<Section title="Element">',
      '<Section title="QR code">',
      '<Section title="Background">',
      '<Section title="Image crop defaults"',
      '<Section title="Image filters"',
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

describe("dark panels are readable on the sidebar surface", () => {
  it("themes the layers list for a dark background", () => {
    expect(layers).toContain("text-white/65");
    expect(layers).not.toContain('bg-white text-[#303839] hover:bg-[#F8F6F1]');
  });

  it("themes the pages thumbnails for a dark background", () => {
    expect(pages).toContain("border-white/12");
    expect(pages).toContain("text-white/50");
  });

  it("keeps every page and layer action", () => {
    for (const handler of ["onAddPage", "onDuplicatePage", "onRenamePage", "onMovePage", "onDeletePage", "onPatchPage"]) {
      expect(pages).toContain(handler);
    }
    for (const handler of ["onSelect", "onLayerPatch", "onReorder", "onDuplicate", "onRemove"]) {
      expect(layers).toContain(handler);
    }
  });
});

describe("tool rail keeps every tool", () => {
  it("retains the full tool set", () => {
    for (const tool of ["select", "text", "image", "photo", "shape", "line", "qr", "elements", "background", "guide", "pan", "pages"]) {
      expect(rail).toContain(`id="${tool}"`);
    }
  });

  it("gives the Pages button real behaviour now that pages are always visible", () => {
    expect(builder).toContain("admin-pages-section");
    expect(builder).toContain("scrollIntoView");
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
