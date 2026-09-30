/**
 * The canonical, trusted pricing resolver.
 *
 * Pure and deterministic — no I/O — so every rule is unit tested. The ONLY
 * inputs that can influence money are server-loaded product rows; the
 * customer contributes nothing but WHICH configured option they chose and HOW
 * MANY units they want.
 *
 * The rule this module exists to enforce: a price is never parsed from text
 * the browser sent. Option selections historically arrived as display labels
 * carrying a price suffix ("Premium Linen +$0.40") and the surcharge was read
 * back out of that suffix — so editing it to "+$0" in DevTools made the option
 * free. Here a selection is matched to a configured option by IDENTITY (its
 * label or stable value, with any suffix discarded), and the surcharge is
 * always the one configured on the server.
 *
 * Everything fails closed: an unknown, inactive, hidden, ambiguous or
 * foreign option, a missing required option, an unsupported option key, a
 * product that is not currently purchasable, a missing/invalid price, an
 * unsupported or mixed currency, or an out-of-range quantity rejects the line.
 */

import { BUILT_IN_FORMAT_OPTIONS, parseProductOptionList, stripSurchargeFromLabel, type ParsedProductOption } from "@/lib/products/options";
import { normalizeCurrency, type SupportedCurrency } from "@/lib/currency";
import { CHECKOUT_ACCEPTED_CURRENCIES, CHECKOUT_LIMITS } from "@/lib/orders/checkout-policy";
import { fromMinorUnits, multiplyMinor, toMinorUnits } from "@/lib/money";

export type OptionGroupSpec = {
  key: string;
  productField: string;
  label: string;
  /** Used only when the product has no configured list for this group. */
  builtIn?: string[];
};

/** Every option group that exists in the product model, in display order. */
export const OPTION_GROUPS: readonly OptionGroupSpec[] = [
  { key: "format", productField: "formatOptions", label: "Format", builtIn: BUILT_IN_FORMAT_OPTIONS },
  { key: "size", productField: "sizeOptions", label: "Size" },
  { key: "paperStyle", productField: "paperStyleOptions", label: "Paper style" },
  { key: "paper", productField: "paperOptions", label: "Paper" },
  { key: "envelope", productField: "envelopeOptions", label: "Envelope" },
  { key: "corner", productField: "cornerOptions", label: "Corner style" },
  { key: "printing", productField: "printingOptions", label: "Printing process" },
];

/**
 * Keys the product page and customizer store alongside real options. They
 * never affect price. `logo` is a production instruction and is kept; the
 * others are editor bookkeeping and are dropped.
 */
const BOOKKEEPING_KEYS = new Set(["quantity", "customQty", "activePage"]);

export type ResolverErrorCode =
  | "PRODUCT_NOT_FOUND"
  | "PRODUCT_UNAVAILABLE"
  | "PRODUCT_OUT_OF_STOCK"
  | "PRODUCT_PRICE_INVALID"
  | "PRODUCT_CURRENCY_UNSUPPORTED"
  | "OPTION_UNKNOWN_GROUP"
  | "OPTION_INVALID_VALUE"
  | "OPTION_NOT_OFFERED"
  | "OPTION_UNAVAILABLE"
  | "OPTION_AMBIGUOUS"
  | "OPTION_REQUIRED"
  | "QUANTITY_INVALID"
  | "CURRENCY_MIXED"
  | "TOTAL_OUT_OF_RANGE";

export type ResolverError = { code: ResolverErrorCode; message: string; field?: string };

export type CanonicalOptions = Record<string, string | boolean>;

export type OptionCharge = {
  key: string;
  groupLabel: string;
  optionLabel: string;
  optionValue: string;
  amountMinor: number;
};

export type TrustedLinePrice = {
  currency: SupportedCurrency;
  quantity: number;
  baseMinor: number;
  optionsMinor: number;
  unitMinor: number;
  lineMinor: number;
  options: CanonicalOptions;
  charges: OptionCharge[];
};

/* -------------------------------------------------------------- products -- */

const UNAVAILABLE_AVAILABILITY = new Set(["unavailable", "discontinued", "archived", "internal"]);

/**
 * Whether a server-loaded product may be sold right now. Mirrors the public
 * catalogue rules (active, not hidden) and adds everything a sale needs.
 * `visibility: "direct"` products are link-only but purchasable.
 */
