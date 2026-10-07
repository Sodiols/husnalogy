/**
 * Open redirects through `?returnTo=` (the customizer's exit link). Browsers
 * treat `\` as `/` and drop tabs/newlines, so `/\evil.example` and
 * `/\t/evil.example` become `//evil.example` — another origin. Only a
 * same-origin path may ever be used.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { safeReturnPath } from "@/lib/auth/redirects";

describe("safeReturnPath", () => {
  it.each([
    ["/\\evil.example", "/fallback"],
    ["/\\\\evil.example", "/fallback"],
    ["/\t/evil.example", "/fallback"],
    ["/\n/evil.example", "/fallback"],
    ["//evil.example", "/fallback"],
    ["https://evil.example/x", "/fallback"],
    ["javascript:alert(1)", "/fallback"],
    ["evil.example", "/fallback"],
    ["", "/fallback"],
  ])("refuses %j", (value, expected) => {
    expect(safeReturnPath(value, "/fallback")).toBe(expected);
  });

  it.each([
    ["/cart", "/cart"],
    ["/products/pearl-card?tab=details", "/products/pearl-card?tab=details"],
    ["/", "/"],
  ])("keeps the same-origin path %j", (value, expected) => {
    expect(safeReturnPath(value, "/fallback")).toBe(expected);
  });

  it("the customizer's exit link uses it", () => {
    const source = readFileSync("app/products/[slug]/personalize/personalize-client.tsx", "utf8");
    expect(source).toContain("return safeReturnPath(value, fallback);");
    expect(source).not.toContain('value.startsWith("//")) return fallback;');
  });
});
