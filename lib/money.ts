/**
 * Money arithmetic in integer MINOR units (paisa for BDT, cents for USD).
 *
 * Every trusted price calculation converts to minor units once, does integer
 * arithmetic, and converts back only at the storage/response boundary. The
 * database columns are numeric(12,2), so the round trip is exact; floating
 * point sums such as 0.1 + 0.2 never reach an order total.
 */

/** numeric(12,2) holds at most 9,999,999,999.99. */
export const MAX_STORABLE_MINOR = 999_999_999_999;

/**
 * Parse a trusted, server-side money value (a number or a numeric string from
 * Postgres) into minor units. Returns null for anything that is not a finite,
 * non-negative amount with at most two decimals of meaningful precision.
 */
export function toMinorUnits(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const text = typeof value === "number" ? value.toFixed(6) : value.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  // Round half up on the third decimal, exactly, without floating point.
  const cents = Number(`${whole}${(fraction + "00").slice(0, 2)}`);
  const roundUp = Number((fraction + "000").charAt(2)) >= 5 ? 1 : 0;
  const minor = cents + roundUp;
  if (!Number.isSafeInteger(minor) || minor > MAX_STORABLE_MINOR) return null;
  return minor;
}

/** Minor units → a numeric(12,2)-compatible number (exact for our range). */
export function fromMinorUnits(minor: number): number {
  if (!Number.isSafeInteger(minor)) throw new RangeError("Money value is not a safe integer.");
  return Number((minor / 100).toFixed(2));
}

/** Minor units → the exact decimal string sent to Postgres. */
export function minorToDecimalString(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new RangeError("Money value must be a non-negative safe integer.");
  const whole = Math.floor(minor / 100);
  const fraction = String(minor % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}

/** Multiply a unit price by a quantity, refusing to overflow. */
export function multiplyMinor(unitMinor: number, quantity: number): number | null {
  const product = unitMinor * quantity;
  return Number.isSafeInteger(product) && product <= MAX_STORABLE_MINOR ? product : null;
}
