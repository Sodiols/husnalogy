// Server-authoritative order maths (spec §13 "Pricing and product options" and
// non-negotiable rule 5: "Never trust customer submitted product prices or
// totals").
//
// Pure module — no Supabase, no network — so every trust rule is unit tested.
//
// What this replaces:
//   * `applyTrustedPricing` used to FAIL OPEN. When `getProducts()` threw, or
//     when a line item's product could not be resolved, it logged and kept the
//     browser-submitted `price`/`finalPrice`/`subtotal`/`total`. A tampered
//     cart payload for an unknown/renamed product id was therefore persisted at
//     the customer's own price.
//   * `validateSelectedOptions` existed and was unit tested but was never
//     called from the order path, so a customer could order a paper/size/
//     envelope combination the product does not offer — and pay nothing for it,
//     since an unknown option carries no surcharge.
//   * `deliveryCharge` was taken straight from the request body (clamped only
//     to <= 100000) and folded into the stored total.

import { calculateCustomizationPrice, validateSelectedOptions, type PricingBreakdown } from "@/lib/customizer/v2/pricing";

export type TrustedOrderItem = Record<string, any> & {
  productId?: string;
  productSlug?: string;
  quantity?: number;
  price?: number;
  finalPrice?: number;
  selectedOptions?: Record<string, unknown>;
  pricingBreakdown?: PricingBreakdown;
};

export type TrustedOrderResult = {
  ok: boolean;
  errors: Record<string, string>;
  order: Record<string, any>;
};

/**
 * The single place delivery pricing is decided. Husnalogy quotes delivery after
 * the order is reviewed, so the trusted value is 0 — but it is computed here,
 * server side, instead of being accepted from the browser. Put real delivery
 * rules in this function; nothing else needs to change.
 */
export function resolveDeliveryCharge(_order: Record<string, any>): number {
  return 0;
}

export function findProductForItem(
  item: TrustedOrderItem,
  products: Array<Record<string, any>>,
): Record<string, any> | null {
  const byId = item?.productId ? products.find((product) => String(product?.id) === String(item.productId)) : null;
  if (byId) return byId;
  const bySlug = item?.productSlug ? products.find((product) => String(product?.slug) === String(item.productSlug)) : null;
  return bySlug || null;
}

function itemLabel(item: TrustedOrderItem): string {
  return String(item?.productTitle || item?.title || item?.productSlug || "An item");
}

/**
 * Recalculate every line from the server-loaded product row and reject the
 * order when any line cannot be priced with confidence.
 *
 * `products` must be the server-loaded catalogue. Pass `null` to signal that
 * the catalogue could not be loaded at all — the order is then rejected rather
 * than persisted at customer-supplied prices.
 */
export function applyTrustedOrderPricing(
  order: Record<string, any>,
  products: Array<Record<string, any>> | null,
): TrustedOrderResult {
  const items: TrustedOrderItem[] = Array.isArray(order?.items) ? order.items : [];

  if (products === null) {
    return {
      ok: false,
      errors: { pricing: "We could not confirm current prices. Please try again in a moment." },
      order,
    };
  }

  if (!items.length) {
    const deliveryCharge = resolveDeliveryCharge(order);
    return {
      ok: true,
      errors: {},
      order: { ...order, subtotal: 0, deliveryCharge, total: round2(deliveryCharge) },
    };
  }

  const errors: Record<string, string> = {};
  const repriced = items.map((item) => {
    const product = findProductForItem(item, products);
    if (!product) {
      errors.product = `${itemLabel(item)} is no longer available. Remove it from your cart and try again.`;
      return item;
    }
    if (product.isStockOut) {
      errors.product = `${product.title || itemLabel(item)} is currently stock out.`;
      return item;
    }

    const optionCheck = validateSelectedOptions(product, item.selectedOptions || {});
    if (!optionCheck.ok) {
      errors.options = optionCheck.errors[0] || "A selected option is not available for this product.";
      return item;
    }

    const pricing = calculateCustomizationPrice(product, item.selectedOptions || {}, item.quantity);
    return {
      ...item,
      quantity: pricing.quantity,
      price: pricing.unitPrice,
      currency: pricing.currency,
      finalPrice: pricing.subtotal,
      pricingBreakdown: pricing,
    };
  });

  if (Object.keys(errors).length) return { ok: false, errors, order };

  const subtotal = round2(repriced.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0));
  const deliveryCharge = resolveDeliveryCharge(order);

  return {
    ok: true,
    errors: {},
    order: {
      ...order,
      items: repriced,
      subtotal,
      deliveryCharge,
      total: round2(subtotal + deliveryCharge),
    },
  };
}

/* ------------------------------------------------------- order snapshots -- */

export type SnapshotFailure = { customizationId: string; reason: string };

export type SnapshotOutcome = {
  created: number;
  failures: SnapshotFailure[];
};

/**
 * Spec §14: "The order must not be considered production ready when the
 * permanent snapshot fails. … Do not silently continue after critical snapshot
 * failure."
 *
 * Every customized line item must end up with an immutable design snapshot. If
 * any is missing the caller has to compensate (delete the half-created order)
 * and tell the customer, rather than shipping an order nobody can print.
 */
export function evaluateSnapshotOutcome(
  requiredCustomizationIds: string[],
  outcome: SnapshotOutcome,
): { ok: boolean; error: string } {
  const required = requiredCustomizationIds.filter(Boolean);
  if (!required.length) return { ok: true, error: "" };

  if (outcome.failures.length || outcome.created < required.length) {
    return {
      ok: false,
      error:
        "We could not lock in your personalized design for production. Nothing was charged — please reopen the design from your cart and try again.",
    };
  }
  return { ok: true, error: "" };
}

function round2(value: number): number {
  return Number((Number(value) || 0).toFixed(2));
}
