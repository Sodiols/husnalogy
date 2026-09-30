/**
 * Server-side validation and normalization of the Bangladesh checkout form.
 *
 * Browser `required` attributes are a convenience only; these functions are
 * what decide whether a checkout request is accepted. Every value is
 * normalized (Unicode NFC, collapsed whitespace) and length-bounded, control
 * characters are refused, and markup characters are refused in fields that
 * never legitimately contain them — so nothing stored here can become HTML in
 * the admin panel, order history, a designer view or a future email template.
 */

// Bangladesh mobile numbers: 01 + operator digit 3-9 + 8 digits.
const BD_MOBILE = /^01[3-9]\d{8}$/;

/**
 * Normalize a Bangladesh mobile number to the canonical `+8801XXXXXXXXX`.
 * Accepts `01XXXXXXXXX`, `+8801XXXXXXXXX`, `8801XXXXXXXXX` and `008801…`,
 * with spaces, dashes, dots or parentheses as separators. Returns null for
 * anything else (landlines, wrong length, unknown operator prefix, letters).
 */
export function normalizeBangladeshPhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.length > 25) return null;
  if (!/^[+\d\s().-]+$/.test(raw)) return null;
  const plus = raw.startsWith("+");
  let digits = raw.replace(/\D/g, "");
  if (plus) {
    if (!digits.startsWith("880")) return null;
    digits = digits.slice(2); // keep the leading 0 of the national number
  } else if (digits.startsWith("00880")) {
    digits = digits.slice(4);
  } else if (digits.startsWith("880")) {
    digits = digits.slice(2);
  }
  if (!BD_MOBILE.test(digits)) return null;
  return `+88${digits}`;
}

// C0/C1 control characters except TAB/LF/CR, plus bidi overrides that can be
// used to disguise text in an admin view.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‪-‮⁦-⁩]/;
const MARKUP_CHARS = /[<>`]/;

export type TextRule = {
  min: number;
  max: number;
  /** Allow line breaks (delivery notes). */
  multiline?: boolean;
  /** Refuse `<`, `>` and backticks (names, addresses, cities). */
  noMarkup?: boolean;
  /** Extra shape check applied after normalization. */
  pattern?: RegExp;
};

export type TextResult = { ok: true; value: string } | { ok: false; reason: "required" | "too_short" | "too_long" | "invalid" };

export function normalizeText(input: unknown, rule: TextRule): TextResult {
  if (input === undefined || input === null) {
    return rule.min > 0 ? { ok: false, reason: "required" } : { ok: true, value: "" };
  }
  if (typeof input !== "string") return { ok: false, reason: "invalid" };
  // Bound the work before normalizing a hostile multi-megabyte string.
  if (input.length > rule.max * 4 + 64) return { ok: false, reason: "too_long" };
  if (CONTROL_CHARS.test(input)) return { ok: false, reason: "invalid" };
  let value = input.normalize("NFC");
  value = rule.multiline
    ? value.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()
    : value.replace(/\s+/g, " ").trim();
  if (!value) return rule.min > 0 ? { ok: false, reason: "required" } : { ok: true, value: "" };
  if (rule.noMarkup && MARKUP_CHARS.test(value)) return { ok: false, reason: "invalid" };
  if ([...value].length < rule.min) return { ok: false, reason: "too_short" };
  if ([...value].length > rule.max) return { ok: false, reason: "too_long" };
  if (rule.pattern && !rule.pattern.test(value)) return { ok: false, reason: "invalid" };
  return { ok: true, value };
}

/** A person's name: letters (any script), marks, spaces, and . ' - */
export const NAME_RULE: TextRule = { min: 2, max: 120, noMarkup: true, pattern: /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u };
export const CITY_RULE: TextRule = { min: 2, max: 80, noMarkup: true, pattern: /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .,'’()/-]*$/u };
export const AREA_RULE: TextRule = { min: 0, max: 100, noMarkup: true };
export const ADDRESS_RULE: TextRule = { min: 5, max: 300, noMarkup: true };
export const NOTE_RULE: TextRule = { min: 0, max: 500, multiline: true };
/** Bangladesh postcodes are four digits. */
export const POSTCODE_RULE: TextRule = { min: 0, max: 4, pattern: /^\d{4}$/ };
