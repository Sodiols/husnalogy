// Permanent order design snapshots (spec §22). Server-only.
//
// A customized order is only ever accepted when every customized item has a
// complete, immutable snapshot: the exact template version document, customer
// values, editor state, resolved layers, pricing, the authoritative preflight
// result and an integrity hash. Editing the product, the template or the
// customer's live draft afterwards never changes the snapshot.
//
// Creation is split into two phases so the order can be rejected *before* it
// exists:
//
//   1. prepareOrderDesignSnapshots() — loads, verifies ownership, resolves
//      assets, runs authoritative preflight and builds every payload. Throws a
//      typed OrderSnapshotError on the first item that cannot produce one.
//   2. finalizeOrderDesignSnapshots() — runs after the transactional insert
//      has committed: records the audit trail and queues production rendering.
//
// The insert itself happens inside the create_customized_order() database
// function so the order, its items and all snapshots commit together.

import { createServiceRoleClient } from "@/lib/supabase/server";
import { customizationFromRow } from "@/lib/customizer/customizations";
import { getTrustedTemplateForCustomization } from "@/lib/customizer/versions";
import { templateToDocument, resolveCustomerDocument } from "@/lib/customizer/v2/document";
import { runPreflight } from "@/lib/customizer/v2/preflight";
import type { PreflightResult } from "@/lib/customizer/v2/types";
import { createServerMeasure } from "@/lib/customizer/v2/server/server-fonts";
import { calculateCustomizationPrice } from "@/lib/customizer/v2/pricing";
import { isCustomizerFeatureEnabled } from "@/lib/customizer/v2/feature-flags";
import { collectCustomerAssetReferences, stripEphemeralAssetUrls } from "@/lib/customizer/v2/asset-references";
import { resolvePrivateAssetsForDelivery } from "@/lib/customizer/server/private-assets";
import { getProducts } from "@/lib/products";
import { resolveFlagsIntoTemplate } from "@/lib/customizer/v2/feature-flags.server";

import { computeIntegrityHash } from "@/lib/customizer/snapshot-hash";

// Re-exported so existing callers keep a single import site.
export { computeIntegrityHash, verifySnapshotIntegrity } from "@/lib/customizer/snapshot-hash";

// ---------------------------------------------------------------------------
// Typed failures
// ---------------------------------------------------------------------------

export type OrderSnapshotErrorCode =
  | "CUSTOMIZATION_NOT_FOUND"
  | "CUSTOMIZATION_OWNERSHIP_INVALID"
  | "TEMPLATE_VERSION_NOT_FOUND"
  | "PRIVATE_ASSET_UNAVAILABLE"
  | "PREFLIGHT_BLOCKED"
  | "SNAPSHOT_BUILD_FAILED"
  | "SNAPSHOT_INSERT_FAILED"
  | "ORDER_TRANSACTION_FAILED"
  | "RENDER_QUEUE_FAILED";

// Customer-facing text. Deliberately free of internal identifiers, storage
// paths, template ids and database messages — the technical detail is logged
// on the server only.
const CUSTOMER_MESSAGES: Record<OrderSnapshotErrorCode, string> = {
  CUSTOMIZATION_NOT_FOUND:
    "A personalized design could not be found. Please reopen it from your cart, save it again, and retry checkout.",
  CUSTOMIZATION_OWNERSHIP_INVALID:
    "A personalized design does not belong to this account. Please reopen the design from your own cart and save it again.",
  TEMPLATE_VERSION_NOT_FOUND:
    "A personalized design uses a template version that is no longer available. Please reopen the design and save it again.",
  PRIVATE_ASSET_UNAVAILABLE:
    "A photo used in a personalized design could not be opened. Please reopen the design, re-add the photo, and save it again.",
  PREFLIGHT_BLOCKED:
    "A personalized design has a problem that must be fixed before checkout. Please reopen the design to review the highlighted issues.",
  SNAPSHOT_BUILD_FAILED:
    "A personalized design could not be prepared for production. Please reopen it, save it again, and retry checkout.",
  SNAPSHOT_INSERT_FAILED:
    "Your personalized order could not be completed. Nothing was charged or created — please try again.",
  ORDER_TRANSACTION_FAILED:
    "Your personalized order could not be completed. Nothing was charged or created — please try again.",
  RENDER_QUEUE_FAILED:
    "Your order was received. Our team has been notified to prepare the production files.",
};

