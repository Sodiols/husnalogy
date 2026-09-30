import { describe, expect, it } from "vitest";
import {
  checkProductPurchasable,
  optionIdentity,
  priceLine,
  resolveSelectedOptions,
  sameCanonicalOptions,
  totalOrder,
} from "@/lib/orders/pricing-resolver";
import { fromMinorUnits, minorToDecimalString, multiplyMinor, toMinorUnits } from "@/lib/money";

// A product as the server loads it (lib/products normalizeProduct shape).
const product = (overrides: Record<string, any> = {}) => ({
  id: "product-1",
  title: "Pearl Invitation",
  slug: "pearl-invitation",
  status: "active",
  visibility: "public",
  isStockOut: false,
  deletedAt: null,
  price: 120,
  salePrice: 100,
  currency: "BDT",
  formatOptions: [],
  sizeOptions: ['5" x 7"', "Large +$30"],
  paperStyleOptions: [],
  paperOptions: [
    "Signature Matte",
    { label: "Premium", surcharge: 100 },
    { label: "Retired Linen", surcharge: 5, active: false },
    { label: "Staff Only", surcharge: 0, customerVisible: false },
  ],
  envelopeOptions: ["No Envelopes", { label: "Gold Foil", value: "gold-foil", surcharge: 12.5 }],
  cornerOptions: ["Squared"],
  printingOptions: ["Standard", "High Definition +$0.40"],
  ...overrides,
});

const basic = {
  format: "Printed Flat Card",
  size: '5" x 7"',
  paper: "Signature Matte",
  envelope: "No Envelopes",
  corner: "Squared",
  printing: "Standard",
};

describe("money in integer minor units", () => {
  it("parses trusted decimals exactly", () => {
    expect(toMinorUnits(0.4)).toBe(40);
    expect(toMinorUnits("12.50")).toBe(1250);
    expect(toMinorUnits(0.1 + 0.2)).toBe(30);
    expect(toMinorUnits("0.005")).toBe(1);
    expect(toMinorUnits(0)).toBe(0);
  });

  it("rejects negative, non-finite, malformed and oversized values", () => {
    for (const bad of [-1, "-1", Number.NaN, Number.POSITIVE_INFINITY, "1e3", "abc", "", null, undefined, {}, 1e21, "99999999999999"]) {
      expect(toMinorUnits(bad as any)).toBeNull();
    }
  });

  it("round-trips and multiplies without floating point drift", () => {
    expect(fromMinorUnits(3)).toBe(0.03);
    expect(minorToDecimalString(123456)).toBe("1234.56");
    expect(minorToDecimalString(7)).toBe("0.07");
    expect(multiplyMinor(1010, 3)).toBe(3030);
    expect(multiplyMinor(999_999_999_999, 2)).toBeNull();
  });
});

describe("base price, options, quantity", () => {
  it("uses the server sale price as the base", () => {
    const result = priceLine(product(), basic, 1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.line.baseMinor).toBe(10000);
      expect(result.line.unitMinor).toBe(10000);
      expect(result.line.lineMinor).toBe(10000);
      expect(result.line.currency).toBe("BDT");
    }
  });

  it("adds configured surcharges from rich and legacy string options", () => {
    const result = priceLine(product(), { ...basic, paper: "Premium", size: "Large", printing: "High Definition", envelope: "Gold Foil" }, 3);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // 100 + 100 (Premium) + 30 (Large) + 0.40 (HD) + 12.50 (Gold Foil)
      expect(result.line.unitMinor).toBe(10000 + 10000 + 3000 + 40 + 1250);
      expect(result.line.lineMinor).toBe((10000 + 10000 + 3000 + 40 + 1250) * 3);
      expect(result.line.charges.map((charge) => charge.key).sort()).toEqual(["envelope", "paper", "printing", "size"]);
    }
  });

  it("free options cost nothing", () => {
    const result = priceLine(product(), basic, 2);
    expect(result.ok && result.line.optionsMinor).toBe(0);
  });

  it("matches an option by its stable value as well as its label", () => {
    const result = priceLine(product(), { ...basic, envelope: "gold-foil" }, 1);
    expect(result.ok && result.line.options.envelope).toBe("Gold Foil");
  });

  it("is deterministic", () => {
    const a = priceLine(product(), { ...basic, paper: "Premium" }, 7);
    const b = priceLine(product(), { ...basic, paper: "Premium" }, 7);
    expect(a).toEqual(b);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 10001, "3" as any, null as any])("rejects quantity %s", (quantity) => {
    const result = priceLine(product(), basic, quantity);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.errors[0].code).toBe("QUANTITY_INVALID");
  });

  it("refuses a line whose total would overflow the order ceiling", () => {
    const result = priceLine(product({ salePrice: 9_000_000, price: 9_000_000 }), basic, 10_000);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.errors[0].code).toBe("TOTAL_OUT_OF_RANGE");
  });
});

