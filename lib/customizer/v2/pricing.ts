// Server-side customization pricing (spec §31). The single trusted price
// calculation — clients may display estimates but every persisted price
// (cart snapshot, order snapshot) comes from here.

import { getSurchargeForSelection } from "@/lib/products/options";

export type PricingLineItem = {
  key: string;
  label: string;
  amount: number;
};

export type PricingBreakdown = {
  basePrice: number;
  optionSurcharges: PricingLineItem[];
  optionsTotal: number;
  unitPrice: number;
  quantity: number;
  subtotal: number;
  currency: string;
};

// Option keys that carry surcharges, mapped to the product's configured lists.
const OPTION_LIST_MAP: Array<{ key: string; productField: string; label: string }> = [
  { key: "format", productField: "formatOptions", label: "Format" },
  { key: "size", productField: "sizeOptions", label: "Size" },
  { key: "paper", productField: "paperOptions", label: "Paper" },
  { key: "paperStyle", productField: "paperStyleOptions", label: "Paper style" },
  { key: "envelope", productField: "envelopeOptions", label: "Envelope" },
  { key: "corner", productField: "cornerOptions", label: "Corner style" },
  { key: "printing", productField: "printingOptions", label: "Printing process" },
];

function round2(value: number): number {
  return Number(value.toFixed(2));
}

// Calculate the trusted price for a product + selected options + quantity.
// `product` must be the server-loaded product row, never client input.
export function calculateCustomizationPrice(
  product: Record<string, any>,
  selectedOptions: Record<string, unknown> = {},
  quantity = 1,
): PricingBreakdown {
  const basePrice = round2(Number(product?.salePrice ?? product?.price ?? 0) || 0);
  const safeQuantity = Math.max(1, Math.min(9999, Math.round(Number(quantity) || 1)));

  const optionSurcharges: PricingLineItem[] = [];
  for (const { key, productField, label } of OPTION_LIST_MAP) {
    const selection = selectedOptions?.[key];
    if (typeof selection !== "string" || !selection.trim()) continue;
    const surcharge = getSurchargeForSelection(selection, product?.[productField]);
    if (surcharge > 0) {
      optionSurcharges.push({ key, label, amount: round2(surcharge) });
    }
  }

  const optionsTotal = round2(optionSurcharges.reduce((sum, item) => sum + item.amount, 0));
  const unitPrice = round2(basePrice + optionsTotal);
  return {
    basePrice,
    optionSurcharges,
    optionsTotal,
    unitPrice,
    quantity: safeQuantity,
    subtotal: round2(unitPrice * safeQuantity),
    currency: String(product?.currency || "BDT"),
  };
}

// Validate that every selected option value exists in the product's configured
// lists (spec §21 — "Confirm product options are valid"). Unknown keys are
// allowed (quantity, logo, activePage bookkeeping), but a value provided for a
// known option list must match one of its entries or legacy free-text format.
export function validateSelectedOptions(
  product: Record<string, any>,
  selectedOptions: Record<string, unknown> = {},
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const { key, productField, label } of OPTION_LIST_MAP) {
    const selection = selectedOptions?.[key];
    if (selection === undefined || selection === null || selection === "") continue;
    if (typeof selection !== "string") {
      errors.push(`${label} has an invalid value.`);
      continue;
    }
    const list = product?.[productField];
    if (!Array.isArray(list) || !list.length) continue; // product has no list configured — accept
    const values = new Set<string>();
    for (const entry of list) {
      if (typeof entry === "string") {
        values.add(entry.trim());
      } else if (entry && typeof entry === "object") {
        const lbl = String((entry as any).label || "").trim();
        if (lbl) values.add(lbl);
        const surcharge = Number((entry as any).surcharge) || 0;
        if (lbl && surcharge > 0) values.add(`${lbl.replace(/\s*[\(\[]?\+\s*(?:৳|\$|BDT\s*)?\s*\d+(?:\.\d+)?[\)\]]?\s*$/i, "").trim()} +$${surcharge.toFixed(2)}`);
        const stripped = lbl.replace(/\s*[\(\[]?\+\s*(?:৳|\$|BDT\s*)?\s*\d+(?:\.\d+)?[\)\]]?\s*$/i, "").trim();
        if (stripped) values.add(stripped);
      }
    }
    const cleaned = selection.trim();
    const strippedSelection = cleaned.replace(/\s*[\(\[]?\+\s*(?:৳|\$|BDT\s*)?\s*\d+(?:\.\d+)?[\)\]]?\s*$/i, "").trim();
    if (!values.has(cleaned) && !values.has(strippedSelection)) {
      errors.push(`${label} "${strippedSelection}" is not an available option for this product.`);
    }
  }
  return { ok: errors.length === 0, errors };
}
