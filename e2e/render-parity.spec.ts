/**
 * Admin / Customer / server rendering parity (stabilization task 17).
 *
 * The Admin studio canvas and the Customer editor both draw with
 * CustomizerPreview; production output is buildPageSvg (rasterised by resvg).
 * A deterministic reference design — wrapped and aligned text in two font
 * families, shapes, a transparent-stroke line, a cropped photo, masks, a page
 * background image and colour, Front and Back with different safe areas — is
 * rendered both ways and compared:
 *
 *  1. Metrics: the server measures text with opentype.js from font files; the
 *     browser with canvas. Given the SAME font bytes they must agree, or text
 *     would wrap differently in print.
 *  2. Geometry: with identical metrics, every drawn text line (content and
 *     position), image placement/crop/fit, mask, shape and background must
 *     match between the client SVG and the server SVG.
 *  3. Server-side wrapping (opentype measure, as production uses) produces the
 *     same lines the browser drew.
 *  4. Curved text (lib/customizer/v2/text-curve): the same arc path, size and
 *     wording on the client and the server.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import * as opentype from "opentype.js";
import { expect, test } from "@playwright/test";
import { buildPageSvg } from "../lib/customizer/v2/svg";
import { createOpentypeMeasure, type MeasureStyle } from "../lib/customizer/v2/text-layout";
import { withGposKerning } from "../lib/customizer/v2/gpos-kerning";

const FONT_DIR = path.join(process.cwd(), "app", "brand-fonts");
const FONT_FILES = [
  { family: "ParitySans", weight: "400", style: "normal", file: "Inter-400.ttf" },
  { family: "ParitySans", weight: "700", style: "normal", file: "Inter-700.ttf" },
  { family: "ParitySerif", weight: "400", style: "normal", file: "CormorantGaramond-400.ttf" },
];
const parsed = new Map(FONT_FILES.map((font) => {
  const buffer = readFileSync(path.join(FONT_DIR, font.file));
  const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  // Exactly as the server parses fonts (lib/customizer/v2/server/server-fonts.ts).
  return [`${font.family}|${font.weight}`, withGposKerning(opentype.parse(bytes), bytes)];
}));
const serverMeasure = createOpentypeMeasure((style: MeasureStyle) => (parsed.get(`${style.fontFamily}|${String(style.fontWeight || "400")}`) as any) || null);

const PNG = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#2f6fb0"/><circle cx="400" cy="300" r="200" fill="#d4af37"/></svg>')}`;
const BG = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#f3e9dc"/></svg>')}`;

const text = (id: string, page: string, value: string, x: number, y: number, style: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id, page, type: "text", text: value, x, y, width: 400, height: 80, zIndex: 1, textStyle: { fontFamily: "ParitySans", fontSize: 60, color: "#303839", ...style }, ...extra,
});

function referenceTemplate(widthIn: number, heightIn: number) {
  const W = Math.round(widthIn * 300);
  const H = Math.round(heightIn * 300);
  return {
    enabled: true, cardWidthIn: widthIn, cardHeightIn: heightIn, dpi: 300, canvasWidthPx: W, canvasHeightPx: H,
    safeArea: { top: 90, right: 90, bottom: 90, left: 90 },
    pages: [
      { id: "front", label: "Front", enabled: true, backgroundColor: "#fbf7f0", backgroundImage: BG },
      { id: "back", label: "Back", enabled: true, backgroundColor: "#1f2425", safeArea: { top: 250, right: 250, bottom: 250, left: 250 } },
    ],
    defaultPage: "front", fields: [], guides: [],
    layers: [
      text("t_safe", "front", "Together with their families Anna Maria and Benjamin request the pleasure of your company", W / 2, 300, { autoSizeMode: "safe-width", textAlign: "center" }),
      text("t_left", "front", "Saturday the twelfth of June\nat four o'clock in the afternoon", W / 2, 700, { autoSizeMode: "height", textAlign: "left", letterSpacing: 4, lineHeight: 1.3 }, { width: W * 0.6 }),
      text("t_right", "front", "Reception to follow", W / 2, 950, { autoSizeMode: "width", textAlign: "right", fontWeight: "700" }),
      text("t_serif", "front", "Anna & Ben", W / 2, 1150, { fontFamily: "ParitySerif", fontSize: 110, autoSizeMode: "width", textAlign: "center" }),
      text("t_arch", "front", "Together forever", W / 2, 1450, { fontFamily: "ParitySerif", fontSize: 90, autoSizeMode: "width", textAlign: "center", curve: 55, letterSpacing: 3 }),
      { id: "s_rect", page: "front", type: "shape", shape: "rectangle", x: 300, y: H - 400, width: 260, height: 160, zIndex: 2, fill: "#d4af37", stroke: "#303839", strokeWidth: 6, borderRadius: 20 },
      { id: "s_oval", page: "front", type: "shape", shape: "oval", x: 650, y: H - 400, width: 200, height: 140, zIndex: 3, fill: "none", stroke: "#27307a", strokeWidth: 8 },
      { id: "s_line", page: "front", type: "shape", shape: "line", x: W / 2, y: H - 200, width: 600, height: 20, zIndex: 4, stroke: "#27307a", strokeWidth: 5, lineEndCap: "arrow" },
      { id: "s_line_clear", page: "front", type: "shape", shape: "line", x: W / 2, y: H - 150, width: 600, height: 20, zIndex: 5, stroke: "none", strokeWidth: 5 },
      { id: "i_crop", page: "front", type: "image", src: PNG, x: W - 350, y: H - 400, width: 300, height: 300, zIndex: 6, imageTransform: { zoom: 1.6, offsetX: 40, offsetY: -20, cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1 }, mask: { kind: "circle" } },
      { id: "i_arch", page: "back", type: "image", src: PNG, x: W / 2, y: H / 2, width: 500, height: 600, zIndex: 7, mask: { kind: "arch-top" }, fitMode: "contain" },
      text("t_back", "back", "Kindly reply by the first of May to the address on the enclosed card", W / 2, 400, { autoSizeMode: "safe-width", textAlign: "center", color: "#ffffff" }),
      text("t_smile", "back", "With love", W / 2, H - 500, { fontSize: 80, autoSizeMode: "width", textAlign: "center", curve: -70, color: "#ffffff", uppercase: true }),
    ],
  };
}

type Line = { text: string; x: number; y: number };
type Shape = { tag: string; attrs: Record<string, string> };

/** Normalised drawing facts of one SVG, read in the browser (DOMParser for the server string). */
async function facts(page: import("@playwright/test").Page, svgSource: { pageId: string } | { markup: string }) {
  return page.evaluate((source) => {
    const svg = "markup" in source
      ? new DOMParser().parseFromString(source.markup, "image/svg+xml").documentElement
      : document.querySelector(`[data-parity-page="${source.pageId}"] svg`)!;
    const round = (value: string | null) => (value === null ? "" : String(Math.round(Number(value) * 2) / 2));
    const lines: Line[] = Array.from(svg.querySelectorAll("text tspan")).map((tspan) => ({ text: (tspan.textContent || "").replace(/\s+$/, ""), x: Number(round(tspan.getAttribute("x"))), y: Number(round(tspan.getAttribute("y"))) }));
    const images = Array.from(svg.querySelectorAll("image")).map((image) => ({
      href: (image.getAttribute("href") || image.getAttribute("xlink:href") || "").slice(0, 60),
      x: round(image.getAttribute("x")), y: round(image.getAttribute("y")), width: round(image.getAttribute("width")), height: round(image.getAttribute("height")),
      fit: image.getAttribute("preserveAspectRatio") || "",
    }));
    const clips = Array.from(svg.querySelectorAll("clipPath path, clipPath ellipse, clipPath circle")).map((node) => (node.getAttribute("d") || `${node.tagName}:${round(node.getAttribute("cx"))},${round(node.getAttribute("cy"))},${round(node.getAttribute("r") || node.getAttribute("rx"))}`).replace(/(\d+\.\d)\d+/g, "$1"));
    const shapes: Shape[] = Array.from(svg.querySelectorAll("rect, ellipse, line, polygon, circle")).filter((node) => !node.closest("clipPath, defs, mask")).map((node) => ({
      tag: node.tagName.toLowerCase(),
      attrs: Object.fromEntries(["x", "y", "width", "height", "cx", "cy", "rx", "ry", "x1", "y1", "x2", "y2", "fill", "stroke", "stroke-width"].map((name) => [name, node.getAttribute(name)]).filter(([, value]) => value !== null).map(([name, value]) => [name, /^-?\d/.test(String(value)) ? round(String(value)) : String(value).toLowerCase()])),
    }));
    const curves = Array.from(svg.querySelectorAll("textPath")).map((textPath) => {
      const href = (textPath.getAttribute("href") || "").replace(/^#/, "");
      const path = Array.from(svg.querySelectorAll("path")).find((node) => node.getAttribute("id") === href);
      const text = textPath.closest("text")!;
      return {
        text: textPath.textContent || "",
        d: (path?.getAttribute("d") || "").replace(/-?\d+(?:\.\d+)?/g, (value) => String(Math.round(Number(value) * 2) / 2)),
        fontSize: String(text.getAttribute("font-size") || (text as any).style?.fontSize || "").replace("px", ""),
        anchor: text.getAttribute("text-anchor") || "",
        offset: textPath.getAttribute("startOffset") || "",
      };
    });
    return { lines, images, clips, shapes, curves };
  }, svgSource as any);
}

for (const [widthIn, heightIn] of [[5, 7], [7, 5], [3.5, 5]] as const) {
  test(`${widthIn}×${heightIn}: client and server renderers draw the same design`, async ({ page }) => {
    const template = referenceTemplate(widthIn, heightIn);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/__e2e/render-parity");
    await expect.poll(() => page.evaluate(() => Boolean((window as any).__renderParity))).toBe(true);
    const fonts = FONT_FILES.map((font) => ({ family: font.family, weight: font.weight, style: font.style, base64: readFileSync(path.join(FONT_DIR, font.file)).toString("base64") }));
    await page.evaluate((job) => (window as any).__renderParity.load(job), { template, fonts });
    await expect(page.locator("[data-render-parity]")).not.toHaveAttribute("data-drawn", "0");
    await expect(page.locator("[data-parity-page] svg")).toHaveCount(2);

    // 1. Metrics: browser canvas vs server opentype, same font bytes.
    const samples = [
      ...["Together with their families", "Anna & Ben", "Saturday the twelfth of June", "WAVY Kerning AVATAR"].flatMap((value) => [
        { text: value, style: { fontFamily: "ParitySans", fontSize: 60, fontWeight: "400", fontStyle: "normal", letterSpacing: 0 } },
        { text: value, style: { fontFamily: "ParitySans", fontSize: 60, fontWeight: "700", fontStyle: "normal", letterSpacing: 4 } },
        { text: value, style: { fontFamily: "ParitySerif", fontSize: 110, fontWeight: "400", fontStyle: "normal", letterSpacing: 0 } },
      ]),
    ];
    const browserWidths: number[] = await page.evaluate((items) => (window as any).__renderParity.measure(items), samples);
    samples.forEach((sample, index) => {
      const server = serverMeasure(sample.text, sample.style as MeasureStyle);
      const drift = Math.abs(server - browserWidths[index]);
      // Sub-pixel shaping differences only: under 0.5% of the line.
      expect(drift, `${sample.style.fontFamily} ${sample.style.fontWeight} "${sample.text}": server ${server.toFixed(2)} vs browser ${browserWidths[index].toFixed(2)}`).toBeLessThan(Math.max(1, browserWidths[index] * 0.005));
    });

    for (const pageId of ["front", "back"]) {
      // 2. Geometry: client SVG vs server SVG built with the browser's measure.
      const client = await facts(page, { pageId });
      const serverMarkup: string = await page.evaluate((id) => (window as any).__renderParity.server(id), pageId);
      const server = await facts(page, { markup: serverMarkup });
      expect(client.lines.length).toBeGreaterThan(0);
      expect(server.lines).toEqual(client.lines);
      expect(server.images).toEqual(client.images);
      expect(server.clips).toEqual(client.clips);
      expect(server.shapes).toEqual(client.shapes);
      // 4. Curved text: one arc, one size, one wording on both renderers.
      expect(client.curves.length).toBe(1);
      expect(server.curves).toEqual(client.curves);

      // 3. Production wrapping (opentype measure in Node) gives the same lines the browser drew.
      const production = buildPageSvg({ template, pageId, mode: "print", measure: serverMeasure });
      const productionLines = [...production.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((match) => match[1].replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/\s+$/, ""));
      expect(productionLines).toEqual(client.lines.map((line) => line.text));
      const productionCurves = [...production.matchAll(/<textPath[^>]*>([^<]*)<\/textPath>/g)].map((match) => match[1].replace(/&amp;/g, "&"));
      expect(productionCurves).toEqual(client.curves.map((curve) => curve.text));
    }
  });
}
