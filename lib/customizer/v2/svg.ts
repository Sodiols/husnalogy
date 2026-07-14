// Deterministic SVG string builder (spec §23). Server-safe, no React/DOM.
//
// This mirrors app/components/customizer/CustomizerPreview.tsx exactly: both
// resolve layers through the same customizer-utils helpers, clip through the
// same mask generator, and break lines through the same text layout service.
// The output feeds @resvg/resvg-js for PNG production and pdf-lib for PDFs.

import {
  getEffectiveLayersForPage,
  getFieldById,
  getPageById,
  resolveLayerImage,
  resolveLayerText,
  type EditorState,
} from "@/app/components/customizer/customizer-utils";
import { getLegacyMaskPath, getMaskPath } from "./masks";
import { layoutText, fallbackMeasure, type MeasureFn } from "./text-layout";
import { getGridSlotRect, normalizeGridSlot } from "./grids";

export type SvgBuildOptions = {
  template: any;
  values?: Record<string, any>;
  editorState?: EditorState | null;
  pageId: string;
  measure?: MeasureFn;
  // Production renders must inline every image (resvg does not fetch URLs).
  // Map of original href -> data URI (or safe replacement URL).
  hrefMap?: Record<string, string>;
  // Print mode: no guides, no placeholders, no watermark (spec §24).
  mode?: "print" | "preview";
  // Watermark text for protected customer previews.
  watermark?: string;
  // Extra bleed in px added around the page for print output.
  bleedPx?: { top: number; right: number; bottom: number; left: number };
  backgroundColor?: string;
};

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function attr(name: string, value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  return ` ${name}="${esc(value)}"`;
}

// Every image URL a page's render depends on — fetch these, convert to data
// URIs, and pass them back via hrefMap before building the production SVG.
export function collectPageImageUrls(
  template: any,
  values: Record<string, any>,
  editorState: EditorState | null | undefined,
  pageId: string,
): string[] {
  const urls = new Set<string>();
  const page = getPageById(template, pageId);
  if (page?.backgroundImage) urls.add(String(page.backgroundImage));
  const layers = getEffectiveLayersForPage(template, pageId, editorState || undefined);
  for (const layer of layers) {
    if (layer.hidden) continue;
    if (layer.type === "image" || layer.type === "frame") {
      const field = layer.fieldId ? getFieldById(template, layer.fieldId) : null;
      const image = resolveLayerImage(layer, field, values);
      if (image?.url) urls.add(String(image.url));
    }
    if (layer.type === "grid") {
      for (const slot of layer.slots || []) if (slot?.src) urls.add(String(slot.src));
    }
    if (layer.type === "element" && layer.src) urls.add(String(layer.src));
    if (layer.type === "background" && layer.src) urls.add(String(layer.src));
  }
  return [...urls];
}

function renderTextLayer(layer: any, field: any, values: Record<string, any>, measure: MeasureFn, mode: string): string {
  const style = layer.textStyle || {};
  const text = resolveLayerText(layer, field, values);
  const isPlaceholder =
    field && (values[field.id] === undefined || values[field.id] === "" || values[field.id] === null) && !field.defaultValue;

  // Print output never renders placeholder hint text (spec §24).
  if (mode === "print" && isPlaceholder) return "";
  if (!String(text).trim()) return "";

  const layout = layoutText(
    {
      text: String(text),
      width: layer.width || 0,
      height: layer.height || 0,
      fontFamily: style.fontFamily || "Cormorant Garamond",
      fontSize: Number(style.fontSize) || 48,
      minFontSize: Number(style.minFontSize) || undefined,
      fontWeight: style.fontWeight || "400",
      fontStyle: style.fontStyle === "italic" ? "italic" : "normal",
      letterSpacing: Number(style.letterSpacing) || 0,
      lineHeight: Number(style.lineHeight) || 1.15,
      textAlign: style.textAlign || "center",
      verticalAlign: style.verticalAlign || "middle",
      multiline: Boolean(style.multiline),
      fitMode: style.fitMode === "shrink" ? "shrink" : "fixed",
      maxLines: Number(layer.maxLines) > 0 ? Number(layer.maxLines) : undefined,
    },
    measure,
  );

  const boxLeft = layer.x - layer.width / 2;
  const boxTop = layer.y - layer.height / 2;
  const fill = isPlaceholder ? "#9aa0a1" : style.color || "#303839";
  const rotate = layer.rotation ? ` transform="rotate(${layer.rotation} ${layer.x} ${layer.y})"` : "";

  const spans = layout.lines
    .map((line) => `<tspan x="${boxLeft + line.x}" y="${boxTop + line.y}">${esc(line.text) || " "}</tspan>`)
    .join("");

  return (
    `<text${rotate} text-anchor="${layout.anchor}" dominant-baseline="middle"` +
    ` font-family="${esc(style.fontFamily || "Cormorant Garamond")}"` +
    ` font-size="${layout.fontSize}"` +
    attr("font-weight", style.fontWeight || "400") +
    (style.fontStyle === "italic" ? ` font-style="italic"` : "") +
    (Number(style.letterSpacing) ? ` letter-spacing="${Number(style.letterSpacing)}"` : "") +
    (style.underline ? ` text-decoration="underline"` : "") +
    ` fill="${esc(fill)}">${spans}</text>`
  );
}

