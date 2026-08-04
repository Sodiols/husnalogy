import { expect, test, type APIRequestContext } from "@playwright/test";
import { adminCredentials, customerCredentials, requireSeededAcceptance, seedManifest } from "./helpers";

// Customized order atomicity, ownership and render recovery (spec §43, §44).
//
// These drive the real HTTP surface rather than the editor UI, so they assert
// the server-side promise directly: a customized order either exists complete
// with its snapshots, or it does not exist at all.

const customizerUrl = process.env.E2E_CUSTOMIZER_URL || seedManifest.customizerUrl || "";
const productId = process.env.E2E_PRODUCT_ID || seedManifest.productId || "";
const customizationId = process.env.E2E_CUSTOMIZATION_ID || seedManifest.customizationId || "";
const otherCustomerCustomizationId =
  process.env.E2E_OTHER_CUSTOMIZATION_ID || seedManifest.customerBCustomizationId || "";

requireSeededAcceptance([
  ["E2E_CUSTOMIZER_URL", customizerUrl],
  ["E2E_PRODUCT_ID", productId],
  ["E2E_CUSTOMIZATION_ID", customizationId],
  ["customer email", customerCredentials.email],
  ["customer password", customerCredentials.password],
]);

// These assert server behaviour over HTTP, so one desktop engine is enough;
// running the identical request five times adds no coverage.
test.describe.configure({ mode: "serial" });
test.skip(({ browserName }) => browserName !== "chromium", "API-level contract; browser engine is irrelevant.");

async function signIn(request: APIRequestContext, email: string, password: string) {
  const response = await request.post("/api/auth/login", { data: { email, password } });
  expect(response.ok(), `sign-in failed for ${email}`).toBeTruthy();
}

function orderBody(overrides: Record<string, unknown> = {}) {
  return {
    customerName: "Playwright Customer",
    customerEmail: customerCredentials.email,
    customerPhone: "01700000000",
    addressLine1: "1 Test Road",
    city: "Dhaka",
    postalCode: "1200",
    deliveryMethod: "delivery",
    subtotal: 1000,
    deliveryCharge: 0,
    total: 1000,
    currency: "BDT",
    paymentStatus: "unpaid",
    status: "pending",
    message: "Playwright acceptance",
    items: [
      {
        productId,
        customizationId,
        title: "Seeded customizable product",
        quantity: 1,
        price: 1000,
        finalPrice: 1000,
        selectedOptions: {},
      },
    ],
    ...overrides,
  };
}

