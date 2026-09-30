/**
 * A trusted price quote for the checkout page (display only).
 *
 * Uses exactly the resolver the order API uses, so the total a customer sees
 * before pressing "Place order" is the total the server will charge. A price
 * stored in the browser cart is never honoured: if the catalogue changed
 * since the item was added, the quote shows the current price and flags it.
 */

import type { CheckoutItemInput } from "@/lib/orders/checkout-schema";
import { priceLine, totalOrder, type TrustedLinePrice } from "@/lib/orders/pricing-resolver";
import { resolveDeliveryChargeMinor } from "@/lib/orders/checkout-policy";
import { fromMinorUnits } from "@/lib/money";

export type QuoteLine = {
  lineNumber: number;
  cartItemId: string | null;
  ok: boolean;
  unitPrice?: number;
  lineTotal?: number;
  currency?: string;
  error?: string;
};

export type Quote = {
  ok: boolean;
  lines: QuoteLine[];
  currency: string | null;
  subtotal: number | null;
  deliveryCharge: number;
  total: number | null;
  error?: string;
};

export function buildQuote(items: CheckoutItemInput[], products: Map<string, { product: Record<string, any> }>): Quote {
  const priced: TrustedLinePrice[] = [];
  const lines: QuoteLine[] = items.map((item) => {
    const result = priceLine(products.get(item.productId)?.product as Record<string, any>, item.selectedOptions, item.quantity);
    if (result.ok === false) return { lineNumber: item.lineNumber, cartItemId: item.cartItemId, ok: false, error: result.errors[0].message };
    priced.push(result.line);
    return {
      lineNumber: item.lineNumber,
      cartItemId: item.cartItemId,
      ok: true,
      unitPrice: fromMinorUnits(result.line.unitMinor),
      lineTotal: fromMinorUnits(result.line.lineMinor),
      currency: result.line.currency,
    };
  });

  const deliveryMinor = resolveDeliveryChargeMinor("delivery");
  if (priced.length !== items.length) {
    return { ok: false, lines, currency: null, subtotal: null, deliveryCharge: 0, total: null, error: "Some items in your cart need attention before you can check out." };
  }
  const totals = totalOrder(priced, deliveryMinor);
  if (totals.ok === false) {
    return { ok: false, lines, currency: null, subtotal: null, deliveryCharge: 0, total: null, error: totals.error.message };
  }
  return {
    ok: true,
    lines,
    currency: totals.totals.currency,
    subtotal: fromMinorUnits(totals.totals.subtotalMinor),
    deliveryCharge: fromMinorUnits(totals.totals.deliveryMinor),
    total: fromMinorUnits(totals.totals.totalMinor),
  };
}
