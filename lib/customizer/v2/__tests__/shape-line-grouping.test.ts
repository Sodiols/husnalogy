/**
 * Line lives inside Shape.
 *
 * This is a UI grouping change only: `line` remains its own Husnalogy object
 * type, created by its own code path, so existing documents containing lines
 * keep loading and rendering exactly as before.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getCustomerTools } from "@/app/components/customizer/CustomerToolRail";

const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");

const base = {
  allowAddText: false,
  hasUploads: false,
  allowElements: false,
  allowFrames: false,
  allowGrids: false,
  allowQRCode: false,
  allowBackground: false,
  showLayers: false,
};
const ids = (options: Record<string, boolean>) =>
  getCustomerTools({ ...base, ...options }).map((tool) => tool.id);

describe("customer tool rail", () => {
  it("never offers a separate Lines tool", () => {
    expect(ids({ allowShapes: true, allowLines: true })).not.toContain("lines");
  });

  it("offers one Shapes entry when either shapes or lines are permitted", () => {
    expect(ids({ allowShapes: true, allowLines: false })).toContain("shapes");
    // A template that allows ONLY lines must still expose the entry, or the
    // customer would have no way to draw one at all.
    expect(ids({ allowShapes: false, allowLines: true })).toContain("shapes");
    expect(ids({ allowShapes: true, allowLines: true }).filter((id) => id === "shapes")).toHaveLength(1);
  });

  it("hides it entirely when neither is permitted", () => {
    expect(ids({ allowShapes: false, allowLines: false })).not.toContain("shapes");
  });
});

describe("customer insert panel", () => {
  const panel = read("app/components/customizer/CustomerInsertPanel.tsx");

  it("renders shapes and lines from the one shapes panel", () => {
    expect(panel).toContain('if (tool === "shapes")');
    expect(panel).not.toContain('if (tool === "lines")');
    // Each half keeps its own permission gate.
    expect(panel).toContain("allowShapes");
    expect(panel).toContain("allowLines");
  });

  it("still creates lines through the line code path", () => {
    // Not converted into a shape variant — the document model is unchanged.
    expect(panel).toContain("onAddLine(style)");
    expect(panel).toContain('["solid", "dashed", "dotted"]');
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
