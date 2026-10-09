import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pagePreviewUnchanged } from "../page-preview-memo";
import { moveLayers, patchPage, updateLayer } from "../../../../app/admin/dashboard/design-builder/builder-utils";

const template = () => ({
  canvasWidthPx: 1500, canvasHeightPx: 2100, safeArea: { top: 90, right: 90, bottom: 90, left: 90 }, fields: [], settings: {},
  pages: [{ id: "front", label: "Front" }, { id: "back", label: "Back" }],
  layers: [
    { id: "a", page: "front", type: "shape", x: 100, y: 100, width: 10, height: 10 },
    { id: "b", page: "back", type: "shape", x: 100, y: 100, width: 10, height: 10 },
  ],
});

describe("a page thumbnail re-renders only when its own drawing can change", () => {
  it("an edit on Front leaves Back's thumbnail alone and redraws Front's", () => {
    const before = template();
    const after = moveLayers(before, ["a"], 5, 0);
    expect(pagePreviewUnchanged(before, after, "back")).toBe(true);
    expect(pagePreviewUnchanged(before, after, "front")).toBe(false);
  });
  it("page settings, template-wide inputs and moving a layer between pages all redraw", () => {
    const before = template();
    expect(pagePreviewUnchanged(before, patchPage(before, "back", { backgroundColor: "#000000" }), "back")).toBe(false);
    expect(pagePreviewUnchanged(before, { ...before, safeArea: { ...before.safeArea } }, "back")).toBe(false);
    const moved = updateLayer(before, "a", { page: "back" });
    expect(pagePreviewUnchanged(before, moved, "back")).toBe(false);
    expect(pagePreviewUnchanged(before, moved, "front")).toBe(false);
  });
  it("the Pages panel uses it", () => {
    const panel = readFileSync(path.join(process.cwd(), "app/admin/dashboard/design-builder/AdminPagesPanel.tsx"), "utf8");
    expect(panel).toContain("pagePreviewUnchanged(previous.template, next.template, next.pageId)");
    expect(panel).toContain("<PageThumbnail template={template} pageId={page.id} />");
  });
});
