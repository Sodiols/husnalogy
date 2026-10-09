// Effective print resolution of placed photos (docs/PRINT_QUALITY_AUDIT.md D5).
//
// A photo's own pixel count says nothing on its own: what matters is how many
// SOURCE pixels land on each printed inch after the frame size, crop, zoom and
// fit are applied. This module computes that from the SAME draw box the
// browser editors and the production renderer use (image-crop.ts), so the
// warning describes exactly what will print.
//
//   canvas px per source px  s = max(drawW / srcW, drawH / srcH)   cover ("slice")
//                              = min(drawW / srcW, drawH / srcH)   contain ("meet")
//   effective PPI              = page DPI / s
//
// Rotation and flips do not change the scale, so they do not change the PPI.
// Nothing here claims interpolation adds detail: an image below the threshold
// gets a warning, never a "sharpened" upscale.

import { resolveImageDrawBoxFromTransform, type ImageCropTransform } from "./image-crop";

export type PrintQualitySettings = {
  /** Below this a placed photo is reported as likely to print blurry. */
  minImagePpi?: number;
  /** At or above this a placed photo is excellent for this product. */
  recommendedImagePpi?: number;
  /** Refuse checkout below the minimum (only for products that require it). */
  blockLowResolution?: boolean;
};

export type PrintQualityThresholds = { minimum: number; recommended: number; block: boolean };

/** Defaults for photographic stationery: 300 PPI excellent, under 200 likely blurry. */
export const DEFAULT_PRINT_QUALITY: PrintQualityThresholds = { minimum: 200, recommended: 300, block: false };

const positive = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

export function printQualityThresholds(settings: PrintQualitySettings | null | undefined): PrintQualityThresholds {
  const minimum = positive(settings?.minImagePpi) ?? DEFAULT_PRINT_QUALITY.minimum;
  const recommended = Math.max(minimum, positive(settings?.recommendedImagePpi) ?? Math.max(minimum, DEFAULT_PRINT_QUALITY.recommended));
  return { minimum, recommended, block: settings?.blockLowResolution === true };
}

/** Only the keys this module understands, or undefined when none are set (old documents stay unchanged). */
export function normalizePrintQualitySettings(input: unknown): PrintQualitySettings | undefined {
  if (!input || typeof input !== "object") return undefined;
  const source = input as Record<string, unknown>;
  const out: PrintQualitySettings = {};
  const minimum = positive(source.minImagePpi);
  const recommended = positive(source.recommendedImagePpi);
  if (minimum) out.minImagePpi = Math.min(minimum, 1200);
  if (recommended) out.recommendedImagePpi = Math.min(recommended, 1200);
  if (source.blockLowResolution === true) out.blockLowResolution = true;
  return Object.keys(out).length ? out : undefined;
}

export type EffectivePpiInput = {
  frameWidth: number;
  frameHeight: number;
  transform?: ImageCropTransform | null;
  fitMode?: "cover" | "contain" | string | null;
  sourceWidth: number;
  sourceHeight: number;
  /** The DPI the page declares (used when no physical size is known). */
  dpi: number;
  /**
   * Document pixels per printed inch MEASURED from the page's pixels and its
   * physical size (measuredPxPerInch). This, not the declared DPI, decides how
   * large the photo prints — they differ when a template's canvas does not
   * match its card size.
   */
  pxPerInch?: { x: number; y: number } | null;
};

/** Pixels per printed inch on each axis, from a page's pixel and physical size; null when unknown. */
export function measuredPxPerInch(page: { widthPx?: number; heightPx?: number; widthIn?: number; heightIn?: number } | null | undefined): { x: number; y: number } | null {
  const widthPx = positive(page?.widthPx);
  const heightPx = positive(page?.heightPx);
  const widthIn = positive(page?.widthIn);
  const heightIn = positive(page?.heightIn);
  return widthPx && heightPx && widthIn && heightIn ? { x: widthPx / widthIn, y: heightPx / heightIn } : null;
}

/**
 * Source pixels per printed inch for a placed photo, or null when it cannot be
 * known. With a measured density the lower of the two axes is returned (a
 * stretched page prints one axis coarser than the other).
 */
export function effectiveImagePpi(input: EffectivePpiInput): number | null {
  const sourceWidth = positive(input.sourceWidth);
  const sourceHeight = positive(input.sourceHeight);
  const densityX = positive(input.pxPerInch?.x) ?? positive(input.dpi);
  const densityY = positive(input.pxPerInch?.y) ?? positive(input.dpi);
  if (!sourceWidth || !sourceHeight || !densityX || !densityY || !(input.frameWidth > 0) || !(input.frameHeight > 0)) return null;
  const draw = resolveImageDrawBoxFromTransform(
    { frameX: 0, frameY: 0, frameWidth: input.frameWidth, frameHeight: input.frameHeight },
    input.transform || null,
  );
  const scaleX = draw.width / sourceWidth;
  const scaleY = draw.height / sourceHeight;
  const scale = input.fitMode === "contain" ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
  if (!(scale > 0)) return null;
  return Math.min(densityX, densityY) / scale;
}

export type ImageQualityLevel = "excellent" | "acceptable" | "low";

export function imageQualityLevel(ppi: number, thresholds: PrintQualityThresholds): ImageQualityLevel {
  if (ppi >= thresholds.recommended) return "excellent";
  if (ppi >= thresholds.minimum) return "acceptable";
  return "low";
}

/** Plain-language customer message for a photo below the product's minimum. */
export const LOW_RESOLUTION_CUSTOMER_MESSAGE =
  "Your photo may look blurry when printed at this size. For a sharper result, upload a higher resolution image or make the photo smaller.";

type SizedLayer = {
  assetId?: string;
  src?: string;
  sourceWidth?: number;
  sourceHeight?: number;
  assetReference?: { width?: number; height?: number } | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * The pixel size of the photo a layer (or grid slot) shows, from the data the
 * design already carries: the customer asset reference, the studio's storage
 * provenance, slot metadata, or the document's asset list.
 */
export function layerSourceDimensions(
  layer: SizedLayer,
  assets: Array<{ id: string; width?: number; height?: number }> = [],
  known: Record<string, { width: number; height: number }> = {},
): { width: number; height: number } | null {
  const pick = (width: unknown, height: unknown) => {
    const w = positive(width);
    const h = positive(height);
    return w && h ? { width: w, height: h } : null;
  };
  return (
    (layer.src ? known[layer.src] : undefined) ||
    (layer.assetId ? known[layer.assetId] : undefined) ||
    pick(layer.assetReference?.width, layer.assetReference?.height) ||
    pick(layer.sourceWidth, layer.sourceHeight) ||
    pick(layer.metadata?.width, layer.metadata?.height) ||
    (() => {
      const asset = layer.assetId ? assets.find((entry) => entry.id === layer.assetId) : undefined;
      return asset ? pick(asset.width, asset.height) : null;
    })()
  );
}
