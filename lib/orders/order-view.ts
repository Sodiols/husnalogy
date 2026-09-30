/**
 * Database row → order object used by the admin panel, the customer order
 * history and the checkout response.
 *
 * Orders created by the hardened checkout only contain server-built values.
 * Orders created BEFORE it may still carry browser-supplied media URLs in
 * their item metadata (`previewImages`, `uploadedFiles[*].signedUrl`), which
 * the admin panel renders as <img>/<a>. Those URLs are filtered here to
 * same-origin paths and this project's Supabase storage, so a legacy row can
 * never point an administrator's browser at an arbitrary host or scheme.
 */

import { normalizeCurrency } from "@/lib/currency";

function storageHost(): string {
  try {
    return new URL(String(process.env.NEXT_PUBLIC_SUPABASE_URL || "")).host;
  } catch {
    return "";
  }
}

export function safeMediaUrl(value: unknown): string {
  const url = typeof value === "string" ? value.trim() : "";
  if (!url) return "";
  if (url.startsWith("/") && !url.startsWith("//") && !url.includes("\\")) return url;
  try {
    const parsed = new URL(url);
    const host = storageHost();
    return parsed.protocol === "https:" && host && parsed.host === host ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function sanitizeMediaTree(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || value === undefined) return value ?? null;
  if (typeof value === "string") {
    return /^(https?:|\/\/|javascript:|data:|vbscript:)/i.test(value.trim()) ? safeMediaUrl(value) : value;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => sanitizeMediaTree(entry, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      out[key] = sanitizeMediaTree(entry, depth + 1);
    }
    return out;
  }
  return value;
}

const asObject = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};

function itemFromRow(item: Record<string, any>, orderCurrency: string) {
  const meta = asObject(item.metadata);
  return {
    id: item.id,
    lineNumber: Number(item.line_number) || 0,
    productId: item.product_id || "",
    productSlug: item.product_slug || "",
    productTitle: item.product_title || "",
    sku: item.product_sku || "",
    image: safeMediaUrl(item.product_image),
    price: Number(item.unit_price || 0),
    currency: normalizeCurrency(item.currency || meta.currency || orderCurrency),
    quantity: Number(item.quantity || 1),
    selectedOptions: asObject(item.selected_options),
    customizationValues: sanitizeMediaTree(asObject(item.customization_values)) as Record<string, unknown>,
    uploadedFiles: sanitizeMediaTree(asObject(item.uploaded_files)) as Record<string, unknown>,
    previewData: sanitizeMediaTree(asObject(item.preview_data)) as Record<string, unknown>,
    previewImages: sanitizeMediaTree(asObject(meta.previewImages)) as Record<string, unknown>,
    customizationId: item.customization_id || meta.customizationId || "",
    templateId: meta.templateId || "",
    templateVersion: Number(meta.templateVersion) || 0,
    pricing: asObject(item.pricing),
    finalPrice: Number(item.line_total || 0),
  };
}

export function orderFromRow(row: Record<string, any> = {}) {
  const metadata = asObject(row.metadata);
  const currency = normalizeCurrency(row.currency || metadata.currency);
  const items = Array.isArray(row.order_items)
    ? [...row.order_items]
        .sort((a, b) => (Number(a.line_number) || 0) - (Number(b.line_number) || 0) || String(a.created_at || "").localeCompare(String(b.created_at || "")))
        .map((item) => itemFromRow(item, currency))
    : [];
  const deliveryMethod = row.delivery_method === "store" || metadata.deliveryMethod === "store" ? "store" : "delivery";

  return {
    id: row.id,
    customerId: row.customer_id || "",
    customerName: row.customer_name || "",
    customerEmail: row.customer_email || "",
    customerPhone: row.customer_phone || "",
    productId: row.product_id || "",
    productTitle: row.product_title || items[0]?.productTitle || "Order",
    productSlug: row.product_slug || "",
    items,
    subtotal: Number(row.subtotal || 0),
    deliveryCharge: Number(row.delivery_charge || 0),
    total: Number(row.total || 0),
    currency,
    paymentStatus: row.payment_status || "unpaid",
    paymentMethod: metadata.paymentMethod || "Cash on Delivery",
    status: row.status || "pending",
    checkoutState: row.checkout_state || "finalized",
    message: row.message || "",
    address: asObject(row.address),
    deliveryMethod,
    deliveryChargeConfirmed: deliveryMethod === "store" || Boolean(metadata.deliveryChargeConfirmed),
    customizationDetails: sanitizeMediaTree(asObject(row.customization_details || metadata.customizationDetails)) as Record<string, unknown>,
    uploadedFiles: sanitizeMediaTree(asObject(row.uploaded_files)) as Record<string, unknown>,
    eventDate: typeof metadata.eventDate === "string" ? metadata.eventDate : "",
    checkoutSubmissionId: row.checkout_submission_id || "",
    termsVersion: row.terms_version || "",
    termsAcceptedAt: row.terms_accepted_at || null,
    productionIssues: Array.isArray(metadata.productionIssues) ? metadata.productionIssues : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type OrderView = ReturnType<typeof orderFromRow>;

/** What a customer may see about their own order (no internal diagnostics). */
export function toCustomerOrderView(order: OrderView) {
  const { productionIssues: _issues, checkoutSubmissionId: _submission, ...visible } = order;
  return visible;
}
