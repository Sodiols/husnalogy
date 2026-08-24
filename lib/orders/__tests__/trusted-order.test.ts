import { describe, expect, it } from "vitest";
import {
  applyTrustedOrderPricing,
  evaluateSnapshotOutcome,
  findProductForItem,
  resolveDeliveryCharge,
} from "../trusted-order";

const product = {
  id: "prod_1",
  slug: "gold-leaf-invitation",
  title: "Gold Leaf Invitation",
  price: 100,
  currency: "BDT",
  paperOptions: ["Matte", { label: "Pearl", surcharge: 25 }],
  sizeOptions: ["5x7"],
};

const products = [product];

function orderWith(item: Record<string, any>, extra: Record<string, any> = {}) {
  return {
    items: [item],
    subtotal: 1,
    deliveryCharge: 0,
    total: 1,
    ...extra,
  };
}

describe("resolveDeliveryCharge", () => {
  it("is decided by the server, not the submitted body", () => {
    expect(resolveDeliveryCharge({ deliveryCharge: 99999 })).toBe(0);
  });
});

describe("findProductForItem", () => {
  it("matches by id first, then slug", () => {
    expect(findProductForItem({ productId: "prod_1" }, products)).toBe(product);
    expect(findProductForItem({ productSlug: "gold-leaf-invitation" }, products)).toBe(product);
    expect(findProductForItem({ productId: "nope" }, products)).toBeNull();
    expect(findProductForItem({}, products)).toBeNull();
  });
});

