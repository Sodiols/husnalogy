import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPageSvg } from "../svg";
import { normalizeCustomizerTemplate } from "../..";
import { TRANSPARENT_PAINT } from "../paint";

const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");
const line = (extra: Record<string, unknown> = {}) => ({
  id: "ln", page: "front", type: "shape", shape: "line", x: 750, y: 1000, width: 600, height: 20, zIndex: 1,
  stroke: "#27307a", strokeWidth: 6, lineStartCap: "arrow", lineEndCap: "circle", ...extra,
});
const template = (layer: any) => ({ enabled: true, canvasWidthPx: 1500, canvasHeightPx: 2100, pages: [{ id: "front", label: "Front" }], layers: [layer], fields: [] });

describe("a line's transparent stroke", () => {
  it("is stored as the canonical transparent paint and survives normalization with geometry intact", () => {
    const saved = normalizeCustomizerTemplate(template(line({ stroke: "transparent" })));
    const stored = saved.layers.find((layer: any) => layer.id === "ln");
    expect(stored.stroke).toBe(TRANSPARENT_PAINT);
    expect(stored).toMatchObject({ shape: "line", x: 750, y: 1000, width: 600, strokeWidth: 6, lineStartCap: "arrow", lineEndCap: "circle" });
  });

  it("renders no visible line or caps on the server — and restoring a colour draws it again", () => {
    const hidden = buildPageSvg({ template: template(line({ stroke: TRANSPARENT_PAINT })), pageId: "front", mode: "print" });
    const lineTag = hidden.match(/<line [^>]*>/)?.[0] || "";
    expect(lineTag).toContain('stroke="none"');
    expect(hidden).not.toMatch(/<(circle|polygon)[^>]*fill="#/);
    const restored = buildPageSvg({ template: template(line({ stroke: "#ff0000" })), pageId: "front", mode: "print" });
    expect(restored).toMatch(/<line [^>]*stroke="#ff0000"/);
  });

  it("a legacy EMPTY stroke keeps its old meaning (falls back to a visible colour), so old designs are unchanged", () => {
    const legacy = buildPageSvg({ template: template(line({ stroke: "" })), pageId: "front", mode: "print" });
    expect(legacy).toMatch(/<line [^>]*stroke="#303839"/);
  });

  it("the admin toolbar offers Transparent for a line's colour, like every other shape's line", () => {
    const toolbar = read("app/admin/dashboard/design-builder/AdminContextToolbar.tsx");
    expect(toolbar).not.toContain("allowTransparent={!line}");
  });
});
