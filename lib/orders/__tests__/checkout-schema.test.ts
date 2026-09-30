import { describe, expect, it } from "vitest";
import { parseCheckoutRequest, parseQuoteRequest } from "@/lib/orders/checkout-schema";
import { normalizeBangladeshPhone, normalizeText, NAME_RULE, ADDRESS_RULE, NOTE_RULE } from "@/lib/orders/bd-contact";
import { CURRENT_TERMS_VERSION } from "@/lib/orders/checkout-policy";

const CUSTOMIZATION = "8f14e45f-ceea-4f67-9b1a-2a3c4d5e6f70";
const CART_ITEM = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

export const validRequest = (overrides: Record<string, unknown> = {}) => ({
  checkoutSubmissionId: "3b241101-e2bb-4255-8caf-4136c566a962",
  customerName: "Ayesha Rahman",
  customerPhone: "01712345678",
  deliveryMethod: "delivery",
  addressLine1: "House 12, Road 5, Zindabazar",
  city: "Sylhet",
  postalCode: "3100",
  deliveryNote: "Call before arriving",
  acceptTerms: true,
  termsVersion: CURRENT_TERMS_VERSION,
  items: [{ productId: "product-1", quantity: 2, selectedOptions: { paper: "Premium" }, cartItemId: CART_ITEM }],
  ...overrides,
});

const errorsOf = (body: unknown) => {
  const result = parseCheckoutRequest(body);
  return "errors" in result ? result.errors : {};
};

describe("Bangladesh phone numbers", () => {
  it.each([
    ["01712345678", "+8801712345678"],
    ["+8801712345678", "+8801712345678"],
    ["8801712345678", "+8801712345678"],
    ["008801712345678", "+8801712345678"],
    ["+880 1712-345678", "+8801712345678"],
    ["(017) 1234 5678", "+8801712345678"],
    ["01312345678", "+8801312345678"],
    ["01912345678", "+8801912345678"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeBangladeshPhone(input)).toBe(expected);
  });

  it.each([
    "",
    "0171234567", // too short
    "017123456789", // too long
    "01212345678", // no such operator
    "01012345678",
    "02712345678", // landline prefix
    "+15551234567", // foreign
    "+8811712345678",
    "0171234567a",
    "01712345678; drop table orders",
    "٠١٧١٢٣٤٥٦٧٨", // non-ASCII digits
    123 as any,
    null as any,
  ])("rejects %s", (input) => {
    expect(normalizeBangladeshPhone(input)).toBeNull();
  });
});

describe("text normalization", () => {
  it("accepts Bengali and Latin names", () => {
    expect(normalizeText("আয়েশা রহমান", NAME_RULE)).toEqual({ ok: true, value: "আয়েশা রহমান" });
    expect(normalizeText("  Mary-Jane   O'Neil ", NAME_RULE)).toEqual({ ok: true, value: "Mary-Jane O'Neil" });
  });

  it("rejects markup, control characters and bidi overrides", () => {
    expect(normalizeText("<img src=x onerror=alert(1)>", NAME_RULE).ok).toBe(false);
    expect(normalizeText("Road 5 <script>alert(1)</script>", ADDRESS_RULE).ok).toBe(false);
    expect(normalizeText("Name\u0000", NAME_RULE).ok).toBe(false);
    expect(normalizeText("abc‮evil", NAME_RULE).ok).toBe(false);
  });

  it("bounds length before doing work on hostile input", () => {
    expect(normalizeText("a".repeat(100_000), NOTE_RULE)).toEqual({ ok: false, reason: "too_long" });
  });

  it("keeps line breaks only in multiline fields", () => {
    expect(normalizeText("line one\n\n\n\nline two", NOTE_RULE)).toEqual({ ok: true, value: "line one\n\nline two" });
  });
});