export function checkProductPurchasable(product: Record<string, any> | null | undefined): ResolverError | null {
  if (!product) return { code: "PRODUCT_NOT_FOUND", message: "An item in your cart is no longer available." };
  const title = String(product.title || "An item");
  if (product.status === "deleted" || product.deletedAt) {
    return { code: "PRODUCT_UNAVAILABLE", message: `${title} is no longer available.` };
  }
  if (product.status !== "active" || String(product.visibility || "public") === "hidden") {
    return { code: "PRODUCT_UNAVAILABLE", message: `${title} is not available for purchase.` };
  }
  if (UNAVAILABLE_AVAILABILITY.has(String(product.availability || "").toLowerCase())) {
    return { code: "PRODUCT_UNAVAILABLE", message: `${title} is not available for purchase.` };
  }
  if (product.isStockOut) {
    return { code: "PRODUCT_OUT_OF_STOCK", message: `${title} is currently out of stock.` };
  }
  const base = toMinorUnits(product.salePrice ?? product.price);
  if (base === null || base <= 0) {
    return { code: "PRODUCT_PRICE_INVALID", message: `${title} does not have a valid price right now.` };
  }
  const currency = normalizeCurrency(product.currency);
  if (!CHECKOUT_ACCEPTED_CURRENCIES.includes(currency)) {
    return { code: "PRODUCT_CURRENCY_UNSUPPORTED", message: `${title} cannot be ordered online in ${currency}.` };
  }
  return null;
}

/* --------------------------------------------------------------- options -- */

