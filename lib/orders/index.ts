import { createId, nowIso } from "@/lib/core/id";
import { clampNumber, clampString, cleanOptionalString, cleanString, isValidEmail } from "@/lib/validation";
import { getProductBySlug, getProducts } from "@/lib/products";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { normalizeCurrency } from "@/lib/currency";
import { calculateCustomizationPrice } from "@/lib/customizer/v2/pricing";
import {
  finalizeOrderDesignSnapshots,
  isOrderSnapshotError,
  OrderSnapshotError,
  prepareOrderDesignSnapshots,
  recordCheckoutPreflightResults,
  type PreparedOrderSnapshot,
} from "@/lib/customizer/order-snapshots";

const ORDER_STATUSES = new Set([
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

const PAYMENT_STATUSES = new Set(["unpaid", "paid", "partially paid", "refunded", "cancelled"]);

// Personalized production lifecycle (spec §39). Kept separate from
// ORDER_STATUSES so render progress never overloads the customer-facing state.
export const PRODUCTION_STATUSES = new Set([
  "not_required",
  "snapshot_pending",
  "snapshot_ready",
  "render_queued",
  "rendering",
  "render_ready",
  "attention_required",
  "failed",
]);

// Calm, customer-facing wording for the account order list (spec §40). Internal
// error codes and technical render states are never shown to customers.
export const CUSTOMER_PRODUCTION_LABELS: Record<string, string> = {
  not_required: "",
  snapshot_pending: "Design received",
  snapshot_ready: "Design received",
  render_queued: "Preparing production files",
  rendering: "Preparing production files",
  render_ready: "Design ready for production",
  attention_required: "Design requires attention",
  failed: "Design requires attention",
};

export function customerProductionStatusLabel(productionStatus: string): string {
  return CUSTOMER_PRODUCTION_LABELS[cleanString(productionStatus)] ?? "";
}

function orderFromSupabaseRow(row: any = {}) {
  const metadata = row.metadata || {};
  const items = Array.isArray(row.order_items)
    ? row.order_items.map((item) => {
        const itemMeta = item.metadata || {};
        return {
          id: item.id,
          productId: item.product_id || "",
          productSlug: item.product_slug || "",
          productTitle: item.product_title || "",
          image: item.product_image || "",
          price: Number(item.unit_price || 0),
          currency: normalizeCurrency(itemMeta.currency || metadata.currency),
          quantity: Number(item.quantity || 1),
          selectedOptions: item.selected_options || {},
          customizationValues: item.customization_values || {},
          uploadedFiles: item.uploaded_files || {},
          previewData: item.preview_data || {},
          previewImages: itemMeta.previewImages || {},
          customizationId: itemMeta.customizationId || "",
          templateId: itemMeta.templateId || "",
          templateVersion: itemMeta.templateVersion || 0,
          renderData: itemMeta.renderData || {},
          finalPrice: Number(item.line_total || 0),
        };
      })
    : metadata.items || [];

  return normalizeOrderRequest(
    {
      ...metadata,
      id: row.id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      customerPhone: row.customer_phone,
      productId: row.product_id,
      productTitle: row.product_title,
      productSlug: row.product_slug,
      items,
      subtotal: row.subtotal,
      deliveryCharge: row.delivery_charge,
      total: row.total,
      paymentStatus: row.payment_status,
      status: row.status,
      message: row.message,
      address: row.address || metadata.address || {},
      customizationDetails: row.customization_details || metadata.customizationDetails || {},
      uploadedFiles: row.uploaded_files || metadata.uploadedFiles || {},
      productionStatus: row.production_status || metadata.productionStatus || "not_required",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    metadata
  );
}

// The stable reference that ties an order item in this request to its prepared
// snapshot. Never a client-supplied id: create_customized_order() maps it to
// the real order_items.id it just inserted.
function orderItemRef(_item: any, index: number) {
  return `item_${index}`;
}

// Insert the order, its items and every required design snapshot in one
// database transaction (spec §5). A partially created customized order is
// impossible: the function either commits everything or raises, and a raise
// inside the function rolls the whole statement back.
async function insertSupabaseOrder(
  order: any,
  prepared: PreparedOrderSnapshot[],
): Promise<{ order: any; reused: boolean; inserted: Array<Record<string, any>> }> {
  const supabase = createServiceRoleClient();

  const orderPayload = {
    id: order.id,
    customer_id: order.customerId || null,
    customer_name: order.customerName,
    customer_email: order.customerEmail,
    customer_phone: order.customerPhone || null,
    product_id: order.productId || null,
    product_title: order.productTitle,
    product_slug: order.productSlug || null,
    subtotal: order.subtotal,
    delivery_charge: order.deliveryCharge,
    total: order.total,
    payment_status: order.paymentStatus,
    status: order.status,
    message: order.message || null,
    address: order.address || {},
    customization_details: order.customizationDetails || {},
    uploaded_files: order.uploadedFiles || {},
    metadata: order,
    // Personalized orders start as snapshot_pending and are advanced by
    // finalizeOrderDesignSnapshots once rendering is queued.
    production_status: prepared.length ? "snapshot_pending" : "not_required",
    idempotency_key: order.idempotencyKey || null,
    created_at: order.createdAt,
    updated_at: order.updatedAt,
  };

  const itemsPayload = (order.items || []).map((item: any, index: number) => ({
    ref: orderItemRef(item, index),
    product_id: item.productId || null,
    product_slug: item.productSlug || null,
    product_title: item.productTitle || "Order item",
    product_image: item.image || null,
    quantity: item.quantity,
    unit_price: item.price,
    line_total: item.finalPrice,
    selected_options: item.selectedOptions || {},
    customization_values: item.customizationValues || {},
    uploaded_files: item.uploadedFiles || {},
    preview_data: item.previewData || {},
    metadata: item,
  }));

  const { data, error } = await (supabase.rpc as any)("create_customized_order", {
    p_order: orderPayload,
    p_items: itemsPayload,
    p_snapshots: prepared.map((entry) => entry.row),
  });

  if (error) {
    console.error(`[orders] Transactional insert failed for order ${order.id}:`, error);
    throw new OrderSnapshotError(
      prepared.length ? "ORDER_TRANSACTION_FAILED" : "SNAPSHOT_INSERT_FAILED",
      `create_customized_order failed: ${error.message}`,
      { cause: error },
    );
  }

  const result = (data || {}) as Record<string, any>;
  const inserted = Array.isArray(result.snapshots) ? result.snapshots : [];

  // The transaction guarantees this, but an explicit check keeps the promise
  // enforced in application code too: a successful customized order response
  // is never returned without one snapshot per customized item.
  if (!result.reused && inserted.length !== prepared.length) {
    throw new OrderSnapshotError(
      "SNAPSHOT_INSERT_FAILED",
      `Expected ${prepared.length} snapshots but the transaction reported ${inserted.length}.`,
    );
  }

  // Attach the order to any saved customizations and mark them ordered.
  // Bookkeeping only — the permanent record is the snapshot, so a failure here
  // never invalidates the committed order.
  const customizationIds = (order.items || [])
    .map((item: any) => item.customizationId)
    .filter(Boolean);
  if (customizationIds.length) {
    try {
      await supabase
        .from("product_customizations")
        .update({ status: "ordered", order_id: order.id, updated_at: nowIso() })
        .in("id", customizationIds);
    } catch (updateError) {
      console.error("Could not mark customizations as ordered:", updateError);
    }
  }

  return { order, reused: Boolean(result.reused), inserted };
}

async function readSupabaseOrders(filters: any = {}) {
  const supabase = createServiceRoleClient();
  let query = supabase
    .from("orders")
    .select("*,order_items(*)")
    .order("created_at", { ascending: false });

  const customerId = cleanString(filters.customerId);
  const email = cleanString(filters.email).toLowerCase();
  const status = cleanString(filters.status).toLowerCase();

  if (customerId && email) query = query.or(`customer_id.eq.${customerId},customer_email.eq.${email}`);
  else if (customerId) query = query.eq("customer_id", customerId);
  else if (email) query = query.eq("customer_email", email);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw error;

  const queryText = cleanString(filters.query).toLowerCase();
  const orders = (data || []).map(orderFromSupabaseRow);

  if (!queryText) return orders;

  return orders.filter((order) => {
    const haystack = [
      order.id,
      order.productTitle,
      order.productSlug,
      order.customerName,
      order.customerEmail,
      order.customerPhone,
      order.message,
      ...(order.items || []).map((item) => item.productTitle),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(queryText);
  });
}

async function updateSupabaseOrderStatus(id, status) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("orders")
    .update({ status, updated_at: nowIso() })
    .eq("id", id)
    .select("*,order_items(*)")
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return orderFromSupabaseRow(data);
}

function normalizeCustomizationData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [key, cleanOptionalString(entryValue)])
  );
}

