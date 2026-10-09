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
import { layoutText, fallbackMeasure, type MeasureFn } from "./text-layout";
import { getGridSlotRect, normalizeGridSlot, validateGridGeometry } from "./grids";
import { validateGroupRelationships } from "./groups";
import { isValidQRValue, qrContrastRatio } from "./qr";
import { isCustomerFieldRequired } from "./field-binding";
import { LOW_RESOLUTION_CUSTOMER_MESSAGE, effectiveImagePpi, layerSourceDimensions, printQualityThresholds } from "./print-resolution";

export type PreflightOptions = {
  measure?: MeasureFn;
  // Known pixel dimensions for uploaded images, keyed by src/assetId. When an
  // image layer's source is missing here, the resolution check is skipped.
  imageDimensions?: Record<string, { width: number; height: number }>;
  // Minimum acceptable effective PPI for placed photos (default: the
  // product's settings.printQuality.minImagePpi, else 200).
  minImageDpi?: number;
  // The caller may block (checkout). Blocking also needs the product to
  // require it (settings.printQuality.blockLowResolution); otherwise warn.
  blockOnLowResolution?: boolean;
  mockupAvailable?: boolean;
  productionRenderFailed?: boolean;
  /**
   * Lower-cased Google Font family names from the trusted catalog. When
   * supplied, a family outside it is reported as `unknown-font` — this is how
   * a legacy non-Google font (e.g. an old "Georgia" template) surfaces to the
   * admin so it can be replaced before republishing (spec §23).
   *
   * Omitted during a catalog outage, where font identity simply is not
   * asserted rather than flagging every layer.
   */
  knownFontFamilies?: Set<string> | null;
};

const MIN_READABLE_FONT_PX_AT_300DPI = 16; // ≈ 4pt at 300dpi

function isImageLike(layer: CustomizerLayer): layer is Extract<CustomizerLayer, { type: "image" | "frame" }> {
  return layer.type === "image" || layer.type === "frame";
}

