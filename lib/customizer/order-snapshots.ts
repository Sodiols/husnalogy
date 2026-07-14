// Permanent order design snapshots (spec §22). Server-only.
//
// When an order is created, every customized item gets an immutable
// order_design_snapshots row containing the complete resolved design: the
// exact template version document, customer values, editor state, resolved
// layers, pricing, preflight results, and an integrity hash. Editing the
// product or template afterwards never changes the snapshot.

import { createHash } from "crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { customizationFromRow } from "@/lib/customizer/customizations";
import { getTrustedTemplateForCustomization } from "@/lib/customizer/versions";
import { templateToDocument, resolveCustomerDocument } from "@/lib/customizer/v2/document";
import { runPreflight } from "@/lib/customizer/v2/preflight";
import { calculateCustomizationPrice } from "@/lib/customizer/v2/pricing";
import { isCustomizerFeatureEnabled } from "@/lib/customizer/v2/feature-flags";
import { collectCustomerAssetReferences, stripEphemeralAssetUrls } from "@/lib/customizer/v2/asset-references";
import { resolvePrivateAssetsForDelivery } from "@/lib/customizer/server/private-assets";
import { getProducts } from "@/lib/products";
import { resolveFlagsIntoTemplate } from "@/lib/customizer/v2/feature-flags.server";

export function computeIntegrityHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

type OrderLike = {
  id: string;
  items?: Array<Record<string, any>>;
};

// Create snapshots for all customized items on a freshly created order.
// Returns the number of snapshots created. Individual item failures are
// logged and skipped so one bad customization never blocks the others.
export async function createOrderDesignSnapshots(order: OrderLike): Promise<number> {
  const items = (order.items || []).filter((item) => item.customizationId);
  if (!items.length) return 0;

  const supabase = createServiceRoleClient();
  const products = await getProducts().catch(() => []);
  let created = 0;

  for (const item of items) {
    try {
      const { data: row, error } = await supabase
        .from("product_customizations")
        .select("*")
        .eq("id", item.customizationId)
        .maybeSingle();
      if (error) throw error;
      if (!row) {
        console.error(`[customizer] Order ${order.id}: customization ${item.customizationId} not found; snapshot skipped.`);
        continue;
      }
      const customization = customizationFromRow(row);

      const trusted = await getTrustedTemplateForCustomization(customization);
      if (!trusted) {
        console.error(`[customizer] Order ${order.id}: no template for customization ${customization.id}; snapshot skipped.`);
        continue;
      }
      const template = trusted.template;

      const product = products.find((p: any) => p.id === (customization.productId || item.productId)) || null;
      const authoritativeTemplate = await resolveFlagsIntoTemplate(template, {
        productId: customization.productId || item.productId || "",
        productType: product?.productType || product?.departmentPath?.join("/") || product?.category || template?.settings?.productType,
        actorId: customization.userId,
      });
      const selectedOptions = customization.selectedOptions || item.selectedOptions || {};
      const quantity = Math.max(1, Number(item.quantity) || Number(selectedOptions.quantity) || 1);
      const pricing = product
        ? calculateCustomizationPrice(product, selectedOptions, quantity)
        : { basePrice: Number(item.price) || 0, optionSurcharges: [], optionsTotal: 0, unitPrice: Number(item.price) || 0, quantity, subtotal: (Number(item.price) || 0) * quantity, currency: item.currency || "BDT" };

      // Resolve the full document for deterministic rendering later.
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
        productId: customization.productId || item.productId || "",
        productTitle: item.productTitle || product?.title || "",
        productSku: product?.sku || "",
        productVariant: selectedOptions.size || "",
        quantity,
        selectedOptions,
        pricing,
        templateId: customization.templateId || template.id || "",
        templateVersion: customization.templateVersion || template.version || 1,
        templateSource: trusted.source,
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
        createdAt: new Date().toISOString(),
      };

      const integrityHash = computeIntegrityHash(snapshot);

      const { data: versionRow } = customization.templateId
        ? await supabase
            .from("customizer_template_versions")
            .select("id")
            .eq("template_id", customization.templateId)
            .eq("version", customization.templateVersion || 0)
            .maybeSingle()
        : { data: null };

      const { error: insertError } = await supabase.from("order_design_snapshots").insert({
        order_id: order.id,
        order_item_id: item.id || null,
        customization_id: customization.id,
        product_id: snapshot.productId || null,
        product_title: snapshot.productTitle,
        product_sku: snapshot.productSku,
        quantity,
        selected_options: selectedOptions,
        pricing,
        template_id: customization.templateId || null,
        template_version: snapshot.templateVersion,
        template_version_id: versionRow?.id || null,
        snapshot,
        preflight,
        preview_files: customization.previewImages || {},
        print_files: customization.printFiles || {},
        render_status: "pending",
        integrity_hash: integrityHash,
      });
      if (insertError) throw insertError;

      // Persist the preflight run for the audit trail.
      await supabase.from("customizer_preflight_results").insert({
        customization_id: customization.id,
        order_id: order.id,
        context: "order",
        ok: preflight.ok,
        blocking: preflight.blocking,
        issues: preflight.issues,
      });

      // Queue production rendering (spec §23). The protected worker endpoint
      // (or an admin retry) processes these; enqueue failures never block the
      // order.
      try {
        if (isCustomizerFeatureEnabled(authoritativeTemplate, "customizer_v2_server_rendering")) {
          const { enqueueRenderJob } = await import("@/lib/customizer/render-jobs");
          await enqueueRenderJob({ customizationId: customization.id, orderId: order.id, jobType: "print_png", priority: 10 });
          if (isCustomizerFeatureEnabled(authoritativeTemplate, "customizer_v2_print_pdf")) {
            await enqueueRenderJob({ customizationId: customization.id, orderId: order.id, jobType: "print_pdf", priority: 10 });
          }
          await supabase.from("order_design_snapshots").update({ render_status: "queued" }).eq("order_id", order.id).eq("customization_id", customization.id);
        }
      } catch (queueError) {
        console.error(`[customizer] Could not queue print renders for order ${order.id}:`, queueError);
      }

      created += 1;
    } catch (error) {
      console.error(`[customizer] Order ${order.id}: snapshot failed for item ${item.customizationId}:`, error);
    }
  }
  return created;
}

export type OrderDesignSnapshotSummary = {
  id: string;
  orderId: string;
  orderItemId: string | null;
  customizationId: string | null;
  productId: string;
  productTitle: string;
  quantity: number;
  selectedOptions: Record<string, unknown>;
  pricing: Record<string, unknown>;
  templateVersion: number;
  renderStatus: string;
  preflight: Record<string, unknown>;
  previewFiles: Record<string, unknown>;
  printFiles: Record<string, unknown>;
  integrityHash: string;
  createdAt: string;
};

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
