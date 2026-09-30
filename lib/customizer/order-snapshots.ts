// Permanent order design snapshots (spec §22). Server-only.
//
// Every customized order line gets an immutable order_design_snapshots row
// containing the complete resolved design: the exact template version
// document, customer values, editor state, resolved layers, TRUSTED pricing,
// preflight results, and an integrity hash. Editing the product or template
// afterwards never changes the snapshot (a database trigger enforces that).
//
// Two phases, deliberately separate:
//
//   buildOrderDesignSnapshot  — BEFORE the checkout transaction. Pure with
//                               respect to the database (reads only). Its
//                               output is written by create_checkout_order in
//                               the same transaction as the order itself, so
//                               an order can never exist without its
//                               snapshots.
//   queueOrderProduction      — AFTER the order has committed. Enqueues the
//                               print renders and writes audit rows. Every
//                               step is idempotent (render jobs dedupe on
//                               their input hash) and a failure is recorded on
//                               the snapshot for the Admin retry path — it
//                               can never undo or duplicate the order.

import { createHash } from "crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { customizationFromRow } from "@/lib/customizer/customizations";
import { templateToDocument, resolveCustomerDocument } from "@/lib/customizer/v2/document";
import { runPreflight } from "@/lib/customizer/v2/preflight";
import { isCustomizerFeatureEnabled } from "@/lib/customizer/v2/feature-flags";
import { collectCustomerAssetReferences, stripEphemeralAssetUrls } from "@/lib/customizer/v2/asset-references";
import { resolvePrivateAssetsForDelivery } from "@/lib/customizer/server/private-assets";
import { resolveFlagsIntoTemplate } from "@/lib/customizer/v2/feature-flags.server";
import { getTrustedTemplateForCustomization } from "@/lib/customizer/versions";
import { logEvent } from "@/lib/observability/logger";
import type { DesignSnapshotPayload } from "@/lib/orders/checkout";

export function computeIntegrityHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Build the immutable snapshot for one customized order line.
 *
 * `product`, `template`, `pricing`, `selectedOptions` and `quantity` must all
 * be server-trusted values (the checkout pipeline resolves them); nothing
 * here is taken from the request.
 */