describe("forged option price text can never change the amount", () => {
  it.each([
    "Premium +$0",
    "Premium +$0.00",
    "Premium (+৳0)",
    "Premium +BDT 0",
    "Premium +$1",
    "Premium   +$0 ",
    "premium +$0",
  ])("%s is priced at the configured +100", (forged) => {
    const result = priceLine(product(), { ...basic, paper: forged }, 1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.line.charges.find((charge) => charge.key === "paper")?.amountMinor).toBe(10000);
      expect(result.line.unitMinor).toBe(20000);
    }
  });

  it("a forged suffix on a legacy string option still charges the configured amount", () => {
    const result = priceLine(product(), { ...basic, printing: "High Definition +$0" }, 1);
    expect(result.ok && result.line.optionsMinor).toBe(40);
  });

  it("a forged surcharge on a FREE option cannot add value either", () => {
    const result = priceLine(product(), { ...basic, paper: "Signature Matte +$999" }, 1);
    expect(result.ok && result.line.optionsMinor).toBe(0);
  });

  it("stores the canonical label, never the submitted price text", () => {
    const result = priceLine(product(), { ...basic, paper: "Premium +$0" }, 1);
    expect(result.ok && result.line.options.paper).toBe("Premium");
  });
});

describe("options fail closed", () => {
  const codeFor = (selection: Record<string, unknown>, p = product()) => {
    const result = resolveSelectedOptions(p, selection);
    return "errors" in result ? result.errors[0].code : null;
  };

  it("rejects an unknown option value", () => {
    expect(codeFor({ ...basic, paper: "Gold Leaf" })).toBe("OPTION_NOT_OFFERED");
  });

  it("rejects an inactive option", () => {
    expect(codeFor({ ...basic, paper: "Retired Linen" })).toBe("OPTION_UNAVAILABLE");
  });

  it("rejects a hidden (internal) option", () => {
    expect(codeFor({ ...basic, paper: "Staff Only" })).toBe("OPTION_UNAVAILABLE");
  });

  it("rejects an option that belongs to another product", () => {
    const other = product({ paperOptions: ["Other Product Paper"] });
    expect(codeFor({ ...basic, paper: "Premium" }, other)).toBe("OPTION_NOT_OFFERED");
  });

  it("rejects an option key the product model does not have", () => {
    expect(codeFor({ ...basic, discount: "100%" })).toBe("OPTION_UNKNOWN_GROUP");
    expect(codeFor({ ...basic, unitPrice: "0" })).toBe("OPTION_UNKNOWN_GROUP");
  });

  it("rejects non-string values for an option group", () => {
    expect(codeFor({ ...basic, paper: 5 })).toBe("OPTION_INVALID_VALUE");
    expect(codeFor({ ...basic, paper: { label: "Premium", surcharge: 0 } })).toBe("OPTION_INVALID_VALUE");
    expect(codeFor({ ...basic, logo: "yes" })).toBe("OPTION_INVALID_VALUE");
  });

  it("requires every offered option group", () => {
    const { paper: _paper, ...withoutPaper } = basic;
    expect(codeFor(withoutPaper)).toBe("OPTION_REQUIRED");
  });

  it("refuses to guess between two configured options that share an identity", () => {
    const ambiguous = product({ paperOptions: ["Premium", { label: "Premium", surcharge: 100 }] });
    expect(codeFor({ ...basic, paper: "Premium" }, ambiguous)).toBe("OPTION_AMBIGUOUS");
  });

  it("accepts the built-in format list only when the product configures none", () => {
    expect(codeFor({ ...basic, format: "Instant Download" })).toBeNull();
    const configured = product({ formatOptions: ["Printed Only"] });
    expect(codeFor({ ...basic, format: "Instant Download" }, configured)).toBe("OPTION_NOT_OFFERED");
    expect(codeFor({ ...basic, format: "Printed Only" }, configured)).toBeNull();
  });

  it("ignores editor bookkeeping keys and keeps the logo preference", () => {
    const result = resolveSelectedOptions(product(), { ...basic, quantity: 50, activePage: "front", customQty: "", logo: false });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.logo).toBe(false);
      expect(result.options).not.toHaveProperty("quantity");
    }
  });

  it("compares canonical option sets by identity", () => {
    expect(sameCanonicalOptions({ paper: "Premium" }, { paper: "premium" })).toBe(true);
    expect(sameCanonicalOptions({ paper: "Premium" }, { paper: "Signature Matte" })).toBe(false);
    expect(optionIdentity('Classic (5" × 7") +$0.35')).toBe('classic (5" x 7")');
  });
});

