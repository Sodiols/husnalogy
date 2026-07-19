// Server-side customization validation (spec §18, §21).
//
// Never trust the browser-submitted document: every save / add-to-cart /
// order / render call re-validates the submitted customer state against the
// trusted template loaded from the database. Unauthorized changes are
// rejected with typed violations, and a sanitized editor state (only the
// permitted changes) is returned for persistence.

import { z } from "zod";
import { getLayerPermissions } from "@/app/components/customizer/customizer-utils";
import { CUSTOMIZER_APPROVED_FONTS } from "@/lib/customizer";
import { listFonts } from "./fonts";
import { isValidQRValue, normalizeQRCodeStyle } from "./qr";
import { normalizeImageFilters } from "./image-filters";

/* ------------------------------------------------------------- zod schemas */

const finite = z.number().finite();

export const customerAssetReferenceSchema = z
  .object({
    version: z.literal(1).optional(),
    assetId: z.string().max(160),
    ownerId: z.string().max(160),
    bucket: z.literal("customer-uploads"),
    storagePath: z.string().max(600),
    editorStoragePath: z.string().max(600).optional(),
    thumbnailStoragePath: z.string().max(600).optional(),
    originalFileName: z.string().max(300),
    mimeType: z.string().max(120),
    fileSize: finite.min(0),
    width: finite.min(0),
    height: finite.min(0),
    checksum: z.string().max(160).optional(),
    createdAt: z.string().max(80),
  })
  .strict();

export const transformOverrideSchema = z
  .object({
    x: finite.optional(),
    y: finite.optional(),
    width: finite.positive().max(50000).optional(),
    height: finite.positive().max(50000).optional(),
    rotation: finite.min(-360).max(360).optional(),
    opacity: finite.min(0).max(1).optional(),
    zIndex: finite.int().min(-100000).max(100000).optional(),
  })
  .strict();

export const textStyleOverrideSchema = z
  .object({
    fontFamily: z.string().max(80).optional(),
    fontSize: finite.positive().max(2000).optional(),
    fontWeight: z.string().max(8).optional(),
    fontStyle: z.enum(["normal", "italic"]).optional(),
    color: z
      .string()
      .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)
      .optional(),
    letterSpacing: finite.min(-50).max(200).optional(),
    lineHeight: finite.min(0.5).max(4).optional(),
    textAlign: z.enum(["left", "center", "right"]).optional(),
    verticalAlign: z.enum(["top", "middle", "bottom"]).optional(),
  })
  .strict();

export const imageTransformOverrideSchema = z
  .object({
    zoom: finite.min(0.05).max(20).optional(),
    offsetX: finite.min(-50000).max(50000).optional(),
    offsetY: finite.min(-50000).max(50000).optional(),
    rotation: finite.min(-360).max(360).optional(),
    flipX: z.boolean().optional(),
    flipY: z.boolean().optional(),
    fitMode: z.enum(["cover", "contain"]).optional(),
    cropX: finite.optional(),
    cropY: finite.optional(),
    cropWidth: finite.min(0).optional(),
    cropHeight: finite.min(0).optional(),
  })
  .strict();

export const imageFiltersSchema = z.object({
  brightness: finite.min(0).max(2).optional(),
  contrast: finite.min(0).max(2).optional(),
  saturation: finite.min(0).max(2).optional(),
  grayscale: finite.min(0).max(1).optional(),
  sepia: finite.min(0).max(1).optional(),
  tintColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  tintAmount: finite.min(0).max(1).optional(),
}).strict();

const layerPropertiesSchema = z.record(
  z.string().max(80),
  z.union([z.string().max(2048), z.number().finite(), z.boolean(), z.null()]),
).refine((value) => Object.keys(value).length <= 20, "Too many layer properties.");

