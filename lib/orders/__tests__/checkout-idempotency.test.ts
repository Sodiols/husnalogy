import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Checkout idempotency: double-click, a slow-network retry, or a resent
// request must never create a second order for the same checkout attempt.
//
// SECURITY: an idempotency token is not an authorization token. Every
// submission-id lookup is scoped to the authenticated customer, and database
// uniqueness is (customer_id, checkout_submission_id) — so Customer B
// presenting Customer A's token can never receive Customer A's order.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const orders = read("lib/orders/index.ts");
const route = read("app/api/order-requests/route.ts");
const checkout = read("app/checkout/checkout-client.tsx");
const migration = read("supabase/migrations/20260824090000_checkout_idempotency.sql");

describe("database enforcement is customer scoped", () => {
  it("adds a checkout_submission_id column", () => {
    expect(migration).toContain("add column if not exists checkout_submission_id text");
  });

  it("makes uniqueness (customer_id, checkout_submission_id), not the token alone", () => {
    expect(migration).toContain("on public.orders (customer_id, checkout_submission_id)");
    expect(migration).toContain("where checkout_submission_id is not null");
  });

  it("drops any earlier globally-unique index so the token alone is never a global key", () => {
    expect(migration).toContain("drop index if exists public.orders_checkout_submission_id_key");
  });
});

describe("every submission-id lookup is ownership scoped", () => {
  it("has no lookup helper that queries the token without a customer filter", () => {
    // The only helper must be the ownership-scoped one.
    expect(orders).toContain("async function findOwnedOrderByCheckoutSubmissionId(checkoutSubmissionId: string, customerId: string)");
    expect(orders).not.toContain("async function findOrderByCheckoutSubmissionId(");
  });

  it("filters on both the submission id and the customer id", () => {
    const helperIndex = orders.indexOf("async function findOwnedOrderByCheckoutSubmissionId");
    const helperBody = orders.slice(helperIndex, orders.indexOf("\n}", helperIndex));
    expect(helperBody).toContain('.eq("checkout_submission_id", checkoutSubmissionId)');
    expect(helperBody).toContain('.eq("customer_id", customerId)');
  });

  it("returns null rather than querying at all when either identifier is missing", () => {
    expect(orders).toContain("if (!checkoutSubmissionId || !customerId) return null;");
  });

  it("uses the ownership-scoped helper on BOTH the fast path and the unique-index race recovery", () => {
    const calls = orders.match(/findOwnedOrderByCheckoutSubmissionId\(checkoutSubmissionId, trustedCustomerId\)/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("never falls back to an unscoped lookup when the unique-index race finds nothing", () => {
    const raceIndex = orders.indexOf('error?.code === "23505"');
    const raceBlock = orders.slice(raceIndex, raceIndex + 700);
    expect(raceBlock).toContain("findOwnedOrderByCheckoutSubmissionId(checkoutSubmissionId, trustedCustomerId)");
    // A collision that is NOT this customer's own row must be refused, not
    // resolved into somebody else's order.
    expect(raceBlock).toContain("This checkout could not be completed. Please start a new checkout.");
  });

  it("requires an authenticated customer id before any idempotency work happens", () => {
    const guardIndex = orders.indexOf("Authentication is required to place an order.");
    const lookupIndex = orders.indexOf("const existingOrder = await findOwnedOrderByCheckoutSubmissionId");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(lookupIndex).toBeGreaterThan(guardIndex);
  });
});

describe("server enforcement", () => {
  it("requires a checkoutSubmissionId before doing any order work", () => {
    const requireIndex = orders.indexOf("if (!checkoutSubmissionId) {");
    const productLookupIndex = orders.indexOf("getProductBySlug(input.productSlug)");
    expect(requireIndex).toBeGreaterThan(-1);
    expect(productLookupIndex).toBeGreaterThan(requireIndex);
  });

  it("returns the existing order instead of creating a new one on repeat", () => {
    expect(orders).toContain("if (existingOrder) return { ok: true, order: existingOrder, idempotent: true };");
  });

  it("checks for an existing order before pricing or snapshotting run again", () => {
    const existingCheckIndex = orders.indexOf("if (existingOrder) return");
    const pricingIndex = orders.indexOf("applyTrustedPricing(order)");
    expect(existingCheckIndex).toBeGreaterThan(-1);
    expect(pricingIndex).toBeGreaterThan(existingCheckIndex);
  });

  it("persists the submission id on the order row", () => {
    expect(orders).toContain("checkout_submission_id: order.checkoutSubmissionId || null");
  });

  it("takes customerId from the authenticated session, never the request body", () => {
    // The spread comes first, so these overwrite any client-supplied value.
    const spreadIndex = route.indexOf("...body,");
    const customerIdIndex = route.indexOf("customerId: user.uid");
    const emailIndex = route.indexOf("customerEmail: trustedCustomerEmail");
    expect(spreadIndex).toBeGreaterThan(-1);
    expect(customerIdIndex).toBeGreaterThan(spreadIndex);
    expect(emailIndex).toBeGreaterThan(spreadIndex);
  });

  it("distinguishes an idempotent replay (200) from a fresh creation (201)", () => {
    expect(route).toContain("idempotent: Boolean((result as any).idempotent)");
    expect(route).toContain("status: (result as any).idempotent ? 200 : 201");
  });
});

describe("client enforcement", () => {
  it("generates one id per mount and sends it with every checkout attempt", () => {
    expect(checkout).toContain("checkoutSubmissionIdRef = useRef(newCheckoutSubmissionId())");
    expect(checkout).toContain("checkoutSubmissionId: checkoutSubmissionIdRef.current");
  });

  it("rotates the id only after an order is actually placed, so a retry reuses it but a new checkout does not", () => {
    const successIndex = checkout.indexOf("saveLocalOrder(savedOrder);");
    const rotateIndex = checkout.indexOf("checkoutSubmissionIdRef.current = newCheckoutSubmissionId();");
    expect(successIndex).toBeGreaterThan(-1);
    expect(rotateIndex).toBeGreaterThan(successIndex);
  });

  it("keeps the button disabled while a request is in flight as defense in depth, not the primary guard", () => {
    expect(checkout).toContain("disabled={status.loading || authLoading || !user || !items.length || !acceptTerms}");
  });
});