export class OrderSnapshotError extends Error {
  readonly code: OrderSnapshotErrorCode;
  readonly customerMessage: string;
  readonly customizationId: string;
  readonly detail: string;

  constructor(
    code: OrderSnapshotErrorCode,
    detail: string,
    options: { customizationId?: string; customerMessage?: string; cause?: unknown } = {},
  ) {
    super(`${code}: ${detail}`);
    this.name = "OrderSnapshotError";
    this.code = code;
    this.detail = detail;
    this.customizationId = options.customizationId || "";
    this.customerMessage = options.customerMessage || CUSTOMER_MESSAGES[code];
    if (options.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

export function isOrderSnapshotError(error: unknown): error is OrderSnapshotError {
  return error instanceof OrderSnapshotError;
}

// ---------------------------------------------------------------------------
// Prepared payloads
// ---------------------------------------------------------------------------

// The snake_case row create_customized_order() inserts, plus the metadata the
// post-commit finalize step needs. `itemRef` ties the snapshot to the order
// item the same request is inserting, so the database can resolve the real
// order_items.id — a client-supplied id is never trusted.
export type PreparedOrderSnapshot = {
  itemRef: string;
  customizationId: string;
  preflight: PreflightResult;
  serverRenderingEnabled: boolean;
  printPdfEnabled: boolean;
  row: {
    item_ref: string;
    customization_id: string;
    product_id: string | null;
    product_title: string;
    product_sku: string;
    quantity: number;
    selected_options: Record<string, unknown>;
    pricing: unknown;
    template_id: string | null;
    template_version: number;
    template_version_id: string | null;
    snapshot: Record<string, unknown>;
    preflight: PreflightResult;
    preview_files: Record<string, unknown>;
    print_files: Record<string, unknown>;
    render_status: string;
    integrity_hash: string;
  };
};

export type PrepareSnapshotsResult = {
  totalCustomizedItems: number;
  prepared: PreparedOrderSnapshot[];
  preflightResults: Array<{ customizationId: string; preflight: PreflightResult }>;
};

type OrderItemLike = Record<string, any>;

// Build (but do not insert) the immutable snapshot for every customized item.
// Throws OrderSnapshotError on the first item that cannot produce one so the
// caller can reject the order before it exists.
export async function prepareOrderDesignSnapshots(options: {
  items: OrderItemLike[];
  customerId?: string;
  itemRefFor?: (item: OrderItemLike, index: number) => string;
}): Promise<PrepareSnapshotsResult> {
  const indexed = options.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => Boolean(item.customizationId));

  if (!indexed.length) {
    return { totalCustomizedItems: 0, prepared: [], preflightResults: [] };
  }

  const supabase = createServiceRoleClient();
  const products = await getProducts().catch(() => []);
  const measure = createServerMeasure();
  const prepared: PreparedOrderSnapshot[] = [];
  const preflightResults: Array<{ customizationId: string; preflight: PreflightResult }> = [];

  for (const { item, index } of indexed) {
    const customizationId = String(item.customizationId);
    const itemRef = options.itemRefFor ? options.itemRefFor(item, index) : `item_${index}`;

    const { data: row, error } = await supabase
      .from("product_customizations")
      .select("*")
      .eq("id", customizationId)
      .maybeSingle();
    if (error) {
      throw new OrderSnapshotError("CUSTOMIZATION_NOT_FOUND", `Lookup failed: ${error.message}`, {
        customizationId,
        cause: error,
      });
    }
    if (!row) {
      throw new OrderSnapshotError("CUSTOMIZATION_NOT_FOUND", "No product_customizations row.", { customizationId });
    }

    // Ownership. A saved design that belongs to an account may only be ordered
    // by that account.
    if (row.user_id && (!options.customerId || String(row.user_id) !== String(options.customerId))) {
      throw new OrderSnapshotError(
        "CUSTOMIZATION_OWNERSHIP_INVALID",
        `Customization owner ${row.user_id} does not match ordering customer ${options.customerId || "(anonymous)"}.`,
        { customizationId },
      );
    }

    const customization = customizationFromRow(row);

    const trusted = await getTrustedTemplateForCustomization(customization);
    if (!trusted) {
      throw new OrderSnapshotError(
        "TEMPLATE_VERSION_NOT_FOUND",
        `No trusted template for template ${customization.templateId || "(none)"} version ${customization.templateVersion || 0}.`,
        { customizationId },
      );
    }
    const template = trusted.template;

    const productId = customization.productId || item.productId || "";
    const product = products.find((candidate: any) => candidate.id === productId) || null;
    const authoritativeTemplate = await resolveFlagsIntoTemplate(template, {
      productId,
      productType:
        product?.productType ||
        product?.departmentPath?.join("/") ||
        product?.category ||
        template?.settings?.productType,
      actorId: customization.userId,
    });

    const selectedOptions = customization.selectedOptions || item.selectedOptions || {};
    const quantity = Math.max(1, Number(item.quantity) || Number(selectedOptions.quantity) || 1);
    const pricing = product
      ? calculateCustomizationPrice(product, selectedOptions, quantity)
      : {
          basePrice: Number(item.price) || 0,
          optionSurcharges: [],
          optionsTotal: 0,
          unitPrice: Number(item.price) || 0,
          quantity,
          subtotal: (Number(item.price) || 0) * quantity,
          currency: item.currency || "BDT",
        };

    let snapshot: Record<string, unknown>;
    let preflight: PreflightResult;
    let integrityHash: string;

    try {
      const { document } = templateToDocument(template);
      const editorState = stripEphemeralAssetUrls(customization.renderData?.editorState || null, customization.userId);
      const values = stripEphemeralAssetUrls(customization.values || {}, customization.userId);
      const uploadedFiles = stripEphemeralAssetUrls(customization.uploadedFiles || {}, customization.userId);

      // Resolve the production variant of every private customer asset. A
      // missing or inaccessible photo is a hard failure — an order must never
      // be accepted with an unrenderable image.
      let renderValues: unknown;
      let renderEditorState: unknown;
      try {
        [renderValues, renderEditorState] = await Promise.all([
          resolvePrivateAssetsForDelivery(values, { productionWorker: true }, "original", supabase),
          resolvePrivateAssetsForDelivery(editorState, { productionWorker: true }, "original", supabase),
        ]);
      } catch (assetError: any) {
        throw new OrderSnapshotError(
          "PRIVATE_ASSET_UNAVAILABLE",
          `Private asset resolution failed: ${assetError?.code || ""} ${assetError?.message || assetError}`.trim(),
          { customizationId, cause: assetError },
        );
      }

      const resolvedForPreflight = resolveCustomerDocument(document, renderValues as any, renderEditorState as any);

      // Authoritative preflight, measured with the real production font files
      // and blocking on low resolution — the same gate the print worker will
      // face, run before the order is accepted.
      preflight = runPreflight(resolvedForPreflight, { measure, blockOnLowResolution: true });

      // Signed URLs are ephemeral; the permanent record keeps durable
      // bucket/path asset references only.
      const resolved = stripEphemeralAssetUrls(resolvedForPreflight, customization.userId);
      const assetReferences = collectCustomerAssetReferences(
        { values, editorState, uploadedFiles, document: resolved },
        customization.userId,
      );

      snapshot = {
        productId,
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
        // Freeze the render feature decisions taken when the order was
        // accepted. Flipping a feature flag afterwards must not change the
        // production output of an order already placed (spec §34).
        renderFeatures: {
          serverRendering: isCustomizerFeatureEnabled(authoritativeTemplate, "customizer_v2_server_rendering"),
          printPdf: isCustomizerFeatureEnabled(authoritativeTemplate, "customizer_v2_print_pdf"),
        },
        preflight,
        createdAt: new Date().toISOString(),
      };
      integrityHash = computeIntegrityHash(snapshot);
    } catch (buildError) {
      if (isOrderSnapshotError(buildError)) throw buildError;
      throw new OrderSnapshotError(
        "SNAPSHOT_BUILD_FAILED",
        `Could not build snapshot payload: ${(buildError as any)?.message || buildError}`,
        { customizationId, cause: buildError },
      );
    }

    preflightResults.push({ customizationId, preflight });

    if (preflight.blocking) {
      const firstError = preflight.issues.find((issue) => issue.severity === "error");
      throw new OrderSnapshotError(
        "PREFLIGHT_BLOCKED",
        `Blocking preflight issues: ${preflight.issues
          .filter((issue) => issue.severity === "error")
          .map((issue) => issue.code || issue.message)
          .join(", ")}`,
        {
          customizationId,
          // The preflight message is written for customers and names the field
          // that needs attention, so it is safe and more useful than the
          // generic fallback.
          customerMessage: firstError?.message || CUSTOMER_MESSAGES.PREFLIGHT_BLOCKED,
        },
      );
    }

    const { data: versionRow } = customization.templateId
      ? await supabase
          .from("customizer_template_versions")
          .select("id")
          .eq("template_id", customization.templateId)
          .eq("version", customization.templateVersion || 0)
          .maybeSingle()
      : { data: null };

    prepared.push({
      itemRef,
      customizationId,
      preflight,
      serverRenderingEnabled: isCustomizerFeatureEnabled(authoritativeTemplate, "customizer_v2_server_rendering"),
      printPdfEnabled: isCustomizerFeatureEnabled(authoritativeTemplate, "customizer_v2_print_pdf"),
      row: {
        item_ref: itemRef,
        customization_id: customizationId,
        product_id: productId || null,
        product_title: String(snapshot.productTitle || ""),
        product_sku: String(snapshot.productSku || ""),
        quantity,
        selected_options: selectedOptions,
        pricing,
        template_id: customization.templateId || null,
        template_version: Number(snapshot.templateVersion) || 1,
        template_version_id: versionRow?.id || null,
        snapshot,
        preflight,
        preview_files: customization.previewImages || {},
        print_files: customization.printFiles || {},
        // Rendering has not been queued yet. finalize() advances this to
        // 'queued', 'queue_failed' or 'not_required' — it is never left here.
        render_status: "pending",
        integrity_hash: integrityHash,
      },
    });
  }

  return { totalCustomizedItems: indexed.length, prepared, preflightResults };
}

// ---------------------------------------------------------------------------
// Post-commit finalization
// ---------------------------------------------------------------------------

export type SnapshotFinalizeResult = {
  orderId: string;
  totalCustomizedItems: number;
  snapshotsInserted: number;
  queued: Array<{ customizationId: string; snapshotId: string; jobTypes: string[] }>;
  queueFailures: Array<{ customizationId: string; snapshotId: string; errorCode: string; errorMessage: string }>;
  productionStatus: string;
};

type InsertedSnapshot = {
  id: string;
  order_item_id: string;
  customization_id: string;
  item_ref?: string;
};

// Record the audit trail and queue production rendering after the order and
// its snapshots have committed. A queue failure never deletes the snapshot —
// it is recorded as `queue_failed` with its error so an admin can see and
// retry it.
export async function finalizeOrderDesignSnapshots(options: {
  orderId: string;
  prepared: PreparedOrderSnapshot[];
  inserted: InsertedSnapshot[];
}): Promise<SnapshotFinalizeResult> {
  const supabase = createServiceRoleClient();
  const bySnapshotCustomization = new Map(options.inserted.map((row) => [String(row.customization_id), row]));

  const queued: SnapshotFinalizeResult["queued"] = [];
  const queueFailures: SnapshotFinalizeResult["queueFailures"] = [];

  for (const entry of options.prepared) {
    const insertedRow = bySnapshotCustomization.get(entry.customizationId);
    if (!insertedRow) continue;

    // Audit trail: the exact preflight result the order was accepted on.
    try {
      await supabase.from("customizer_preflight_results").insert({
        customization_id: entry.customizationId,
        order_id: options.orderId,
        context: "order",
        ok: entry.preflight.ok,
        blocking: entry.preflight.blocking,
        issues: entry.preflight.issues,
      });
    } catch (auditError) {
      console.error(
        `[customizer] Order ${options.orderId}: could not record the order preflight audit row for customization ${entry.customizationId}.`,
        auditError,
      );
    }

    if (!entry.serverRenderingEnabled) {
      await supabase
        .from("order_design_snapshots")
        .update({ render_status: "not_required" })
        .eq("id", insertedRow.id);
      continue;
    }

    const jobTypes: string[] = ["print_png", ...(entry.printPdfEnabled ? ["print_pdf"] : [])];
    try {
      const { enqueueRenderJob } = await import("@/lib/customizer/render-jobs");
      for (const jobType of jobTypes) {
        await enqueueRenderJob({
          customizationId: entry.customizationId,
          orderId: options.orderId,
          orderItemId: insertedRow.order_item_id,
          snapshotId: insertedRow.id,
          jobType: jobType as any,
          priority: 10,
        });
      }
      await supabase
        .from("order_design_snapshots")
        .update({
          render_status: "queued",
          render_queued_at: new Date().toISOString(),
          render_error_code: null,
          render_error_message: null,
        })
        .eq("id", insertedRow.id);
      queued.push({ customizationId: entry.customizationId, snapshotId: insertedRow.id, jobTypes });
    } catch (queueError: any) {
      // The snapshot stays — it is the permanent record of an accepted order.
      // The failure is recorded so it shows up in admin render monitoring and
      // can be retried, instead of sitting silently at 'pending'.
      const errorCode = String(queueError?.code || "RENDER_QUEUE_FAILED").slice(0, 120);
      const errorMessage = String(queueError?.message || queueError).slice(0, 1000);
      console.error(
        `[customizer] Order ${options.orderId}: could not queue print renders for customization ${entry.customizationId}.`,
        queueError,
      );
      await supabase
        .from("order_design_snapshots")
        .update({
          render_status: "queue_failed",
          render_error_code: errorCode,
          render_error_message: errorMessage,
          last_render_attempt_at: new Date().toISOString(),
        })
        .eq("id", insertedRow.id);
      queueFailures.push({
        customizationId: entry.customizationId,
        snapshotId: insertedRow.id,
        errorCode,
        errorMessage,
      });
    }
  }

  const productionStatus = !options.prepared.length
    ? "not_required"
    : queueFailures.length
      ? "attention_required"
      : queued.length
        ? "render_queued"
        : "snapshot_ready";

  await supabase
    .from("orders")
    .update({ production_status: productionStatus })
    .eq("id", options.orderId);

  return {
    orderId: options.orderId,
    totalCustomizedItems: options.prepared.length,
    snapshotsInserted: options.inserted.length,
    queued,
    queueFailures,
    productionStatus,
  };
}

// Record the pre-order (checkout context) preflight audit rows. Kept separate
// from the order-context rows so a rejected checkout still leaves a trail.
export async function recordCheckoutPreflightResults(
  results: Array<{ customizationId: string; preflight: PreflightResult }>,
): Promise<void> {
  if (!results.length) return;
  const supabase = createServiceRoleClient();
  try {
    await supabase.from("customizer_preflight_results").insert(
      results.map((entry) => ({
        customization_id: entry.customizationId,
        context: "checkout",
        ok: entry.preflight.ok,
        blocking: entry.preflight.blocking,
        issues: entry.preflight.issues,
      })),
    );
  } catch (error) {
    console.error("[customizer] Could not record checkout preflight audit rows.", error);
  }
}

export async function getOrderDesignSnapshots(orderId: string, includeDocument = false) {
  const supabase = createServiceRoleClient();
  const columns = includeDocument
    ? "*"
    : "id, order_id, order_item_id, customization_id, product_id, product_title, quantity, selected_options, pricing, template_id, template_version, template_version_id, render_status, render_error_code, render_error_message, render_attempt_count, last_render_attempt_at, render_queued_at, manual_review_requested_at, manual_review_note, preflight, preview_files, print_files, integrity_hash, created_at";
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
    templateId: row.template_id || "",
    templateVersion: Number(row.template_version) || 1,
    templateVersionId: row.template_version_id || "",
    renderStatus: row.render_status || "pending",
    renderErrorCode: row.render_error_code || "",
    renderErrorMessage: row.render_error_message || "",
    renderAttemptCount: Number(row.render_attempt_count) || 0,
    lastRenderAttemptAt: row.last_render_attempt_at || "",
    renderQueuedAt: row.render_queued_at || "",
    manualReviewRequestedAt: row.manual_review_requested_at || "",
    manualReviewNote: row.manual_review_note || "",
    preflight: row.preflight || {},
    previewFiles: row.preview_files || {},
    printFiles: row.print_files || {},
    integrityHash: row.integrity_hash || "",
    createdAt: row.created_at,
    ...(includeDocument ? { snapshot: row.snapshot || {} } : {}),
  }));
}

