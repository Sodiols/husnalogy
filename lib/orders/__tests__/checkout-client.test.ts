import { describe, expect, it } from "vitest";
import { attemptForCart, buildCheckoutItems, cartFingerprint, readAttempt, writeAttempt } from "@/lib/orders/checkout-client";
import { parseCheckoutRequest } from "@/lib/orders/checkout-schema";
import { CURRENT_TERMS_VERSION } from "@/lib/orders/checkout-policy";

const CART_ITEM = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DESIGN = "8f14e45f-ceea-4f67-9b1a-2a3c4d5e6f70";

// A cart line exactly as app/lib/customer-lists.ts stores it, including every
// client-side value the server must never receive or trust.
const cartLine = (overrides: Record<string, unknown> = {}) => ({
  id: CART_ITEM,
  productId: "product-1",
  slug: "pearl",
  title: "Pearl Invitation",
  image: "https://evil.example/tracker.png",
  price: 0.01,
  finalPrice: 0.02,
  currency: "USD",
  quantity: 2,
  selectedOptions: { paper: "Premium +$0", size: '5" x 7"', logo: true, quantity: 2, activePage: "front", discount: "100%" },
  customizationValues: { bride_name: "Ayesha", photo_upload: "https://signed.example/url" },
  uploadedFiles: { photo_upload: { path: "user-1/product/1/original.jpg", signedUrl: "https://signed.example/url", name: "p.jpg" } },
  previewImages: { front: "javascript:alert(1)" },
  renderData: { editorState: {} },
  ...overrides,
});

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

describe("the browser sends identifiers and choices only", () => {
  it("drops prices, titles, images, currencies, previews and unknown option keys", () => {
    const [line] = buildCheckoutItems([cartLine()]);
    expect(line).toEqual({
      productId: "product-1",
      quantity: 2,
      selectedOptions: { paper: "Premium +$0", size: '5" x 7"', logo: true },
      cartItemId: CART_ITEM,
      personalization: { bride_name: "Ayesha" },
      uploads: { photo_upload: { path: "user-1/product/1/original.jpg" } },
    });
  });

  it("sends only the design id for a customizer line", () => {
    const [line] = buildCheckoutItems([cartLine({ customizationId: DESIGN })]);
    expect(line.customizationId).toBe(DESIGN);
    expect(line.personalization).toBeUndefined();
    expect(line.uploads).toBeUndefined();
  });

  it("produces a payload the strict server schema accepts", () => {
    const result = parseCheckoutRequest({
      checkoutSubmissionId: "3b241101-e2bb-4255-8caf-4136c566a962",
      customerName: "Ayesha Rahman",
      customerPhone: "01712345678",
      deliveryMethod: "store",
      deliveryNote: "",
      acceptTerms: true,
      termsVersion: CURRENT_TERMS_VERSION,
      items: buildCheckoutItems([cartLine(), cartLine({ id: "legacy-local-id", customizationId: DESIGN })]),
    });
    expect(result.ok).toBe(true);
  });

  it("rounds a legacy fractional quantity instead of sending it", () => {
    expect(buildCheckoutItems([cartLine({ quantity: "3.7" })])[0].quantity).toBe(4);
  });
});

describe("the checkout attempt (idempotency key lifecycle)", () => {
  it("reuses the same submission id for every retry of the same cart", () => {
    const fingerprint = cartFingerprint([cartLine()]);
    const first = attemptForCart(null, fingerprint).attempt;
    const retry = attemptForCart(first, fingerprint);
    expect(retry.attempt.submissionId).toBe(first.submissionId);
    expect(retry.alreadyPlaced).toBe(false);
  });

  it("rotates the id only when the cart changes", () => {
    const first = attemptForCart(null, cartFingerprint([cartLine()])).attempt;
    const changed = attemptForCart(first, cartFingerprint([cartLine({ quantity: 3 })]));
    expect(changed.attempt.submissionId).not.toBe(first.submissionId);
  });

  it("an unchanged cart after a placed order (cart cleanup failed) cannot be submitted again", () => {
    const fingerprint = cartFingerprint([cartLine()]);
    const placed = { ...attemptForCart(null, fingerprint).attempt, status: "placed" as const, orderId: "order-1" };
    const again = attemptForCart(placed, fingerprint);
    expect(again.alreadyPlaced).toBe(true);
    expect(again.attempt.orderId).toBe("order-1");
  });

  it("survives a page refresh through sessionStorage, per user", () => {
    const storage = new MemoryStorage() as unknown as Storage;
    const attempt = attemptForCart(null, "fp").attempt;
    writeAttempt(storage, "user-1", attempt);
    expect(readAttempt(storage, "user-1")).toEqual(attempt);
    expect(readAttempt(storage, "user-2")).toBeNull();
  });

  it("tolerates missing or corrupt storage", () => {
    expect(readAttempt(null, "user-1")).toBeNull();
    const storage = new MemoryStorage() as unknown as Storage;
    storage.setItem("husnalogy_checkout_attempt:user-1", "{not json");
    expect(readAttempt(storage, "user-1")).toBeNull();
  });

  it("fingerprints are order independent and ignore display-only fields", () => {
    const a = cartLine();
    const b = cartLine({ id: "1b1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", productId: "product-2" });
    expect(cartFingerprint([a, b])).toBe(cartFingerprint([b, a]));
    expect(cartFingerprint([a])).toBe(cartFingerprint([{ ...a, title: "Other", price: 999 }]));
  });
});
