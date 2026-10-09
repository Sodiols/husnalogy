import { describe, expect, it } from "vitest";

import { normaliseSwatch, orderSwatches } from "../swatch-order";

describe("orderSwatches", () => {
  it("puts white, then black, then neutrals light to dark, then hues from red", () => {
    const studio = ["#303839", "#5B6667", "#8D6E63", "#D4AF37", "#B08D2A", "#F4ECEC", "#FFFFFF", "#7A1F2B", "#000000", "#1F4E79", "#2E7D32", "#C62828"];
    const ordered = orderSwatches(studio).map((hex) => hex.toLowerCase());
    expect(ordered.slice(0, 2)).toEqual(["#ffffff", "#000000"]);
    // Neutrals next, light before dark (the near-white blush counts as one).
    expect(ordered.indexOf("#f4ecec")).toBeLessThan(ordered.indexOf("#5b6667"));
    expect(ordered.indexOf("#5b6667")).toBeLessThan(ordered.indexOf("#303839"));
    // Crimson just under 360° sits with the reds, before gold.
    expect(ordered.indexOf("#7a1f2b")).toBeLessThan(ordered.indexOf("#d4af37"));
    expect(ordered.indexOf("#303839")).toBeLessThan(ordered.indexOf("#c62828"));
    // Then around the wheel: reds, browns and gold, green, blue.
    expect(ordered.indexOf("#c62828")).toBeLessThan(ordered.indexOf("#d4af37"));
    expect(ordered.indexOf("#d4af37")).toBeLessThan(ordered.indexOf("#2e7d32"));
    expect(ordered.indexOf("#2e7d32")).toBeLessThan(ordered.indexOf("#1f4e79"));
    expect(ordered).toHaveLength(studio.length);
  });

  it("can add white and black, and drops duplicates and invalid values", () => {
    expect(orderSwatches(["#f00", "#FF0000", "nope", "#00f"], { includeBasics: true })).toEqual(["#ffffff", "#000000", "#f00", "#00f"]);
  });

  it("keeps the spelling a swatch was given, since that is what it applies", () => {
    expect(orderSwatches(["#7A1F2B", "#FFFFFF"], { includeBasics: true })).toEqual(["#FFFFFF", "#000000", "#7A1F2B"]);
  });

  it("keeps only white and black when that is all there is", () => {
    expect(orderSwatches(["#000", "#fff"])).toEqual(["#fff", "#000"]);
  });
});

describe("normaliseSwatch", () => {
  it("expands short hex and lowercases", () => {
    expect(normaliseSwatch("#ABC")).toBe("#aabbcc");
    expect(normaliseSwatch("303839")).toBe("#303839");
    expect(normaliseSwatch("red")).toBeNull();
  });
});
