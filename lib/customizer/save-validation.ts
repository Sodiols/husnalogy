// Server-side validation for customization saves (spec §18, §21).
//
// Both POST /api/customizations and PATCH /api/customizations/[id] call this
// before persisting. It loads the trusted template (exact published version
// when available), validates the submitted values + editor state against the
// admin's permissions, and rewrites the persisted payload to contain ONLY the
// sanitized state — unauthorized changes are rejected with typed violations.

import { getTrustedTemplateForCustomization } from "@/lib/customizer/versions";
import { validateCustomerState, assertOwnedUploadPath, type ValidationViolation } from "@/lib/customizer/v2/validate";
import { collectCustomerAssetReferences, stripEphemeralAssetUrls } from "@/lib/customizer/v2/asset-references";
import { validatePrivateAssetOwnership } from "@/lib/customizer/server/private-assets";
import { resolveFlagsIntoTemplate } from "@/lib/customizer/v2/feature-flags.server";
import { isCustomizerFeatureEnabled } from "@/lib/customizer/v2/feature-flags";

export type SaveValidationResult =
  | { ok: true; body: Record<string, any>; warnings: ValidationViolation[] }
  | { ok: false; status: number; error: string; violations: ValidationViolation[] };

function extractEditorState(body: Record<string, any>) {
  if (body.editorState && typeof body.editorState === "object") return body.editorState;
  if (body.renderData?.editorState && typeof body.renderData.editorState === "object") return body.renderData.editorState;
  return null;
}

// Violations that indicate a forged/tampered request rather than harmless
// drift (e.g. a stale template). Any of these rejects the save outright.
const HARD_REJECT_CODES = new Set([
  "move-not-allowed",
  "resize-not-allowed",
  "rotate-not-allowed",
  "opacity-not-allowed",
  "layer-order-not-allowed",
  "interaction-disabled",
  "filters-not-allowed",
  "property-not-allowed",
  "invalid-qr-url",
  "rename-not-allowed",
  "visibility-not-allowed",
  "lock-not-allowed",
  "font-not-allowed",
  "font-size-not-allowed",
  "color-not-allowed",
  "alignment-not-allowed",
  "letter-spacing-not-allowed",
  "line-height-not-allowed",
  "vertical-alignment-not-allowed",
  "style-not-allowed",
  "zoom-not-allowed",
  "reposition-not-allowed",
  "flip-not-allowed",
  "image-rotate-not-allowed",
  "grid-replace-not-allowed",
  "grid-crop-not-allowed",
  "user-text-not-allowed",
  "user-element-not-allowed",
  "user-shape-not-allowed",
  "user-line-not-allowed",
  "user-frame-not-allowed",
  "user-grid-not-allowed",
  "user-qr-not-allowed",
  "user-background-not-allowed",
  "user-group-not-allowed",
  "user-layer-page-not-allowed",
  "customer-object-count-limit",
  "customer-object-limit",
  "font-not-allowed-by-template",
  "color-not-allowed-by-template",
  "filter-not-allowed-by-template",
  "user-element-not-allowed-by-template",
  "user-shape-not-allowed-by-template",
  "user-frame-not-allowed-by-template",
  "user-grid-not-allowed-by-template",
  "not-owned-upload",
  "feature-disabled",
]);