export async function buildOrderDesignSnapshot(input: {
  row: Record<string, any>;
  product: Record<string, any>;
  template: Record<string, any>;
  templateSource: "version" | "live";
  templateVersionId: string | null;
  selectedOptions: Record<string, unknown>;
  quantity: number;
  pricing: Record<string, unknown>;
}): Promise<DesignSnapshotPayload> {
  const supabase = createServiceRoleClient();
  const customization = customizationFromRow(input.row);
  const { template, product } = input;

  const { document } = templateToDocument(template);
  const editorState = stripEphemeralAssetUrls(customization.renderData?.editorState || null, customization.userId);
  const values = stripEphemeralAssetUrls(customization.values || {}, customization.userId);
  const uploadedFiles = stripEphemeralAssetUrls(customization.uploadedFiles || {}, customization.userId);
  const [renderValues, renderEditorState] = await Promise.all([
    resolvePrivateAssetsForDelivery(values, { productionWorker: true }, "original", supabase),
    resolvePrivateAssetsForDelivery(editorState, { productionWorker: true }, "original", supabase),
  ]);
  const resolvedForPreflight = resolveCustomerDocument(document, renderValues, renderEditorState);
  const resolved = stripEphemeralAssetUrls(resolvedForPreflight, customization.userId);
  const preflight = runPreflight(resolvedForPreflight);
  const assetReferences = collectCustomerAssetReferences({ values, editorState, uploadedFiles, document: resolved }, customization.userId);

  const snapshot = {
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

/**
 * Post-commit production work for a freshly finalized order. Safe to call
 * more than once for the same order: render jobs are deduplicated by input
 * hash and the status updates are idempotent.
 */
export async function queueOrderProduction(orderId: string, customizationIds: string[]): Promise<void> {
  if (!customizationIds.length) return;
  const supabase = createServiceRoleClient();

  const { data: snapshots, error } = await supabase
    .from("order_design_snapshots")
    .select("customization_id, product_id, preflight")
    .eq("order_id", orderId)
    .in("customization_id", customizationIds);
  if (error) throw error;

  for (const snapshot of snapshots || []) {
    const customizationId = String(snapshot.customization_id);
    const preflight: any = snapshot.preflight || {};

    const { error: auditError } = await supabase.from("customizer_preflight_results").insert({
      customization_id: customizationId,
      order_id: orderId,
      context: "order",
      ok: Boolean(preflight.ok),
      blocking: Boolean(preflight.blocking),
      issues: Array.isArray(preflight.issues) ? preflight.issues : [],
    });
    if (auditError) logEvent("warn", "order.preflight_audit_failed", { orderId, customizationId, error: auditError });

    try {
      const { data: row } = await supabase.from("product_customizations").select("*").eq("id", customizationId).maybeSingle();
      if (!row) throw new Error("customization-not-found");
      const customization = customizationFromRow(row);
      const trusted = await getTrustedTemplateForCustomization(customization);
      if (!trusted) throw new Error("template-version-unavailable");
      const authoritativeTemplate = await resolveFlagsIntoTemplate(trusted.template, {
        productId: customization.productId,
        productType: trusted.template?.settings?.productType,
        actorId: customization.userId,
      });
      if (!isCustomizerFeatureEnabled(authoritativeTemplate, "customizer_v2_server_rendering")) continue;

      const { enqueueRenderJob } = await import("@/lib/customizer/render-jobs");
      await enqueueRenderJob({ customizationId, orderId, jobType: "print_png", priority: 10 });
      if (isCustomizerFeatureEnabled(authoritativeTemplate, "customizer_v2_print_pdf")) {
        await enqueueRenderJob({ customizationId, orderId, jobType: "print_pdf", priority: 10 });
      }
      const { error: queuedError } = await supabase
        .from("order_design_snapshots")
        .update({ render_status: "queued" })
        .eq("order_id", orderId)
        .eq("customization_id", customizationId)
        .eq("render_status", "pending");
      if (queuedError) logEvent("error", "order.render_status_sync_failed", { orderId, customizationId, error: queuedError });
    } catch (queueError) {
      logEvent("error", "order.render_enqueue_failed", { orderId, customizationId, error: queueError });
      const { error: failedStatusError } = await supabase
        .from("order_design_snapshots")
        .update({
          render_status: "failed",
          preflight: {
            ...preflight,
            renderQueueError: {
              code: "RENDER_ENQUEUE_FAILED",
              message: queueError instanceof Error ? queueError.message : String(queueError),
              at: new Date().toISOString(),
            },
          },
        })
        .eq("order_id", orderId)
        .eq("customization_id", customizationId);
      if (failedStatusError) logEvent("error", "order.render_status_sync_failed", { orderId, customizationId, error: failedStatusError });
    }
  }
}

export async function getOrderDesignSnapshots(orderId: string, includeDocument = false) {
  const supabase = createServiceRoleClient();
  const columns = includeDocument
    ? "*"
    : "id, order_id, order_item_id, customization_id, product_id, product_title, quantity, selected_options, pricing, template_version, render_status, preflight, preview_files, print_files, integrity_hash, created_at";
  const { data, error } = await supabase
    .from("order_design_snapshots")
    .select(columns)
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    orderId: row.order_id,
    orderItemId: row.order_item_id,
    customizationId: row.customization_id,
    productId: row.product_id || "",
    productTitle: row.product_title || "",
    quantity: Number(row.quantity) || 1,
    selectedOptions: row.selected_options || {},
    pricing: row.pricing || {},
    templateVersion: Number(row.template_version) || 1,
    renderStatus: row.render_status || "pending",
    preflight: row.preflight || {},
    previewFiles: row.preview_files || {},
    printFiles: row.print_files || {},
    integrityHash: row.integrity_hash || "",
    createdAt: row.created_at,
    ...(includeDocument ? { snapshot: row.snapshot || {} } : {}),
  }));
}
