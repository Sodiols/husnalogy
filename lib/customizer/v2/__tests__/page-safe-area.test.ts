import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pageSafeBounds, pageSafeInsets, resolvePageSafeArea, setPageSafeArea } from "../safe-area";
import { DEFAULT_LINE_HEIGHT, fallbackMeasure, resolveTextBox, templateSafeBounds } from "../text-layout";
import { buildPageSvg } from "../svg";
import { templateToDocument } from "../document";
import { runPreflight } from "../preflight";
import { changeTemplateOrientation, resizeTemplateArtboard } from "../artboard";
import { normalizeCustomizerTemplate, validateCustomizerTemplateDetailed } from "../..";
import { templateFromVersionSnapshot } from "../../versions";

const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");

/** A card at `widthIn` × `heightIn` (300 dpi) with Front/Back; Back has a wider safe margin when `ownBack`. */
function card(widthIn: number, heightIn: number, ownBack = true) {
  const widthPx = Math.round(widthIn * 300);
  const heightPx = Math.round(heightIn * 300);
  return {
    enabled: true,
    cardWidthIn: widthIn,
    cardHeightIn: heightIn,
    dpi: 300,
    canvasWidthPx: widthPx,
    canvasHeightPx: heightPx,
    safeArea: { top: 90, right: 90, bottom: 90, left: 90 },
    bleed: { top: 45, right: 45, bottom: 45, left: 45 },
    defaultPage: "front",
    pages: [
      { id: "front", label: "Front", enabled: true },
      { id: "back", label: "Back", enabled: true, ...(ownBack ? { safeArea: { top: 300, right: 300, bottom: 300, left: 300 } } : {}) },
    ],
    fields: [],
    layers: [] as any[],
  };
}

const SENTENCE = "hi hi hi how are you doing on this fine day my friend";
/** New-text defaults: safe-width growth, font size 17 pt equivalent in px is irrelevant here — same size on both pages. */
function safeWidthText(page: string, x: number, fontSize = 70.83) {
  return {
    id: `t_${page}`,
    page,
    type: "text",
    name: "Text",
    text: SENTENCE,
    x,
    y: 600,
    width: 100,
    height: 90,
    zIndex: 1,
    customerEditable: true,
    textStyle: { fontFamily: "Inter", fontSize, autoSizeMode: "safe-width", textAlign: "center" },
  };
}

function boxFor(template: any, layer: any) {
  const style = layer.textStyle;
  return resolveTextBox(
    { x: layer.x, y: layer.y, width: layer.width, height: layer.height, text: layer.text, fontFamily: style.fontFamily, fontSize: style.fontSize, textAlign: style.textAlign, autoSizeMode: style.autoSizeMode },
    fallbackMeasure,
    templateSafeBounds(template, layer.page),
  );
}

describe("the canonical page-aware safe-area resolver", () => {
  it("a page inherits the template's insets unless it has its own", () => {
    const t = card(5, 7);
    expect(resolvePageSafeArea(t, "front")).toMatchObject({ ownInsets: false, insets: { top: 90, right: 90, bottom: 90, left: 90 }, width: 1500, height: 2100 });
    expect(resolvePageSafeArea(t, "back")).toMatchObject({ ownInsets: true, insets: { top: 300, right: 300, bottom: 300, left: 300 } });
    expect(pageSafeBounds(t, "back")).toEqual({ left: 300, top: 300, right: 1200, bottom: 1800 });
    // No page id: the default page.
    expect(pageSafeBounds(t)).toEqual(pageSafeBounds(t, "front"));
    // A partial own safe area fills the missing sides from the template.
    const partial = { ...t, pages: [{ id: "front", safeArea: { left: 10 } }] };
    expect(pageSafeInsets(partial, "front")).toEqual({ top: 90, right: 90, bottom: 90, left: 10 });
  });

  it("covers 5×7 and 3.5×5 in portrait and landscape", () => {
    for (const [w, h] of [[5, 7], [7, 5], [3.5, 5], [5, 3.5]]) {
      const t = card(w, h);
      const front = resolvePageSafeArea(t, "front");
      const back = resolvePageSafeArea(t, "back");
      expect(front.width).toBe(Math.round(w * 300));
      expect(front.height).toBe(Math.round(h * 300));
      expect(front.bounds.right).toBe(front.width - 90);
      expect(back.bounds.right).toBe(back.width - 300);
      expect(back.bounds.bottom).toBe(back.height - 300);
    }
  });

  it("setPageSafeArea gives a page its own area and can return it to inheriting", () => {
    const t = card(5, 7, false);
    const own = setPageSafeArea(t, "back", { left: 150 });
    expect(pageSafeInsets(own, "back")).toEqual({ top: 90, right: 90, bottom: 90, left: 150 });
    expect(pageSafeInsets(own, "front")).toEqual({ top: 90, right: 90, bottom: 90, left: 90 });
    const back = setPageSafeArea(own, "back", null);
    expect(resolvePageSafeArea(back, "back").ownInsets).toBe(false);
    expect(setPageSafeArea(t, "back", null)).toBe(t);
    expect(setPageSafeArea(t, "missing", { left: 1 })).toBe(t);
  });
});

