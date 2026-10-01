#!/usr/bin/env node
/**
 * Measures the production render path (resvg rasterisation → PNG → PDF embed,
 * as lib/customizer/v2/server/render.ts does) at candidate print sizes, in a
 * FRESH process per size so peak memory is not shared between cases.
 *
 *   node scripts/benchmark-render-limits.mjs            # all cases
 *   node scripts/benchmark-render-limits.mjs 7071 7071  # one case (internal)
 *
 * Use the Node major the host runs (22). Output: JSON lines with wall time and
 * peak RSS. Used to choose PRODUCTION_RENDER_LIMITS in
 * lib/customizer/production-limits.ts.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [, , w, h] = process.argv;

if (w && h) {
  const { Resvg } = await import("@resvg/resvg-js");
  const { PDFDocument } = await import("pdf-lib");
  const width = Number(w);
  const height = Number(h);
  let peak = process.memoryUsage().rss;
  const sample = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 5);
  const started = Date.now();
  // A realistic page: background, a photo-sized gradient block, shapes and text.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b21c40"/><stop offset="1" stop-color="#1c40b2"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="#f2efe4"/>
    <rect x="${width * 0.1}" y="${height * 0.2}" width="${width * 0.8}" height="${height * 0.5}" fill="url(#g)"/>
    ${Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 97) % width}" cy="${(i * 211) % height}" r="${Math.max(4, width / 60)}" fill="#303839" opacity="0.4"/>`).join("")}
  </svg>`;
  const rendered = new Resvg(svg, { fitTo: { mode: "width", value: width }, background: "#ffffff" }).render();
  const png = Buffer.from(rendered.asPng());
  peak = Math.max(peak, process.memoryUsage().rss);
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([width * 0.24, height * 0.24]);
  page.drawImage(await pdf.embedPng(png), { x: 0, y: 0, width: width * 0.24, height: height * 0.24 });
  const bytes = await pdf.save();
  clearInterval(sample);
  peak = Math.max(peak, process.memoryUsage().rss);
  console.log(JSON.stringify({ width, height, megapixels: Number(((width * height) / 1e6).toFixed(1)), ms: Date.now() - started, peakRssMb: Math.round(peak / 1048576), pngMb: Number((png.length / 1048576).toFixed(1)), pdfMb: Number((bytes.length / 1048576).toFixed(1)) }));
  process.exit(0);
}

const cases = [
  ["5x7 in @300 + bleed", 1575, 2175],
  ["8x10 in @300", 2400, 3000],
  ["12x18 in @300", 3600, 5400],
  ["18x24 in @300", 5400, 7200],
  ["24x36 in @150", 3600, 5400],
  ["24x36 in @200", 4800, 7200],
  ["current per-page ceiling 50 MP", 7071, 7071],
  ["24x36 in @300 (NOT supported)", 7200, 10800],
];
const self = fileURLToPath(import.meta.url);
console.log(JSON.stringify({ node: process.version, platform: `${process.platform}-${process.arch}` }));
for (const [label, width, height] of cases) {
  const run = spawnSync(process.execPath, [self, String(width), String(height)], { encoding: "utf8", timeout: 600_000 });
  const line = (run.stdout || "").trim().split("\n").pop();
  console.log(JSON.stringify({ label, ...(line ? JSON.parse(line) : { error: (run.stderr || `exit ${run.status}`).slice(0, 300) }) }));
}