export async function validateCustomizationSave(
  userId: string,
  body: Record<string, any>,
  existing: { productId?: string; templateId?: string; templateVersion?: number } = {},
): Promise<SaveValidationResult> {
  const productId = body.productId || existing.productId || "";
  const templateId = body.templateId || existing.templateId || "";
  const templateVersion = Number(body.templateVersion || existing.templateVersion) || 0;

  const hasValues = body.values !== undefined;
  const editorState = extractEditorState(body);

  // Pure bookkeeping updates (status/cartItemId/orderId) skip design checks.
  if (!hasValues && !editorState) return { ok: true, body, warnings: [] };

  const trusted = await getTrustedTemplateForCustomization({ productId, templateId, templateVersion });
  if (!trusted) {
    // No template — nothing to validate against (legacy/deleted product).
    return { ok: true, body, warnings: [] };
  }

  const authoritativeTemplate = await resolveFlagsIntoTemplate(trusted.template, {
    productId,
    productType: trusted.template?.productType || trusted.template?.settings?.productType,
    actorId: userId,
  });
  if (!isCustomizerFeatureEnabled(authoritativeTemplate, "customizer_v2")) {
    return { ok: false, status: 403, error: "Personalization is not enabled for this product.", violations: [{ code: "feature-disabled", message: "Customizer V2 is disabled for this product." }] };
  }

  const result = validateCustomerState(authoritativeTemplate, {
    values: hasValues ? body.values : {},
    editorState,
  });
  if (!isCustomizerFeatureEnabled(authoritativeTemplate, "customizer_v2_grids")) {
    const hasGridChanges = Object.values(editorState?.layerOverrides || {}).some((override: any) => override?.gridSlots && Object.keys(override.gridSlots).length);
    if (hasGridChanges) result.violations.push({ code: "feature-disabled", message: "Photo grids are disabled for this product." });
  }
  const submittedUserLayers = Array.isArray(editorState?.userLayers) ? editorState.userLayers : [];
  const featureByLayerType: Record<string, any> = {
    shape: "customizer_v2_customer_shapes",
    frame: "customizer_v2_customer_frames",
    grid: "customizer_v2_customer_grids",
    qrCode: "customizer_v2_qr_codes",
    group: "customizer_v2_customer_grouping",
  };
  for (const layer of submittedUserLayers) {
    const flag = layer?.type === "shape" && layer?.shape === "line"
      ? "customizer_v2_customer_lines"
      : featureByLayerType[String(layer?.type || "")];
    if (flag && !isCustomizerFeatureEnabled(authoritativeTemplate, flag)) {
      result.violations.push({ code: "feature-disabled", message: `${String(layer.type)} customer objects are disabled for this product.` });
    }
  }

  // Uploaded storage paths must belong to the caller (spec §21, §33).
  const ownershipViolations: ValidationViolation[] = [];
  if (hasValues && body.values && typeof body.values === "object") {
    for (const [fieldId, value] of Object.entries(body.values as Record<string, any>)) {
      if (value && typeof value === "object" && typeof value.path === "string" && value.path) {
        if (!assertOwnedUploadPath(userId, value.path)) {
          ownershipViolations.push({
            code: "not-owned-upload",
            fieldId,
            message: "An uploaded photo does not belong to this account.",
          });
        }
      }
    }
  }
  for (const [layerId, override] of Object.entries((editorState as any)?.layerOverrides || {})) {
    for (const [slotId, slot] of Object.entries((override as any)?.gridSlots || {})) {
      const path = String((slot as any)?.path || "");
      const changesSource = Boolean((slot as any)?.src || (slot as any)?.assetId || (slot as any)?.path);
      const bucket = String((slot as any)?.bucket || "");
      if ((changesSource && (!path || bucket !== "customer-uploads")) || (path && !assertOwnedUploadPath(userId, path))) {
        ownershipViolations.push({
          code: "not-owned-upload",
          layerId,
          message: `The upload used by grid slot "${slotId}" does not belong to this account.`,
        });
      }
    }
  }

  const permanentValues = stripEphemeralAssetUrls(result.sanitizedValues, userId);
  const permanentEditorState = stripEphemeralAssetUrls(result.sanitizedEditorState, userId);
  try {
    await validatePrivateAssetOwnership({ values: permanentValues, editorState: permanentEditorState }, userId);
  } catch {
    ownershipViolations.push({
      code: "not-owned-upload",
      message: "An uploaded photo could not be verified for this account.",
    });
  }

  const allViolations = [...result.violations, ...ownershipViolations];
  const hardViolations = allViolations.filter((violation) => HARD_REJECT_CODES.has(violation.code));

  if (hardViolations.length) {
    console.warn(
      `[customizer] Rejected save for user ${userId}: ${hardViolations.map((v) => v.code).join(", ")}`,
    );
    return {
      ok: false,
      status: 422,
      error: "Some changes are not allowed on this design.",
      violations: hardViolations,
    };
  }

  // Persist only the sanitized state. Soft violations (unknown fields from a
  // stale template, over-long values already clamped) are dropped silently
  // but logged for observability.
  const nextBody: Record<string, any> = { ...body };
  if (hasValues) nextBody.values = permanentValues;
  if (editorState) {
    nextBody.editorState = permanentEditorState;
    if (nextBody.renderData && typeof nextBody.renderData === "object") {
      nextBody.renderData = stripEphemeralAssetUrls({
        ...nextBody.renderData,
        editorState: permanentEditorState,
        values: hasValues ? permanentValues : nextBody.renderData.values,
      }, userId);
    }
  }
  if (nextBody.uploadedFiles !== undefined) nextBody.uploadedFiles = stripEphemeralAssetUrls(nextBody.uploadedFiles, userId);
  nextBody.assetReferences = collectCustomerAssetReferences({
    values: nextBody.values,
    editorState: nextBody.editorState || nextBody.renderData?.editorState,
    uploadedFiles: nextBody.uploadedFiles,
    renderData: nextBody.renderData,
  }, userId);

  if (allViolations.length) {
    console.info(
      `[customizer] Sanitized save for user ${userId}: ${allViolations.map((v) => v.code).join(", ")}`,
    );
  }

  return { ok: true, body: nextBody, warnings: allViolations };
}