describe("Front and Back with different safe areas: editor, server and preflight agree", () => {
  for (const [w, h] of [[5, 7], [7, 5], [3.5, 5], [5, 3.5]] as const) {
    it(`${w}×${h}: the same sentence wraps at each page's own width, identically in the server render`, () => {
      const t: any = card(w, h);
      const width = Math.round(w * 300);
      t.layers = [safeWidthText("front", width / 2), safeWidthText("back", width / 2)];
      const front = boxFor(t, t.layers[0]);
      const back = boxFor(t, t.layers[1]);
      // Each box stays inside its own page's safe area…
      expect(front.x - front.width / 2).toBeGreaterThanOrEqual(90 - 0.5);
      expect(front.x + front.width / 2).toBeLessThanOrEqual(width - 90 + 0.5);
      expect(back.x - back.width / 2).toBeGreaterThanOrEqual(300 - 0.5);
      expect(back.x + back.width / 2).toBeLessThanOrEqual(width - 300 + 0.5);
      // …so Back (narrower) is never wider than Front and needs at least as many lines.
      expect(back.width).toBeLessThanOrEqual(front.width);
      expect(back.height).toBeGreaterThanOrEqual(front.height);

      // The server SVG wraps with the same page-specific bound: same line count as the editor box.
      const lines = (pageId: string) => (buildPageSvg({ template: t, pageId, mode: "print" }).match(/<tspan/g) || []).length;
      const editorLines = (box: any) => Math.round(box.height / (70.83 * DEFAULT_LINE_HEIGHT));
      expect(lines("front")).toBe(editorLines(front));
      expect(lines("back")).toBe(editorLines(back));
    });
  }

  it("preflight checks each page against its own safe area (the reported mismatch)", () => {
    const t: any = card(5, 7);
    // A customer-editable box at x 200–600: inside Front's 90px margin, outside Back's 300px one.
    const box = { type: "text", name: "Name", text: "Ann", y: 1000, width: 400, height: 90, x: 400, zIndex: 1, customerEditable: true, textStyle: { fontFamily: "Inter", fontSize: 40 } };
    t.layers = [{ ...box, id: "f", page: "front" }, { ...box, id: "b", page: "back" }];
    const normalized = normalizeCustomizerTemplate(t);
    const { document } = templateToDocument(normalized);
    const flagged = runPreflight(document).issues.filter((issue) => issue.code === "outside-safe-area").map((issue) => issue.layerId);
    expect(flagged).toEqual(["b"]);
    // And the editor's resolver agrees on which page the box crosses.
    const crosses = (pageId: string) => {
      const b = pageSafeBounds(normalized, pageId);
      return 400 - 200 < b.left;
    };
    expect(crosses("front")).toBe(false);
    expect(crosses("back")).toBe(true);
  });

  it("the page's own safe area survives normalization, the canonical document and publishing", () => {
    const normalized = normalizeCustomizerTemplate(card(5, 7));
    expect(normalized.pages.find((p: any) => p.id === "back").safeArea).toEqual({ top: 300, right: 300, bottom: 300, left: 300 });
    expect(normalized.pages.find((p: any) => p.id === "front").safeArea).toBeUndefined();
    const { document } = templateToDocument(normalized);
    for (const page of document.pages) expect(page.safeArea).toEqual(pageSafeInsets(normalized, page.id));
    const published = templateFromVersionSnapshot({ templateId: "x", document } as any);
    expect(pageSafeInsets(published, "back")).toEqual({ top: 300, right: 300, bottom: 300, left: 300 });
    expect(pageSafeInsets(published, "front")).toEqual({ top: 90, right: 90, bottom: 90, left: 90 });
  });

  it("validation rejects a page safe area larger than the page", () => {
    const t: any = card(5, 7);
    t.pages[1].safeArea = { top: 0, right: 800, bottom: 0, left: 800 };
    const result = validateCustomizerTemplateDetailed(normalizeCustomizerTemplate(t));
    expect(result.errors.join(" ")).toContain('safe area of page "Back" is larger than the page');
  });

  it("a DPI change scales a page's own safe area with the card; orientation fits inside the tightest page", () => {
    const t: any = card(5, 7);
    const resized = resizeTemplateArtboard(t, { widthIn: 5, heightIn: 7, dpi: 600 }).template;
    expect(pageSafeInsets(resized, "back").left).toBe(600);
    expect(pageSafeInsets(resized, "front").left).toBe(180);
    t.layers = [{ id: "r", page: "front", type: "shape", x: 750, y: 1050, width: 1300, height: 600, zIndex: 1 }];
    const turned = changeTemplateOrientation(t, "landscape");
    const shape = turned.template.layers[0];
    // Fitted within Back's 300px margins even though it sits on Front.
    expect(shape.height).toBeLessThanOrEqual(1500 - 600 + 0.5);
  });
});

describe("every consumer resolves the page's safe area (no template-only reads remain)", () => {
  it("editors, previews, selection geometry, snapping and the server render use the resolver", () => {
    const files = [
      "app/admin/dashboard/design-builder/AdminCanvas.tsx",
      "app/admin/dashboard/design-builder/AdminDesignBuilder.tsx",
      "app/components/customizer/CustomizerPreview.tsx",
      "app/components/customizer/CustomizerWorkspace.tsx",
      "app/products/[slug]/personalize/personalize-client.tsx",
      "lib/customizer/v2/svg.ts",
      "lib/customizer/v2/text-layout.ts",
    ];
    for (const file of files) {
      const source = read(file);
      expect(source, file).not.toMatch(/template\?\.safeArea\?\.(left|right|top|bottom)/);
      expect(source, file).not.toMatch(/current\?\.safeArea\?\./);
      expect(source, file).toMatch(/pageSafeBounds|pageSafeInsets|resolvePageSafeArea|templateSafeBounds\([^)]*,/);
    }
  });
});