test.describe("customized order atomicity", () => {
  test("rejects the order when a referenced design does not exist", async ({ request }) => {
    await signIn(request, customerCredentials.email, customerCredentials.password);

    const response = await request.post("/api/order-requests", {
      data: orderBody({
        items: [
          {
            productId,
            // A well-formed id that resolves to nothing.
            customizationId: "00000000-0000-4000-8000-000000000000",
            title: "Missing design",
            quantity: 1,
            price: 1000,
            finalPrice: 1000,
            selectedOptions: {},
          },
        ],
      }),
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    const message = String(Object.values(body.errors || {})[0] || "");
    // Customer-friendly, and free of internal detail.
    expect(message).toMatch(/reopen/i);
    expect(message).not.toMatch(/product_customizations|uuid|null|exception/i);
  });

  test("rejects an order that mixes a valid and an unusable customized item", async ({ request }) => {
    await signIn(request, customerCredentials.email, customerCredentials.password);

    const before = await (await request.get("/api/order-requests")).json();
    const countBefore = (before.orders || []).length;

    const response = await request.post("/api/order-requests", {
      data: orderBody({
        items: [
          { productId, customizationId, title: "Valid", quantity: 1, price: 1000, finalPrice: 1000, selectedOptions: {} },
          {
            productId,
            customizationId: "00000000-0000-4000-8000-000000000000",
            title: "Broken",
            quantity: 1,
            price: 1000,
            finalPrice: 1000,
            selectedOptions: {},
          },
        ],
      }),
    });

    expect(response.status()).toBe(400);

    // The whole order was rejected — no partial order was left behind.
    const after = await (await request.get("/api/order-requests")).json();
    expect((after.orders || []).length).toBe(countBefore);
  });

  test("refuses to order another customer's design", async ({ request }) => {
    test.skip(!otherCustomerCustomizationId, "Seed must create a second customer with their own design.");
    await signIn(request, customerCredentials.email, customerCredentials.password);

    const response = await request.post("/api/order-requests", {
      data: orderBody({
        items: [
          {
            productId,
            customizationId: otherCustomerCustomizationId,
            title: "Someone else's design",
            quantity: 1,
            price: 1000,
            finalPrice: 1000,
            selectedOptions: {},
          },
        ],
      }),
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(String(Object.values(body.errors || {})[0] || "")).toMatch(/does not belong|reopen/i);
  });

  test("a repeated submission with the same idempotency key creates one order", async ({ request }) => {
    await signIn(request, customerCredentials.email, customerCredentials.password);
    const idempotencyKey = `pw-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const first = await request.post("/api/order-requests", { data: orderBody({ idempotencyKey }) });
    expect(first.status()).toBe(201);
    const firstOrder = (await first.json()).order;

    const second = await request.post("/api/order-requests", { data: orderBody({ idempotencyKey }) });
    expect(second.status()).toBe(201);
    const secondOrder = (await second.json()).order;

    expect(secondOrder.id).toBe(firstOrder.id);

    const list = await (await request.get("/api/order-requests")).json();
    const matching = (list.orders || []).filter((order: any) => order.id === firstOrder.id);
    expect(matching).toHaveLength(1);
  });

  test("a successful customized order has one snapshot per item, bound to the real order item", async ({ request }) => {
    await signIn(request, customerCredentials.email, customerCredentials.password);
    const created = await request.post("/api/order-requests", {
      data: orderBody({ idempotencyKey: `pw-${Date.now()}-${Math.random().toString(36).slice(2)}` }),
    });
    expect(created.status()).toBe(201);
    const order = (await created.json()).order;

    // Admin view: the snapshot must reference a real order_items row.
    await signIn(request, adminCredentials.email, adminCredentials.password);
    const snapshotsResponse = await request.get(
      `/api/admin/customizer/orders/${encodeURIComponent(order.id)}/snapshots?document=1`,
    );
    expect(snapshotsResponse.ok()).toBeTruthy();
    const { snapshots } = await snapshotsResponse.json();

    expect(snapshots).toHaveLength(1);
    const snapshot = snapshots[0];
    expect(snapshot.customizationId).toBe(customizationId);
    // A real database uuid, never a client-supplied cart id.
    expect(snapshot.orderItemId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    // The frozen payload still matches its recorded hash.
    expect(snapshot.integrityVerified).toBe(true);
    expect(snapshot.preflightStatus).toBe("passed");
    // Rendering was queued (or explicitly recorded as failed) — never left pending.
    expect(["queued", "processing", "completed", "queue_failed", "not_required"]).toContain(snapshot.renderStatus);
  });

  test("editing the design afterwards does not change the order snapshot", async ({ request }) => {
    await signIn(request, customerCredentials.email, customerCredentials.password);
    const created = await request.post("/api/order-requests", {
      data: orderBody({ idempotencyKey: `pw-${Date.now()}-${Math.random().toString(36).slice(2)}` }),
    });
    expect(created.status()).toBe(201);
    const order = (await created.json()).order;

    await signIn(request, adminCredentials.email, adminCredentials.password);
    const before = await (
      await request.get(`/api/admin/customizer/orders/${encodeURIComponent(order.id)}/snapshots?document=1`)
    ).json();
    const hashBefore = before.snapshots[0].integrityHash;

    // The customer keeps editing the same saved design.
    await signIn(request, customerCredentials.email, customerCredentials.password);
    const patch = await request.patch(`/api/customizations/${encodeURIComponent(customizationId)}`, {
      data: { values: { edited: `after-order-${Date.now()}` } },
    });
    expect(patch.ok()).toBeTruthy();

    await signIn(request, adminCredentials.email, adminCredentials.password);
    const after = await (
      await request.get(`/api/admin/customizer/orders/${encodeURIComponent(order.id)}/snapshots?document=1`)
    ).json();

    expect(after.snapshots[0].integrityHash).toBe(hashBefore);
    expect(after.snapshots[0].integrityVerified).toBe(true);
  });
});

test.describe("render failure visibility and recovery", () => {
  test("the admin sees render state and can retry a snapshot's production files", async ({ request }) => {
    await signIn(request, customerCredentials.email, customerCredentials.password);
    const created = await request.post("/api/order-requests", {
      data: orderBody({ idempotencyKey: `pw-${Date.now()}-${Math.random().toString(36).slice(2)}` }),
    });
    expect(created.status()).toBe(201);
    const order = (await created.json()).order;

    await signIn(request, adminCredentials.email, adminCredentials.password);
    const snapshots = (
      await (await request.get(`/api/admin/customizer/orders/${encodeURIComponent(order.id)}/snapshots`)).json()
    ).snapshots;
    const snapshot = snapshots[0];

    // Per-item render monitoring is exposed for both production formats.
    expect(snapshot.render).toBeTruthy();
    expect(snapshot.render.png).toHaveProperty("status");
    expect(snapshot.render.pdf).toHaveProperty("status");

    const retry = await request.post("/api/admin/customizer/render/retry", {
      data: { snapshotId: snapshot.id, jobTypes: ["print_png"] },
    });
    expect(retry.ok()).toBeTruthy();
    const retryBody = await retry.json();
    expect(retryBody.ok).toBe(true);
    expect(retryBody.jobs?.[0]?.jobType).toBe("print_png");
  });

  test("an admin can flag a snapshot for manual review without altering the design", async ({ request }) => {
    await signIn(request, adminCredentials.email, adminCredentials.password);
    const orders = await (await request.get("/api/admin/orders")).json().catch(() => ({ orders: [] }));
    const order = (orders.orders || []).find((entry: any) => entry.productionStatus && entry.productionStatus !== "not_required");
    test.skip(!order, "No personalized order available to review.");

    const listed = await (
      await request.get(`/api/admin/customizer/orders/${encodeURIComponent(order.id)}/snapshots?document=1`)
    ).json();
    const snapshot = listed.snapshots[0];
    const hashBefore = snapshot.integrityHash;

    const marked = await request.post("/api/admin/customizer/render/retry", {
      data: { snapshotId: snapshot.id, markForReview: true, note: "Playwright review flag" },
    });
    expect(marked.ok()).toBeTruthy();

    const after = await (
      await request.get(`/api/admin/customizer/orders/${encodeURIComponent(order.id)}/snapshots?document=1`)
    ).json();
    const reviewed = after.snapshots.find((entry: any) => entry.id === snapshot.id);
    expect(reviewed.renderStatus).toBe("attention_required");
    // Operational metadata changed; the frozen design did not.
    expect(reviewed.integrityHash).toBe(hashBefore);
    expect(reviewed.integrityVerified).toBe(true);
  });

  test("the render health summary reports production readiness", async ({ request }) => {
    await signIn(request, adminCredentials.email, adminCredentials.password);
    const response = await request.get("/api/admin/customizer/render/health");
    expect(response.ok()).toBeTruthy();
    const { health } = await response.json();

    expect(health.jobs).toHaveProperty("queued");
    expect(health.jobs).toHaveProperty("failed");
    expect(health).toHaveProperty("oldestQueuedJobAgeSeconds");
    expect(health).toHaveProperty("ordersMissingSnapshots");
    expect(health).toHaveProperty("snapshotsWithoutRenderJobs");
    expect(health).toHaveProperty("snapshotsWithFailedRendering");
    // Every accepted order must have its snapshot.
    expect(health.ordersMissingSnapshots).toBe(0);
  });
});

test.describe("scheduled render worker", () => {
  test("refuses to run without the shared secret", async ({ request }) => {
    const response = await request.get("/api/cron/customizer-render");
    // 401 when configured, 503 when the environment is incomplete — never 200.
    expect([401, 503]).toContain(response.status());
    const body = await response.json();
    expect(body.ok).toBe(false);
    // Missing variables are reported by name only, never by value.
    for (const name of body.missingEnv || []) {
      expect(String(name)).toMatch(/^[A-Z_ ]+(?: or [A-Z_]+)?$/);
    }
  });
});