export const layerOverrideSchema = z
  .object({
    textStyle: textStyleOverrideSchema.optional(),
    transform: transformOverrideSchema.optional(),
    imageTransform: imageTransformOverrideSchema.optional(),
    imageFilters: imageFiltersSchema.optional(),
    properties: layerPropertiesSchema.optional(),
    name: z.string().max(120).optional(),
    hidden: z.boolean().optional(),
    customerLocked: z.boolean().optional(),
    gridSlots: z
      .record(
        z.string().max(120),
        z
          .object({
            assetId: z.string().max(160).optional(),
            src: z.string().max(4000).optional(),
            bucket: z.string().max(120).optional(),
            path: z.string().max(600).optional(),
            originalPath: z.string().max(600).optional(),
            ownerId: z.string().max(160).optional(),
            assetReference: customerAssetReferenceSchema.optional(),
            metadata: z.record(z.string().max(80), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
            transform: imageTransformOverrideSchema.optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export const userLayerSchema = z
  .object({
    id: z.string().max(80),
    type: z.enum(["text", "element", "shape", "image", "frame", "grid", "group", "background", "qrCode"]).default("text"),
    page: z.string().max(80),
    text: z.string().max(500).optional(),
    assetId: z.string().max(120).optional(),
    src: z.string().max(4000).optional(),
    tintColor: z.string().max(32).optional(),
    x: finite,
    y: finite,
    width: finite.positive().max(50000),
    height: finite.positive().max(50000),
    rotation: finite.min(-360).max(360).optional(),
    zIndex: finite.optional(),
    flipX: z.boolean().optional(),
    flipY: z.boolean().optional(),
    opacity: finite.min(0).max(1).optional(),
    textStyle: z
      .object({
        fontFamily: z.string().max(80).optional(),
        fontSize: finite.positive().max(2000).optional(),
        fontWeight: z.string().max(8).optional(),
        fontStyle: z.string().max(12).optional(),
        color: z.string().max(32).optional(),
        letterSpacing: finite.min(-50).max(200).optional(),
        lineHeight: finite.min(0.5).max(4).optional(),
        textAlign: z.string().max(12).optional(),
        verticalAlign: z.enum(["top", "middle", "bottom"]).optional(),
        uppercase: z.boolean().optional(),
        multiline: z.boolean().optional(),
      })
      .optional(),
  })
  .passthrough();

export const editorStateSchema = z.object({
  layerOverrides: z.record(z.string().max(120), layerOverrideSchema).default({}),
  userLayers: z.array(userLayerSchema).max(60).default([]),
});

export const imageValueSchema = z
  .object({
    bucket: z.string().max(120).optional(),
    path: z.string().max(600).optional(),
    url: z.string().max(4000).optional(),
    signedUrl: z.string().max(4000).optional(),
    assetId: z.string().max(160).optional(),
    ownerId: z.string().max(160).optional(),
    originalPath: z.string().max(600).optional(),
    thumbnailPath: z.string().max(600).optional(),
    assetReference: customerAssetReferenceSchema.optional(),
    name: z.string().max(300).optional(),
    zoom: finite.min(0.05).max(20).optional(),
    offsetX: finite.min(-50000).max(50000).optional(),
    offsetY: finite.min(-50000).max(50000).optional(),
    flipX: z.boolean().optional(),
    flipY: z.boolean().optional(),
    imageRotation: finite.min(-360).max(360).optional(),
    width: finite.optional(),
    height: finite.optional(),
  })
  .passthrough();

export const customizationSubmitSchema = z.object({
  customizationId: z.string().max(80).optional(),
  productId: z.string().max(120),
  templateId: z.string().max(80).optional(),
  templateVersion: z.coerce.number().int().positive().optional(),
  cartItemId: z.string().max(80).optional(),
  status: z.enum(["draft", "in_cart", "ordered", "archived"]).optional(),
  values: z.record(z.string().max(120), z.unknown()).default({}),
  selectedOptions: z.record(z.string().max(120), z.unknown()).default({}),
  editorState: editorStateSchema.optional(),
});

/* --------------------------------------------------------------- violation */

export type ValidationViolation = {
  code: string;
  layerId?: string;
  fieldId?: string;
  message: string;
};

export type CustomizationValidationResult = {
  ok: boolean;
  violations: ValidationViolation[];
  // Only the permitted subset of the submitted editor state.
  sanitizedEditorState: { layerOverrides: Record<string, any>; userLayers: any[] };
  sanitizedValues: Record<string, unknown>;
};

/* ----------------------------------------------------------- main validate */

// Fonts customers may select: the registry's customer set plus the legacy
// approved list (existing customer toolbars offer these — rejecting them
// would fail legitimate saves from older templates).
const CUSTOMER_FONT_FAMILIES = new Set([
  ...listFonts({ customerOnly: true }).map((f) => f.cssFamily),
  ...CUSTOMIZER_APPROVED_FONTS.map((f) => f.value),
]);

function pageAllowsText(template: Record<string, any>, pageId: string): boolean {
  const page = (template?.pages || []).find((p: any) => p.id === pageId);
  if (page && page.allowCustomerText !== undefined) return Boolean(page.allowCustomerText);
  return Boolean(template?.settings?.allowCustomerText);
}

function settingList(template: Record<string, any>, key: string): string[] {
  const value = template?.settings?.[key];
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function settingAllows(template: Record<string, any>, key: string, value: unknown): boolean {
  const allowed = settingList(template, key);
  if (!allowed.length) return true;
  const candidate = String(value || "").toLowerCase();
  return allowed.some((item) => item.toLowerCase() === candidate);
}

function constrainCustomerTransform(
  template: Record<string, any>,
  pageId: string,
  base: Record<string, any>,
  patch: Record<string, any>,
  violations: ValidationViolation[],
  layerId?: string,
): Record<string, any> {
  const limits = template?.settings?.customerObjectLimits;
  if (!limits || typeof limits !== "object" || !Object.keys(limits).length) return patch;
  const page = (template?.pages || []).find((entry: any) => entry.id === pageId) || {};
  const pageWidth = Number(page.widthPx || template?.canvasWidthPx) || 1500;
  const pageHeight = Number(page.heightPx || template?.canvasHeightPx) || 2100;
  const next = { ...patch };
  const minWidth = Math.max(1, Number(limits.minWidth) || 1);
  const maxWidth = Number(limits.maxWidth) > 0 ? Number(limits.maxWidth) : pageWidth;
  const minHeight = Math.max(1, Number(limits.minHeight) || 1);
  const maxHeight = Number(limits.maxHeight) > 0 ? Number(limits.maxHeight) : pageHeight;
  const minRotation = Number.isFinite(Number(limits.minRotation)) ? Number(limits.minRotation) : -360;
  const maxRotation = Number.isFinite(Number(limits.maxRotation)) ? Number(limits.maxRotation) : 360;
  const width = Math.min(maxWidth, Math.max(minWidth, Number(next.width ?? base.width) || minWidth));
  const height = Math.min(maxHeight, Math.max(minHeight, Number(next.height ?? base.height) || minHeight));
  const left = Math.max(0, Number(limits.insetLeft) || 0);
  const top = Math.max(0, Number(limits.insetTop) || 0);
  const right = Math.max(0, Number(limits.insetRight) || 0);
  const bottom = Math.max(0, Number(limits.insetBottom) || 0);
  const x = Math.min(Math.max(left + width / 2, Number(next.x ?? base.x) || 0), Math.max(left + width / 2, pageWidth - right - width / 2));
  const y = Math.min(Math.max(top + height / 2, Number(next.y ?? base.y) || 0), Math.max(top + height / 2, pageHeight - bottom - height / 2));
  const rotation = Math.min(maxRotation, Math.max(minRotation, Number(next.rotation ?? base.rotation) || 0));
  const changed =
    (next.width !== undefined && width !== Number(next.width)) ||
    (next.height !== undefined && height !== Number(next.height)) ||
    (next.x !== undefined && x !== Number(next.x)) ||
    (next.y !== undefined && y !== Number(next.y)) ||
    (next.rotation !== undefined && rotation !== Number(next.rotation));
  if (changed) violations.push({ code: "customer-object-limit", layerId, message: "A customer object exceeded this template's position, size, or rotation limits." });
  if (next.width !== undefined) next.width = width;
  if (next.height !== undefined) next.height = height;
  if (next.x !== undefined) next.x = x;
  if (next.y !== undefined) next.y = y;
  if (next.rotation !== undefined) next.rotation = rotation;
  return next;
}

// Validate a submitted editorState + values against the trusted template.
// Returns violations plus a sanitized state containing only permitted changes.
export function validateCustomerState(
  template: Record<string, any>,
  submitted: {
    values?: Record<string, unknown>;
    editorState?: { layerOverrides?: Record<string, any>; userLayers?: any[] } | null;
  },
): CustomizationValidationResult {
  const violations: ValidationViolation[] = [];
  const layers: any[] = Array.isArray(template?.layers) ? template.layers : [];
  const layerById = new Map(layers.map((layer) => [layer.id, layer]));
  const fields: any[] = Array.isArray(template?.fields) ? template.fields : [];
  const fieldById = new Map(fields.map((field) => [field.id, field]));
  const fieldLayerById = new Map(layers.filter((layer) => layer.fieldId).map((layer) => [layer.fieldId, layer]));
  const pageIds = new Set((template?.pages || []).filter((p: any) => p.enabled !== false).map((p: any) => p.id));

  /* ---- values ---- */
  const sanitizedValues: Record<string, unknown> = {};
  const submittedValues = submitted.values && typeof submitted.values === "object" ? submitted.values : {};
  for (const [fieldId, raw] of Object.entries(submittedValues)) {
    const field = fieldById.get(fieldId);
    if (!field) {
      violations.push({ code: "unknown-field", fieldId, message: `Field "${fieldId}" does not exist on this template.` });
      continue;
    }
    const connectedLayer: any = fieldLayerById.get(fieldId);
    if (connectedLayer?.customerInteractionDisabled || (connectedLayer && !connectedLayer.customerEditable)) {
      violations.push({ code: "interaction-disabled", fieldId, layerId: connectedLayer.id, message: `Editing "${connectedLayer.name || field.label}" is disabled.` });
      continue;
    }
    if (field.type === "image" || field.type === "file") {
      if (raw === null || raw === undefined || raw === "") {
        sanitizedValues[fieldId] = null;
        continue;
      }
      const parsed = imageValueSchema.safeParse(raw);
      if (!parsed.success) {
        violations.push({ code: "invalid-image-value", fieldId, message: `Photo value for "${field.label}" is invalid.` });
        continue;
      }
      sanitizedValues[fieldId] = parsed.data;
      continue;
    }
    if (field.type === "checkbox") {
      sanitizedValues[fieldId] = Boolean(raw);
      continue;
    }
    if (typeof raw === "object" && raw !== null) {
      violations.push({ code: "invalid-value", fieldId, message: `Value for "${field.label}" is invalid.` });
      continue;
    }
    let text = raw === null || raw === undefined ? "" : String(raw);
    const maxLength = Number(field.maxLength) > 0 ? Number(field.maxLength) : 2000;
    if (text.length > maxLength) {
      violations.push({
        code: "value-too-long",
        fieldId,
        message: `"${field.label}" must be ${maxLength} characters or fewer.`,
      });
      text = text.slice(0, maxLength);
    }
    if (field.type === "select" && Array.isArray(field.options) && field.options.length && text) {
      if (!field.options.map(String).includes(text)) {
        violations.push({ code: "invalid-option", fieldId, message: `"${text}" is not an option for "${field.label}".` });
        continue;
      }
    }
    sanitizedValues[fieldId] = text;
  }

  /* ---- layer overrides ---- */
  const sanitizedOverrides: Record<string, any> = {};
  const submittedOverrides =
    submitted.editorState?.layerOverrides && typeof submitted.editorState.layerOverrides === "object"
      ? submitted.editorState.layerOverrides
      : {};

  for (const [layerId, rawOverride] of Object.entries(submittedOverrides)) {
    const layer = layerById.get(layerId);
    if (!layer) {
      violations.push({ code: "unknown-layer", layerId, message: `Layer "${layerId}" does not exist on this template.` });
      continue;
    }
    const parsed = layerOverrideSchema.safeParse(rawOverride);
    if (!parsed.success) {
      violations.push({ code: "invalid-override", layerId, message: `Changes to "${layer.name || layerId}" are invalid.` });
      continue;
    }
    const override = parsed.data;
    const permissions = getLayerPermissions(layer);
    const clean: any = {};

    if (layer.customerInteractionDisabled) {
      violations.push({ code: "interaction-disabled", layerId, message: `Customer interaction with "${layer.name || layerId}" is disabled.` });
      continue;
    }

    if (override.transform) {
      const t: any = {};
      const deny = (code: string, what: string) =>
        violations.push({ code, layerId, message: `Moving/changing "${layer.name || layerId}" ${what} is not allowed.` });
      if (override.transform.x !== undefined || override.transform.y !== undefined) {
        if (permissions.move && !layer.positionLocked) {
          if (override.transform.x !== undefined) t.x = override.transform.x;
          if (override.transform.y !== undefined) t.y = override.transform.y;
        } else deny("move-not-allowed", "position");
      }
      if (override.transform.width !== undefined || override.transform.height !== undefined) {
        if (permissions.resize && !layer.positionLocked) {
          if (override.transform.width !== undefined) t.width = override.transform.width;
          if (override.transform.height !== undefined) t.height = override.transform.height;
        } else deny("resize-not-allowed", "size");
      }
      if (override.transform.rotation !== undefined) {
        if (permissions.rotate && !layer.positionLocked) t.rotation = override.transform.rotation;
        else deny("rotate-not-allowed", "rotation");
      }
      if (override.transform.opacity !== undefined) {
        if ((permissions as any).changeOpacity) t.opacity = override.transform.opacity;
        else deny("opacity-not-allowed", "opacity");
      }
      if (override.transform.zIndex !== undefined) {
        if (permissions.changeLayerOrder && !layer.positionLocked) t.zIndex = override.transform.zIndex;
        else deny("layer-order-not-allowed", "layer order");
      }
      if (Object.keys(t).length) clean.transform = constrainCustomerTransform(template, layer.page || template.defaultPage || "front", layer, t, violations, layerId);
    }

    if (override.textStyle) {
      if (layer.type !== "text") {
        violations.push({ code: "style-on-non-text", layerId, message: `"${layer.name || layerId}" is not a text layer.` });
      } else {
        const s: any = {};
        const style = override.textStyle;
        const gate = (key: keyof typeof style, allowed: boolean, code: string) => {
          if (style[key] === undefined) return;
          if (allowed) s[key] = style[key];
          else violations.push({ code, layerId, message: `Changing ${String(key)} on "${layer.name || layerId}" is not allowed.` });
        };
        gate("fontFamily", Boolean(permissions.changeFont), "font-not-allowed");
        gate("fontSize", Boolean(permissions.changeFontSize), "font-size-not-allowed");
        gate("color", Boolean(permissions.changeColor), "color-not-allowed");
        gate("textAlign", Boolean(permissions.changeAlignment), "alignment-not-allowed");
        gate("letterSpacing", Boolean(permissions.changeLetterSpacing), "letter-spacing-not-allowed");
        gate("lineHeight", Boolean((permissions as any).changeLineHeight ?? permissions.editStyle), "line-height-not-allowed");
        gate("verticalAlign", Boolean(permissions.changeAlignment || permissions.editStyle), "vertical-alignment-not-allowed");
        gate("fontWeight", Boolean(permissions.editStyle), "style-not-allowed");
        gate("fontStyle", Boolean(permissions.editStyle), "style-not-allowed");

        if (s.fontFamily !== undefined && !CUSTOMER_FONT_FAMILIES.has(String(s.fontFamily))) {
          violations.push({ code: "font-not-available", layerId, message: `Font "${s.fontFamily}" is not available.` });
          delete s.fontFamily;
        }
        if (s.fontFamily !== undefined && !settingAllows(template, "allowedCustomerFonts", s.fontFamily)) {
          violations.push({ code: "font-not-allowed-by-template", layerId, message: `Font "${s.fontFamily}" is not allowed for this design.` });
          delete s.fontFamily;
        }
        if (s.color !== undefined && !settingAllows(template, "allowedCustomerColors", s.color)) {
          violations.push({ code: "color-not-allowed-by-template", layerId, message: `Colour "${s.color}" is not allowed for this design.` });
          delete s.color;
        }
        if (Object.keys(s).length) clean.textStyle = s;
      }
    }

    if (override.imageTransform) {
      if (layer.type !== "image" && layer.type !== "frame") {
        violations.push({ code: "crop-on-non-image", layerId, message: `"${layer.name || layerId}" is not a photo layer.` });
      } else {
        const t: any = {};
        const it = override.imageTransform;
        const cropAllowed = Boolean((permissions as any).cropImage ?? (permissions.zoomImage || permissions.repositionImage));
        if (it.zoom !== undefined) {
          if (permissions.zoomImage || cropAllowed) t.zoom = it.zoom;
          else violations.push({ code: "zoom-not-allowed", layerId, message: `Zooming "${layer.name || layerId}" is not allowed.` });
        }
        if (it.offsetX !== undefined || it.offsetY !== undefined) {
          if (permissions.repositionImage || cropAllowed) {
            if (it.offsetX !== undefined) t.offsetX = it.offsetX;
            if (it.offsetY !== undefined) t.offsetY = it.offsetY;
          } else violations.push({ code: "reposition-not-allowed", layerId, message: `Repositioning "${layer.name || layerId}" is not allowed.` });
        }
        if (it.flipX !== undefined || it.flipY !== undefined) {
          if ((permissions as any).flipImage) {
            if (it.flipX !== undefined) t.flipX = it.flipX;
            if (it.flipY !== undefined) t.flipY = it.flipY;
          } else violations.push({ code: "flip-not-allowed", layerId, message: `Flipping "${layer.name || layerId}" is not allowed.` });
        }
        if (it.rotation !== undefined) {
          if (cropAllowed) t.rotation = it.rotation;
          else violations.push({ code: "image-rotate-not-allowed", layerId, message: `Rotating the photo in "${layer.name || layerId}" is not allowed.` });
        }
        if (it.fitMode !== undefined && cropAllowed) t.fitMode = it.fitMode;
        if (Object.keys(t).length) clean.imageTransform = t;
      }
    }

    if (override.imageFilters) {
      if ((layer.type === "image" || layer.type === "frame") && permissions.applyImageFilters) {
        const allowedFilters = settingList(template, "allowedCustomerImageFilters");
        const filtered = Object.fromEntries(Object.entries(override.imageFilters).filter(([key]) => !allowedFilters.length || allowedFilters.includes(key) || (allowedFilters.includes("tint") && (key === "tintColor" || key === "tintAmount"))));
        if (Object.keys(filtered).length !== Object.keys(override.imageFilters).length) violations.push({ code: "filter-not-allowed-by-template", layerId, message: "An image filter is not allowed for this design." });
        clean.imageFilters = normalizeImageFilters(filtered);
      }
      else violations.push({ code: "filters-not-allowed", layerId, message: `Image filters are not allowed on "${layer.name || layerId}".` });
    }

    if (override.properties) {
      const properties: Record<string, unknown> = {};
      const shapeKeys = new Set(["fill", "stroke", "strokeWidth", "borderRadius", "lineStyle", "lineCap", "lineStartCap", "lineEndCap"]);
      const qrKeys = new Set(["value", "foregroundColor", "backgroundColor", "margin", "errorCorrection", "moduleStyle"]);
      const gridKeys = new Set(["gap", "padding", "cornerRadius", "borderColor", "borderWidth", "backgroundColor"]);
      const frameKeys = new Set(["borderColor", "borderWidth", "backgroundColor"]);
      for (const [key, value] of Object.entries(override.properties)) {
        const allowed = layer.type === "shape"
          ? (shapeKeys.has(key) && (key === "fill" ? permissions.changeFill : permissions.changeBorder || permissions.editStyle))
          : layer.type === "qrCode"
            ? (qrKeys.has(key) && (key === "value" ? permissions.editQRCodeValue : permissions.editQRCodeStyle))
            : layer.type === "grid"
              ? (gridKeys.has(key) && permissions.editGridLayout)
              : layer.type === "frame"
                ? (frameKeys.has(key) && permissions.changeBorder)
              : false;
        if (allowed) properties[key] = value;
        else violations.push({ code: "property-not-allowed", layerId, message: `Changing ${key} on "${layer.name || layerId}" is not allowed.` });
      }
      if (layer.type === "qrCode" && properties.value !== undefined && !isValidQRValue(properties.value)) {
        violations.push({ code: "invalid-qr-url", layerId, message: "The QR code destination is invalid." });
        delete properties.value;
      }
      if (layer.type === "qrCode") Object.assign(properties, normalizeQRCodeStyle({ ...layer, ...properties }));
      if (Object.keys(properties).length) clean.properties = properties;
    }

    if (override.name !== undefined) {
      if (permissions.editContent) clean.name = override.name;
      else violations.push({ code: "rename-not-allowed", layerId, message: `Renaming "${layer.name || layerId}" is not allowed.` });
    }
    if (override.hidden !== undefined) {
      if (permissions.hide) clean.hidden = override.hidden;
      else violations.push({ code: "visibility-not-allowed", layerId, message: `Changing visibility for "${layer.name || layerId}" is not allowed.` });
    }
    if (override.customerLocked !== undefined) {
      if (permissions.lock) clean.customerLocked = override.customerLocked;
      else violations.push({ code: "lock-not-allowed", layerId, message: `Locking "${layer.name || layerId}" is not allowed.` });
    }

    if (override.gridSlots) {
      if (layer.type !== "grid") {
        violations.push({ code: "grid-on-non-grid", layerId, message: `"${layer.name || layerId}" is not a photo grid.` });
      } else {
        const slots = new Map((Array.isArray(layer.slots) ? layer.slots : []).map((slot: any) => [slot.id, slot]));
        const cleanSlots: Record<string, any> = {};
        for (const [slotId, patch] of Object.entries(override.gridSlots)) {
          const slot: any = slots.get(slotId);
          if (!slot) {
            violations.push({ code: "unknown-grid-slot", layerId, message: `Grid slot "${slotId}" does not exist.` });
            continue;
          }
          const slotPermissions = { ...permissions, ...(slot.permissions || {}) };
          const cleanSlot: any = {};
          if (patch.assetId !== undefined || patch.src !== undefined || patch.path !== undefined) {
            if (slotPermissions.replaceImage) {
              if (patch.assetId !== undefined) cleanSlot.assetId = patch.assetId;
              if (patch.src !== undefined) cleanSlot.src = patch.src;
              if (patch.bucket !== undefined) cleanSlot.bucket = patch.bucket;
              if (patch.path !== undefined) cleanSlot.path = patch.path;
              if (patch.originalPath !== undefined) cleanSlot.originalPath = patch.originalPath;
              if (patch.ownerId !== undefined) cleanSlot.ownerId = patch.ownerId;
              if (patch.assetReference !== undefined) cleanSlot.assetReference = patch.assetReference;
              if (patch.metadata !== undefined) cleanSlot.metadata = patch.metadata;
            } else {
              violations.push({ code: "grid-replace-not-allowed", layerId, message: `Replacing a photo in "${layer.name || layerId}" is not allowed.` });
            }
          }
          if (patch.transform) {
            const cropAllowed = Boolean(slotPermissions.cropImage || slotPermissions.zoomImage || slotPermissions.repositionImage);
            if (cropAllowed) cleanSlot.transform = patch.transform;
            else violations.push({ code: "grid-crop-not-allowed", layerId, message: `Cropping a photo in "${layer.name || layerId}" is not allowed.` });
          }
          if (Object.keys(cleanSlot).length) cleanSlots[slotId] = cleanSlot;
        }
        if (Object.keys(cleanSlots).length) clean.gridSlots = cleanSlots;
      }
    }

    if (Object.keys(clean).length) sanitizedOverrides[layerId] = clean;
  }

  /* ---- user layers ---- */
  const sanitizedUserLayers: any[] = [];
  const customerObjectsByPage = new Map<string, number>();
  const allowedCustomerPages = settingList(template, "allowedCustomerPages");
  const maxCustomerObjectsPerPage = Math.max(0, Math.round(Number(template?.settings?.maxCustomerObjectsPerPage) || 0));
  const submittedUserLayers = Array.isArray(submitted.editorState?.userLayers) ? submitted.editorState!.userLayers : [];
  for (const raw of submittedUserLayers) {
    const parsed = userLayerSchema.safeParse(raw);
    if (!parsed.success) {
      violations.push({ code: "invalid-user-layer", message: "A customer-added layer is invalid." });
      continue;
    }
    const layer = parsed.data;
    if (!pageIds.has(layer.page)) {
      violations.push({ code: "user-layer-bad-page", message: "A customer-added layer points at a missing page." });
      continue;
    }
    if (allowedCustomerPages.length && !allowedCustomerPages.includes(layer.page)) {
      violations.push({ code: "user-layer-page-not-allowed", message: "Customer-added objects are not allowed on this page." });
      continue;
    }
    if (layer.type !== "group" && maxCustomerObjectsPerPage > 0) {
      const count = customerObjectsByPage.get(layer.page) || 0;
      if (count >= maxCustomerObjectsPerPage) {
        violations.push({ code: "customer-object-count-limit", message: `This page allows at most ${maxCustomerObjectsPerPage} customer objects.` });
        continue;
      }
    }
    if (layer.type === "text" && !pageAllowsText(template, layer.page)) {
      violations.push({
        code: "user-text-not-allowed",
        message: "Adding text is not enabled on this page.",
      });
      continue;
    }
    if (layer.type === "element" && !template?.settings?.allowCustomerElements) {
      violations.push({ code: "user-element-not-allowed", message: "Adding elements is not enabled for this design." });
      continue;
    }
    if (layer.type === "element" && !settingAllows(template, "allowedCustomerElementIds", (layer as any).assetId)) {
      violations.push({ code: "user-element-not-allowed-by-template", message: "This decorative element is not allowed for this design." });
      continue;
    }
    if (layer.type === "shape") {
      const line = String((layer as any).shape) === "line";
      if (line ? !template?.settings?.allowCustomerLines : !template?.settings?.allowCustomerShapes) {
        violations.push({ code: line ? "user-line-not-allowed" : "user-shape-not-allowed", message: `Adding ${line ? "lines" : "shapes"} is not enabled for this design.` });
        continue;
      }
      if (!line && !settingAllows(template, "allowedCustomerShapes", (layer as any).shape)) {
        violations.push({ code: "user-shape-not-allowed-by-template", message: "This shape is not allowed for this design." });
        continue;
      }
    }
    if (layer.type === "frame" && !template?.settings?.allowCustomerFrames) {
      violations.push({ code: "user-frame-not-allowed", message: "Adding frames is not enabled for this design." });
      continue;
    }
    if (layer.type === "frame" && !settingAllows(template, "allowedCustomerFrameMasks", (layer as any).maskShape || (layer as any).mask?.kind)) {
      violations.push({ code: "user-frame-not-allowed-by-template", message: "This frame shape is not allowed for this design." });
      continue;
    }
    if (layer.type === "grid" && !template?.settings?.allowCustomerGrids) {
      violations.push({ code: "user-grid-not-allowed", message: "Adding photo grids is not enabled for this design." });
      continue;
    }
    if (layer.type === "grid" && !settingAllows(template, "allowedCustomerGridPresets", (layer as any).presetId)) {
      violations.push({ code: "user-grid-not-allowed-by-template", message: "This photo-grid layout is not allowed for this design." });
      continue;
    }
    if (layer.type === "qrCode") {
      if (!template?.settings?.allowCustomerQRCodes) {
        violations.push({ code: "user-qr-not-allowed", message: "Adding QR codes is not enabled for this design." });
        continue;
      }
      if (!isValidQRValue((layer as any).value)) {
        violations.push({ code: "invalid-qr-url", message: "The QR code destination is invalid." });
        continue;
      }
    }
    if (layer.type === "background" && !template?.settings?.allowCustomerBackground) {
      violations.push({ code: "user-background-not-allowed", message: "Changing the background is not enabled for this design." });
      continue;
    }
    if (layer.type === "group" && !template?.settings?.allowCustomerGrouping) {
      violations.push({ code: "user-group-not-allowed", message: "Grouping is not enabled for this design." });
      continue;
    }
    if (layer.type === "text" && layer.textStyle?.fontFamily && !CUSTOMER_FONT_FAMILIES.has(String(layer.textStyle.fontFamily))) {
      violations.push({ code: "font-not-available", message: `Font "${layer.textStyle.fontFamily}" is not available.` });
      layer.textStyle = { ...layer.textStyle, fontFamily: "Cormorant Garamond" };
    }
    if (layer.type === "text" && layer.textStyle?.fontFamily && !settingAllows(template, "allowedCustomerFonts", layer.textStyle.fontFamily)) {
      violations.push({ code: "font-not-allowed-by-template", message: `Font "${layer.textStyle.fontFamily}" is not allowed for this design.` });
      const fallback = settingList(template, "allowedCustomerFonts")[0] || "Cormorant Garamond";
      layer.textStyle = { ...layer.textStyle, fontFamily: fallback };
    }
    const colourValues = layer.type === "text"
      ? [layer.textStyle?.color]
      : layer.type === "shape"
        ? [String((layer as any).shape) === "line" ? undefined : (layer as any).fill, (layer as any).stroke]
        : layer.type === "qrCode"
          ? [(layer as any).foregroundColor, (layer as any).backgroundColor]
          : layer.type === "frame" || layer.type === "image"
            ? [(layer as any).borderColor, (layer as any).backgroundColor]
            : layer.type === "grid"
              ? [(layer as any).borderColor, (layer as any).backgroundColor]
          : layer.type === "background"
            ? [(layer as any).color]
            : layer.type === "element"
              ? [(layer as any).tintColor]
              : [];
    if (colourValues.some((colour) => colour && !settingAllows(template, "allowedCustomerColors", colour))) {
      violations.push({ code: "color-not-allowed-by-template", message: "A customer object uses a colour that is not allowed for this design." });
      continue;
    }
    const filters = (layer as any).filters;
    if (filters && typeof filters === "object") {
      const allowedFilters = settingList(template, "allowedCustomerImageFilters");
      const usedFilters = Object.entries(filters).filter(([key, value]) => {
        if (key === "brightness" || key === "contrast" || key === "saturation") return Number(value) !== 1;
        if (key === "grayscale" || key === "sepia" || key === "tintAmount") return Number(value) > 0;
        return key === "tintColor" && Number(filters.tintAmount) > 0;
      });
      if (allowedFilters.length && usedFilters.some(([key]) => !allowedFilters.includes(key) && !(allowedFilters.includes("tint") && (key === "tintColor" || key === "tintAmount")))) {
        violations.push({ code: "filter-not-allowed-by-template", message: "A customer object uses an image filter that is not allowed for this design." });
        continue;
      }
    }
    Object.assign(layer, constrainCustomerTransform(template, layer.page, layer, layer, violations, layer.id));
    if (layer.type !== "group" && maxCustomerObjectsPerPage > 0) customerObjectsByPage.set(layer.page, (customerObjectsByPage.get(layer.page) || 0) + 1);
    sanitizedUserLayers.push(layer);
  }

  return {
    ok: violations.length === 0,
    violations,
    sanitizedEditorState: { layerOverrides: sanitizedOverrides, userLayers: sanitizedUserLayers },
    sanitizedValues,
  };
}

// Storage ownership check: a customer-supplied storage path must live in the
// caller's own folder of the customer-uploads bucket.
export function assertOwnedUploadPath(userId: string, path: string): boolean {
  if (!userId || !path) return false;
  const clean = String(path).replace(/\\/g, "/");
  if (clean.includes("..")) return false;
  return clean.startsWith(`${userId}/`);
}