function renderShapeLayer(layer: any): string {
  const x = layer.x - layer.width / 2;
  const y = layer.y - layer.height / 2;
  const rotate = layer.rotation ? ` transform="rotate(${layer.rotation} ${layer.x} ${layer.y})"` : "";
  const common = `${attr("fill", layer.fill || "none")}${attr("stroke", layer.stroke || "none")}${attr("stroke-width", layer.strokeWidth || 0)}`;

  if (layer.shape === "ellipse" || layer.shape === "circle" || layer.shape === "oval") {
    return `<ellipse cx="${layer.x}" cy="${layer.y}" rx="${layer.width / 2}" ry="${layer.height / 2}"${rotate}${common}/>`;
  }
  if (layer.shape === "line") {
    const dash = layer.lineStyle === "dashed" ? "12 8" : layer.lineStyle === "dotted" ? "2 8" : "";
    return `<line x1="${x}" y1="${layer.y}" x2="${x + layer.width}" y2="${layer.y}"${rotate} stroke="${esc(layer.stroke || layer.fill || "#303839")}" stroke-width="${layer.strokeWidth || 3}"${attr("stroke-dasharray", dash)} stroke-linecap="${esc(layer.lineCap || "round")}"/>`;
  }
  if (layer.shape === "triangle") {
    return `<path d="M ${layer.x} ${y} L ${x + layer.width} ${y + layer.height} L ${x} ${y + layer.height} Z"${rotate}${common}/>`;
  }
  if (layer.shape === "polygon" && Array.isArray(layer.points) && layer.points.length >= 3) {
    const points = layer.points.map((point: any) => `${x + Number(point.x || 0) * layer.width},${y + Number(point.y || 0) * layer.height}`).join(" ");
    return `<polygon points="${esc(points)}"${rotate}${common}/>`;
  }
  if (layer.shape === "arch") {
    const path = getMaskPath({ kind: "arch" }, { x, y, width: layer.width, height: layer.height });
    return `<path d="${esc(path.d)}"${rotate}${common}/>`;
  }
  if (layer.shape === "path" && layer.path) return `<path d="${esc(layer.path)}"${rotate}${common}/>`;
  return `<rect x="${x}" y="${y}" width="${layer.width}" height="${layer.height}" rx="${layer.borderRadius || 0}" ry="${layer.borderRadius || 0}"${rotate}${common}/>`;
}

function mapHref(url: string, hrefMap: Record<string, string>): string {
  return hrefMap[url] || url;
}

function renderElementLayer(layer: any, idPrefix: string, hrefMap: Record<string, string>): string {
  if (!layer.src) return "";
  const frameX = layer.x - layer.width / 2;
  const frameY = layer.y - layer.height / 2;
  const filterId = `${idPrefix}-tint-${layer.id}`;
  const transforms: string[] = [];
  if (layer.rotation) transforms.push(`rotate(${layer.rotation} ${layer.x} ${layer.y})`);
  if (layer.flipX || layer.flipY) {
    transforms.push(
      `translate(${layer.x} ${layer.y}) scale(${layer.flipX ? -1 : 1} ${layer.flipY ? -1 : 1}) translate(${-layer.x} ${-layer.y})`,
    );
  }
  const g = transforms.length ? ` transform="${transforms.join(" ")}"` : "";
  const filterDef = layer.tintColor
    ? `<defs><filter id="${filterId}" x="0%" y="0%" width="100%" height="100%"><feFlood flood-color="${esc(layer.tintColor)}" result="tint"/><feComposite in="tint" in2="SourceAlpha" operator="in"/></filter></defs>`
    : "";
  const filterAttr = layer.tintColor ? ` filter="url(#${filterId})"` : "";
  return `<g${g}>${filterDef}<image href="${esc(mapHref(layer.src, hrefMap))}" x="${frameX}" y="${frameY}" width="${layer.width}" height="${layer.height}" preserveAspectRatio="xMidYMid meet"${filterAttr}/></g>`;
}

