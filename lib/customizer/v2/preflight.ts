// Print preflight validation (spec §9, §24). Pure and dependency-injected so
// the same checks run in the browser (live warnings) and on the server
// (blocking validation before cart/order/render).

import type {
  CustomizerDocument,
  CustomizerLayer,
  PreflightIssue,
  PreflightResult,
  TextLayer,
} from "./types";
import { getFontByFamily } from "./fonts";
import { layoutText, fallbackMeasure, type MeasureFn } from "./text-layout";
import { getGridSlotRect, normalizeGridSlot, validateGridGeometry } from "./grids";
import { validateGroupRelationships } from "./groups";

export type PreflightOptions = {
  measure?: MeasureFn;
  // Known pixel dimensions for uploaded images, keyed by src/assetId. When an
  // image layer's source is missing here, the resolution check is skipped.
  imageDimensions?: Record<string, { width: number; height: number }>;
  // Minimum acceptable effective DPI for placed photos before warning/error.
  minImageDpi?: number;
  blockOnLowResolution?: boolean;
  mockupAvailable?: boolean;
  productionRenderFailed?: boolean;
};

const MIN_READABLE_FONT_PX_AT_300DPI = 16; // ≈ 4pt at 300dpi

function isImageLike(layer: CustomizerLayer): layer is Extract<CustomizerLayer, { type: "image" | "frame" }> {
  return layer.type === "image" || layer.type === "frame";
}

