import { createId, nowIso } from "@/lib/core/id";
import { clampNumber, clampString, cleanOptionalString, cleanString, isValidEmail } from "@/lib/validation";
import { getProductBySlug, getProducts } from "@/lib/products";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { normalizeCurrency } from "@/lib/currency";
import { applyTrustedOrderPricing, evaluateSnapshotOutcome } from "@/lib/orders/trusted-order";
import { createOrderDesignSnapshots } from "@/lib/customizer/order-snapshots";
import { customizationFromRow } from "@/lib/customizer/customizations";
import { getTrustedTemplateForCustomization } from "@/lib/customizer/versions";
import { resolveCustomerDocument, templateToDocument } from "@/lib/customizer/v2/document";
import { runPreflight } from "@/lib/customizer/v2/preflight";
import { createServerMeasure } from "@/lib/customizer/v2/server/server-fonts";

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
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    metadata
  );
}

// Insert the order, then freeze every personalized design before the order is
// allowed to stand (spec §14).
//
// Supabase's REST client has no cross-table transaction, so this uses the
// compensation strategy the spec allows: the customizations are only marked
// "ordered" AFTER the snapshots exist, and a snapshot failure deletes the
// half-created order (order_items and snapshots cascade) so the customer can
// retry cleanly instead of ending up with an unprintable order.
async function insertSupabaseOrder(order) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("orders")
    .insert({
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
      created_at: order.createdAt,
      updated_at: order.updatedAt,
    })
    .select("*")
    .single();

  if (error) throw error;

  // Map each customization to the order_items row that was actually created,
  // so the permanent snapshot can point at a real order item.
  const orderItemIdByCustomizationId: Record<string, string> = {};

  if (order.items?.length) {
    const { data: insertedItems, error: itemError } = await supabase
      .from("order_items")
      .insert(
        order.items.map((item) => ({
          order_id: data.id,
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
        }))
      )
      .select("id,metadata");

    if (itemError) throw itemError;

    for (const row of insertedItems || []) {
      const customizationId = (row as any)?.metadata?.customizationId;
      if (customizationId) orderItemIdByCustomizationId[String(customizationId)] = String((row as any).id);
    }
  }

  const customizationIds = (order.items || [])
    .map((item) => item.customizationId)
    .filter(Boolean);

  if (customizationIds.length) {
    // Permanent order design snapshots (spec §14/§22): freeze the complete
    // resolved design so later template/product edits never affect the order.
    // A failure here is fatal for the order — an order without a frozen design
    // cannot be produced, so it must not be reported as placed.
    let outcome;
    try {
      outcome = await createOrderDesignSnapshots(order, orderItemIdByCustomizationId);
    } catch (snapshotError) {
      console.error("Could not create order design snapshots:", snapshotError);
      outcome = {
        created: 0,
        failures: customizationIds.map((customizationId) => ({
          customizationId: String(customizationId),
          reason: snapshotError instanceof Error ? snapshotError.message : "snapshot-run-failed",
        })),
      };
    }

    const verdict = evaluateSnapshotOutcome(customizationIds.map(String), outcome);
    if (!verdict.ok) {
      // Compensate: remove the order so no half-frozen order reaches production.
      // order_items and order_design_snapshots cascade on orders.id.
      try {
        await supabase.from("orders").delete().eq("id", data.id);
      } catch (rollbackError) {
        console.error(`Order ${data.id}: snapshot rollback failed; needs manual review.`, rollbackError);
      }
      const error: any = new Error(verdict.error);
      error.code = "ORDER_SNAPSHOT_FAILED";
      error.snapshotFailures = outcome.failures;
      throw error;
    }

    // Only now is the design genuinely ordered.
    try {
      await supabase
        .from("product_customizations")
        .update({ status: "ordered", order_id: data.id, updated_at: nowIso() })
        .in("id", customizationIds);
    } catch (updateError) {
      console.error("Could not mark customizations as ordered:", updateError);
    }
  }

  return order;
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

// Trusted server pricing (spec §13/§31). Every line is repriced from the
// server-loaded product row, every selected option is validated against the
// product's configured lists, and the delivery charge is computed server side.
//
// This FAILS CLOSED: if the catalogue cannot be loaded, a product cannot be
// resolved, or an option is not offered, the order is rejected instead of being
// persisted at browser-supplied prices.
async function applyTrustedPricing(order: any) {
  let products: any[] | null = null;
  try {
    products = await getProducts();
  } catch (error) {
    console.error("Trusted pricing: could not load the product catalogue.", error);
    products = null;
  }
  return applyTrustedOrderPricing(order, products);
}

async function validateOrderCustomizations(order: any): Promise<Record<string, string>> {
  const customizedItems = (order.items || []).filter((item: any) => item.customizationId);
  if (!customizedItems.length) return {};
  const supabase = createServiceRoleClient();
  for (const item of customizedItems) {
    const { data: row, error } = await supabase
      .from("product_customizations")
      .select("*")
      .eq("id", item.customizationId)
      .maybeSingle();
    if (error || !row) return { customization: "A personalized design could not be found. Reopen it from your cart and save again." };
    if (row.user_id && (!order.customerId || String(row.user_id) !== String(order.customerId))) {
      return { customization: "A personalized design does not belong to this account." };
    }
    const customization = customizationFromRow(row);
    const trusted = await getTrustedTemplateForCustomization(customization);
    if (!trusted) return { customization: "A personalized design uses a template version that is no longer available." };
    const { document } = templateToDocument(trusted.template);
    const resolved = resolveCustomerDocument(document, customization.values || {}, customization.renderData?.editorState || null);
    const preflight = runPreflight(resolved, { measure: createServerMeasure(), blockOnLowResolution: true });
    if (preflight.blocking) {
      const first = preflight.issues.find((issue) => issue.severity === "error");
      return { customization: first?.message || "A personalized design has a problem that must be fixed before checkout." };
    }
    await supabase.from("customizer_preflight_results").insert({
      customization_id: customization.id,
      context: "checkout",
      ok: preflight.ok,
      blocking: preflight.blocking,
      issues: preflight.issues,
    });
  }
  return {};
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

  const customizationErrors = await validateOrderCustomizations(order);
  if (Object.keys(customizationErrors).length) return { ok: false, errors: customizationErrors };

  const priced = await applyTrustedPricing(order);
  if (!priced.ok) return { ok: false, errors: priced.errors };

  try {
    await insertSupabaseOrder(priced.order);
  } catch (error: any) {
    // A failed design snapshot is a customer-facing outcome, not a 500: the
    // order was rolled back and they can safely retry (spec §14).
    if (error?.code === "ORDER_SNAPSHOT_FAILED") {
      return { ok: false, errors: { customization: error.message } };
    }
    throw error;
  }
  return { ok: true, order: priced.order };
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
