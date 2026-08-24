/**
 * Shapes, Lines, Frames and QR live inside the unified Elements library.
 *
 * This is a UI grouping change only: `shape`, `line`, `frame` and `qrCode`
 * remain their own Husnalogy object types, created by their own code paths, so
 * existing documents keep loading and rendering exactly as before.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getCustomerTools, hasAnyElementsCapability } from "@/app/components/customizer/CustomerToolRail";

const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");

const base = {
  allowAddText: false,
  hasUploads: false,
  allowElements: false,
  allowShapes: false,
  allowLines: false,
  allowFrames: false,
  allowGrids: false,
  allowQRCode: false,
  allowTextPresets: false,
  allowBackground: false,
  showLayers: false,
};
const ids = (options: Record<string, boolean>) =>
  getCustomerTools({ ...base, ...options }).map((tool) => tool.id);

describe("customer tool rail is consolidated", () => {
  it.each(["shapes", "lines", "frames", "qr"])("never offers a separate %s tool", (removed) => {
    const everything = ids({
      allowAddText: true, hasUploads: true, allowElements: true, allowShapes: true,
      allowLines: true, allowFrames: true, allowGrids: true, allowQRCode: true,
      allowBackground: true, showLayers: true,
    });
    expect(everything).not.toContain(removed);
  });

  it("offers exactly one Elements entry when everything is permitted", () => {
    const everything = ids({
      allowAddText: true, hasUploads: true, allowElements: true, allowShapes: true,
      allowLines: true, allowFrames: true, allowGrids: true, allowQRCode: true,
      allowBackground: true, showLayers: true,
    });
    expect(everything.filter((id) => id === "elements")).toHaveLength(1);
  });

  it("keeps the unrelated tools", () => {
    const everything = ids({
      allowAddText: true, hasUploads: true, allowElements: true, allowGrids: true,
      allowBackground: true, showLayers: true,
    });
    for (const kept of ["edit", "addText", "uploads", "grids", "background", "layers", "options"]) {
      expect(everything).toContain(kept);
    }
  });
});

describe("Elements appears when ANY contained capability is permitted", () => {
  it.each([
    ["graphics only", { allowElements: true }],
    ["shapes only", { allowShapes: true }],
    ["lines only", { allowLines: true }],
    ["frames only", { allowFrames: true }],
    ["QR only", { allowQRCode: true }],
  ])("shows Elements with %s", (_label, options) => {
    expect(ids(options)).toContain("elements");
  });

  it("shows Elements when graphics are OFF but a native section is ON", () => {
    // Graphics false / Shapes true → Elements still appears (spec §3).
    expect(ids({ allowElements: false, allowShapes: true })).toContain("elements");
    // Graphics false / QR true → Elements still appears.
    expect(ids({ allowElements: false, allowQRCode: true })).toContain("elements");
  });

  it("shows Elements for text presets only when the caller asks for them", () => {
    expect(ids({ allowTextPresets: true })).toContain("elements");
  });

  it("hides Elements entirely when every contained capability is off", () => {
    expect(ids({})).not.toContain("elements");
  });

  it("never infers Elements from the standalone Text tool", () => {
    // A surface can offer Add Text without rendering an Elements panel — the
    // admin's customer preview does exactly that. Implying Elements from
    // allowAddText would give it a button that opens the wrong panel.
    expect(ids({ allowAddText: true })).toContain("addText");
    expect(ids({ allowAddText: true })).not.toContain("elements");
  });

  it("the admin customer preview gets no Elements button it cannot service", () => {
    const preview = read("app/admin/dashboard/design-builder/AdminCustomerPreview.tsx");
    // It renders no Elements panel...
    expect(preview).not.toContain('activeTool === "elements"');
    // ...so it must not request any Elements capability either.
    const call = preview.slice(preview.indexOf("getCustomerTools({"), preview.indexOf("getCustomerTools({") + 300);
    for (const capability of ["allowElements", "allowShapes", "allowLines", "allowFrames", "allowQRCode", "allowTextPresets"]) {
      expect(call, `${capability} must not be requested`).not.toContain(capability);
    }
  });

  it("exposes the capability rule on its own for reuse", () => {
    expect(hasAnyElementsCapability({})).toBe(false);
    expect(hasAnyElementsCapability({ allowShapes: true })).toBe(true);
    expect(hasAnyElementsCapability({ allowQRCode: true })).toBe(true);
    expect(hasAnyElementsCapability({ allowElements: true })).toBe(true);
  });
});

describe("customer insert panel keeps only its unrelated routes", () => {
  const panel = read("app/components/customizer/CustomerInsertPanel.tsx");

  it.each(["shapes", "frames", "qr"])("no longer handles the %s tool", (tool) => {
    expect(panel).not.toContain(`if (tool === "${tool}")`);
  });

  it("still handles Photo Grids and Background", () => {
    expect(panel).toContain('if (tool === "grids")');
    expect(panel).toContain('if (tool === "background")');
  });
});

describe("no dead tool state remains", () => {
  const client = read("app/products/[slug]/personalize/personalize-client.tsx");
  const rail = read("app/components/customizer/CustomerToolRail.tsx");

  it.each(["shapes", "frames", "qr"])("the %s tool is gone from the CustomerTool union", (removed) => {
    const union = rail.slice(rail.indexOf("export type CustomerTool"), rail.indexOf("type ToolDef"));
    expect(union).not.toContain(`"${removed}"`);
  });

  it("selecting a shape or QR layer never activates a removed tool", () => {
    expect(client).not.toContain('setActiveTool("shapes")');
    expect(client).not.toContain('setActiveTool("qr")');
    expect(client).not.toContain('setActiveTool("frames")');
  });

  it("routes only the remaining tools to the insert panel", () => {
    expect(client).toContain('["grids", "background"].includes(activeTool)');
  });

  it("drops the removed rail icons", () => {
    const icons = rail.slice(rail.indexOf("RAIL_ICONS"), rail.indexOf("export type CustomerTool"));
    for (const removed of ["  shapes:", "  frames:", "  qr:", "  lines:"]) {
      expect(icons).not.toContain(removed);
    }
  });
});

describe("admin tool rail", () => {
  const rail = read("app/admin/dashboard/design-builder/AdminToolRail.tsx");

  it("lists Line last in the Shape menu", () => {
    const menu = rail.slice(rail.indexOf("SHAPE_MENU_ITEMS = ["), rail.indexOf("] as const"));
    for (const shape of ["rectangle", "rounded-rectangle", "circle", "oval", "triangle", "polygon", "arch", "line"]) {
      expect(menu).toContain(`"${shape}"`);
    }
    expect(menu.indexOf('"line"')).toBeGreaterThan(menu.indexOf('"arch"'));
  });

  it("routes Line to the line creator, not the shape creator", () => {
    expect(rail).toContain('shape === "line" ? props.onAddLine() : props.onAddShape(shape)');
  });
});