describe("product purchasability", () => {
  it.each([
    ["draft", { status: "draft" }, "PRODUCT_UNAVAILABLE"],
    ["hidden status", { status: "hidden" }, "PRODUCT_UNAVAILABLE"],
    ["hidden visibility", { visibility: "hidden" }, "PRODUCT_UNAVAILABLE"],
    ["deleted status", { status: "deleted" }, "PRODUCT_UNAVAILABLE"],
    ["soft deleted", { deletedAt: "2026-09-01T00:00:00Z" }, "PRODUCT_UNAVAILABLE"],
    ["internal availability", { availability: "internal" }, "PRODUCT_UNAVAILABLE"],
    ["discontinued", { availability: "discontinued" }, "PRODUCT_UNAVAILABLE"],
    ["out of stock", { isStockOut: true }, "PRODUCT_OUT_OF_STOCK"],
    ["no price", { price: null, salePrice: null }, "PRODUCT_PRICE_INVALID"],
    ["zero price", { price: 0, salePrice: 0 }, "PRODUCT_PRICE_INVALID"],
    ["negative price", { price: -5, salePrice: -5 }, "PRODUCT_PRICE_INVALID"],
    ["USD product in a BDT-only checkout", { currency: "USD" }, "PRODUCT_CURRENCY_UNSUPPORTED"],
  ])("rejects a %s product", (_label, overrides, code) => {
    expect(checkProductPurchasable(product(overrides))?.code).toBe(code);
    expect(priceLine(product(overrides), basic, 1).ok).toBe(false);
  });

  it("rejects a missing product", () => {
    expect(checkProductPurchasable(null)?.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("accepts an active public or direct-link product", () => {
    expect(checkProductPurchasable(product())).toBeNull();
    expect(checkProductPurchasable(product({ visibility: "direct" }))).toBeNull();
  });

  it("treats a missing currency as the store currency", () => {
    expect(checkProductPurchasable(product({ currency: undefined }))).toBeNull();
  });
});

describe("order totals", () => {
  const line = (currency: "BDT" | "USD", lineMinor: number) => ({ currency, quantity: 1, baseMinor: lineMinor, optionsMinor: 0, unitMinor: lineMinor, lineMinor, options: {}, charges: [] });

  it("sums lines and a server delivery charge", () => {
    const result = totalOrder([line("BDT", 1000), line("BDT", 2550)], 0);
    expect(result.ok && result.totals).toEqual({ currency: "BDT", subtotalMinor: 3550, deliveryMinor: 0, totalMinor: 3550 });
  });

  it("never adds different currencies together", () => {
    const result = totalOrder([line("BDT", 1000), line("USD", 1000)], 0);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error.code).toBe("CURRENCY_MIXED");
  });

  it("rejects a negative delivery charge", () => {
    expect(totalOrder([line("BDT", 1000)], -500).ok).toBe(false);
  });
});
