// Product option entries — shared by the product page, the customer
// customizer's Options panel, and the admin Product Options manager.
//
// Backward compatibility is the core rule here. Historically every option list
// (sizeOptions, paperOptions, …) was an array of plain strings whose label
// could carry a "+$x" surcharge suffix that getOptionsSurcharge() parses from
// the saved selection. Rich options are stored as objects alongside those
// strings in the same JSONB arrays; when a rich option is selected we store its
// label plus a "+$x" suffix so the existing surcharge parser and every cart /
// order consumer keep working unchanged.

export type RichProductOption = {
  label: string;
  value?: string;
  description?: string;
  image?: string;
  surcharge?: number;
  badge?: string; // "Best Seller" | "Recommended" | custom
  isDefault?: boolean;
  active?: boolean; // default true; inactive options are hidden from customers
  customerVisible?: boolean; // default true
};

export type ProductOptionEntry = string | RichProductOption;

export type ParsedProductOption = {
  kind: "string" | "object";
  /** Internal value (stable id for the option). */
  value: string;
  /** Full label as stored (strings may still carry "+$x"). */
  label: string;
  /** Label with any "+$x" suffix removed — what the customer reads. */
  displayLabel: string;
  /** The string persisted into selectedOptions so surcharge parsing works. */
  cartValue: string;
  description: string;
  image: string;
  badge: string;
  surcharge: number;
  isDefault: boolean;
  active: boolean;
  customerVisible: boolean;
};

function cleanText(value: any, max = 500): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function toSurcharge(value: any): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Number(num.toFixed(2)) : 0;
}

export function parseSurchargeFromLabel(label: string): number {
  const match = String(label || "").match(/\+\s*(?:৳|\$|BDT\s*)?\s*(\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : 0;
}

export function stripSurchargeFromLabel(label: string): string {
  return String(label || "")
    .replace(/\s*[\(\[]?\+\s*(?:৳|\$|BDT\s*)?\s*\d+(?:\.\d+)?[\)\]]?\s*$/i, "")
    .trim();
}

export function optionValueFromLabel(label: string): string {
  return (
    String(label || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "option"
  );
}

export function formatSurcharge(surcharge: number): string {
  if (!surcharge) return "";
  return `+$${surcharge.toFixed(2)}`;
}

function cartValueFor(displayLabel: string, surcharge: number): string {
  if (!surcharge) return displayLabel;
  return `${displayLabel} +$${surcharge.toFixed(2)}`;
}

export function parseProductOption(entry: ProductOptionEntry): ParsedProductOption | null {
  if (typeof entry === "string") {
    const label = cleanText(entry);
    if (!label) return null;
    const surcharge = parseSurchargeFromLabel(label);
    const displayLabel = stripSurchargeFromLabel(label) || label;
    return {
      kind: "string",
      value: optionValueFromLabel(displayLabel),
      label,
      displayLabel,
      cartValue: label,
      description: "",
      image: "",
      badge: "",
      surcharge,
      isDefault: false,
      active: true,
      customerVisible: true,
    };
  }

  if (!entry || typeof entry !== "object") return null;
  const displayLabel = stripSurchargeFromLabel(cleanText(entry.label)) || cleanText(entry.label);
  if (!displayLabel) return null;
  const surcharge = toSurcharge(entry.surcharge) || parseSurchargeFromLabel(cleanText(entry.label));
  return {
    kind: "object",
    value: cleanText(entry.value) || optionValueFromLabel(displayLabel),
    label: displayLabel,
    displayLabel,
    cartValue: cartValueFor(displayLabel, surcharge),
    description: cleanText(entry.description, 300),
    image: cleanText(entry.image, 2000),
    badge: cleanText(entry.badge, 40),
    surcharge,
    isDefault: entry.isDefault === true,
    active: entry.active !== false,
    customerVisible: entry.customerVisible !== false,
  };
}

// Parse a whole list. Inactive / customer-hidden options are kept by default
// (admin views need them); pass customerFacing to filter to what customers see.
export function parseProductOptionList(
  value: any,
  { customerFacing = false, fallback = [] as ProductOptionEntry[] } = {},
): ParsedProductOption[] {
  const source = Array.isArray(value) && value.length ? value : fallback;
  const parsed = source
    .map(parseProductOption)
    .filter(Boolean) as ParsedProductOption[];
  if (!customerFacing) return parsed;
  return parsed.filter((option) => option.active && option.customerVisible);
}

// Normalize a list for storage: strings stay strings, objects are cleaned.
// Invalid entries are dropped. Used when saving products / admin edits.
export function normalizeProductOptionEntries(value: any, fallback: ProductOptionEntry[] = []): ProductOptionEntry[] {
  if (!Array.isArray(value)) {
    if (value === undefined || value === null) return fallback;
    // Legacy textarea form: newline-separated labels.
    const lines = String(value)
      .split("\n")
      .map((line) => cleanText(line))
      .filter(Boolean);
    return lines.length ? lines : fallback;
  }

  const entries: ProductOptionEntry[] = [];
  value.forEach((entry) => {
    if (typeof entry === "string") {
      const label = cleanText(entry);
      if (label) entries.push(label);
      return;
    }
    if (entry && typeof entry === "object") {
      const label = cleanText((entry as any).label);
      if (!label) return;
      const rich: RichProductOption = {
        label,
        value: cleanText((entry as any).value) || optionValueFromLabel(stripSurchargeFromLabel(label)),
        description: cleanText((entry as any).description, 300),
        image: cleanText((entry as any).image, 2000),
        surcharge: toSurcharge((entry as any).surcharge),
        badge: cleanText((entry as any).badge, 40),
        isDefault: (entry as any).isDefault === true,
        active: (entry as any).active !== false,
        customerVisible: (entry as any).customerVisible !== false,
      };
      entries.push(rich);
    }
  });
  // An explicit array is authoritative — an admin clearing every option means
  // "no options", not "use the defaults". Fallback applies only when the value
  // was missing entirely (handled above).
  return entries;
}

// The default selection for a list: the flagged default, else the first
// customer-visible option.
export function getDefaultOptionCartValue(value: any, fallback: ProductOptionEntry[] = []): string {
  const options = parseProductOptionList(value, { customerFacing: true, fallback });
  if (!options.length) return "";
  const flagged = options.find((option) => option.isDefault);
  return (flagged || options[0]).cartValue;
}

// Surcharge for a saved selection string against a configured list. Falls back
// to parsing "+$x" from the stored string (legacy behaviour) when the option
// is not found — so old carts keep pricing correctly.
export function getSurchargeForSelection(selection: string, value: any): number {
  const stored = cleanText(selection);
  if (!stored) return 0;
  const options = parseProductOptionList(value);
  const match = options.find((option) => option.cartValue === stored || option.displayLabel === stored || option.label === stored);
  if (match) return match.surcharge;
  return parseSurchargeFromLabel(stored);
}

export const DEFAULT_FORMAT_OPTIONS: ProductOptionEntry[] = [
  "Printed Flat Card",
  "Prints + Instant Download",
  "Instant Download",
];
