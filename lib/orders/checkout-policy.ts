/**
 * Server-side checkout policy. One place for every limit the checkout API
 * enforces, so the request schema, the pricing resolver, the tests and the
 * documentation cannot drift apart.
 */

import { PRIMARY_CURRENCY, type SupportedCurrency } from "@/lib/currency";

/**
 * Currencies an order may be placed in. The Bangladesh launch is Cash on
 * Delivery in BDT only: a product priced in any other currency is refused at
 * checkout rather than summed into a BDT total.
 */
export const CHECKOUT_ACCEPTED_CURRENCIES: readonly SupportedCurrency[] = [PRIMARY_CURRENCY];

/**
 * The version of /terms the customer must explicitly accept. Bump it whenever
 * the published terms change; older clients are then asked to accept again.
 */
export const CURRENT_TERMS_VERSION = "2026-09-30";

export const CHECKOUT_LIMITS = {
  /** Serialized request body. A 50-line cart is ~20 KB. */
  maxBodyBytes: 64 * 1024,
  maxItems: 50,
  maxLineQuantity: 10_000,
  /** 100,000,000.00 in minor units — far above any real stationery order. */
  maxOrderTotalMinor: 10_000_000_000,
  submissionIdMinLength: 16,
  submissionIdMaxLength: 100,
} as const;

/** Payment is Cash on Delivery; the initial states are fixed server side. */
export const COD_INITIAL_STATE = {
  paymentMethod: "cash_on_delivery",
  paymentMethodLabel: "Cash on Delivery",
  paymentStatus: "unpaid",
  orderStatus: "pending",
} as const;

export const DELIVERY_METHODS = ["delivery", "store"] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

/**
 * The single place delivery pricing is decided. Husnalogy quotes delivery
 * after reviewing the destination, and store pickup is free, so the trusted
 * charge at checkout is 0 for both — the admin records the confirmed charge
 * later. Nothing from the browser can influence this value.
 */
export function resolveDeliveryChargeMinor(_method: DeliveryMethod): number {
  return 0;
}
