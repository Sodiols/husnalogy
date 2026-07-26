// Deterministic server rendering core (spec §23, §24). Server-only.
//
// Pipeline: normalized template + values + editorState
//   → deterministic SVG (lib/customizer/v2/svg — same layout/masks/crops as
//     the browser renderer)
//   → @resvg/resvg-js with the registry's font files (no system fonts)
//   → PNG buffers, and print-ready PDF via pdf-lib at exact physical size.
//
// Images are inlined as data URIs before rendering: resvg never fetches the
// network, and we only accept sources we trust (our own Supabase storage,
// site-relative public files, or data URIs) — spec §33.

import { createHash } from "crypto";
import { readFileSync, existsSync } from "fs";
import { join, normalize } from "path";
import { Resvg } from "@resvg/resvg-js";
import { PDFDocument } from "pdf-lib";
import { buildPageSvg, collectPageImageUrls } from "../svg";
import type { EditorState } from "@/app/components/customizer/customizer-utils";
import { getEnabledPages } from "@/app/components/customizer/customizer-utils";
import { createServerMeasure, getAllFontFilePaths, findMissingFontFiles, findUnrenderableFonts } from "./server-fonts";

export class RenderError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

function isTrustedRemote(url: URL): boolean {
  const supabaseHost = (() => {
    try {
      return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host : "";
    } catch {
      return "";
    }
  })();
  if (supabaseHost && url.host === supabaseHost) return true;
  // Any *.supabase.co storage host (matches next.config image allowlist).
  if (/\.supabase\.co$/i.test(url.host)) return true;
  return false;
}