function normalizeOrderItem(item) {
  const price = clampNumber(item.price);
  const quantity = Math.round(clampNumber(item.quantity, { min: 1, max: 9999, fallback: 1 }));

  return {
    id: cleanOptionalString(item.id),
    productId: cleanOptionalString(item.productId),
    productSlug: cleanOptionalString(item.slug || item.productSlug),
    productTitle: clampString(item.title || item.productTitle, 300),
    image: cleanOptionalString(item.image),
    price,
    currency: normalizeCurrency(item.currency),
    quantity,
    selectedOptions: item.selectedOptions || item.options || {},
    customizationValues: item.customizationValues || item.customization || {},
    uploadedFiles: item.uploadedFiles || {},
    previewData: item.previewData || {},
    // Customizer fields carried through so admins can review the exact design.
    previewImages: item.previewImages || {},
    customizationId: cleanOptionalString(item.customizationId),
    templateId: cleanOptionalString(item.templateId),
    templateVersion: Number(item.templateVersion) || 0,
    renderData: item.renderData || {},
    finalPrice: clampNumber(item.finalPrice, { fallback: price * quantity }) || price * quantity,
  };
}

function normalizeAddress(input: any, existing: any = {}) {
  return {
    addressLine1: cleanOptionalString(input.addressLine1 ?? existing.addressLine1),
    addressLine2: cleanOptionalString(input.addressLine2 ?? existing.addressLine2),
    city: cleanOptionalString(input.city ?? existing.city),
    area: cleanOptionalString(input.area ?? existing.area),
    postalCode: cleanOptionalString(input.postalCode ?? existing.postalCode),
    country: cleanOptionalString(input.country ?? existing.country) || "Bangladesh",
    deliveryNote: cleanOptionalString(input.deliveryNote ?? existing.deliveryNote),
  };
}

