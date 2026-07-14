// Server-only font loading for deterministic text measurement + rendering.
// Parses the registry's TTF files (public/fonts) with opentype.js and exposes
// the same MeasureFn the browser uses, so line breaks match exactly.

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import * as opentype from "opentype.js";
import { resolveFontFile, getFontByFamily, FONT_REGISTRY, collectFontDependencies } from "../fonts";
import { createOpentypeMeasure, fallbackMeasure, type MeasureFn, type MeasureStyle } from "../text-layout";

const fontCache = new Map<string, opentype.Font | null>();

function publicPath(relative: string): string {
  return join(process.cwd(), "public", relative);
}

function loadParsedFont(file: string): opentype.Font | null {
  if (fontCache.has(file)) return fontCache.get(file) || null;
  try {
    const absolute = publicPath(file);
    if (!existsSync(absolute)) {
      fontCache.set(file, null);
      return null;
    }
    const buffer = readFileSync(absolute);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const font = opentype.parse(arrayBuffer);
    fontCache.set(file, font);
    return font;
  } catch (error) {
    console.error(`[customizer] Failed to parse font file ${file}:`, error);
    fontCache.set(file, null);
    return null;
  }
}

// The shared server measurer: exact metrics for registry fonts with files,
// deterministic fallback for anything else (preflight flags those).
export function createServerMeasure(): MeasureFn {
  return createOpentypeMeasure((style: MeasureStyle) => {
    const entry = resolveFontFile(style.fontFamily, style.fontWeight, style.fontStyle);
    if (!entry) return null;
    return loadParsedFont(entry.file);
  }, fallbackMeasure);
}

// Absolute file paths for every server-renderable registry font — passed to
// the resvg renderer so SVG text draws with the exact same fonts.
export function getAllFontFilePaths(): string[] {
  const paths: string[] = [];
  for (const font of FONT_REGISTRY) {
    for (const file of font.files) {
      const absolute = publicPath(file.file);
      if (existsSync(absolute)) paths.push(absolute);
    }
  }
  return paths;
}

// Font families used by a template's text layers that the server CANNOT
// reproduce. Print jobs must fail on these instead of substituting (spec §10).
export function findUnrenderableFonts(template: Record<string, any>, editorState?: any): string[] {
  const families = new Set<string>();
  const check = (family: unknown) => {
    if (!family) return;
    const entry = getFontByFamily(String(family));
    if (!entry || !entry.serverRenderable) families.add(String(family));
  };
  for (const layer of template?.layers || []) {
    if (layer?.type === "text") check(layer?.textStyle?.fontFamily);
  }
  for (const layer of editorState?.userLayers || []) {
    if (layer?.type !== "element") check(layer?.textStyle?.fontFamily);
  }
  for (const override of Object.values(editorState?.layerOverrides || {})) {
    check((override as any)?.textStyle?.fontFamily);
  }
  return [...families];
}

export function findMissingFontFiles(template: Record<string, any>, editorState?: any): string[] {
  const styles: Array<{ fontFamily?: string; fontWeight?: string; fontStyle?: string }> = [];
  for (const layer of template?.layers || []) {
    if (layer?.type === "text") styles.push(layer.textStyle || {});
  }
  for (const layer of editorState?.userLayers || []) {
    if (layer?.type === "text" || !layer?.type) styles.push(layer.textStyle || {});
  }
  for (const override of Object.values(editorState?.layerOverrides || {})) {
    const style = (override as any)?.textStyle;
    if (style?.fontFamily) styles.push(style);
  }
  const dependencies = collectFontDependencies(styles);
  return dependencies.files
    .map((entry) => entry.file)
    .filter((file) => !existsSync(publicPath(file)));
}
