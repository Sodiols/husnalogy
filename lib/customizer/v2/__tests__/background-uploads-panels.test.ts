/**
 * The studio's Background and Uploads panels: real page background data and
 * the one image library — no decorative controls.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BACKGROUND_SWATCHES,
  NO_BACKGROUND_COLOR,
  designPalette,
  isNoBackgroundColor,
  normalizeHexInput,
} from "@/lib/customizer/v2/background-palette";
import { pushRecentColor } from "@/lib/customizer/v2/studio-recent-colors";
import { normalizeCustomizerTemplate } from "@/lib/customizer";
import { buildPageSvg } from "@/lib/customizer/v2/svg";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("background colours", () => {
  it("validates and normalises hex input", () => {
    expect(normalizeHexInput("#ABC")).toBe("#aabbcc");
    expect(normalizeHexInput("1a2b3c")).toBe("#1a2b3c");
    expect(normalizeHexInput(" #FFFFFF ")).toBe("#ffffff");
    for (const bad of ["", "#12", "red", "#gggggg", "url(#x)"]) expect(normalizeHexInput(bad)).toBeNull();
  });

  it("'no colour' is the page's real default: empty, drawn and stored as the paper white", () => {
    expect(isNoBackgroundColor(NO_BACKGROUND_COLOR)).toBe(true);
    expect(isNoBackgroundColor("#FFFFFF")).toBe(true);
    expect(isNoBackgroundColor("#000000")).toBe(false);
    const saved = normalizeCustomizerTemplate({ pages: [{ id: "front", label: "Front", backgroundColor: NO_BACKGROUND_COLOR }] });
    expect(saved.pages[0].backgroundColor).toBe("#ffffff");
  });

  it("offers a full, valid, unique swatch grid", () => {
    expect(BACKGROUND_SWATCHES.length).toBeGreaterThanOrEqual(36);
    expect(new Set(BACKGROUND_SWATCHES).size).toBe(BACKGROUND_SWATCHES.length);
    for (const hex of BACKGROUND_SWATCHES) expect(normalizeHexInput(hex)).toBe(hex);
  });

  it("derives the original palette from the design itself, deterministically", () => {
    const template = {
      pages: [{ id: "front", backgroundColor: "#ffffff" }, { id: "back", backgroundColor: "#000000" }],
      layers: [
        { zIndex: 1, type: "text", textStyle: { color: "#999999" } },
        { zIndex: 2, type: "shape", fill: "#d4af37", stroke: "#999999" },
      ],
    };
    expect(designPalette(template)).toEqual(["#ffffff", "#000000", "#999999", "#d4af37"]);
    expect(designPalette(template)).toEqual(designPalette(JSON.parse(JSON.stringify(template))));
    expect(designPalette(template, 3)).toHaveLength(3);
  });

  it("keeps one recent-colours list: newest first, unique, capped", () => {
    let list: string[] = [];
    for (const hex of ["#111111", "#222222", "#111111", "nope", "#333333"]) list = pushRecentColor(list, hex);
    expect(list).toEqual(["#333333", "#111111", "#222222"]);
    for (let index = 0; index < 20; index += 1) list = pushRecentColor(list, `#0000${String(index).padStart(2, "0")}`);
    expect(list).toHaveLength(8);
  });

  it("a page colour is page specific and reaches the server render", () => {
    const template = normalizeCustomizerTemplate({
      canvasWidthPx: 1500,
      canvasHeightPx: 2100,
      pages: [{ id: "front", label: "Front", enabled: true, backgroundColor: "#ec008c" }, { id: "back", label: "Back", enabled: true, backgroundColor: "#005a86" }],
      layers: [],
    });
    expect(buildPageSvg({ template, pageId: "front", mode: "print" })).toContain('fill="#ec008c"');
    expect(buildPageSvg({ template, pageId: "back", mode: "print" })).toContain('fill="#005a86"');
    expect(buildPageSvg({ template, pageId: "back", mode: "print" })).not.toContain("#ec008c");
  });
});

describe("Background panel wiring", () => {
  const panel = read("app/admin/dashboard/design-builder/AdminBackgroundPanel.tsx");
  it("writes only the active page, through the studio's page command", () => {
    expect(panel).toContain("onPatchPage(pageId, { backgroundColor: hex })");
    expect(panel).toContain('uploadBuilderImage(file, "background")');
    expect(panel).toContain("backgroundAssetId: asset.id");
  });
  it("searches the library's background images", () => {
    expect(panel).toContain('type: "background", search: term');
  });
  it("applies a native colour pick once, on change", () => {
    expect(panel).toContain('element.addEventListener("change", onChange)');
  });
  it("records colours in the shared studio list, which the toolbar colours use too", () => {
    expect(panel).toContain("rememberRecentColor(hex)");
    expect(read("app/admin/dashboard/design-builder/AdminContextToolbar.tsx")).toContain("rememberRecentColor(color)");
  });
});

describe("Uploads panel wiring", () => {
  const panel = read("app/admin/dashboard/design-builder/AdminUploadsPanel.tsx");
  it("uploads through the shared pipeline and inserts the asset, not the thumbnail", () => {
    expect(panel).toContain('uploadBuilderImage(files[index], "image"');
    expect(panel).toContain("onInsertAsset(asset)");
    expect(panel).not.toMatch(/src:\s*asset\.thumbnailUrl/);
  });
  it("opens the full library as the media manager", () => {
    expect(panel).toContain("<AdminMediaLibrary");
    expect(panel).toContain('title="Media manager"');
  });
  it("hands off to a real phone upload page for studio users only", () => {
    expect(panel).toContain('const MOBILE_UPLOAD_PATH = "/upload-from-phone"');
    const page = read("app/upload-from-phone/page.tsx");
    expect(page).toContain("if (!canAccessStudio(actor)) notFound();");
    expect(read("proxy.js")).toContain('"/upload-from-phone",');
    expect(read("app/upload-from-phone/upload-from-phone-client.tsx")).toContain('uploadBuilderImage(files[index], "image"');
  });
});
