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
      checkoutSubmissionId: row.checkout_submission_id || metadata.checkoutSubmissionId || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    metadata
  );
}

// Shared compensation cleanup for a partially created order.
//
// CRITICAL: the Supabase JS client RESOLVES with `{ error }` rather than
// throwing, so wrapping a delete in try/catch proves nothing — the catch
// never fires and a failed rollback looks identical to a successful one.
// Every rollback path goes through here so the returned error is actually
// inspected and a stuck partial order is always loud in the server logs.
//
// Returns whether the order row is genuinely gone. order_items and
// order_design_snapshots cascade on orders.id, so deleting the order row
// removes the whole partial tree.
async function rollbackPartialOrder(
  supabase: ReturnType<typeof createServiceRoleClient>,
  orderId: string,
  stage: string,
): Promise<{ rolledBack: boolean }> {
  try {
    const { error } = await supabase.from("orders").delete().eq("id", orderId);
    if (error) {
      console.error(
        `[orders] ORDER_ROLLBACK_FAILED order=${orderId} stage=${stage}: a partial order row still exists and needs manual review.`,
        error,
      );
      return { rolledBack: false };
    }
    return { rolledBack: true };
  } catch (thrown) {
    // Network/transport level failure (the client does throw for these).
    console.error(
      `[orders] ORDER_ROLLBACK_FAILED order=${orderId} stage=${stage}: a partial order row still exists and needs manual review.`,
      thrown,
    );
    return { rolledBack: false };
  }
}

// Insert the order, then freeze every personalized design before the order is
// allowed to stand (spec §14).
//
// Supabase's REST client has no cross-table transaction, so this uses the
// compensation strategy the spec allows: the order row is only left standing
// once its items AND its permanent design snapshots exist. Either failure
// deletes the half-created order (order_items and snapshots cascade) so the
// customer can retry cleanly instead of ending up with an incomplete or
// unprintable order. A checkout_submission_id unique-index violation (a
// duplicate/retried request racing itself) is handled by the caller, not here.
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
      checkout_submission_id: order.checkoutSubmissionId || null,
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

    if (itemError) {
      // An order with no items is unusable — never leave it standing.
      console.error(`[orders] order_items insert failed for order ${data.id}:`, itemError);
      const { rolledBack } = await rollbackPartialOrder(supabase, data.id, "order_items");
      const wrapped: any = new Error("Could not save the order items. Please try again.");
      wrapped.code = "ORDER_ITEMS_FAILED";
      wrapped.cause = itemError;
      wrapped.rolledBack = rolledBack;
      throw wrapped;
    }

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
      const { rolledBack } = await rollbackPartialOrder(supabase, data.id, "order_design_snapshots");
      const error: any = new Error(verdict.error);
      error.code = "ORDER_SNAPSHOT_FAILED";
      error.snapshotFailures = outcome.failures;
      error.rolledBack = rolledBack;
      throw error;
    }

    // Only now is the design genuinely ordered.
    //
    // The immutable order_design_snapshots row is the production source of
    // truth, and it already exists at this point — so a failure to flip the
    // ORIGINAL customization to "ordered" must NOT destroy an otherwise
    // valid, fully snapshotted customer order. It is instead recorded so
    // Admin can resynchronise, and the customization is re-locked below.
    const { error: lockError } = await supabase
      .from("product_customizations")
      .update({ status: "ordered", order_id: data.id, updated_at: nowIso() })
      .in("id", customizationIds);

    if (lockError) {
      console.error(
        `[orders] CUSTOMIZATION_LOCK_FAILED order=${data.id} customizations=${customizationIds.join(",")}: the order and its immutable snapshot are valid, but the source customizations were not marked "ordered" and may still look editable.`,
        lockError,
      );
      // Make the desynchronisation visible to Admin instead of silent, and
      // retryable, without touching the valid order itself.
      await recordOrderProductionIssue(supabase, data.id, {
        code: "CUSTOMIZATION_LOCK_FAILED",
        customizationIds: customizationIds.map(String),
        message: lockError.message || "Could not mark customizations as ordered.",
      });
    }
  }

  return order;
}