export function runPreflight(document: CustomizerDocument, options: PreflightOptions = {}): PreflightResult {
  const issues: PreflightIssue[] = [];
  const measure = options.measure || fallbackMeasure;
  const minImageDpi = options.minImageDpi ?? 150;

  const enabledPages = document.pages.filter((page) => page.enabled);
  if (!enabledPages.length) {
    issues.push({ code: "no-pages", severity: "error", message: "The design has no enabled pages." });
  }

  for (const page of enabledPages) {
    if (!(page.widthPx > 0) || !(page.heightPx > 0)) {
      issues.push({ code: "invalid-page-size", severity: "error", pageId: page.id, message: `Page "${page.name}" has invalid dimensions.` });
    }
  }

  const pageById = new Map(enabledPages.map((page) => [page.id, page]));
  const fieldById = new Map(document.fields.map((field) => [field.id, field]));
  const assetIds = new Set(document.assets.map((asset) => asset.id));
  const supportedLayerTypes = new Set(["text", "image", "frame", "shape", "grid", "group", "element", "background"]);

  for (const layer of document.layers) {
    if (!supportedLayerTypes.has(layer.type)) {
      issues.push({ code: "UNSUPPORTED_LAYER", severity: "error", layerId: (layer as any).id, message: `Unsupported layer type "${(layer as any).type}".` });
      continue;
    }
    if (layer.hidden) continue;
    const page = pageById.get(layer.pageId);
    if (!page) continue;

    const left = layer.x - layer.width / 2;
    const top = layer.y - layer.height / 2;
    const right = layer.x + layer.width / 2;
    const bottom = layer.y + layer.height / 2;

    // Outside bleed limits (completely off the printable sheet) is an error.
    if (right < 0 || bottom < 0 || left > page.widthPx || top > page.heightPx) {
      issues.push({
        code: "outside-canvas",
        severity: "error",
        pageId: page.id,
        layerId: layer.id,
        message: `"${layer.name}" sits completely outside the page and will not print.`,
      });
      continue;
    }

    // Important (customer-editable or required) objects outside the safe area.
    const safe = page.safeArea;
    const outsideSafe =
      left < safe.left || top < safe.top || right > page.widthPx - safe.right || bottom > page.heightPx - safe.bottom;
    if (outsideSafe && (layer.customerEditable || (layer.type === "text" && layer.required))) {
      issues.push({
        code: "outside-safe-area",
        severity: "warning",
        pageId: page.id,
        layerId: layer.id,
        message: `"${layer.name}" extends beyond the safe area and may be trimmed.`,
      });
    }

    if (layer.type === "text") {
      checkTextLayer(layer, document, measure, issues, fieldById);
    }

    if (isImageLike(layer)) {
      const field = layer.fieldId ? fieldById.get(layer.fieldId) : null;
      const hasImage = Boolean(layer.src || layer.placeholderImage);
      if (field?.required && !layer.src) {
        issues.push({
          code: "missing-required-image",
          severity: "error",
          pageId: page.id,
          layerId: layer.id,
          fieldId: field.id,
          message: `A photo is required for "${field.label}".`,
        });
      } else if (!hasImage && layer.customerEditable) {
        issues.push({
          code: "empty-photo-frame",
          severity: "warning",
          pageId: page.id,
          layerId: layer.id,
          message: `Photo frame "${layer.name}" is empty.`,
        });
      }

      // Effective print resolution: the placed image must carry enough pixels
      // for the frame's physical print size (frame px are at page DPI).
      const dims =
        options.imageDimensions?.[layer.src] ||
        (layer.assetId ? options.imageDimensions?.[layer.assetId] : undefined);
      if (dims && dims.width > 0 && layer.src) {
        const zoom = layer.transform.zoom || 1;
        // Pixels of source image shown per canvas px (cover fit, zoomed).
        const coverScale = Math.max(layer.width / dims.width, layer.height / dims.height) * zoom;
        const effectiveDpi = page.dpi / Math.max(coverScale, 1e-6) / 1; // src px per output inch
        // coverScale = canvas px per source px; source px per inch = dpi / coverScale
        if (effectiveDpi < minImageDpi) {
          issues.push({
            code: "low-resolution-image",
            severity: options.blockOnLowResolution ? "error" : "warning",
            pageId: page.id,
            layerId: layer.id,
            message: `"${layer.name}" photo prints at about ${Math.round(effectiveDpi)} DPI (minimum ${minImageDpi}). It may look blurry.`,
          });
        }
      }
    }

    if (layer.type === "grid") {
      const geometryIssues = validateGridGeometry(layer);
      for (const geometryIssue of geometryIssues) {
        issues.push({
          code: geometryIssue.code,
          severity: "error",
          pageId: page.id,
          layerId: layer.id,
          message: `Photo grid "${layer.name}" contains an invalid slot (${geometryIssue.slotId}).`,
        });
      }
      layer.slots.forEach((rawSlot, index) => {
        const slot = normalizeGridSlot(rawSlot, index);
        if (!slot.src && !slot.assetId) {
          issues.push({
            code: slot.required ? "REQUIRED_GRID_SLOT_EMPTY" : "empty-grid-slot",
            severity: slot.required ? "error" : "warning",
            pageId: page.id,
            layerId: layer.id,
            message: `Photo grid "${layer.name}" slot ${index + 1} is empty.`,
          });
        }
        if (slot.assetId && !assetIds.has(slot.assetId) && !slot.src) {
          issues.push({
            code: "ASSET_NOT_FOUND",
            severity: "error",
            pageId: page.id,
            layerId: layer.id,
            message: `Photo grid "${layer.name}" slot ${index + 1} points at a missing asset.`,
          });
        }
        const metadataWidth = Number(slot.metadata?.width) || 0;
        const metadataHeight = Number(slot.metadata?.height) || 0;
        const dimensions = options.imageDimensions?.[slot.src] || (slot.assetId ? options.imageDimensions?.[slot.assetId] : undefined) ||
          (metadataWidth > 0 && metadataHeight > 0 ? { width: metadataWidth, height: metadataHeight } : undefined);
        if (dimensions && slot.src) {
          const rect = getGridSlotRect(layer, slot);
          const coverScale = Math.max(rect.width / dimensions.width, rect.height / dimensions.height) * (slot.transform.zoom || 1);
          const effectiveDpi = page.dpi / Math.max(coverScale, 1e-6);
          if (effectiveDpi < minImageDpi) {
            issues.push({
              code: "LOW_RESOLUTION_GRID_IMAGE",
              severity: options.blockOnLowResolution ? "error" : "warning",
              pageId: page.id,
              layerId: layer.id,
              message: `Photo grid "${layer.name}" slot ${index + 1} prints at about ${Math.round(effectiveDpi)} DPI.`,
            });
          }
        }
      });
    }

    if (layer.type === "element" && !layer.src && !layer.assetId) {
      issues.push({
        code: "broken-asset",
        severity: "error",
        pageId: page.id,
        layerId: layer.id,
        message: `Element "${layer.name}" points at a missing asset.`,
      });
    }
  }

  for (const groupIssue of validateGroupRelationships(document.layers)) {
    issues.push({
      code: groupIssue.code,
      severity: "error",
      layerId: groupIssue.groupId,
      message: "The document contains an invalid nested group relationship.",
    });
  }

  if (options.mockupAvailable === false) {
    issues.push({ code: "MOCKUP_UNAVAILABLE", severity: "warning", message: "The product mockup preview is temporarily unavailable; production artwork is unaffected." });
  }
  if (options.productionRenderFailed) {
    issues.push({ code: "PRODUCTION_RENDER_FAILED", severity: "error", message: "The production artwork could not be rendered." });
  }

  // Required text fields with no connected content.
  for (const field of document.fields) {
    if (!field.required || field.type === "image" || field.type === "file") continue;
    const connected = document.layers.find(
      (layer) => layer.type === "text" && layer.fieldId === field.id && !layer.hidden,
    ) as TextLayer | undefined;
    if (connected && !String(connected.text || "").trim()) {
      issues.push({
        code: "missing-required-text",
        severity: "error",
        fieldId: field.id,
        layerId: connected.id,
        message: `"${field.label}" is required.`,
      });
    }
  }

  const blocking = issues.some((issue) => issue.severity === "error");
  return {
    ok: !blocking,
    blocking,
    issues,
    checkedAt: new Date().toISOString(),
  };
}

