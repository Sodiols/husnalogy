export const PRIMARY_CURRENCY = "BDT" as const;
export const SECONDARY_CURRENCY = "USD" as const;
export const SUPPORTED_CURRENCIES = [PRIMARY_CURRENCY, SECONDARY_CURRENCY] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function normalizeCurrency(value: unknown): SupportedCurrency {
  const currency = String(value || "").trim().toUpperCase();
  return currency === SECONDARY_CURRENCY ? SECONDARY_CURRENCY : PRIMARY_CURRENCY;
}

export function getCurrencySymbol(value: unknown): string {
  return normalizeCurrency(value) === SECONDARY_CURRENCY ? "$" : "৳";
}

export function formatCurrency(
  value: unknown,
  currency: unknown = PRIMARY_CURRENCY,
  options: { maximumFractionDigits?: number; minimumFractionDigits?: number } = {},
): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  const normalized = normalizeCurrency(currency);
  const maximumFractionDigits = options.maximumFractionDigits ?? 2;
  const minimumFractionDigits = options.minimumFractionDigits ?? 2;
  const formatted = new Intl.NumberFormat(normalized === "BDT" ? "en-BD" : "en-US", {
    maximumFractionDigits,
    minimumFractionDigits,
  }).format(amount);
  return `${getCurrencySymbol(normalized)}${formatted}`;
}

export function formatCurrencySurcharge(value: unknown, currency: unknown = PRIMARY_CURRENCY): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return `+${formatCurrency(amount, currency)}`;
}
