import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Elements panel structure contract.
//
// The panel is the single place a customer reaches Dynamic Shapes, Graphics,
// Text, Borders/Lines, Shapes, Frames and QR Code. These assertions pin the
// wiring — that each section exists, routes to the NATIVE creator rather than
// an image, and is gated on the matching template permission.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const panel = read("app/components/customizer/CustomerElementsPanel.tsx");
const client = read("app/products/[slug]/personalize/personalize-client.tsx");

describe("landing section order matches the reference", () => {
  it("orders sections exactly: Dynamic Shapes, Graphics, Text, Borders/Lines, Shapes, Frames, QR Code", () => {
    const order = ["Dynamic Shapes", "Graphics", "Text", "Borders / Lines", "Shapes", "Frames", "QR Code"];
    const positions = order.map((title) => ({
      title,
      at: panel.search(new RegExp(`<Section\\s+title="${title.replace(/[/]/g, "\\/")}"`)),
    }));
    for (const entry of positions) expect(entry.at, `${entry.title} must exist`).toBeGreaterThan(-1);
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i].at, `${positions[i].title} must follow ${positions[i - 1].title}`)
        .toBeGreaterThan(positions[i - 1].at);
    }
  });

  it("keeps Recently used and Favourites BELOW QR Code, never between the reference sections", () => {
    const qr = panel.search(/<Section\s+title="QR Code"/);
    expect(panel.search(/<Section\s+title="Recently used"/)).toBeGreaterThan(qr);
    expect(panel.search(/<Section\s+title="Favourites"/)).toBeGreaterThan(qr);
  });

  it("puts the search field directly below the Elements header", () => {
    const header = panel.indexOf("Close Elements");
    const search = panel.indexOf('placeholder="Search for elements"');
    const firstSection = panel.search(/<Section\s+title=/);
    expect(search).toBeGreaterThan(-1);
    expect(search).toBeLessThan(firstSection);
    expect(header).toBeLessThan(search);
  });
});

describe("header and panel navigation", () => {
  it("has an Elements header with a close control", () => {
    expect(panel).toContain("Close Elements");
    expect(panel).toContain("onClose");
  });

  it("offers See more on every browsable section", () => {
    for (const target of ["graphics", "text", "borders", "shapes", "frames"]) {
      expect(panel, `${target} needs See more`).toContain(`seeMore("${target}")`);
    }
  });

  it("navigates within the same panel rather than to a route", () => {
    expect(panel).toContain('export type ElementsView = "home" | "graphics" | "text" | "borders" | "shapes" | "frames"');
    expect(panel).toContain('useState<ElementsView>("home")');
    expect(panel).toContain("Back to Elements");
  });

  it("renders a focused subview for each See more target", () => {
    for (const target of ["graphics", "text", "borders", "shapes", "frames"]) {
      expect(panel, `${target} subview missing`).toContain(`view === "${target}"`);
    }
  });

  it("scrolls the section list, not the header", () => {
    expect(panel).toContain("min-h-0 flex-1");
    expect(panel).toContain("overflow-y-auto overscroll-contain");
    expect(panel).toContain("[scrollbar-width:thin]");
  });

  it("lets the customer clear a search and return to the landing page", () => {
    expect(panel).toContain("Clear search");
  });
});

describe("panel sections", () => {
  it.each([
    "Dynamic Shapes",
    "Graphics",
    "Text",
    "Borders / Lines",
    "Shapes",
    "Frames",
    "QR Code",
  ])("renders a %s section", (title) => {
    // Tolerant of both the inline and multi-line <Section ...> JSX forms.
    expect(panel).toMatch(new RegExp(`<Section\\s+title="${title.replace(/[/]/g, "\\/")}"`));
  });

  it("offers an Add QR Code trigger, matching the reference layout", () => {
    expect(panel).toContain("Add QR Code");
  });

  it("gives the browsable sections a See more control", () => {
    for (const key of ["graphics", "text", "borders", "shapes", "frames"]) {
      expect(panel, `${key} should be browsable`).toContain(`seeMore("${key}")`);
    }
  });
});