function normalizeOrderRequest(input: any, existing: any = {}) {
  const now = nowIso();
  const statusInput = cleanString(input.status ?? existing.status).toLowerCase();
  const status = ORDER_STATUSES.has(statusInput) ? statusInput : existing.status || "pending";
  const paymentInput = cleanString(input.paymentStatus ?? existing.paymentStatus).toLowerCase();
  const paymentStatus = PAYMENT_STATUSES.has(paymentInput) ? paymentInput : existing.paymentStatus || "unpaid";
  const items = Array.isArray(input.items) ? input.items.slice(0, 100).map(normalizeOrderItem) : existing.items || [];
  const computedSubtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const subtotal = clampNumber(input.subtotal ?? existing.subtotal ?? computedSubtotal, { fallback: computedSubtotal });
  const deliveryCharge = clampNumber(input.deliveryCharge ?? existing.deliveryCharge ?? 0, { max: 100000 });
  const total = clampNumber(input.total ?? existing.total ?? subtotal + deliveryCharge, { fallback: subtotal + deliveryCharge });

  return {
    id: existing.id || cleanString(input.id) || createId("order"),
    customerId: cleanOptionalString(input.customerId ?? existing.customerId),
    productId: cleanOptionalString(input.productId ?? existing.productId),
    productTitle: cleanOptionalString(input.productTitle ?? existing.productTitle) || items[0]?.productTitle || "Cart order",
    productSlug: cleanOptionalString(input.productSlug ?? existing.productSlug) || items[0]?.productSlug || "",
    customerName: clampString(input.customerName ?? existing.customerName, 160),
    customerEmail: clampString(input.customerEmail ?? existing.customerEmail, 254).toLowerCase(),
    customerPhone: clampString(input.customerPhone ?? existing.customerPhone, 40),
    address: normalizeAddress(input, existing.address || {}),
    eventDate: cleanOptionalString(input.eventDate ?? existing.eventDate),
    customizationDetails: normalizeCustomizationData(input.customizationDetails ?? existing.customizationDetails),
    uploadedFiles: input.uploadedFiles ?? existing.uploadedFiles ?? {},
    items,
    subtotal: Number(subtotal.toFixed(2)),
    deliveryCharge: Number(deliveryCharge.toFixed(2)),
    total: Number(total.toFixed(2)),
    currency: normalizeCurrency(input.currency ?? existing.currency ?? items[0]?.currency),
    paymentStatus,
    status,
    // Personalized production lifecycle (spec §39), deliberately separate from
    // the customer-facing order status.
    productionStatus: PRODUCTION_STATUSES.has(
      cleanString(input.productionStatus ?? existing.productionStatus)
    )
      ? cleanString(input.productionStatus ?? existing.productionStatus)
      : existing.productionStatus || "not_required",
    // Lets a retried checkout submission resolve to the same order instead of
    // creating a duplicate one.
    idempotencyKey: clampString(input.idempotencyKey ?? existing.idempotencyKey, 200),
    message: clampString(input.message ?? existing.message, 5000),
    createdAt: existing.createdAt || input.createdAt || now,
    updatedAt: now,
  };
}

