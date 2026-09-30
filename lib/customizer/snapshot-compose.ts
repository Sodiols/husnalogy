/**
 * The pure part of building an order design snapshot (no I/O).
 *
 * `buildOrderDesignSnapshot` (order-snapshots.ts) resolves private assets and
 * then calls this; the database integration tests call this SAME function, so
 * what they exercise is the production snapshot shape — including the
 * mandatory `line_number` that links the snapshot to its order item.
 */

import { customizationFromRow } from "@/lib/customizer/customizations";
import { templateToDocument, resolveCustomerDocument } from "@/lib/customizer/v2/document";
import { runPreflight } from "@/lib/customizer/v2/preflight";
import { collectCustomerAssetReferences, stripEphemeralAssetUrls } from "@/lib/customizer/v2/asset-references";
import type { DesignSnapshotPayload } from "@/lib/orders/checkout";
import { makeProductionInput, productionIntegrityHash, SNAPSHOT_SCHEMA_VERSION } from "@/lib/customizer/production-input";

export function computeIntegrityHash(payload: unknown): string {
  return productionIntegrityHash(payload);
}

export type SnapshotInput = {
  orderId?: string;
  /** The trusted order line this design is bought on. Required. */
  lineNumber: number;
  row: Record<string, any>;
  product: Record<string, any>;
  template: Record<string, any>;
  templateSource: "version" | "live";
  templateVersionId: string;
  selectedOptions: Record<string, unknown>;
  quantity: number;
  pricing: Record<string, unknown>;
};

/**
 * `renderValues` / `renderEditorState` are the customer's values with private
 * uploads resolved to production (original) URLs, used only for preflight;
 * they are never stored (stored data keeps permanent references only).
 */
export function composeOrderDesignSnapshot(
  input: SnapshotInput,
  resolvedAssets: { renderValues?: Record<string, unknown>; renderEditorState?: unknown } = {},
): DesignSnapshotPayload {
  if (!Number.isInteger(input.lineNumber) || input.lineNumber < 1) {
    throw new Error("A design snapshot needs the order line number it belongs to.");
  }
  if (!input.templateVersionId) {
    throw new Error("A design snapshot needs the published template version it was made from.");
  }
  const customization = customizationFromRow(input.row);
  const { template, product } = input;

  const { document } = templateToDocument(template);
  const editorState = stripEphemeralAssetUrls(customization.renderData?.editorState || null, customization.userId);
  const values = stripEphemeralAssetUrls(customization.values || {}, customization.userId);
  const uploadedFiles = stripEphemeralAssetUrls(customization.uploadedFiles || {}, customization.userId);
  const resolvedForPreflight = resolveCustomerDocument(
    document,
    (resolvedAssets.renderValues as Record<string, unknown>) ?? values,
    (resolvedAssets.renderEditorState as any) ?? editorState,
  );
  const resolved = stripEphemeralAssetUrls(resolvedForPreflight, customization.userId);
  const preflight = runPreflight(resolvedForPreflight);
  const assetReferences = collectCustomerAssetReferences({ values, editorState, uploadedFiles, document: resolved }, customization.userId);

  const snapshot = {
    snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
    production: makeProductionInput(template, values, editorState),
    orderLineNumber: input.lineNumber,
    productId: product.id,
    productTitle: String(product.title || ""),
    productSlug: String(product.slug || ""),
    productSku: String(product.sku || product.slug || product.id),
    productVariant: String(input.selectedOptions.size || ""),
    quantity: input.quantity,
    selectedOptions: input.selectedOptions,
    pricing: input.pricing,
    customizationId: customization.id,
    customizationUpdatedAt: String(input.row.updated_at || ""),
    templateId: customization.templateId || template.id || "",
    templateVersion: customization.templateVersion || template.version || 1,
    templateVersionId: input.templateVersionId,
    templateSource: input.templateSource,
    document: resolved,
    values,
    editorState: editorState || { layerOverrides: {}, userLayers: [] },
    uploadedFiles,
    assetReferences,
    canvas: {
      widthPx: template.canvasWidthPx,
      heightPx: template.canvasHeightPx,
      widthIn: template.cardWidthIn,
      heightIn: template.cardHeightIn,
      dpi: template.dpi,
    },
    safeArea: template.safeArea || {},
    bleed: template.bleed || {},
    preflight,
  };

  return {
    line_number: input.lineNumber,
    customization_id: customization.id,
    product_id: product.id,
    product_title: snapshot.productTitle,
    product_sku: snapshot.productSku,
    quantity: input.quantity,
    selected_options: input.selectedOptions as DesignSnapshotPayload["selected_options"],
    pricing: input.pricing,
    template_id: snapshot.templateId,
    template_version: snapshot.templateVersion,
    template_version_id: input.templateVersionId,
    snapshot,
    preflight: preflight as unknown as Record<string, unknown>,
    preview_files: customization.previewImages || {},
    integrity_hash: computeIntegrityHash(snapshot),
  };
}
