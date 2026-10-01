/**
 * Checkout verification of one personalized design (server only).
 *
 * The checkout pipeline has already proven strict ownership, product identity,
 * orderable status and option identity from the stored row. This module
 * proves the rest of the design's identity and integrity:
 *
 *   * TEMPLATE IDENTITY — the design names a template that is THIS product's
 *     template, and a published version of it that was published for THIS
 *     product. A live/unpublished fallback is not orderable.
 *   * DESIGN VALIDITY — the stored state is re-validated with the same
 *     server-side permission, font, colour, feature-flag and upload-ownership
 *     rules the save API applies. This also covers rows written before
 *     customers lost direct write access to the table.
 *   * PRINTABILITY — blocking preflight problems stop the order.
 *   * PRODUCTION IDENTITY — the immutable snapshot is built from exactly this
 *     row, this template version and the trusted price of this line.
 */

import { customizationFromRow } from "@/lib/customizer/customizations";
import { getCustomizerTemplateByProductId } from "@/lib/customizer/store";
import { getTemplateVersion, templateFromVersionSnapshot } from "@/lib/customizer/versions";
import { validateCustomizationSave } from "@/lib/customizer/save-validation";
import { resolveCustomerDocument, templateToDocument } from "@/lib/customizer/v2/document";
import { runPreflight } from "@/lib/customizer/v2/preflight";
import { createServerMeasure } from "@/lib/customizer/v2/server/server-fonts";
import { buildOrderDesignSnapshot } from "@/lib/customizer/order-snapshots";
import { pricingBreakdown, type TrustedLinePrice } from "@/lib/orders/pricing-resolver";
import type { CustomizationVerification } from "@/lib/orders/checkout";
import { resolveFlagsIntoTemplate } from "@/lib/customizer/v2/feature-flags.server";
import type { ProductionAssetBudget } from "@/lib/customizer/production-limits";

export async function verifyCustomizationForCheckout(input: {
  orderId: string;
  row: Record<string, any>;
  product: Record<string, any>;
  customerId: string;
  line: TrustedLinePrice;
  lineNumber: number;
  /** Order-wide production asset budget (limits, deadline, stored paths). */
  budget?: ProductionAssetBudget;
}): Promise<CustomizationVerification> {
  const { row, product, customerId, line, lineNumber } = input;
  const customization = customizationFromRow(row);

  const templateId = String(row.template_id || "");
  const templateVersion = Number(row.template_version) || 0;
  if (!templateId || templateVersion < 1) {
    return { ok: false, code: "CUSTOMIZATION_TEMPLATE_INVALID", message: "This design is not linked to a published template. Reopen it and save again." };
  }

  const productTemplate = await getCustomizerTemplateByProductId(product.id);
  if (!productTemplate || String(productTemplate.id) !== templateId) {
    return { ok: false, code: "CUSTOMIZATION_TEMPLATE_MISMATCH", message: "This design was made for a different product template." };
  }

  const version = await getTemplateVersion(templateId, templateVersion);
  if (!version || version.productId !== product.id || version.templateId !== templateId) {
    return { ok: false, code: "CUSTOMIZATION_TEMPLATE_VERSION_INVALID", message: "This design's template version is no longer available. Please start a new design." };
  }
  const versionTemplate = templateFromVersionSnapshot(version);
  if (!versionTemplate) {
    return { ok: false, code: "CUSTOMIZATION_TEMPLATE_VERSION_INVALID", message: "This design's template version is no longer available. Please start a new design." };
  }
  const template = await resolveFlagsIntoTemplate(versionTemplate, { productId: product.id, productType: versionTemplate.settings?.productType, actorId: customerId });

  const editorState = customization.renderData?.editorState || null;
  const validation = await validateCustomizationSave(
    customerId,
    { values: customization.values || {}, editorState },
    { productId: product.id, templateId, templateVersion, editorState },
  );
  if (validation.ok === false) {
    return {
      ok: false,
      code: "CUSTOMIZATION_INVALID",
      message: validation.status === 409 ? validation.error : "Your design contains changes that are not allowed for this product. Reopen it and save again.",
    };
  }

  const { document } = templateToDocument(template);
  const resolved = resolveCustomerDocument(document, customization.values || {}, editorState);
  const preflight = runPreflight(resolved, { measure: createServerMeasure(), blockOnLowResolution: true });
  if (preflight.blocking) {
    const first = preflight.issues.find((issue) => issue.severity === "error");
    return { ok: false, code: "CUSTOMIZATION_PREFLIGHT_BLOCKED", message: first?.message || "Your design has a problem that must be fixed before checkout." };
  }

  const snapshot = await buildOrderDesignSnapshot({
    orderId: input.orderId,
    lineNumber,
    row,
    product,
    template,
    templateSource: "version",
    templateVersionId: version.id,
    selectedOptions: line.options,
    quantity: line.quantity,
    pricing: pricingBreakdown(line),
  }, input.budget);

  return {
    ok: true,
    snapshot,
    values: snapshot.snapshot.values as Record<string, unknown>,
    uploadedFiles: snapshot.snapshot.uploadedFiles as Record<string, unknown>,
    templateId,
    templateVersion,
  };
}
