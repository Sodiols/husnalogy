import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("launch checkout contract", () => {
  const route = read("app/api/order-requests/route.ts");
  const checkout = read("lib/orders/checkout.ts");
  const schema = read("lib/orders/checkout-schema.ts");
  const migration = read("supabase/migrations/20260930120000_checkout_integrity_hardening.sql");
  const client = read("app/checkout/checkout-client.tsx");

  it("requires a signed-in server identity and takes the email from the session only", () => {
    expect(route).toContain("if (!user?.uid)");
    expect(route).toContain("status: 401");
    expect(route).toContain('email: String(user.email || "").toLowerCase()');
    // The request schema is strict: a submitted customerEmail/customerId is rejected.
    expect(schema).toContain(".strict()");
    expect(schema).not.toMatch(/customerEmail:\s*z\./);
    expect(checkout).toContain("customer_email: user.email.toLowerCase()");
  });

  it("fixes the Cash on Delivery initial state inside the database transaction", () => {
    expect(migration).toContain("'unpaid', 'pending', 'cash_on_delivery'");
  });

  it("requires an address for delivery and refuses one for store pickup", () => {
    expect(schema).toContain('if (input.deliveryMethod === "delivery")');
    expect(schema).toContain("Store pickup orders do not take a delivery address.");
    expect(client).toContain("No delivery address or delivery charge is required for store pickup");
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

  it("keeps the scheduled worker authenticated and platform independent", () => {
    // The constant-time secret check is shared by the worker and the health endpoint.
    const workerAuth = read("lib/security/worker-auth.ts");
    expect(worker).toContain("hasWorkerSecret(request)");
    expect(workerAuth).toContain("safeSecretMatch(candidate, secret)");
    expect(workerAuth).toContain("getRenderWorkerSecrets()");
    expect(worker).toContain("status: 401");
    // Overlap guard and bounded batches: repeated cron ticks cannot stack up.
    expect(worker).toContain("status: 409");
    expect(renderJobs).toContain("claim_customizer_render_job");
    expect(renderJobs).toContain("RENDER_WORKER_DEFAULT_BUDGET_MS");
    // The secret is never read from the query string.
    expect(worker).not.toMatch(/searchParams\.get\("(secret|token|key)"\)/);
    // Scheduling is platform independent: Hostinger runs it via cron.
    expect(read("HOSTINGER_DEPLOYMENT.md")).toContain("/api/admin/customizer/render/process");
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