function renderImageLayer(
  layer: any,
  field: any,
  values: Record<string, any>,
  idPrefix: string,
  hrefMap: Record<string, string>,
  mode: string,
): string {
  const image = resolveLayerImage(layer, field, values);
  const frameX = layer.x - layer.width / 2;
  const frameY = layer.y - layer.height / 2;
  const clipId = `${idPrefix}-clip-${layer.id}`;
  const mask = layer.mask && typeof layer.mask === "object"
    ? getMaskPath(layer.mask, { x: frameX, y: frameY, width: layer.width, height: layer.height })
    : getLegacyMaskPath(layer.maskShape, { x: frameX, y: frameY, width: layer.width, height: layer.height });
  const maskTransform = mask.transform ? ` transform="${mask.transform}"` : "";
  const rotate = layer.rotation ? ` transform="rotate(${layer.rotation} ${layer.x} ${layer.y})"` : "";

  if (!image?.url) {
    // Print output renders nothing for an empty frame (no dashed placeholder).
    if (mode === "print") return "";
    return (
      `<g${rotate}>` +
      `<path d="${mask.d}"${maskTransform} fill="${esc(layer.backgroundColor || "#F8F6F1")}" stroke="#c9bcbc" stroke-width="3" stroke-dasharray="14 12"/>` +
      `<text x="${layer.x}" y="${layer.y}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="${Math.max(18, layer.width * 0.06)}" fill="#9c8f8f">${esc(field?.label || "Photo")}</text>` +
      `</g>`
    );
  }

  const zoom = Number(image.zoom) > 0 ? Number(image.zoom) : 1;
  const drawW = layer.width * zoom;
  const drawH = layer.height * zoom;
  const drawX = frameX - (drawW - layer.width) / 2 + (Number(image.offsetX) || 0);
  const drawY = frameY - (drawH - layer.height) / 2 + (Number(image.offsetY) || 0);

  const inner: string[] = [];
  if (image.imageRotation) inner.push(`rotate(${image.imageRotation} ${layer.x} ${layer.y})`);
  if (image.flipX || image.flipY) {
    inner.push(
      `translate(${layer.x} ${layer.y}) scale(${image.flipX ? -1 : 1} ${image.flipY ? -1 : 1}) translate(${-layer.x} ${-layer.y})`,
    );
  }
  const innerTransform = inner.length ? ` transform="${inner.join(" ")}"` : "";
  const preserve = layer.fitMode === "contain" ? "xMidYMid meet" : "xMidYMid slice";

  return (
    `<g${rotate}>` +
    `<defs><clipPath id="${clipId}"><path d="${mask.d}"${maskTransform}/></clipPath></defs>` +
    (layer.backgroundColor ? `<path d="${mask.d}"${maskTransform} fill="${esc(layer.backgroundColor)}"/>` : "") +
    `<g clip-path="url(#${clipId})"><g${innerTransform}>` +
    `<image href="${esc(mapHref(image.url, hrefMap))}" x="${drawX}" y="${drawY}" width="${drawW}" height="${drawH}" preserveAspectRatio="${preserve}"/>` +
    `</g></g>` +
    (Number(layer.borderWidth) > 0
      ? `<path d="${mask.d}"${maskTransform} fill="none" stroke="${esc(layer.borderColor || "#303839")}" stroke-width="${Number(layer.borderWidth)}"/>`
      : "") +
    `</g>`
  );
}

function renderGridLayer(layer: any, idPrefix: string, hrefMap: Record<string, string>, mode: string): string {
  const left = layer.x - layer.width / 2;
  const top = layer.y - layer.height / 2;
  const rotate = layer.rotation ? ` transform="rotate(${layer.rotation} ${layer.x} ${layer.y})"` : "";
  const parts: string[] = [];
  if (layer.backgroundColor) {
    parts.push(`<rect x="${left}" y="${top}" width="${layer.width}" height="${layer.height}" rx="${layer.cornerRadius || 0}" fill="${esc(layer.backgroundColor)}"/>`);
  }
  for (let index = 0; index < (layer.slots || []).length; index += 1) {
    const slot = normalizeGridSlot(layer.slots[index], index);
    const rect = getGridSlotRect(layer, slot);
    const slotLayer = {
      id: `${layer.id}-${slot.id}`,
      x: rect.centerX,
      y: rect.centerY,
      width: rect.width,
      height: rect.height,
      rotation: 0,
      src: slot.src,
      imageTransform: slot.transform,
      mask: slot.mask || (layer.cornerRadius ? { kind: "rounded", radius: layer.cornerRadius } : { kind: "rectangle" }),
      maskShape: slot.mask?.kind || (layer.cornerRadius ? "rounded" : "rectangle"),
      fitMode: slot.transform.fitMode || "cover",
      backgroundColor: layer.backgroundColor || "#F8F6F1",
      borderColor: layer.borderColor,
      borderWidth: layer.borderWidth,
    };
    parts.push(renderImageLayer(slotLayer, null, {}, `${idPrefix}-${layer.id}-${index}`, hrefMap, mode));
  }
  return `<g${rotate}>${parts.join("")}</g>`;
}