export function runPreflight(document: CustomizerDocument, options: PreflightOptions = {}): PreflightResult {
  const issues: PreflightIssue[] = [];
  const measure = options.measure || fallbackMeasure;
  // The product's thresholds (template settings.printQuality), else the
  // stationery defaults. A low-resolution photo blocks only where the caller
  // allows blocking (checkout) AND the product requires it.
  const printQuality = printQualityThresholds(document.settings?.printQuality);
  const minImageDpi = options.minImageDpi ?? printQuality.minimum;
  const blockLowResolution = Boolean(options.blockOnLowResolution) && printQuality.block;

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
  // A required field only blocks when the customer can actually fill it
  // (visible, bound to an editable layer on an enabled page) — the same rule
  // the customer form applies, so a hidden required field can never make an
  // order impossible to complete.
  const enabledPageIds = new Set<string>(enabledPages.map((page) => page.id));
  const effectivelyRequired = new Set<string>(
    document.fields
      .filter((field) => isCustomerFieldRequired(field, document.layers as any[], enabledPageIds))
      .map((field) => field.id),
  );
  const assetIds = new Set(document.assets.map((asset) => asset.id));
  const supportedLayerTypes = new Set(["text", "image", "frame", "shape", "grid", "group", "element", "background", "qrCode"]);

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
      checkTextLayer(layer, document, measure, issues, fieldById, options.knownFontFamilies);
    }

    if (isImageLike(layer)) {
      const field = layer.fieldId ? fieldById.get(layer.fieldId) : null;
      const hasImage = Boolean(layer.src || layer.placeholderImage);
      if (field && effectivelyRequired.has(field.id) && !layer.src) {
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

      // Effective print resolution from the same draw box the renderers use
      // (crop, zoom and fit included) — print-resolution.ts.
      const dims = layerSourceDimensions(layer as any, document.assets, options.imageDimensions);
      const effectivePpi = dims && layer.src
        ? effectiveImagePpi({ frameWidth: layer.width, frameHeight: layer.height, transform: layer.transform, fitMode: (layer as any).fitMode, sourceWidth: dims.width, sourceHeight: dims.height, dpi: page.dpi })
        : null;
      if (effectivePpi !== null && effectivePpi < minImageDpi) {
        issues.push({
          code: "low-resolution-image",
          severity: blockLowResolution ? "error" : "warning",
          pageId: page.id,
          layerId: layer.id,
          message: `${LOW_RESOLUTION_CUSTOMER_MESSAGE} ("${layer.name}" prints at about ${Math.round(effectivePpi)} PPI; ${minImageDpi} or more is recommended.)`,
        });
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
        const dimensions = layerSourceDimensions(slot as any, document.assets, options.imageDimensions);
        if (dimensions && slot.src) {
          const rect = getGridSlotRect(layer, slot);
          const effectivePpi = effectiveImagePpi({ frameWidth: rect.width, frameHeight: rect.height, transform: slot.transform, fitMode: (slot.transform as any)?.fitMode, sourceWidth: dimensions.width, sourceHeight: dimensions.height, dpi: page.dpi });
          if (effectivePpi !== null && effectivePpi < minImageDpi) {
            issues.push({
              code: "LOW_RESOLUTION_GRID_IMAGE",
              severity: blockLowResolution ? "error" : "warning",
              pageId: page.id,
              layerId: layer.id,
              message: `${LOW_RESOLUTION_CUSTOMER_MESSAGE} (Photo grid "${layer.name}" slot ${index + 1} prints at about ${Math.round(effectivePpi)} PPI.)`,
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

    if (layer.type === "qrCode") {
      const sizePx = Math.min(layer.width, layer.height);
      const physicalSize = sizePx / page.dpi;
      if (!isValidQRValue(layer.value)) {
        issues.push({ code: "INVALID_QR_URL", severity: "error", pageId: page.id, layerId: layer.id, message: `QR code "${layer.name}" needs a valid http, https, email, or telephone destination.` });
      }
      if (sizePx < 150 || physicalSize < 0.5) {
        issues.push({ code: "QR_TOO_SMALL", severity: "error", pageId: page.id, layerId: layer.id, message: `QR code "${layer.name}" is too small to print reliably.` });
      } else if (sizePx < 225 || physicalSize < 0.75) {
        issues.push({ code: "QR_CLOSE_TO_MINIMUM", severity: "warning", pageId: page.id, layerId: layer.id, message: `QR code "${layer.name}" is close to the minimum recommended print size.` });
      }
      if (Number(layer.margin) < 4) {
        issues.push({ code: "QR_QUIET_ZONE", severity: "error", pageId: page.id, layerId: layer.id, message: `QR code "${layer.name}" needs a quiet zone of at least four modules.` });
      }
      if (qrContrastRatio(layer.foregroundColor, layer.backgroundColor) < 4.5) {
        issues.push({ code: "QR_LOW_CONTRAST", severity: "error", pageId: page.id, layerId: layer.id, message: `QR code "${layer.name}" does not have enough foreground/background contrast.` });
      }
      if (layer.opacity < 0.65) {
        issues.push({ code: "QR_OPACITY_UNREADABLE", severity: "error", pageId: page.id, layerId: layer.id, message: `QR code "${layer.name}" is too transparent to scan reliably.` });
      } else if (layer.opacity < 0.9) {
        issues.push({ code: "QR_HIGH_TRANSPARENCY", severity: "warning", pageId: page.id, layerId: layer.id, message: `QR code "${layer.name}" may be harder to scan because of its transparency.` });
      }
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
    if (!effectivelyRequired.has(field.id) || field.type === "image" || field.type === "file") continue;
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
  knownFontFamilies?: Set<string> | null,
): void {
  const style = layer.textStyle;

  // A family outside the trusted Google Fonts catalog cannot be produced.
  // This is an error, not a substitution warning: production rendering
  // refuses it rather than silently drawing a different typeface (spec §18).
  if (knownFontFamilies && knownFontFamilies.size > 0) {
    const family = String(style.fontFamily || "").trim().toLowerCase();
    if (!family || !knownFontFamilies.has(family)) {
      issues.push({
        code: "unknown-font",
        severity: "error",
        layerId: layer.id,
        pageId: layer.pageId,
        message: `Font "${style.fontFamily}" is not an available Google Font. Choose a Google Font before publishing.`,
      });
    }
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
      severity: layer.required ? "error" : "warning",
      layerId: layer.id,
      pageId: layer.pageId,
      fieldId: layer.fieldId || undefined,
      message: `Text in "${fieldById.get(layer.fieldId)?.label || layer.name}" does not fit its box and may be cut off.`,
    });
  }

  if (layout.overflowWidth) {
    issues.push({
      code: "text-horizontal-overflow",
      severity: layer.required ? "error" : "warning",
      layerId: layer.id,
      pageId: layer.pageId,
      fieldId: layer.fieldId || undefined,
      message: `Text in "${layer.name}" is wider than its text box.`,
    });
  }

  if (layout.overflowHeight) {
    issues.push({
      code: "text-vertical-overflow",
      severity: layer.required ? "error" : "warning",
      layerId: layer.id,
      pageId: layer.pageId,
      fieldId: layer.fieldId || undefined,
      message: `Text in "${layer.name}" is taller than its text box.`,
    });
  }

  if (layout.unbreakableWord) {
    issues.push({
      code: "text-unbreakable-word",
      severity: "warning",
      layerId: layer.id,
      pageId: layer.pageId,
      fieldId: layer.fieldId || undefined,
      message: `A word in "${layer.name}" is wider than the available line and must be broken.`,
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