/** Identity of an option label: suffix-free, whitespace/case/× insensitive. */
export function optionIdentity(value: unknown): string {
  return stripSurchargeFromLabel(String(value ?? ""))
    .normalize("NFC")
    .replace(/×/g, "x")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function groupOptions(product: Record<string, any>, group: OptionGroupSpec): ParsedProductOption[] {
  const configured = parseProductOptionList(product?.[group.productField]);
  if (configured.length || !group.builtIn) return configured;
  return parseProductOptionList(group.builtIn);
}

type OptionMatch = { ok: true; option: ParsedProductOption } | { ok: false; error: ResolverError };

function matchOption(group: OptionGroupSpec, options: ParsedProductOption[], raw: string): OptionMatch {
  const identity = optionIdentity(raw);
  const candidates = options.filter(
    (option) => optionIdentity(option.displayLabel) === identity || optionIdentity(option.value) === identity,
  );
  if (!candidates.length) {
    return {
      ok: false,
      error: { code: "OPTION_NOT_OFFERED", field: group.key, message: `${group.label} "${stripSurchargeFromLabel(raw).slice(0, 80)}" is not offered for this product.` },
    };
  }
  const available = candidates.filter((option) => option.active && option.customerVisible);
  if (!available.length) {
    return { ok: false, error: { code: "OPTION_UNAVAILABLE", field: group.key, message: `The selected ${group.label.toLowerCase()} is no longer available.` } };
  }
  const surcharges = new Set(available.map((option) => toMinorUnits(option.surcharge) ?? -1));
  if (surcharges.size > 1) {
    // Two configured options share an identity but not a price: refuse to guess.
    return { ok: false, error: { code: "OPTION_AMBIGUOUS", field: group.key, message: `The selected ${group.label.toLowerCase()} could not be identified. Please choose it again.` } };
  }
  return { ok: true, option: available[0] };
}

export type ResolvedOptions =
  | { ok: true; options: CanonicalOptions; charges: OptionCharge[] }
  | { ok: false; errors: ResolverError[] };

/**
 * Resolve a customer's option choices for one product into canonical
 * selections and server-priced charges.
 */
export function resolveSelectedOptions(product: Record<string, any>, raw: Record<string, unknown> | null | undefined): ResolvedOptions {
  const selections = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const errors: ResolverError[] = [];
  const options: CanonicalOptions = {};
  const charges: OptionCharge[] = [];
  const known = new Set(OPTION_GROUPS.map((group) => group.key));

  for (const key of Object.keys(selections)) {
    if (known.has(key) || BOOKKEEPING_KEYS.has(key) || key === "logo") continue;
    errors.push({ code: "OPTION_UNKNOWN_GROUP", field: key, message: `"${key.slice(0, 40)}" is not an option for this product.` });
  }

  if (selections.logo !== undefined) {
    if (typeof selections.logo !== "boolean") {
      errors.push({ code: "OPTION_INVALID_VALUE", field: "logo", message: "The logo choice is invalid." });
    } else {
      options.logo = selections.logo;
    }
  }

  for (const group of OPTION_GROUPS) {
    const list = groupOptions(product, group);
    const offered = list.filter((option) => option.active && option.customerVisible);
    const value = selections[group.key];

    if (value === undefined || value === null || value === "") {
      if (offered.length) {
        errors.push({ code: "OPTION_REQUIRED", field: group.key, message: `Please choose a ${group.label.toLowerCase()}.` });
      }
      continue;
    }
    if (typeof value !== "string") {
      errors.push({ code: "OPTION_INVALID_VALUE", field: group.key, message: `${group.label} has an invalid value.` });
      continue;
    }
    const match = matchOption(group, list, value);
    if (match.ok === false) {
      errors.push(match.error);
      continue;
    }
    const amountMinor = toMinorUnits(match.option.surcharge);
    if (amountMinor === null) {
      errors.push({ code: "OPTION_INVALID_VALUE", field: group.key, message: `${group.label} has no valid price configured.` });
      continue;
    }
    options[group.key] = match.option.displayLabel;
    if (amountMinor > 0) {
      charges.push({
        key: group.key,
        groupLabel: group.label,
        optionLabel: match.option.displayLabel,
        optionValue: match.option.value,
        amountMinor,
      });
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, options, charges };
}

/** Two canonical option sets describe the same purchasable configuration. */
export function sameCanonicalOptions(left: CanonicalOptions, right: CanonicalOptions): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (key === "logo") continue; // production preference, never priced
    if (optionIdentity(left[key]) !== optionIdentity(right[key])) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ lines -- */

export type LinePriceResult = { ok: true; line: TrustedLinePrice } | { ok: false; errors: ResolverError[] };

export function priceLine(product: Record<string, any>, selectedOptions: Record<string, unknown>, quantity: unknown): LinePriceResult {
  const unavailable = checkProductPurchasable(product);
  if (unavailable) return { ok: false, errors: [unavailable] };

  if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > CHECKOUT_LIMITS.maxLineQuantity) {
    return { ok: false, errors: [{ code: "QUANTITY_INVALID", field: "quantity", message: `Quantity must be a whole number between 1 and ${CHECKOUT_LIMITS.maxLineQuantity}.` }] };
  }

  const resolved = resolveSelectedOptions(product, selectedOptions);
  if (resolved.ok === false) return { ok: false, errors: resolved.errors };

  const baseMinor = toMinorUnits(product.salePrice ?? product.price) as number;
  const optionsMinor = resolved.charges.reduce((sum, charge) => sum + charge.amountMinor, 0);
  const unitMinor = baseMinor + optionsMinor;
  const lineMinor = multiplyMinor(unitMinor, quantity);
  if (lineMinor === null || lineMinor > CHECKOUT_LIMITS.maxOrderTotalMinor) {
    return { ok: false, errors: [{ code: "TOTAL_OUT_OF_RANGE", field: "quantity", message: "This quantity is too large to order online. Please contact us." }] };
  }

  return {
    ok: true,
    line: {
      currency: normalizeCurrency(product.currency),
      quantity,
      baseMinor,
      optionsMinor,
      unitMinor,
      lineMinor,
      options: resolved.options,
      charges: resolved.charges,
    },
  };
}

export type OrderTotals = { currency: SupportedCurrency; subtotalMinor: number; deliveryMinor: number; totalMinor: number };

export function totalOrder(lines: TrustedLinePrice[], deliveryMinor: number): { ok: true; totals: OrderTotals } | { ok: false; error: ResolverError } {
  const currencies = new Set(lines.map((line) => line.currency));
  if (currencies.size !== 1) {
    return { ok: false, error: { code: "CURRENCY_MIXED", message: "Items priced in different currencies cannot be ordered together." } };
  }
  const subtotalMinor = lines.reduce((sum, line) => sum + line.lineMinor, 0);
  const totalMinor = subtotalMinor + deliveryMinor;
  if (!Number.isSafeInteger(totalMinor) || totalMinor > CHECKOUT_LIMITS.maxOrderTotalMinor || deliveryMinor < 0) {
    return { ok: false, error: { code: "TOTAL_OUT_OF_RANGE", message: "This order is too large to place online. Please contact us." } };
  }
  return { ok: true, totals: { currency: lines[0].currency, subtotalMinor, deliveryMinor, totalMinor } };
}

/** A JSON-friendly pricing breakdown for order items and snapshots. */
export function pricingBreakdown(line: TrustedLinePrice) {
  return {
    currency: line.currency,
    quantity: line.quantity,
    basePrice: fromMinorUnits(line.baseMinor),
    optionSurcharges: line.charges.map((charge) => ({
      key: charge.key,
      label: charge.groupLabel,
      option: charge.optionLabel,
      amount: fromMinorUnits(charge.amountMinor),
    })),
    optionsTotal: fromMinorUnits(line.optionsMinor),
    unitPrice: fromMinorUnits(line.unitMinor),
    subtotal: fromMinorUnits(line.lineMinor),
    minorUnits: { base: line.baseMinor, options: line.optionsMinor, unit: line.unitMinor, line: line.lineMinor },
  };
}