function validateOrderRequest(order: any) {
  const errors: any = {};
  if (!order.items.length && !order.productSlug && !order.productId) errors.product = "Product is required.";
  if (!order.customerName) errors.customerName = "Name is required.";
  if (!order.customerEmail) errors.customerEmail = "Email is required.";
  if (order.customerEmail && !isValidEmail(order.customerEmail)) errors.customerEmail = "Enter a valid email address.";
  return errors;
}

// Trusted server pricing (spec §31): recalculate every line item's price from
// the product row + selected options. The client's submitted price is only an
// estimate and is never persisted when the product can be resolved.
async function applyTrustedPricing(order: any) {
  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.length) return order;

  let products: any[] = [];
  try {
    products = await getProducts();
  } catch (error) {
    console.error("Trusted pricing: could not load products; keeping submitted prices.", error);
    return order;
  }

  const repricedItems = items.map((item: any) => {
    const product =
      products.find((p: any) => p.id === item.productId) ||
      products.find((p: any) => p.slug === item.productSlug);
    if (!product) return item;
    const pricing = calculateCustomizationPrice(product, item.selectedOptions || {}, item.quantity);
    return {
      ...item,
      price: pricing.unitPrice,
      finalPrice: pricing.subtotal,
      pricingBreakdown: pricing,
    };
  });

  const subtotal = repricedItems.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0);
  return {
    ...order,
    items: repricedItems,
    subtotal: Number(subtotal.toFixed(2)),
    total: Number((subtotal + Number(order.deliveryCharge || 0)).toFixed(2)),
  };
}