function checkTextLayer(
  layer: TextLayer,
  document: CustomizerDocument,
  measure: MeasureFn,
  issues: PreflightIssue[],
  fieldById: Map<string, { id: string; label: string; required: boolean }>,
): void {
  const style = layer.textStyle;
  const font = getFontByFamily(style.fontFamily);

  if (!font) {
    issues.push({
      code: "unknown-font",
      severity: "error",
      layerId: layer.id,
      pageId: layer.pageId,
      message: `Font "${style.fontFamily}" is not in the Husnalogy font registry.`,
    });
  } else if (!font.serverRenderable) {
    issues.push({
      code: "font-substitution",
      severity: "warning",
      layerId: layer.id,
      pageId: layer.pageId,
      message: `Font "${style.fontFamily}" is a system font and may render differently in print files.`,
    });
  }

  const page = document.pages.find((p) => p.id === layer.pageId);
  const dpi = page?.dpi || document.canvas.dpi || 300;
  const minReadable = (MIN_READABLE_FONT_PX_AT_300DPI * dpi) / 300;

  const text = String(layer.text || "");
  if (!text.trim()) return;

  const layout = layoutText(
    {
      text,
      width: layer.width,
      height: layer.height,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      minFontSize: style.minFontSize,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      letterSpacing: style.letterSpacing,
      lineHeight: style.lineHeight,
      textAlign: style.textAlign,
      verticalAlign: style.verticalAlign,
      uppercase: style.uppercase,
      multiline: style.multiline,
      fitMode: style.fitMode,
      maxLines: layer.maxLines || undefined,
    },
    measure,
  );

  if (layout.overflowWidth || layout.overflowHeight || layout.truncatedLines) {
    issues.push({
      code: "text-overflow",
      severity: "warning",
      layerId: layer.id,
      pageId: layer.pageId,
      fieldId: layer.fieldId || undefined,
      message: `Text in "${fieldById.get(layer.fieldId)?.label || layer.name}" does not fit its box and may be cut off.`,
    });
  }

  if (layout.fontSize < minReadable) {
    issues.push({
      code: "text-too-small",
      severity: "warning",
      layerId: layer.id,
      pageId: layer.pageId,
      message: `Text in "${layer.name}" is below the minimum readable print size.`,
    });
  }

  if (layer.maxChars > 0 && Array.from(text).length > layer.maxChars) {
    issues.push({
      code: "text-too-long",
      severity: "error",
      layerId: layer.id,
      pageId: layer.pageId,
      fieldId: layer.fieldId || undefined,
      message: `"${layer.name}" exceeds the ${layer.maxChars} character limit.`,
    });
  }
}
