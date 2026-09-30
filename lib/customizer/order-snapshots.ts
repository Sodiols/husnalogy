// Permanent order design snapshots (spec §22). Server-only.
//
// Every customized order line gets an immutable order_design_snapshots row
// containing the complete resolved design: the exact template version
// document, customer values, editor state, resolved layers, TRUSTED pricing,
// preflight results, and an integrity hash. Editing the product or template
// afterwards never changes the snapshot (a database trigger enforces that).
//
//   buildOrderDesignSnapshot — BEFORE the checkout transaction (reads only).
//                              create_checkout_order writes it, linked to its
//                              order item by `line_number`, together with a
//                              durable production task (outbox).
//   runProductionTask        — executed by the production task processor
//                              (lib/outbox/production-tasks.ts) for each task,
//                              right after checkout and again by the scheduled
//                              worker until it succeeds. Idempotent: render
//                              jobs dedupe on their input hash.

import { createServiceRoleClient } from "@/lib/supabase/server";
import { customizationFromRow } from "@/lib/customizer/customizations";
import { isCustomizerFeatureEnabled } from "@/lib/customizer/v2/feature-flags";
import { stripEphemeralAssetUrls } from "@/lib/customizer/v2/asset-references";
import { resolvePrivateAssetsForDelivery } from "@/lib/customizer/server/private-assets";
import { resolveFlagsIntoTemplate } from "@/lib/customizer/v2/feature-flags.server";
import { getTrustedTemplateForCustomization } from "@/lib/customizer/versions";
import { composeOrderDesignSnapshot, computeIntegrityHash, type SnapshotInput } from "@/lib/customizer/snapshot-compose";
import type { DesignSnapshotPayload } from "@/lib/orders/checkout";

export { computeIntegrityHash };

/**
 * Build the immutable snapshot for one customized order line. `lineNumber`,
 * `product`, `template`, `pricing`, `selectedOptions` and `quantity` must all
 * be server-trusted values resolved by the checkout pipeline.
 */
export async function buildOrderDesignSnapshot(input: SnapshotInput): Promise<DesignSnapshotPayload> {
  const supabase = createServiceRoleClient();
  const customization = customizationFromRow(input.row);
  const editorState = stripEphemeralAssetUrls(customization.renderData?.editorState || null, customization.userId);
  const values = stripEphemeralAssetUrls(customization.values || {}, customization.userId);
  const [renderValues, renderEditorState] = await Promise.all([
    resolvePrivateAssetsForDelivery(values, { productionWorker: true }, "original", supabase),
    resolvePrivateAssetsForDelivery(editorState, { productionWorker: true }, "original", supabase),
  ]);
  return composeOrderDesignSnapshot(input, { renderValues, renderEditorState });
}

export type ProductionTaskRow = {
  id: string;
  order_id: string;
  order_item_id: string | null;
  snapshot_id: string;
  customization_id: string | null;
  task_type: string;
  attempt_count: number;
  lock_token: string;
};

/**
 * Turn one durable production task into render jobs. Throws on failure so the
 * task processor records the error and retries with backoff. Safe to run more
 * than once for the same task: `enqueueRenderJob` returns the existing job for
 * the same input instead of creating a duplicate, and the snapshot status
 * update is conditional.
 */
export async function runProductionTask(task: ProductionTaskRow): Promise<{ jobs: string[] }> {
  const supabase = createServiceRoleClient();
  const { data: snapshot, error: snapshotError } = await supabase
    .from("order_design_snapshots")
    .select("id, order_id, customization_id, render_status, preflight")
    .eq("id", task.snapshot_id)
    .maybeSingle();
  if (snapshotError) throw snapshotError;
  if (!snapshot || !snapshot.customization_id) throw new Error("snapshot-not-found");

  const preflight: any = snapshot.preflight || {};
  // Audit row for the order's preflight (diagnostic; re-inserted on retry is harmless).
  await supabase.from("customizer_preflight_results").insert({
    customization_id: snapshot.customization_id,
    order_id: snapshot.order_id,
    context: "order",
    ok: Boolean(preflight.ok),
    blocking: Boolean(preflight.blocking),
    issues: Array.isArray(preflight.issues) ? preflight.issues : [],
  });

  const { data: row, error: rowError } = await supabase.from("product_customizations").select("*").eq("id", snapshot.customization_id).maybeSingle();
  if (rowError) throw rowError;
  if (!row) throw new Error("customization-not-found");
  const customization = customizationFromRow(row);
  const trusted = await getTrustedTemplateForCustomization(customization);
  if (!trusted) throw new Error("template-version-unavailable");
  const authoritativeTemplate = await resolveFlagsIntoTemplate(trusted.template, {
    productId: customization.productId,
    productType: trusted.template?.settings?.productType,
    actorId: customization.userId,
  });
  if (!isCustomizerFeatureEnabled(authoritativeTemplate, "customizer_v2_server_rendering")) {
    // Nothing to render automatically for this product; production is manual.
    return { jobs: [] };
  }

  const { enqueueRenderJob } = await import("@/lib/customizer/render-jobs");
  const jobs: string[] = [];
  const png = await enqueueRenderJob({ customizationId: snapshot.customization_id, orderId: snapshot.order_id, jobType: "print_png", priority: 10 });
  jobs.push(png.job.id);
  if (isCustomizerFeatureEnabled(authoritativeTemplate, "customizer_v2_print_pdf")) {
    const pdf = await enqueueRenderJob({ customizationId: snapshot.customization_id, orderId: snapshot.order_id, jobType: "print_pdf", priority: 10 });
    jobs.push(pdf.job.id);
  }
  const { error: queuedError } = await supabase
    .from("order_design_snapshots")
    .update({ render_status: "queued" })
    .eq("id", snapshot.id)
    .in("render_status", ["pending", "failed"]);
  if (queuedError) throw queuedError;
  return { jobs };
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