function renderBackgroundLayer(layer: any, hrefMap: Record<string, string>): string {
  const x = layer.x - layer.width / 2;
  const y = layer.y - layer.height / 2;
  const rotate = layer.rotation ? ` transform="rotate(${layer.rotation} ${layer.x} ${layer.y})"` : "";
  return `<g${rotate}><rect x="${x}" y="${y}" width="${layer.width}" height="${layer.height}" fill="${esc(layer.color || "#ffffff")}"/>${
    layer.src
      ? `<image href="${esc(mapHref(layer.src, hrefMap))}" x="${x}" y="${y}" width="${layer.width}" height="${layer.height}" preserveAspectRatio="${layer.fitMode === "contain" ? "xMidYMid meet" : "xMidYMid slice"}"/>`
      : ""
  }</g>`;
}

// Build a complete standalone SVG document string for one page.
export function buildPageSvg(options: SvgBuildOptions): string {
  const {
    template,
    values = {},
    editorState = null,
    pageId,
    measure = fallbackMeasure,
    hrefMap = {},
    mode = "preview",
    watermark = "",
    bleedPx,
  } = options;

  const pageWidth = Number(template?.canvasWidthPx) || 1500;
  const pageHeight = Number(template?.canvasHeightPx) || 2100;
  const bleed = bleedPx || { top: 0, right: 0, bottom: 0, left: 0 };
  const totalW = pageWidth + bleed.left + bleed.right;
  const totalH = pageHeight + bleed.top + bleed.bottom;

  const page = getPageById(template, pageId);
  const layers = getEffectiveLayersForPage(template, pageId, editorState || undefined);
  const idPrefix = `srv-${pageId}`;
  const bg = page?.backgroundImage || "";
  const bgColor = options.backgroundColor || page?.backgroundColor || "#ffffff";

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="${-bleed.left} ${-bleed.top} ${totalW} ${totalH}">`,
  );
  // Bleed extension: background colour fills the full sheet including bleed.
  parts.push(`<rect x="${-bleed.left}" y="${-bleed.top}" width="${totalW}" height="${totalH}" fill="${esc(bgColor)}"/>`);
  if (bg) {
    // The background image covers the bleed area too so cuts have no white edge.
    parts.push(
      `<image href="${esc(mapHref(bg, hrefMap))}" x="${-bleed.left}" y="${-bleed.top}" width="${totalW}" height="${totalH}" preserveAspectRatio="xMidYMid slice"/>`,
    );
  }

  for (const layer of layers) {
    if (layer.hidden) continue;
    const field = layer.fieldId ? getFieldById(template, layer.fieldId) : null;
    let inner = "";
    if (layer.type === "image" || layer.type === "frame") inner = renderImageLayer(layer, field, values, idPrefix, hrefMap, mode);
    else if (layer.type === "shape") inner = renderShapeLayer(layer);
    else if (layer.type === "element") inner = renderElementLayer(layer, idPrefix, hrefMap);
    else if (layer.type === "grid") inner = renderGridLayer(layer, idPrefix, hrefMap, mode);
    else if (layer.type === "background") inner = renderBackgroundLayer(layer, hrefMap);
    else if (layer.type === "group") continue;
    else if (layer.type === "text") inner = renderTextLayer(layer, field, values, measure, mode);
    else throw new Error(`UNSUPPORTED_LAYER: ${String(layer.type)}`);
    if (!inner) continue;
    const opacity = layer.opacity === undefined ? 1 : Number(layer.opacity);
    parts.push(opacity >= 1 ? inner : `<g opacity="${opacity}">${inner}</g>`);
  }

  // Watermark tiles for protected customer previews — never in print mode.
  if (mode !== "print" && watermark) {
    const wmId = `${idPrefix}-wm`;
    parts.push(
      `<defs><pattern id="${wmId}" width="420" height="300" patternUnits="userSpaceOnUse" patternTransform="rotate(-24)">` +
        `<text x="0" y="150" font-family="sans-serif" font-size="34" fill="rgba(48,56,57,0.10)" font-weight="700">${esc(watermark)}</text>` +
        `</pattern></defs>` +
        `<rect x="${-bleed.left}" y="${-bleed.top}" width="${totalW}" height="${totalH}" fill="url(#${wmId})"/>`,
    );
  }

  parts.push("</svg>");
  return parts.join("");
}
