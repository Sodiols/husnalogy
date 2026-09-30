/**
 * The production implementation of `CheckoutDeps` (server only).
 *
 * Every query runs with the service role, and every query that returns
 * customer data is explicitly scoped to the authenticated customer id passed
 * in by the route — the service role bypasses RLS, so the scoping here IS the
 * authorization.
 */

import { createId } from "@/lib/core/id";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getProductRecordsForCheckout } from "@/lib/products";
import { runOrderFollowUps } from "@/lib/outbox/supabase-tasks";
import { isAllowedCustomerAssetPath } from "@/lib/customizer/v2/asset-references";
import { verifyCustomizationForCheckout } from "@/lib/orders/checkout-customizations";
import { CheckoutTransactionError, transactionErrorFrom, type CheckoutDeps } from "@/lib/orders/checkout";
import { orderFromRow, toCustomerOrderView } from "@/lib/orders/order-view";
import type { VerifiedUpload } from "@/lib/orders/personalization";
import { personalizationFreezer } from "@/lib/orders/personalization-production";

const CUSTOMER_UPLOAD_BUCKET = "customer-uploads";

export function createSupabaseCheckoutDeps(): CheckoutDeps {
  const supabase = createServiceRoleClient();

  return {
    freezePersonalization: personalizationFreezer(supabase),
    newOrderId: () => createId("order"),

    loadProducts: (ids) => getProductRecordsForCheckout(ids),

    async loadCustomizations(ids) {
      const { data, error } = await supabase.from("product_customizations").select("*").in("id", ids);
      if (error) throw error;
      return new Map((data || []).map((row: any) => [String(row.id), row]));
    },

    async loadVerifiedUploads(userId, paths) {
      const owned = paths.filter((path) => isAllowedCustomerAssetPath(userId, CUSTOMER_UPLOAD_BUCKET, path));
      const verified = new Map<string, VerifiedUpload>();
      if (!owned.length) return verified;

      const librarySelect = "bucket,path,editor_path,file_name,mime_type,size_bytes,status";
      const [libraryByPath, libraryByEditorPath, legacy] = await Promise.all([
        supabase.from("customer_asset_library").select(librarySelect).eq("user_id", userId).eq("status", "ready").in("path", owned),
        supabase.from("customer_asset_library").select(librarySelect).eq("user_id", userId).eq("status", "ready").in("editor_path", owned),
        supabase
          .from("customer_uploads")
          .select("bucket,path,file_name,mime_type,size_bytes")
          .eq("user_id", userId)
          .eq("bucket", CUSTOMER_UPLOAD_BUCKET)
          .in("path", owned),
      ]);
      for (const result of [libraryByPath, libraryByEditorPath, legacy]) if (result.error) throw result.error;
      const library = { data: [...(libraryByPath.data || []), ...(libraryByEditorPath.data || [])] };

      const add = (requested: string, row: any) => {
        if (!row || row.bucket !== CUSTOMER_UPLOAD_BUCKET) return;
        verified.set(requested, {
          bucket: CUSTOMER_UPLOAD_BUCKET,
          path: String(row.path),
          name: String(row.file_name || "").slice(0, 200),
          mimeType: String(row.mime_type || ""),
          size: Number(row.size_bytes) || 0,
        });
      };
      for (const row of library.data || []) {
        for (const requested of owned) if (requested === row.path || requested === row.editor_path) add(requested, row);
      }
      for (const row of legacy.data || []) {
        if (!verified.has(row.path)) add(row.path, row);
      }
      return verified;
    },

    verifyCustomization: (input) => verifyCustomizationForCheckout(input),

    async findOrderBySubmission(customerId, submissionId) {
      const { data, error } = await supabase
        .from("orders")
        .select("id,checkout_state,request_hash")
        .eq("customer_id", customerId)
        .eq("checkout_submission_id", submissionId)
        .maybeSingle();
      if (error) throw error;
      return data ? { id: String(data.id), checkoutState: String(data.checkout_state || "finalized"), requestHash: data.request_hash || null } : null;
    },

    async createOrder({ order, items, snapshots, guards }) {
      const { data, error } = await (supabase.rpc as any)("create_checkout_order", {
        p_order: order,
        p_items: items,
        p_snapshots: snapshots,
        p_guards: guards,
      });
      if (error) throw transactionErrorFrom(error);
      const status = String(data?.status || "");
      if (!["created", "replayed", "conflict", "incomplete"].includes(status) || !data?.order_id) {
        throw new CheckoutTransactionError("CHECKOUT_DATABASE_ERROR", `Unexpected checkout RPC result: ${JSON.stringify(data)}`);
      }
      return { status: status as "created", orderId: String(data.order_id) };
    },

    async loadOrder(orderId, customerId) {
      const { data, error } = await supabase
        .from("orders")
        .select("*,order_items(*)")
        .eq("id", orderId)
        .eq("customer_id", customerId)
        .eq("checkout_state", "finalized")
        .maybeSingle();
      if (error) throw error;
      return data ? toCustomerOrderView(orderFromRow(data)) : null;
    },

    afterOrderCreated: (orderId) => runOrderFollowUps(orderId),
  };
}
