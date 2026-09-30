// Permanent order design snapshots (spec §22). Server-only.
//
// Every customized order line gets an immutable order_design_snapshots row
// containing the complete resolved design: the exact template version
// document, customer values, editor state, resolved layers, TRUSTED pricing,
// preflight results, and an integrity hash. Editing the product or template
// afterwards never changes the snapshot (a database trigger enforces that).
//
//   buildOrderDesignSnapshot — BEFORE the checkout transaction (pins bytes).
//                              create_checkout_order writes it, linked to its
//                              order item by `line_number`, together with a
//                              durable production task (outbox).
//   runProductionTask        — executed by the production task processor
//                              (lib/outbox/supabase-tasks.ts) for each task,
//                              right after checkout and again by the scheduled
//                              worker until it succeeds. Idempotent: render
//                              jobs dedupe on their input hash.

import { createServiceRoleClient } from "@/lib/supabase/server";
import { customizationFromRow } from "@/lib/customizer/customizations";
import { stripEphemeralAssetUrls } from "@/lib/customizer/v2/asset-references";
import { resolvePrivateAssetsForDelivery } from "@/lib/customizer/server/private-assets";
import { composeOrderDesignSnapshot, computeIntegrityHash, type SnapshotInput } from "@/lib/customizer/snapshot-compose";
import type { DesignSnapshotPayload } from "@/lib/orders/checkout";
import { makeProductionInput, readProductionSnapshot } from "@/lib/customizer/production-input";
import { pinProductionInput, productionStorage } from "@/lib/customizer/server/production-assets";

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
  if (!input.orderId) throw new Error("Production snapshot requires its reserved order identity.");
  const [renderValues, renderEditorState, renderTemplate] = await Promise.all([
    resolvePrivateAssetsForDelivery(values, { productionWorker: true }, "original", supabase),
    resolvePrivateAssetsForDelivery(editorState, { productionWorker: true }, "original", supabase),
    resolvePrivateAssetsForDelivery(input.template, { productionWorker: true }, "original", supabase),
  ]);
  const payload = composeOrderDesignSnapshot(input, { renderValues, renderEditorState });
  payload.snapshot.production = await pinProductionInput(input.orderId, makeProductionInput(renderTemplate, renderValues, renderEditorState), productionStorage(supabase));
  payload.integrity_hash = computeIntegrityHash(payload.snapshot);
  readProductionSnapshot({ ...payload, order_id: input.orderId, snapshot_schema_version: 1, production_mode: (payload.snapshot.production as any).mode });
  return payload;
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
export async function runProductionTask(task: ProductionTaskRow, supabase = createServiceRoleClient()): Promise<{ jobs: string[] }> {
  const { data: snapshot, error: snapshotError } = await supabase
    .from("order_design_snapshots")
    .select("*")
    .eq("id", task.snapshot_id)
    .maybeSingle();
  if (snapshotError) throw snapshotError;
  if (!snapshot || snapshot.order_id !== task.order_id || snapshot.order_item_id !== task.order_item_id) throw new Error("snapshot-task-linkage-invalid");
  const input = readProductionSnapshot(snapshot);

  if (input.mode === "manual") {
    const { error } = await supabase.from("order_design_snapshots").update({ render_status: "manual_required" }).eq("id", snapshot.id).in("render_status", ["pending", "failed"]);
    if (error) throw error;
    return { jobs: [] };
  }

  const { enqueueRenderJobFromSnapshot } = await import("@/lib/customizer/render-jobs");
  const jobs: string[] = [];
  for (const jobType of input.requiredJobTypes) jobs.push((await enqueueRenderJobFromSnapshot(snapshot, jobType, supabase)).job.id);
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
    : "id, order_id, order_item_id, customization_id, product_id, product_title, quantity, selected_options, pricing, template_version, snapshot_schema_version, production_mode, render_status, preflight, preview_files, print_files, integrity_hash, created_at";
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
    snapshotSchemaVersion: row.snapshot_schema_version,
    productionMode: row.production_mode,
    preflight: row.preflight || {},
    previewFiles: row.preview_files || {},
    printFiles: row.print_files || {},
    integrityHash: row.integrity_hash || "",
    createdAt: row.created_at,
    ...(includeDocument ? { snapshot: row.snapshot || {} } : {}),
  }));
}
