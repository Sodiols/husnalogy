/**
 * Order reads and administrator order management (server only).
 *
 * Order CREATION lives in `lib/orders/checkout.ts` (the trusted pipeline) and
 * the `create_checkout_order` database transaction. Nothing in this module
 * creates orders, and every customer-facing read is scoped to the
 * authenticated customer id and to FINALIZED orders only.
 */

import { nowIso } from "@/lib/core/id";
import { cleanString } from "@/lib/validation";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { toMinorUnits, minorToDecimalString } from "@/lib/money";
import { placeCheckoutOrder, type CheckoutOutcome, type CheckoutUser } from "@/lib/orders/checkout";
import { createSupabaseCheckoutDeps } from "@/lib/orders/checkout-supabase";
import { orderFromRow, toCustomerOrderView } from "@/lib/orders/order-view";

export const ORDER_STATUSES = new Set([
  "pending",
  "confirmed",
  "in design review",
  "proof sent",
  "customer approved",
  "printing",
  "ready for delivery",
  "delivered",
  "cancelled",
  "new",
  "reviewing",
  "in design",
  "completed",
]);

export const PAYMENT_STATUSES = new Set(["unpaid", "paid", "partially paid", "refunded", "cancelled"]);

/** Place an order through the trusted checkout pipeline. */
export function createOrderRequest(input: { user: CheckoutUser; body: unknown; requestId: string }): Promise<CheckoutOutcome> {
  return placeCheckoutOrder(input, createSupabaseCheckoutDeps());
}

/** Administrator listing: every order, including non-finalized ones. */
export async function getOrderRequests(filters: { status?: string; query?: string } = {}) {
  const supabase = createServiceRoleClient();
  let query = supabase.from("orders").select("*,order_items(*)").order("created_at", { ascending: false });

  const status = cleanString(filters.status).toLowerCase();
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw error;

  const orders = (data || []).map(orderFromRow);
  const queryText = cleanString(filters.query).toLowerCase();
  if (!queryText) return orders;

  return orders.filter((order) =>
    [
      order.id,
      order.productTitle,
      order.productSlug,
      order.customerName,
      order.customerEmail,
      order.customerPhone,
      order.message,
      ...order.items.map((item) => item.productTitle),
    ]
      .join(" ")
      .toLowerCase()
      .includes(queryText),
  );
}

/**
 * A customer's own orders. Ownership is the authenticated customer id ONLY —
 * never an email address — and only finalized orders are ever returned.
 */
export async function getOrderRequestsForCustomer({ customerId }: { customerId: string }) {
  const id = cleanString(customerId);
  if (!id) return [];

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*,order_items(*)")
    .eq("customer_id", id)
    .eq("checkout_state", "finalized")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data || []).map((row) => toCustomerOrderView(orderFromRow(row)));
}

export async function updateOrderRequestStatus(id: string, status: string) {
  return updateOrderRequestDetails(id, { status });
}

/**
 * Administrator changes to a placed order: fulfilment status, payment status
 * (Cash on Delivery is collected offline) and the confirmed delivery charge.
 * Everything else about a finalized order is immutable (database trigger).
 */
export async function updateOrderRequestDetails(id: string, input: Record<string, unknown> = {}) {
  const supabase = createServiceRoleClient();
  const { data: current, error: readError } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
  if (readError) throw readError;
  if (!current) return { ok: false, errors: { order: "Order request not found." } };

  const patch: Record<string, unknown> = { updated_at: nowIso() };
  const metadata = { ...(current.metadata || {}) };

  if (input.status !== undefined) {
    const status = cleanString(input.status).toLowerCase();
    if (!ORDER_STATUSES.has(status)) return { ok: false, errors: { status: "Invalid order status." } };
    patch.status = status;
  }

  if (input.paymentStatus !== undefined) {
    const paymentStatus = cleanString(input.paymentStatus).toLowerCase();
    if (!PAYMENT_STATUSES.has(paymentStatus)) return { ok: false, errors: { paymentStatus: "Invalid payment status." } };
    patch.payment_status = paymentStatus;
  }

  if (Object.prototype.hasOwnProperty.call(input, "deliveryCharge")) {
    const requested = toMinorUnits(input.deliveryCharge);
    if (requested === null || requested > 10_000_000) {
      return { ok: false, errors: { deliveryCharge: "Enter a valid delivery charge." } };
    }
    const isStore = (current.delivery_method || metadata.deliveryMethod) === "store";
    const chargeMinor = isStore ? 0 : requested;
    const subtotalMinor = toMinorUnits(current.subtotal) ?? 0;
    patch.delivery_charge = minorToDecimalString(chargeMinor);
    patch.total = minorToDecimalString(subtotalMinor + chargeMinor);
    metadata.deliveryChargeConfirmed = true;
  }

  patch.metadata = metadata;
  const { data, error } = await supabase.from("orders").update(patch).eq("id", id).select("*,order_items(*)").maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, errors: { order: "Order request not found." } };
  return { ok: true, order: orderFromRow(data) };
}

export async function deleteOrderRequest(id: string) {
  const supabase = createServiceRoleClient();
  const { error, count } = await supabase.from("orders").delete({ count: "exact" }).eq("id", id);
  if (error) throw error;
  if (!count) return { ok: false, errors: { order: "Order request not found." } };
  return { ok: true };
}
