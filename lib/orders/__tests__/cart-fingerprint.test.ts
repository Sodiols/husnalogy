import { describe, expect, it } from "vitest";
import { canonicalJson, cartFingerprint } from "@/lib/orders/checkout-client";

const line = (overrides: Record<string, unknown> = {}) => ({
  id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  productId: "product-1",
  quantity: 2,
  selectedOptions: { paper: "Premium", size: '5" x 7"', logo: true },
  customizationValues: { bride_name: "Ayesha", groom_name: "Rahim" },
  uploadedFiles: { photo_upload: { path: "user-1/p/1/original.jpg", signedUrl: "https://x/1" } },
  title: "Pearl",
  price: 100,
  addedAt: "2026-10-01T00:00:00Z",
  ...overrides,
});

describe("the canonical cart fingerprint", () => {
  it("does not depend on object key order", () => {
    const reordered = {
      uploadedFiles: { photo_upload: { signedUrl: "https://x/1", path: "user-1/p/1/original.jpg" } },
      customizationValues: { groom_name: "Rahim", bride_name: "Ayesha" },
      selectedOptions: { logo: true, size: '5" x 7"', paper: "Premium" },
      quantity: 2,
      productId: "product-1",
      id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    };
    expect(cartFingerprint([reordered])).toBe(cartFingerprint([line()]));
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("does not depend on the order of cart lines", () => {
    const other = line({ id: "1b1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", productId: "product-2" });
    expect(cartFingerprint([line(), other])).toBe(cartFingerprint([other, line()]));
  });

  it.each([
    ["quantity", { quantity: 3 }],
    ["personalization text", { customizationValues: { bride_name: "Ayesha R.", groom_name: "Rahim" } }],
    ["uploaded file", { uploadedFiles: { photo_upload: { path: "user-1/p/2/original.jpg" } } }],
    ["option choice", { selectedOptions: { paper: "Signature Matte", size: '5" x 7"', logo: true } }],
    ["design", { customizationId: "8f14e45f-ceea-4f67-9b1a-2a3c4d5e6f70", customizationValues: {}, uploadedFiles: {} }],
    ["product", { productId: "product-9" }],
    ["cart line", { id: "2b1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d" }],
  ])("changes when the %s changes", (_label, overrides) => {
    expect(cartFingerprint([line(overrides)])).not.toBe(cartFingerprint([line()]));
  });

  it("ignores display-only and volatile state", () => {
    const display = line({ title: "Renamed", price: 999, addedAt: "2030-01-01T00:00:00Z", image: "/x.png" });
    expect(cartFingerprint([display])).toBe(cartFingerprint([line()]));
    // A fresh signed URL for the same upload is the same upload.
    expect(cartFingerprint([line({ uploadedFiles: { photo_upload: { path: "user-1/p/1/original.jpg", signedUrl: "https://x/2" } } })])).toBe(cartFingerprint([line()]));
  });
});
