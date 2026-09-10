import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("launch checkout contract", () => {
  const route = read("app/api/order-requests/route.ts");
  const orders = read("lib/orders/index.ts");
  const checkout = read("app/checkout/checkout-client.tsx");

  it("requires a signed-in server identity and never falls back to a submitted email", () => {
    expect(route).toContain("if (!user?.uid)");
    expect(route).toContain('status: 401');
    expect(route).toContain("cleanString(user.email)");
    expect(route).not.toContain("user?.email || cleanString(body.customerEmail)");
  });

  it("stores fulfillment and payment from a constrained server-side policy", () => {
    expect(orders).toContain('deliveryMethodInput === "store" ? "store" : "delivery"');
    expect(orders).toContain('paymentMethod: "Cash on Delivery"');
    expect(route).toContain('paymentMethod: "Cash on Delivery"');
  });

  it("requires an address for delivery but clears it for store pickup", () => {
    expect(orders).toContain('deliveryMethod === "delivery" ? normalizeAddress');
    expect(orders).toContain('deliveryMethod === "delivery" && !order.address?.addressLine1');
    expect(checkout).toContain('deliveryMethod === "delivery" ? (');
    expect(checkout).toContain("No delivery address or delivery charge is required for store pickup");
  });
});

describe("launch ownership and render immutability", () => {
  const customizations = read("app/api/customizations/[id]/route.ts");
  const renderJobs = read("lib/customizer/render-jobs.ts");
  const worker = read("app/api/admin/customizer/render/process/route.ts");
  const migration = read("supabase/migrations/20260823120000_lock_ordered_customizations.sql");

  it("adds explicit owner filters and locks placed-order designs", () => {
    expect(customizations).toContain('.eq("user_id", user.id)');
    expect(customizations).toContain('existingRow.status === "ordered"');
    expect(migration).toContain("old.status = 'ordered'");
    expect(migration).toContain("ordered customizations are immutable");
  });

  it("renders the captured job input instead of mutable live values", () => {
    expect(renderJobs).toContain("claimed.input_snapshot");
    expect(renderJobs).toContain("values: inputSnapshot.values ?? customization.values");
    expect(renderJobs).toContain("editorState: inputSnapshot.editorState");
    expect(renderJobs).toContain('existingQuery.eq("order_id", options.orderId)');
  });

  it("keeps the scheduled worker authenticated and running daily", () => {
    expect(worker).toContain("safeSecretMatch(bearerToken(request), secret)");
    expect(worker).toContain('status: 401');
    const vercelConfig = read("vercel.json");
    expect(vercelConfig).toContain('"/api/admin/customizer/render/process"');
    // Vercel Hobby allows at most one cron run per day.
    expect(vercelConfig).toContain('"0 0 * * *"');
  });
});

describe("launch storefront contract", () => {
  it("uses actual product currency and stock state in Product JSON-LD", () => {
    const product = read("app/products/[slug]/page.tsx");
    expect(product).toContain("priceCurrency: normalizeCurrency(product.currency)");
    expect(product).toContain("isOutOfStock ? \"https://schema.org/OutOfStock\"");
    expect(product).not.toContain('priceCurrency: "USD"');
  });

  it("does not expose known broken launch routes or placeholder policies", () => {
    const menu = read("app/components/data.ts");
    const categories = read("app/components/categories.tsx");
    const trust = read("app/products/ProductTrustStrip.tsx");
    expect(`${menu}\n${categories}`).not.toMatch(/\/(best-seller|personalizations|homeandliving)/);
    expect(trust).not.toMatch(/30-day|satisfaction guarantee/i);
  });
});
