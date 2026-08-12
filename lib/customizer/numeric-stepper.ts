export type NumericStepperRules = {
  minimum?: number;
  maximum?: number;
  step?: number;
  largeStep?: number;
  allowNegative?: boolean;
  allowDecimal?: boolean;
};

export function decimalPlaces(value: number): number {
  const text = String(value);
  if (text.includes("e-")) return Math.min(8, Number(text.split("e-")[1]) || 0);
  return text.includes(".") ? text.split(".")[1].length : 0;
}

export function clampNumericValue(value: number, rules: NumericStepperRules = {}): number {
  const minimum = Number.isFinite(rules.minimum) ? Number(rules.minimum) : -Infinity;
  const maximum = Number.isFinite(rules.maximum) ? Number(rules.maximum) : Infinity;
  let next = Number.isFinite(value) ? value : Number.isFinite(minimum) ? minimum : 0;
  if (rules.allowNegative === false) next = Math.max(0, next);
  next = Math.min(maximum, Math.max(minimum, next));
  if (rules.allowDecimal === false) next = Math.round(next);
  const precision = rules.allowDecimal === false ? 0 : Math.max(decimalPlaces(rules.step || 1), 4);
  return Number(next.toFixed(precision));
}

export function sanitizeNumericDraft(raw: string, rules: NumericStepperRules = {}): string | null {
  const value = String(raw).replace(/,/g, ".").trim();
  const sign = rules.allowNegative === false ? "" : "-?";
  const fraction = rules.allowDecimal === false ? "\\d*" : "(?:\\d+(?:\\.\\d*)?|\\.\\d*)";
  return new RegExp(`^${sign}${fraction}$`).test(value) ? value : null;
}

export function parseNumericDraft(raw: string, fallback: number, rules: NumericStepperRules = {}): number {
  const sanitized = sanitizeNumericDraft(raw, rules);
  if (sanitized === null || sanitized === "" || sanitized === "-" || sanitized === "." || sanitized === "-.") {
    return clampNumericValue(fallback, rules);
  }
  const parsed = Number(sanitized);
  return clampNumericValue(Number.isFinite(parsed) ? parsed : fallback, rules);
}

export function stepNumericValue(value: number, direction: -1 | 1, rules: NumericStepperRules = {}, large = false): number {
  const amount = large ? rules.largeStep ?? Math.max((rules.step || 1) * 10, 1) : rules.step || 1;
  return clampNumericValue(value + direction * amount, rules);
}

// Format for display. Two rules matter for the text toolbars:
//   1. Never lose precision the value actually carries. A 0.1 step must still
//      render a stored line height of 1.15 as "1.15", not "1.1".
//   2. Only trim trailing zeros inside the fraction. Trimming the whole string
//      turned a letter spacing of 10 ("10.0") into "1".
export function defaultNumericFormat(value: number, step = 1): string {
  if (!Number.isFinite(value)) return "0";
  const precision = Math.min(4, Math.max(decimalPlaces(step), decimalPlaces(Number(value.toFixed(4)))));
  if (precision <= 0) return String(Math.round(value));
  return value
    .toFixed(precision)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}
