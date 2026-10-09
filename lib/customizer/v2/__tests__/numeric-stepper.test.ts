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

  it("accepts every half-typed state, so Backspace can always remove the last character", () => {
    const decimal = { allowNegative: true, allowDecimal: true };
    for (const draft of ["", "-", ".", "-.", "1.", "1.3", ".5"]) expect(sanitizeNumericDraft(draft, decimal), draft).toBe(draft);
    expect(sanitizeNumericDraft("", { allowNegative: false, allowDecimal: false })).toBe("");
    expect(sanitizeNumericDraft("-", { allowNegative: false })).toBeNull();
    expect(sanitizeNumericDraft("1..2", decimal)).toBeNull();
    expect(sanitizeNumericDraft("1-", decimal)).toBeNull();
    // An unfinished draft never becomes a number: it falls back to the last value.
    for (const draft of ["", "-", ".", "-."]) expect(parseNumericDraft(draft, 1.36, { minimum: -20, maximum: 100, step: 0.5, allowNegative: true, allowDecimal: true })).toBe(1.36);
  });

  it("steps half a unit and keeps the precision a value carries", () => {
    const rules = { minimum: 0.5, maximum: 4, step: 0.5, allowDecimal: true };
    expect(stepNumericValue(1, 1, rules)).toBe(1.5);
    expect(stepNumericValue(1.36, 1, rules)).toBe(1.86);
    expect(stepNumericValue(0.7, -1, rules)).toBe(0.5);
    expect(stepNumericValue(3.8, 1, rules)).toBe(4);
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