// Record a non-fatal production problem on an order that is otherwise valid
// (customization lock desync, render enqueue failure, ...). Written into the
// order's metadata so Admin order details can surface it and a retry can
// clear it — never a reason to delete a placed order.
async function recordOrderProductionIssue(
  supabase: ReturnType<typeof createServiceRoleClient>,
  orderId: string,
  issue: { code: string; message: string; customizationIds?: string[] },
) {
  try {
    const { data: current, error: readError } = await supabase
      .from("orders")
      .select("metadata")
      .eq("id", orderId)
      .maybeSingle();
    if (readError || !current) {
      console.error(`[orders] Could not read order ${orderId} to record production issue ${issue.code}.`, readError);
      return;
    }
    const metadata = { ...(current.metadata || {}) };
    const issues = Array.isArray(metadata.productionIssues) ? metadata.productionIssues : [];
    issues.push({ ...issue, at: nowIso() });
    metadata.productionIssues = issues.slice(-20);
    const { error: writeError } = await supabase.from("orders").update({ metadata }).eq("id", orderId);
    if (writeError) {
      console.error(`[orders] Could not record production issue ${issue.code} on order ${orderId}.`, writeError);
    }
  } catch (thrown) {
    console.error(`[orders] Could not record production issue ${issue.code} on order ${orderId}.`, thrown);
  }
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

  if (customerId) query = query.eq("customer_id", customerId);
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
  const deliveryMethodInput = cleanString(input.deliveryMethod ?? existing.deliveryMethod).toLowerCase();
  const deliveryMethod = deliveryMethodInput === "store" ? "store" : "delivery";

  return {
    id: existing.id || cleanString(input.id) || createId("order"),
    customerId: cleanOptionalString(input.customerId ?? existing.customerId),
    productId: cleanOptionalString(input.productId ?? existing.productId),
    productTitle: cleanOptionalString(input.productTitle ?? existing.productTitle) || items[0]?.productTitle || "Cart order",
    productSlug: cleanOptionalString(input.productSlug ?? existing.productSlug) || items[0]?.productSlug || "",
    customerName: clampString(input.customerName ?? existing.customerName, 160),
    customerEmail: clampString(input.customerEmail ?? existing.customerEmail, 254).toLowerCase(),
    customerPhone: clampString(input.customerPhone ?? existing.customerPhone, 40),
    checkoutSubmissionId: clampString(input.checkoutSubmissionId ?? existing.checkoutSubmissionId, 100),
    address: deliveryMethod === "delivery" ? normalizeAddress(input, existing.address || {}) : {},
    deliveryMethod,
    deliveryChargeConfirmed: deliveryMethod === "store" ? true : Boolean(input.deliveryChargeConfirmed ?? existing.deliveryChargeConfirmed),
    paymentMethod: "Cash on Delivery",
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
  if (!order.customerPhone) errors.customerPhone = "Phone number is required.";
  if (order.deliveryMethod === "delivery" && !order.address?.addressLine1) errors.addressLine1 = "Delivery address is required.";
  if (order.deliveryMethod === "delivery" && !order.address?.city) errors.city = "Delivery city is required.";
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
    // Audit row only — a logging failure must not block a valid checkout.
    const { error: preflightLogError } = await supabase.from("customizer_preflight_results").insert({
      customization_id: customization.id,
      context: "checkout",
      ok: preflight.ok,
      blocking: preflight.blocking,
      issues: preflight.issues,
    });
    if (preflightLogError) {
      console.error(`[orders] Could not persist the checkout preflight audit row for customization ${customization.id}.`, preflightLogError);
    }
  }
  return {};
}

// Checkout idempotency (spec: double-click, slow network, or a resent
// request must never create a second order).
//
// SECURITY: an idempotency token is NOT an authorization token. The lookup is
// always scoped to the authenticated customer, so knowing (or guessing)
// another customer's submission id can never return their order. Uniqueness
// in the database is also customer-scoped (customer_id, checkout_submission_id),
// so two different customers reusing the same token are independent, while one
// customer resending their own token is still perfectly idempotent.
async function findOwnedOrderByCheckoutSubmissionId(checkoutSubmissionId: string, customerId: string) {
  if (!checkoutSubmissionId || !customerId) return null;
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*,order_items(*)")
    .eq("checkout_submission_id", checkoutSubmissionId)
    .eq("customer_id", customerId)
    .maybeSingle();
  if (error) throw error;
  return data ? orderFromSupabaseRow(data) : null;
}