describe("the checkout request schema", () => {
  it("accepts a valid delivery request and normalizes it", () => {
    const result = parseCheckoutRequest(validRequest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.customerPhone).toBe("+8801712345678");
      expect(result.request.address).toEqual({ addressLine1: "House 12, Road 5, Zindabazar", city: "Sylhet", area: "", postalCode: "3100", country: "Bangladesh" });
      expect(result.request.items[0]).toMatchObject({ lineNumber: 1, productId: "product-1", quantity: 2, cartItemId: CART_ITEM, customizationId: null });
    }
  });

  it("accepts store pickup without an address", () => {
    const { addressLine1: _a, city: _c, postalCode: _p, ...pickup } = validRequest({ deliveryMethod: "store" });
    const result = parseCheckoutRequest(pickup);
    expect(result.ok && result.request.address).toBeNull();
  });

  it.each([
    ["price", { price: 0 }],
    ["subtotal", { subtotal: 0 }],
    ["total", { total: 1 }],
    ["deliveryCharge", { deliveryCharge: -50 }],
    ["currency", { currency: "USD" }],
    ["paymentStatus", { paymentStatus: "paid" }],
    ["status", { status: "delivered" }],
    ["customerId", { customerId: "someone-else" }],
    ["customerEmail", { customerEmail: "victim@example.com" }],
    ["paymentMethod", { paymentMethod: "Card" }],
    ["message", { message: "<script>" }],
  ])("rejects a request that tries to set %s", (field, extra) => {
    const errors = errorsOf(validRequest(extra));
    expect(Object.values(errors).join(" ")).toContain(field);
  });

  it.each([
    ["title", { title: "Free item" }],
    ["price", { price: 0 }],
    ["unitPrice", { unitPrice: 0 }],
    ["finalPrice", { finalPrice: 0 }],
    ["image", { image: "https://evil.example/x.png" }],
    ["sku", { sku: "FORGED" }],
    ["slug", { slug: "other-product" }],
    ["currency", { currency: "USD" }],
    ["previewImages", { previewImages: { front: "javascript:alert(1)" } }],
    ["renderData", { renderData: {} }],
  ])("rejects a cart line that tries to set %s", (field, extra) => {
    const items = [{ productId: "product-1", quantity: 1, selectedOptions: {}, ...extra }];
    expect(Object.values(errorsOf(validRequest({ items }))).join(" ")).toContain(field);
  });

  it.each([
    ["zero", 0],
    ["negative", -3],
    ["decimal", 1.5],
    ["huge", 1_000_000],
    ["string", "2"],
    ["NaN-like string", "NaN"],
    ["null", null],
  ])("rejects a %s quantity", (_label, quantity) => {
    const errors = errorsOf(validRequest({ items: [{ productId: "product-1", quantity, selectedOptions: {} }] }));
    expect(Object.keys(errors).some((key) => key.startsWith("items"))).toBe(true);
  });

  it("requires explicit acceptance of the CURRENT terms", () => {
    expect(errorsOf(validRequest({ acceptTerms: false })).acceptTerms).toBeTruthy();
    const { acceptTerms: _omit, ...withoutTerms } = validRequest();
    expect(errorsOf(withoutTerms).acceptTerms).toBeTruthy();
    expect(errorsOf(validRequest({ acceptTerms: "true" })).acceptTerms).toBeTruthy();
    expect(errorsOf(validRequest({ termsVersion: "2020-01-01" })).acceptTerms).toContain("updated");
  });

  it("rejects invalid contact data", () => {
    expect(errorsOf(validRequest({ customerPhone: "12345" })).customerPhone).toBeTruthy();
    expect(errorsOf(validRequest({ customerName: "A" })).customerName).toBeTruthy();
    expect(errorsOf(validRequest({ customerName: "<b>x</b>" })).customerName).toBeTruthy();
    expect(errorsOf(validRequest({ addressLine1: "" })).addressLine1).toBeTruthy();
    expect(errorsOf(validRequest({ city: "" })).city).toBeTruthy();
    expect(errorsOf(validRequest({ postalCode: "31000" })).postalCode).toBeTruthy();
    expect(errorsOf(validRequest({ deliveryNote: "x".repeat(501) })).deliveryNote).toBeTruthy();
  });

  it("rejects an unsupported delivery method and a pickup order carrying an address", () => {
    expect(errorsOf(validRequest({ deliveryMethod: "drone" })).deliveryMethod).toBeTruthy();
    expect(errorsOf(validRequest({ deliveryMethod: "store" })).deliveryMethod).toBeTruthy();
  });

  it("rejects missing fields, empty carts, too many lines and malformed ids", () => {
    expect(errorsOf({}).checkoutSubmissionId).toBeTruthy();
    expect(errorsOf(validRequest({ items: [] })).items).toBeTruthy();
    expect(errorsOf(validRequest({ items: Array.from({ length: 51 }, () => ({ productId: "p", quantity: 1 })) })).items).toBeTruthy();
    expect(errorsOf(validRequest({ checkoutSubmissionId: "short" })).checkoutSubmissionId).toBeTruthy();
    expect(errorsOf(validRequest({ checkoutSubmissionId: "x'); drop table orders;--aaaaaa" })).checkoutSubmissionId).toBeTruthy();
    expect(Object.keys(errorsOf(validRequest({ items: [{ productId: "../../etc", quantity: 1 }] })))).toContain("items.0.productId");
    expect(Object.keys(errorsOf(validRequest({ items: [{ productId: "p", quantity: 1, customizationId: "not-a-uuid" }] })))).toContain("items.0.customizationId");
  });

  it("rejects the same personalized design twice in one order", () => {
    const line = { productId: "product-1", quantity: 1, customizationId: CUSTOMIZATION };
    const items = [
      { ...line, cartItemId: CART_ITEM },
      { ...line, cartItemId: "1b1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d" },
    ];
    expect(Object.keys(errorsOf(validRequest({ items })))).toContain("items.1.customizationId");
  });

  it("requires a server-side cart line for every order line, used once", () => {
    const withoutCart = { productId: "product-1", quantity: 1 };
    expect(Object.keys(errorsOf(validRequest({ items: [withoutCart] })))).toContain("items.0.cartItemId");
    const line = { productId: "product-1", quantity: 1, cartItemId: CART_ITEM };
    expect(Object.keys(errorsOf(validRequest({ items: [line, { ...line }] })))).toContain("items.1.cartItemId");
  });

  it("rejects separate personalization data on a customizer line", () => {
    const line = { productId: "product-1", quantity: 1, customizationId: CUSTOMIZATION, cartItemId: CART_ITEM, personalization: { bride_name: "X" } };
    expect(Object.keys(errorsOf(validRequest({ items: [line] })))).toContain("items.0.personalization");
  });

  it("rejects non-object bodies", () => {
    for (const body of [null, "text", 42, [validRequest()]]) {
      expect(parseCheckoutRequest(body).ok).toBe(false);
    }
  });

  it("parses a price quote request with the same line rules", () => {
    expect(parseQuoteRequest({ deliveryMethod: "delivery", items: [{ productId: "product-1", quantity: 1 }] }).ok).toBe(true);
    expect(parseQuoteRequest({ deliveryMethod: "store", items: [{ productId: "product-1", quantity: 1 }] }).ok).toBe(true);
    expect(parseQuoteRequest({ items: [{ productId: "product-1", quantity: 1 }] }).ok).toBe(false);
    expect(parseQuoteRequest({ deliveryMethod: "courier", items: [{ productId: "product-1", quantity: 1 }] }).ok).toBe(false);
    expect(parseQuoteRequest({ deliveryMethod: "delivery", deliveryCharge: 0, items: [{ productId: "product-1", quantity: 1 }] }).ok).toBe(false);
    expect(parseQuoteRequest({ deliveryMethod: "delivery", items: [{ productId: "product-1", quantity: 1, price: 0 }] }).ok).toBe(false);
    expect(parseQuoteRequest({ deliveryMethod: "delivery", items: [], total: 0 }).ok).toBe(false);
  });
});