describe("shapes, frames, lines and text stay native", () => {
  it("routes shapes to the native shape creator, never to an image", () => {
    expect(panel).toContain("onAddShape(shape.id)");
    expect(client).toContain("onAddShape={addCustomerShape}");
  });

  it("routes frames to the native frame creator", () => {
    expect(panel).toContain("onAddFrame(frame.id)");
    expect(client).toContain("onAddFrame={addCustomerFrame}");
  });

  it("routes lines to the native line creator", () => {
    expect(panel).toContain("onAddLine(line.id)");
    expect(client).toContain("onAddLine={addCustomerLine}");
  });

  it("routes text presets to the native editable-text creator", () => {
    expect(panel).toContain("onAddTextPreset(preset.id, preset.text)");
    expect(client).toContain("insertCustomerText(preset, text)");
  });

  it("routes QR to the native QR creator and reuses the shared validator", () => {
    expect(panel).toContain("onAddQRCode(qrValue)");
    expect(panel).toContain('import { isValidQRValue } from "@/lib/customizer/v2/qr"');
    expect(client).toContain("onAddQRCode={addCustomerQRCode}");
  });

  it("never inserts a shape, frame, line or QR code as an element asset", () => {
    // onInsertElement is the LIBRARY path; the native sections must not use it.
    const nativeCalls = panel.match(/onInsertElement\(/g) || [];
    // Only the single insert() helper calls it.
    expect(nativeCalls.length).toBeLessThanOrEqual(1);
  });
});

describe("sections respect template permissions", () => {
  it.each([
    ["Dynamic Shapes", "allowShapes && onAddShape && visibleShapes.length"],
    ["Shapes", "allowShapes && onAddShape && visibleMoreShapes.length"],
    ["Frames", "allowFrames && onAddFrame && visibleFrames.length"],
    ["QR Code", "allowQRCode && onAddQRCode"],
    ["Borders / Lines", "allowLines && onAddLine"],
    ["Text", "allowText && onAddTextPreset"],
  ])("gates %s on its permission", (_title, guard) => {
    expect(panel).toContain(guard);
  });

  it("passes each permission from the template settings, not a hardcoded true", () => {
    for (const wiring of [
      "allowShapes={pageAllowsCustomerObjects && customerShapesEnabled}",
      "allowLines={pageAllowsCustomerObjects && customerLinesEnabled}",
      "allowFrames={pageAllowsCustomerObjects && customerFramesEnabled}",
      "allowQRCode={pageAllowsCustomerObjects && qrEnabled}",
      "allowText={pageAllowsCustomerObjects && anyPageAllowsText}",
    ]) {
      expect(client).toContain(wiring);
    }
  });

  it("honours the admin allowlists for shapes and frame masks", () => {
    expect(panel).toContain("!allowedShapes.length || allowedShapes.includes(id)");
    expect(panel).toContain("!allowedFrameMasks.length || allowedFrameMasks.includes(frame.id)");
    expect(client).toContain("allowedShapes={allowedCustomerShapes}");
    expect(client).toContain("allowedFrameMasks={allowedCustomerFrameMasks}");
  });
});

describe("only real shape kinds are offered", () => {
  // Every id must exist in CUSTOMIZER_SHAPE_KINDS / CUSTOMIZER_MASK_SHAPES,
  // so the panel can never show a button the engine cannot create (spec §29).
  const index = read("lib/customizer/index.ts");

  it.each(["rectangle", "rounded-rectangle", "circle", "triangle", "arch", "oval", "polygon"])(
    "%s is a supported shape kind",
    (shape) => {
      const kinds = index.slice(index.indexOf("CUSTOMIZER_SHAPE_KINDS"), index.indexOf("CUSTOMIZER_MASK_SHAPES"));
      expect(kinds).toContain(`"${shape}"`);
    },
  );

  it.each(["rectangle", "rounded", "circle", "arch-top", "oval", "arch"])(
    "%s is a supported frame mask",
    (mask) => {
      const masks = index.slice(index.indexOf("CUSTOMIZER_MASK_SHAPES"), index.indexOf("CUSTOMIZER_FIT_MODES"));
      expect(masks).toContain(`"${mask}"`);
    },
  );

  it("does not invent a shape the engine lacks", () => {
    // A heart appears in some reference designs but is NOT a Husnalogy shape
    // kind; it must come from the Graphics library instead.
    expect(panel).not.toMatch(/id: "heart"/);
  });
});
