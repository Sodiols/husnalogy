// Live print-quality check for the customer's own photos.
//
// Runs on every edit of the page being customized: it reads the same image
// transform the canvas and the production renderer draw (resolveLayerImage →
// image-crop.ts) and the photo's own pixel size, so the warning appears and
// disappears exactly as the customer resizes, zooms or crops the photo.
// Template artwork chosen by the designer is not reported — the customer
// cannot change it.

import { resolveLayerImage } from "./customizer-utils";
import {
  effectiveImagePpi,
  layerSourceDimensions,
  measuredPxPerInch,
  printQualityThresholds,
  type PrintQualitySettings,
} from "@/lib/customizer/v2/print-resolution";

export type LowResolutionPhoto = { layerId: string; name: string; ppi: number };

const positive = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

export function lowResolutionPhotos(input: {
  layers: any[];
  fields: any[];
  values: Record<string, any>;
  dpi: number | undefined;
  /** The card's physical size and canvas, for the measured print density. */
  physical?: { canvasWidthPx?: number; canvasHeightPx?: number; cardWidthIn?: number; cardHeightIn?: number } | null;
  settings?: { printQuality?: PrintQualitySettings } | null;
}): LowResolutionPhoto[] {
  const thresholds = printQualityThresholds(input.settings?.printQuality);
  const dpi = positive(input.dpi) || 300;
  const pxPerInch = measuredPxPerInch({
    widthPx: input.physical?.canvasWidthPx,
    heightPx: input.physical?.canvasHeightPx,
    widthIn: input.physical?.cardWidthIn,
    heightIn: input.physical?.cardHeightIn,
  });
  const found: LowResolutionPhoto[] = [];
  for (const layer of input.layers || []) {
    if (!layer || (layer.type !== "image" && layer.type !== "frame") || layer.visible === false) continue;
    const field = (input.fields || []).find((entry: any) => entry?.id === layer.fieldId);
    const image = resolveLayerImage(layer, field, input.values || {});
    if (!image?.url) continue;
    // Only what the customer put there: a field photo, or a photo in a frame they added.
    const customerPhoto = image.source === "field" || (image.source === "layer" && layer.isUserLayer);
    if (!customerPhoto) continue;
    const asset: any = image.asset || {};
    const known = positive(asset.width) && positive(asset.height) && image.source === "field"
      ? { [image.url]: { width: positive(asset.width), height: positive(asset.height) } }
      : {};
    const dims = layerSourceDimensions({ ...asset, src: image.url }, [], known);
    if (!dims) continue;
    const ppi = effectiveImagePpi({
      frameWidth: positive(layer.width),
      frameHeight: positive(layer.height),
      transform: { zoom: image.zoom, offsetX: image.offsetX, offsetY: image.offsetY, ...(image.crop || {}) },
      fitMode: layer.fitMode,
      sourceWidth: dims.width,
      sourceHeight: dims.height,
      dpi,
      pxPerInch,
    });
    if (ppi !== null && ppi < thresholds.minimum) found.push({ layerId: layer.id, name: String(layer.name || field?.label || "Photo"), ppi });
  }
  return found;
}