export async function createOrderRequest(input) {
  const product = input.productSlug ? await getProductBySlug(input.productSlug) : null;

  if (product?.isStockOut) {
    return { ok: false, errors: { product: "This product is currently stock out." } };
  }

  const order = normalizeOrderRequest({
    ...input,
    id: "",
    status: "pending",
    paymentStatus: "unpaid",
    createdAt: "",
    productId: input.productId || product?.id,
    productTitle: input.productTitle || product?.title,
    productSlug: input.productSlug || product?.slug,
  });
  const errors = validateOrderRequest(order);

  if (Object.keys(errors).length) return { ok: false, errors };

  const pricedOrder = await applyTrustedPricing(order);

  // Personalized items must have a complete, valid, immutable snapshot before
  // the order is allowed to exist (spec §4). Ownership, the trusted template
  // version, private assets, authoritative server preflight and trusted
  // pricing are all resolved here — before anything is written.
  let prepared: PreparedOrderSnapshot[] = [];
  try {
    const preparation = await prepareOrderDesignSnapshots({
      items: pricedOrder.items || [],
      customerId: pricedOrder.customerId,
      itemRefFor: orderItemRef,
    });
    prepared = preparation.prepared;
    // Audit trail for the checkout gate, kept even when the order is rejected.
    await recordCheckoutPreflightResults(preparation.preflightResults);
  } catch (error) {
    if (isOrderSnapshotError(error)) {
      console.error(
        `[orders] Rejected checkout: ${error.code} for customization ${error.customizationId || "(unknown)"} — ${error.detail}`,
        error,
      );
      return { ok: false, errors: { customization: error.customerMessage }, errorCode: error.code };
    }
    console.error("[orders] Rejected checkout: snapshot preparation failed unexpectedly.", error);
    return {
      ok: false,
      errors: {
        customization:
          "A personalized design could not be prepared for production. Please reopen it, save it again, and retry checkout.",
      },
      errorCode: "SNAPSHOT_BUILD_FAILED",
    };
  }

  let insertResult: Awaited<ReturnType<typeof insertSupabaseOrder>>;
  try {
    insertResult = await insertSupabaseOrder(pricedOrder, prepared);
  } catch (error) {
    if (isOrderSnapshotError(error)) {
      console.error(`[orders] Order ${pricedOrder.id} was not created: ${error.code} — ${error.detail}`, error);
      return { ok: false, errors: { order: error.customerMessage }, errorCode: error.code };
    }
    console.error(`[orders] Order ${pricedOrder.id} was not created.`, error);
    throw error;
  }

  // A replayed submission (same idempotency key) already has its snapshots and
  // render jobs; re-running finalization would only duplicate work.
  if (!insertResult.reused && prepared.length) {
    try {
      await finalizeOrderDesignSnapshots({
        orderId: pricedOrder.id,
        prepared,
        inserted: insertResult.inserted as any,
      });
    } catch (finalizeError) {
      // The order and its snapshots are committed and valid. Queueing is
      // asynchronous, so a failure here is recorded for admin attention rather
      // than failing an order the customer has already completed.
      console.error(
        `[orders] Order ${pricedOrder.id} committed but production finalization failed.`,
        finalizeError,
      );
    }
  }

  return { ok: true, order: pricedOrder, reused: insertResult.reused };
}

export async function getOrderRequests(filters: any = {}) {
  return readSupabaseOrders(filters);
}

export async function getOrderRequestsForCustomer({ customerId, email }: any = {}) {
  const id = cleanString(customerId);
  const mail = cleanString(email).toLowerCase();

  if (!id && !mail) return [];

  const orders = await getOrderRequests({ customerId: id, email: mail });

  return orders.filter((order) => {
    const matchesId = id && order.customerId === id;
    const matchesEmail = mail && String(order.customerEmail || "").toLowerCase() === mail;
    return matchesId || matchesEmail;
  });
}

export async function updateOrderRequestStatus(id, status) {
  const cleanStatus = cleanString(status).toLowerCase();
  if (!ORDER_STATUSES.has(cleanStatus)) {
    return { ok: false, errors: { status: "Invalid order status." } };
  }

  const order = await updateSupabaseOrderStatus(id, cleanStatus);
  if (!order) return { ok: false, errors: { order: "Order request not found." } };
  return { ok: true, order };
}

export async function deleteOrderRequest(id) {
  const supabase = createServiceRoleClient();
  const { error, count } = await supabase.from("orders").delete({ count: "exact" }).eq("id", id);

  if (error) throw error;
  if (!count) return { ok: false, errors: { order: "Order request not found." } };

  return { ok: true };
}
