import { describe, expect, it } from "vitest";
import { clampNumericValue, parseNumericDraft, sanitizeNumericDraft, stepNumericValue } from "@/lib/customizer/numeric-stepper";

describe("editable numeric stepper contract", () => {
  it("accepts typed integers, decimals, and allowed negative values", () => {
    expect(parseNumericDraft("-12.5", 0, { minimum: -360, maximum: 360, allowNegative: true, allowDecimal: true })).toBe(-12.5);
    expect(sanitizeNumericDraft("12px", { allowDecimal: true })).toBeNull();
  });

  it("clamps confirmed values and rejects unsupported signs or decimals", () => {
    expect(parseNumericDraft("150", 50, { minimum: 0, maximum: 100 })).toBe(100);
    expect(parseNumericDraft("-5", 20, { minimum: 0, allowNegative: false })).toBe(20);
    expect(sanitizeNumericDraft("1.5", { allowDecimal: false })).toBeNull();
  });

  it("supports keyboard/button steps and a larger Shift step", () => {
    const rules = { minimum: 0, maximum: 100, step: 1, largeStep: 10 };
    expect(stepNumericValue(20, 1, rules)).toBe(21);
    expect(stepNumericValue(20, -1, rules, true)).toBe(10);
  });

  it("keeps minimum, maximum, and integer rules deterministic", () => {
    expect(clampNumericValue(-10, { minimum: 4, maximum: 500, allowNegative: false })).toBe(4);
    expect(clampNumericValue(10.8, { allowDecimal: false })).toBe(11);
  });
});