export async function createOrderRequest(input) {
  const checkoutSubmissionId = clampString(input.checkoutSubmissionId, 100);
  if (!checkoutSubmissionId) {
    return { ok: false, errors: { checkoutSubmissionId: "A checkout submission id is required." } };
  }

  // The caller (the API route) has already replaced customerId with the
  // authenticated user's id — never a client-supplied value.
  const trustedCustomerId = cleanString(input.customerId);
  if (!trustedCustomerId) {
    return { ok: false, errors: { customerId: "Authentication is required to place an order." } };
  }

  // Fast path: this exact checkout attempt already succeeded for THIS
  // customer (a retried click, a resent request, or a slow response the
  // client never saw). Returning the existing order — not creating a new
  // one — is what makes this idempotent rather than merely rate-limited.
  const existingOrder = await findOwnedOrderByCheckoutSubmissionId(checkoutSubmissionId, trustedCustomerId);
  if (existingOrder) return { ok: true, order: existingOrder, idempotent: true };

  const product = input.productSlug ? await getProductBySlug(input.productSlug) : null;

  if (product?.isStockOut) {
    return { ok: false, errors: { product: "This product is currently stock out." } };
  }

  const order = normalizeOrderRequest({
    ...input,
    checkoutSubmissionId,
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
    // Lost a race to a concurrent identical request from THIS customer (same
    // submission id inserted a moment earlier): return their own order
    // instead of failing. The recovery lookup is ownership-scoped exactly
    // like the fast path, so a unique-index collision can never hand back a
    // row belonging to somebody else.
    if (error?.code === "23505" && String(error?.message || "").includes("checkout_submission_id")) {
      const raced = await findOwnedOrderByCheckoutSubmissionId(checkoutSubmissionId, trustedCustomerId);
      if (raced) return { ok: true, order: raced, idempotent: true };
      return { ok: false, errors: { checkoutSubmissionId: "This checkout could not be completed. Please start a new checkout." } };
    }
    // A failed order-items insert or design snapshot is a customer-facing
    // outcome, not a 500: the order was rolled back and they can safely
    // retry (spec §14).
    if (error?.code === "ORDER_SNAPSHOT_FAILED" || error?.code === "ORDER_ITEMS_FAILED") {
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

  const orders = await getOrderRequests(id ? { customerId: id } : { email: mail });

  return orders.filter((order) => {
    const matchesId = id && order.customerId === id;
    const matchesEmail = !id && mail && String(order.customerEmail || "").toLowerCase() === mail;
    return Boolean(matchesId || matchesEmail);
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

export async function updateOrderRequestDetails(id, input: any = {}) {
  const supabase = createServiceRoleClient();
  const { data: current, error: readError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) return { ok: false, errors: { order: "Order request not found." } };

  const patch: Record<string, any> = { updated_at: nowIso() };
  const metadata = { ...(current.metadata || {}) };
  if (input.status !== undefined) {
    const status = cleanString(input.status).toLowerCase();
    if (!ORDER_STATUSES.has(status)) return { ok: false, errors: { status: "Invalid order status." } };
    patch.status = status;
    metadata.status = status;
  }

  if (Object.prototype.hasOwnProperty.call(input, "deliveryCharge")) {
    const requested = Number(input.deliveryCharge);
    if (!Number.isFinite(requested) || requested < 0 || requested > 100000) {
      return { ok: false, errors: { deliveryCharge: "Enter a valid delivery charge." } };
    }
    const deliveryMethod = cleanString(metadata.deliveryMethod).toLowerCase() === "store" ? "store" : "delivery";
    const charge = deliveryMethod === "store" ? 0 : Number(requested.toFixed(2));
    const subtotal = Number(current.subtotal || 0);
    patch.delivery_charge = charge;
    patch.total = Number((subtotal + charge).toFixed(2));
    metadata.deliveryCharge = charge;
    metadata.total = patch.total;
    metadata.deliveryChargeConfirmed = true;
  }

  metadata.updatedAt = patch.updated_at;
  patch.metadata = metadata;
  const { data, error } = await supabase.from("orders").update(patch).eq("id", id).select("*,order_items(*)").maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, errors: { order: "Order request not found." } };
  return { ok: true, order: orderFromSupabaseRow(data) };
}

export async function deleteOrderRequest(id) {
  const supabase = createServiceRoleClient();
  const { error, count } = await supabase.from("orders").delete({ count: "exact" }).eq("id", id);

  if (error) throw error;
  if (!count) return { ok: false, errors: { order: "Order request not found." } };

  return { ok: true };
}
