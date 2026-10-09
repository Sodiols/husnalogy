import { describe, expect, it } from "vitest";
import { normalizeCustomizerTemplate } from "..";
import { addPage, duplicatePage } from "../../../app/admin/dashboard/design-builder/builder-utils";

const base = () => ({
  enabled: true,
  pages: [{ id: "front", label: "Front" }, { id: "back", label: "Back" }],
  layers: [{ id: "a", page: "front", type: "shape", shape: "rectangle", x: 10, y: 10, width: 10, height: 10 }],
  fields: [],
});

describe("page ids survive saving, and so do their layers", () => {
  it("a layer on a page whose id the normalizer rewrites follows its page (it used to jump to the first page)", () => {
    const template = {
      ...base(),
      pages: [...base().pages, { id: "inside-left", label: "Inside Left" }],
      layers: [...base().layers, { id: "b", page: "inside-left", type: "shape", shape: "oval", x: 1, y: 1, width: 5, height: 5 }],
      defaultPage: "inside-left",
      guides: [{ id: "g", pageId: "inside-left", axis: "vertical", position: 40 }],
    };
    const saved = normalizeCustomizerTemplate(template);
    expect(saved.pages.map((page: any) => page.id)).toEqual(["front", "back", "inside_left"]);
    expect(saved.layers.find((layer: any) => layer.id === "b").page).toBe("inside_left");
    expect(saved.defaultPage).toBe("inside_left");
    expect(saved.guides[0].pageId).toBe("inside_left");
    // Saving again changes nothing.
    expect(normalizeCustomizerTemplate(saved)).toEqual(saved);
  });

  it("the studio's new and duplicated pages get ids that are already in stored form", () => {
    let template: any = normalizeCustomizerTemplate(base());
    ({ template } = addPage(template, "Page"));
    ({ template } = addPage(template, "Page"));
    template = duplicatePage(template, "front").template ?? duplicatePage(template, "front");
    for (const page of template.pages) expect(normalizeCustomizerTemplate({ pages: [page] }).pages[0].id).toBe(page.id);
  });

  it("pages without ids get stable fallback ids", () => {
    const once = normalizeCustomizerTemplate({ pages: [{}, {}, { label: "Third" }], layers: [] });
    expect(once.pages.map((page: any) => page.id)).toEqual(["front", "back", "page_3"]);
    expect(normalizeCustomizerTemplate(once).pages.map((page: any) => page.id)).toEqual(["front", "back", "page_3"]);
  });
});
