// Server-only font loading for deterministic text measurement + rendering.
//
// Replaces the old bundled public/fonts registry: font files are now fetched
// on demand from the trusted Google Fonts catalog, cached on disk, parsed with
// opentype.js, and handed to resvg as concrete file paths.
//
// The measurer intentionally uses REAL font metrics for every family it can
// resolve, so browser and server agree on width, wrapping and auto-height
// (spec §19).

import * as opentype from "opentype.js";
import {
  collectFontDependencies,
  findFamily,
  type FontDependency,
  type GoogleFontFamily,
  type TextStyleLike,
} from "../google-fonts";
import { readFontBuffer, resolveFontsForStyles } from "./google-font-files";
import { createOpentypeMeasure, fallbackMeasure, type MeasureFn, type MeasureStyle } from "../text-layout";

/** Parsed-font cache keyed by the resolved variant, not the family. */
const parsedCache = new Map<string, opentype.Font | null>();

function parseKey(dependency: FontDependency): string {
  return `${dependency.family}|${dependency.variantKey}|${dependency.url}`;
}

function parseBuffer(bytes: Buffer): opentype.Font | null {
  try {
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return opentype.parse(arrayBuffer);
  } catch (error) {
    console.error("[fonts] Could not parse a downloaded font file:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Pre-load and parse every variant a document needs.
 *
 * Measurement is synchronous (the layout engine calls it per text run), so the
 * async download has to happen up front. Callers await this, then build a
 * measurer from the returned map.
 */
export async function preloadFontsForStyles(
  catalog: GoogleFontFamily[],
  styles: TextStyleLike[],
): Promise<{ parsed: Map<string, opentype.Font>; dependencies: FontDependency[]; missingFamilies: string[] }> {
  const { dependencies, missingFamilies } = collectFontDependencies(catalog, styles);
  const parsed = new Map<string, opentype.Font>();

  for (const dependency of dependencies) {
    const key = parseKey(dependency);
    if (parsedCache.has(key)) {
      const cached = parsedCache.get(key);
      if (cached) parsed.set(key, cached);
      continue;
    }
    try {
      const bytes = await readFontBuffer(dependency);
      const font = parseBuffer(bytes);
      parsedCache.set(key, font);
      if (font) parsed.set(key, font);
    } catch (error) {
      // Download failure is reported through missingFamilies so the caller
      // fails the render rather than substituting (spec §18).
      console.error(
        `[fonts] Could not load ${dependency.family} ${dependency.weight} ${dependency.style}:`,
        error instanceof Error ? error.message : error,
      );
      parsedCache.set(key, null);
      if (!missingFamilies.includes(dependency.family)) missingFamilies.push(dependency.family);
    }
  }

  return { parsed, dependencies, missingFamilies };
}

/**
 * A measurer backed by the exact variants this document uses.
 *
 * `fallbackMeasure` only ever applies to a family that is genuinely absent —
 * print rendering refuses those before it reaches this point, so production
 * output never measures against a substitute.
 */
export function createServerMeasureFromCatalog(
  catalog: GoogleFontFamily[],
  parsed: Map<string, opentype.Font>,
): MeasureFn {
  return createOpentypeMeasure((style: MeasureStyle) => {
    const { dependencies } = collectFontDependencies(catalog, [
      { fontFamily: style.fontFamily, fontWeight: style.fontWeight, fontStyle: style.fontStyle },
    ]);
    const dependency = dependencies[0];
    if (!dependency) return null;
    return parsed.get(parseKey(dependency)) || null;
  }, fallbackMeasure);
}

/**
 * Convenience measurer used by preflight and checkout validation, where a
 * fully deterministic measurement is preferred but a catalog outage must not
 * break the request. Loads nothing over the network.
 */
export function createServerMeasure(): MeasureFn {
  return createOpentypeMeasure(() => null, fallbackMeasure);
}

/**
 * Font families a document uses that the catalog cannot resolve at all.
 * Print jobs must fail on these instead of substituting (spec §18).
 */
export function findUnrenderableFonts(
  catalog: GoogleFontFamily[],
  template: Record<string, any>,
  editorState?: any,
): string[] {
  const families = new Set<string>();
  const check = (family: unknown) => {
    if (!family) return;
    if (!findFamily(catalog, String(family))) families.add(String(family));
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

/** Every text style in a template + editor state, for dependency collection. */
export function collectTextStyles(template: Record<string, any>, editorState?: any): TextStyleLike[] {
  const styles: TextStyleLike[] = [];
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
  return styles;
}

/**
 * Download every font file a document needs and return absolute paths for
 * resvg. Only the required variants are fetched (spec §16/§20).
 */
export async function resolveRenderFonts(
  catalog: GoogleFontFamily[],
  template: Record<string, any>,
  editorState?: any,
) {
  return resolveFontsForStyles(catalog, collectTextStyles(template, editorState));
}

/** Test helper — clears the parsed-font cache. */
export function __resetParsedFontCache(): void {
  parsedCache.clear();
}