describe("applyTrustedOrderPricing", () => {
  it("overwrites a tampered unit price with the catalogue price", () => {
    const result = applyTrustedOrderPricing(
      orderWith({ productId: "prod_1", quantity: 2, price: 1, finalPrice: 2, selectedOptions: {} }),
      products,
    );
    expect(result.ok).toBe(true);
    expect(result.order.items[0].price).toBe(100);
    expect(result.order.items[0].finalPrice).toBe(200);
    expect(result.order.subtotal).toBe(200);
    expect(result.order.total).toBe(200);
  });

  it("charges the option surcharge the customer tried to skip", () => {
    const result = applyTrustedOrderPricing(
      orderWith({ productId: "prod_1", quantity: 1, price: 100, selectedOptions: { paper: "Pearl +$25.00" } }),
      products,
    );
    expect(result.ok).toBe(true);
    expect(result.order.items[0].price).toBe(125);
    expect(result.order.items[0].pricingBreakdown.optionsTotal).toBe(25);
  });

  it("rejects an option the product does not offer instead of pricing it at zero", () => {
    const result = applyTrustedOrderPricing(
      orderWith({ productId: "prod_1", quantity: 1, price: 100, selectedOptions: { paper: "Gold Leaf" } }),
      products,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.options).toMatch(/not an available option/i);
  });

  it("rejects — never accepts submitted prices for — an unknown product", () => {
    const result = applyTrustedOrderPricing(
      orderWith({ productId: "ghost", productTitle: "Ghost card", quantity: 1, price: 1, finalPrice: 1 }),
      products,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.product).toMatch(/no longer available/i);
    // And nothing was quietly repriced/persisted.
    expect(result.order.subtotal).toBe(1);
  });

  it("rejects a stock-out product", () => {
    const result = applyTrustedOrderPricing(
      orderWith({ productId: "prod_2", quantity: 1, price: 10 }),
      [{ ...product, id: "prod_2", isStockOut: true }],
    );
    expect(result.ok).toBe(false);
    expect(result.errors.product).toMatch(/stock out/i);
  });

  it("fails closed when the catalogue cannot be loaded", () => {
    const result = applyTrustedOrderPricing(
      orderWith({ productId: "prod_1", quantity: 1, price: 1, finalPrice: 1 }),
      null,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.pricing).toBeTruthy();
    expect(result.order.items[0].price).toBe(1); // untouched — the order is rejected
  });

  it("ignores the submitted delivery charge and total", () => {
    const result = applyTrustedOrderPricing(
      orderWith(
        { productId: "prod_1", quantity: 1, price: 100, selectedOptions: {} },
        { deliveryCharge: 5000, total: 999999 },
      ),
      products,
    );
    expect(result.ok).toBe(true);
    expect(result.order.deliveryCharge).toBe(0);
    expect(result.order.total).toBe(100);
  });

  it("clamps a tampered quantity through the pricing calculator", () => {
    const result = applyTrustedOrderPricing(
      orderWith({ productId: "prod_1", quantity: -4, price: 100, selectedOptions: {} }),
      products,
    );
    expect(result.ok).toBe(true);
    expect(result.order.items[0].quantity).toBe(1);
    expect(result.order.subtotal).toBe(100);
  });

  it("handles an empty cart without inventing a total", () => {
    const result = applyTrustedOrderPricing({ items: [], subtotal: 500, total: 500 }, products);
    expect(result.ok).toBe(true);
    expect(result.order.subtotal).toBe(0);
    expect(result.order.total).toBe(0);
  });

  it.each([
    ["zero", 0],
    ["negative", -10],
    ["fractional", 2.7],
    ["NaN", Number.NaN],
    ["a numeric string", "3" as unknown as number],
    ["excessive", 999999],
  ])("normalizes a %s quantity to a sane integer instead of trusting it", (_label, quantity) => {
    const result = applyTrustedOrderPricing(
      orderWith({ productId: "prod_1", quantity, price: 100, selectedOptions: {} }),
      products,
    );
    expect(result.ok).toBe(true);
    const priced = result.order.items[0].quantity;
    expect(Number.isInteger(priced)).toBe(true);
    expect(priced).toBeGreaterThanOrEqual(1);
    expect(priced).toBeLessThanOrEqual(9999);
    // The persisted subtotal always matches catalogue price x trusted quantity.
    expect(result.order.subtotal).toBe(100 * priced);
  });

  it("never produces a negative or NaN monetary value from a malformed payload", () => {
    const result = applyTrustedOrderPricing(
      orderWith({ productId: "prod_1", quantity: 1, price: -5000, finalPrice: -5000, selectedOptions: {} }, {
        subtotal: -5000,
        total: -5000,
        deliveryCharge: -5000,
      }),
      products,
    );
    expect(result.ok).toBe(true);
    expect(result.order.subtotal).toBe(100);
    expect(result.order.deliveryCharge).toBe(0);
    expect(result.order.total).toBe(100);
    expect(Number.isNaN(result.order.total)).toBe(false);
  });

  it("rejects the whole order when only one line of several is untrusted", () => {
    const result = applyTrustedOrderPricing(
      {
        items: [
          { productId: "prod_1", quantity: 1, price: 100, selectedOptions: {} },
          { productId: "does-not-exist", quantity: 1, price: 1, selectedOptions: {} },
        ],
      },
      products,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.product).toBeTruthy();
  });

  it("treats a non-array items payload as an empty cart rather than throwing", () => {
    const result = applyTrustedOrderPricing({ items: "not-an-array", subtotal: 999 } as any, products);
    expect(result.ok).toBe(true);
    expect(result.order.subtotal).toBe(0);
  });
});

describe("evaluateSnapshotOutcome", () => {
  it("passes when there is nothing personalized to snapshot", () => {
    expect(evaluateSnapshotOutcome([], { created: 0, failures: [] }).ok).toBe(true);
  });

  it("passes when every personalized item got a snapshot", () => {
    expect(evaluateSnapshotOutcome(["c1", "c2"], { created: 2, failures: [] }).ok).toBe(true);
  });

  it("fails when a snapshot errored", () => {
    const result = evaluateSnapshotOutcome(["c1"], {
      created: 0,
      failures: [{ customizationId: "c1", reason: "insert failed" }],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/nothing was charged/i);
  });

  it("fails when a snapshot was silently skipped", () => {
    // The old code `continue`d past a missing customization and still returned
    // a success count — an order with no printable design.
    expect(evaluateSnapshotOutcome(["c1", "c2"], { created: 1, failures: [] }).ok).toBe(false);
  });
});