async function fetchAsDataUri(source: string): Promise<string> {
  if (source.startsWith("data:")) return source;

  // Site-relative public asset (e.g. /images/... placeholders).
  if (source.startsWith("/") && !source.startsWith("//")) {
    const absolute = normalize(join(process.cwd(), "public", source.replace(/^\/+/, "")));
    const publicRoot = normalize(join(process.cwd(), "public"));
    if (!absolute.startsWith(publicRoot)) {
      throw new RenderError("ASSET_ACCESS_DENIED", `Refused local asset path: ${source}`);
    }
    if (!existsSync(absolute)) throw new RenderError("ASSET_NOT_FOUND", `Local asset not found: ${source}`);
    const buffer = readFileSync(absolute);
    if (buffer.byteLength > MAX_IMAGE_BYTES) throw new RenderError("asset-too-large", `Asset too large: ${source}`);
    const ext = source.split(".").pop()?.toLowerCase() || "png";
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : ext === "svg" ? "image/svg+xml" : ext === "gif" ? "image/gif" : "image/png";
    return `data:${mime};base64,${buffer.toString("base64")}`;
  }

  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new RenderError("ASSET_NOT_FOUND", `Invalid asset URL: ${source.slice(0, 120)}`);
  }
  if (url.protocol !== "https:") throw new RenderError("ASSET_ACCESS_DENIED", `Refusing non-HTTPS asset: ${url.host}`);
  if (!isTrustedRemote(url)) {
    throw new RenderError("ASSET_ACCESS_DENIED", `Refusing to render asset from untrusted host: ${url.host}`);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new RenderError(response.status === 403 ? "ASSET_ACCESS_DENIED" : "ASSET_NOT_FOUND", `Asset fetch failed (${response.status}): ${url.pathname}`);
  }
  const contentType = response.headers.get("content-type") || "image/png";
  if (!/^image\//i.test(contentType)) {
    throw new RenderError("IMAGE_DECODE_FAILED", `Asset is not an image: ${url.pathname}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new RenderError("asset-too-large", `Asset exceeds size limit: ${url.pathname}`);
  }
  return `data:${contentType.split(";")[0]};base64,${buffer.toString("base64")}`;
}

export async function loadTrustedImageBuffer(source: string): Promise<Buffer> {
  const dataUri = await fetchAsDataUri(source);
  const match = /^data:[^;,]+;base64,([\s\S]+)$/.exec(dataUri);
  if (!match) throw new RenderError("IMAGE_DECODE_FAILED", "The image could not be decoded for rendering.");
  return Buffer.from(match[1], "base64");
}

export type PageRenderResult = {
  pageId: string;
  png: Buffer;
  widthPx: number;
  heightPx: number;
  dpi: number;
  checksum: string;
};

export type RenderCustomizationOptions = {
  template: Record<string, any>;
  values: Record<string, any>;
  editorState: EditorState | null;
  mode: "print" | "preview";
  // Preview target width in px (ignored for print, which renders at native
  // canvas resolution + bleed).
  previewWidth?: number;
  watermark?: string;
  includeBleed?: boolean;
  pageIds?: string[];
  transparentBackground?: boolean;
};

// Render every requested page of a customization to PNG.
export async function renderCustomizationPages(options: RenderCustomizationOptions): Promise<PageRenderResult[]> {
  const { template, values, editorState, mode } = options;

  // Spec §10: production rendering must fail clearly when a design depends on
  // a font the server cannot reproduce — never silently substitute.
  if (mode === "print") {
    const missing = findUnrenderableFonts(template, editorState);
    if (missing.length) {
      throw new RenderError(
        "FONT_FILE_MISSING",
        `Design uses fonts unavailable for production rendering: ${missing.join(", ")}`,
      );
    }
    const missingFiles = findMissingFontFiles(template, editorState);
    if (missingFiles.length) {
      throw new RenderError("FONT_FILE_MISSING", `Required production font files are missing: ${missingFiles.join(", ")}`);
    }
  }

  const measure = createServerMeasure();
  const fontFiles = getAllFontFilePaths();
  if (!fontFiles.length) {
    throw new RenderError("FONT_FILE_MISSING", "No server font files found under public/fonts.");
  }

  const pages = getEnabledPages(template).filter(
    (page: any) => !options.pageIds || options.pageIds.includes(page.id),
  );
  if (!pages.length) throw new RenderError("no-pages", "No enabled pages to render.");

  const canvasW = Number(template.canvasWidthPx) || 1500;
  const dpi = Number(template.dpi) || 300;
  const bleedPx = options.includeBleed
    ? {
        top: Number(template.bleed?.top) || 0,
        right: Number(template.bleed?.right) || 0,
        bottom: Number(template.bleed?.bottom) || 0,
        left: Number(template.bleed?.left) || 0,
      }
    : { top: 0, right: 0, bottom: 0, left: 0 };

  const results: PageRenderResult[] = [];

  for (const page of pages) {
    // Inline every image the page depends on.
    const urls = collectPageImageUrls(template, values, editorState, page.id);
    const hrefMap: Record<string, string> = {};
    for (const url of urls) {
      hrefMap[url] = await fetchAsDataUri(url);
    }

    try {
      const svg = buildPageSvg({
        template,
        values,
        editorState,
        pageId: page.id,
        measure,
        hrefMap,
        mode,
        watermark: mode === "preview" ? options.watermark : "",
        bleedPx,
        backgroundColor: options.transparentBackground ? "transparent" : undefined,
      });

      const nativeW = canvasW + bleedPx.left + bleedPx.right;
      const fitTo =
        mode === "print"
          ? ({ mode: "width", value: nativeW } as const)
          : ({ mode: "width", value: Math.min(options.previewWidth || 1000, nativeW) } as const);

      const resvg = new Resvg(svg, {
        fitTo,
        font: {
          fontFiles,
          loadSystemFonts: false,
          defaultFontFamily: "Cormorant Garamond",
        },
        background: options.transparentBackground ? undefined : "#ffffff",
      });
      const rendered = resvg.render();
      const png = Buffer.from(rendered.asPng());

      results.push({
        pageId: page.id,
        png,
        widthPx: rendered.width,
        heightPx: rendered.height,
        dpi: mode === "print" ? dpi : Math.round((rendered.width / nativeW) * dpi),
        checksum: createHash("sha256").update(png).digest("hex"),
      });
    } catch (error) {
      if (error instanceof RenderError) throw error;
      const message = String((error as Error)?.message || error);
      if (message.includes("UNSUPPORTED_LAYER")) throw new RenderError("UNSUPPORTED_LAYER", message);
      throw new RenderError("INVALID_DOCUMENT", `Page "${page.id}" could not be rendered: ${message}`);
    }
  }

  return results;
}

// Assemble print pages into a single print-ready PDF at exact physical size
// (spec §24): page size = trim size + bleed, image embedded at full bleed.
export async function buildPrintPdf(
  pages: PageRenderResult[],
  physical: { widthIn: number; heightIn: number; dpi: number; bleedPx: { top: number; right: number; bottom: number; left: number } },
): Promise<{ pdf: Buffer; checksum: string }> {
  try {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.setProducer("Husnalogy Customizer V2");
    pdfDoc.setCreator("Husnalogy Render Service");

    const { widthIn, heightIn, dpi, bleedPx } = physical;
    const bleedWIn = (bleedPx.left + bleedPx.right) / dpi;
    const bleedHIn = (bleedPx.top + bleedPx.bottom) / dpi;
    const pageWpt = (widthIn + bleedWIn) * 72;
    const pageHpt = (heightIn + bleedHIn) * 72;

    for (const page of pages) {
      const pdfPage = pdfDoc.addPage([pageWpt, pageHpt]);
      const image = await pdfDoc.embedPng(page.png);
      pdfPage.drawImage(image, { x: 0, y: 0, width: pageWpt, height: pageHpt });
    }

    const bytes = await pdfDoc.save();
    const pdf = Buffer.from(bytes);
    return { pdf, checksum: createHash("sha256").update(pdf).digest("hex") };
  } catch (error) {
    if (error instanceof RenderError) throw error;
    throw new RenderError("PDF_RENDER_FAILED", String((error as Error)?.message || error));
  }
}
