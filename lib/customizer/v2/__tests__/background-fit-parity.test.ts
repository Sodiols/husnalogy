import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPageSvg } from "../svg";

// Task 16 (review only, no new UI): what fitting each background path has, and
// that the editor preview and the server render agree on it.
const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");
const page = (extra: Record<string, unknown> = {}) => ({ id: "front", label: "Front", backgroundColor: "#ffffff", ...extra });
const base = (pageExtra: Record<string, unknown>, layers: any[] = []) => ({ canvasWidthPx: 1500, canvasHeightPx: 2100, pages: [page(pageExtra)], layers, fields: [] });

describe("background fitting", () => {
  it("a PAGE background image is always cover (slice) — server and preview alike", () => {
    const svg = buildPageSvg({ template: base({ backgroundImage: "https://x.test/bg.webp" }), pageId: "front", mode: "print" });
    expect(svg).toMatch(/<image href="https:\/\/x\.test\/bg\.webp"[^>]*preserveAspectRatio="xMidYMid slice"/);
    const preview = read("app/components/customizer/CustomizerPreview.tsx");
    expect(preview).toMatch(/source=\{background \? null : activePage\?\.backgroundAssetId[\s\S]{0,300}preserveAspectRatio="xMidYMid slice"/);
  });

  it("a BACKGROUND LAYER already offers cover and contain, rendered the same way by both", () => {
    const layer = (fitMode: string) => ({ id: "bg", page: "front", type: "background", src: "https://x.test/l.webp", color: "#ffffff", x: 750, y: 1050, width: 1500, height: 2100, zIndex: 0, fitMode });
    expect(buildPageSvg({ template: base({}, [layer("contain")]), pageId: "front", mode: "print" })).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(buildPageSvg({ template: base({}, [layer("cover")]), pageId: "front", mode: "print" })).toContain('preserveAspectRatio="xMidYMid slice"');
    expect(read("app/components/customizer/CustomizerPreview.tsx")).toContain('preserveAspectRatio={layer.fitMode === "contain" ? "xMidYMid meet" : "xMidYMid slice"}');
  });
});
