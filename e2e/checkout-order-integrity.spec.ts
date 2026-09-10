import { expect, test } from "@playwright/test";
import { adminCredentials, customerCredentials, login, requireSeededAcceptance, seedManifest } from "./helpers";

// Full purchase journey (spec: order integrity, checkout idempotency, trusted
// pricing, immutable snapshot, render queue, cross-account isolation). This
// creates a REAL Cash on Delivery order, so it only runs against a seeded
// local/staging project — never production. See scripts/seed-customizer-test.mjs.

const customizerUrl = process.env.E2E_CUSTOMIZER_URL || seedManifest.customizerUrl || "";
const customizationAId = process.env.E2E_CUSTOMIZATION_A_ID || seedManifest.customizationAId || "";
const customerBEmail = process.env.E2E_CUSTOMER_B_EMAIL || seedManifest.customerBEmail || "";
const customerBPassword = process.env.E2E_CUSTOMER_B_PASSWORD || seedManifest.password || "";
requireSeededAcceptance([
  ["E2E_CUSTOMIZER_URL", customizerUrl],
  ["customer email", customerCredentials.email],
  ["customer password", customerCredentials.password],
  ["Customer A customization", customizationAId],
  ["Customer B email", customerBEmail],
  ["Customer B password", customerBPassword],
  ["admin email", adminCredentials.email],
  ["admin password", adminCredentials.password],
]);

let placedOrderId = "";
let snapshotIntegrityHash = "";

test.describe.serial("checkout places one trusted, immutable, render-queued order", () => {
  test("adds the customization to cart and completes a Delivery COD checkout", async ({ page }) => {
    await login(page, customerCredentials.email, customerCredentials.password, customizerUrl);
    await page.goto(customizerUrl);
    const root = page.locator("[data-customizer-root]");
    await expect(root).toBeVisible();

    await page.getByRole("button", { name: /Next: Review/i }).click();
    const approval = page.locator('input[type="checkbox"]').last();
    if (await approval.count()) await approval.check();
    await page.getByRole("button", { name: /Add to cart|Update cart/i }).click();
    await expect(page).toHaveURL(/\/cart/);

    await page.getByRole("link", { name: /checkout/i }).click();
    await expect(page).toHaveURL(/\/checkout/);

    // Account email must be shown, and only shown, read only — never an
    // editable field a manipulated submit could override.
    await expect(page.getByText("Account email", { exact: true })).toBeVisible();
    await expect(page.getByText(customerCredentials.email, { exact: true })).toBeVisible();
    await expect(page.locator('input[type="email"]')).toHaveCount(0);

    await page.getByLabel(/^Phone/i).fill("+8801711000000");
    await page.getByRole("button", { name: "Delivery", exact: true }).click();
    await page.getByLabel(/^City/i).fill("Sylhet");
    await page.getByLabel(/^Address/i).fill("42/4c Nurani, Bonkolapara, Subidbazar");

    const responsePromise = page.waitForResponse((response) => response.url().includes("/api/order-requests") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Place order" }).click();
    const response = await responsePromise;
    expect(response.ok()).toBe(true);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    placedOrderId = payload.order.id;
    expect(placedOrderId).toBeTruthy();
    expect(payload.order.paymentMethod).toBe("Cash on Delivery");
    expect(payload.order.deliveryMethod).toBe("delivery");
    // Trusted server pricing: the placed total must be a positive, server
    // computed number, never client-echoed unchecked.
    expect(payload.order.subtotal).toBeGreaterThan(0);

    await expect(page.getByText(/Order request placed/i)).toBeVisible();
  });

  test("customer's Orders page shows exactly one order for this checkout", async ({ page }) => {
    await login(page, customerCredentials.email, customerCredentials.password, "/orders");
    await page.goto("/orders");
    const orderCards = page.getByText(placedOrderId);
    await expect(orderCards).toHaveCount(1);
  });

  test("Admin sees the order with correct fulfillment, pricing and a queued render", async ({ page }) => {
    await login(page, adminCredentials.email, adminCredentials.password, "/admin/dashboard?section=Orders");
    const response = await page.request.get(`/api/admin/order-requests?q=${encodeURIComponent(placedOrderId)}`);
    expect(response.ok()).toBe(true);
    const payload = await response.json();
    const order = (payload.orders || []).find((item: any) => item.id === placedOrderId);
    expect(order, "Admin must be able to read the order just placed").toBeTruthy();
    expect(order.deliveryMethod).toBe("delivery");
    expect(order.paymentMethod).toBe("Cash on Delivery");
    expect(order.paymentStatus).toBe("unpaid");
    expect(order.items.length).toBeGreaterThan(0);

    const snapshots = await page.request.get(`/api/admin/customizer/orders/${encodeURIComponent(placedOrderId)}/snapshots`);
    expect(snapshots.ok()).toBe(true);
    const snapshotPayload = await snapshots.json();
    const orderSnapshots = snapshotPayload.snapshots || [];
    expect(orderSnapshots.length).toBeGreaterThan(0);
    snapshotIntegrityHash = orderSnapshots[0].integrityHash;
    expect(snapshotIntegrityHash, "the frozen design must carry an integrity hash").toBeTruthy();
    // A snapshot must never sit silently in "pending" — the enqueue path
    // moves it to queued, or explicitly to failed when queueing broke.
    expect(["queued", "processing", "completed", "failed"]).toContain(orderSnapshots[0].renderStatus);
  });

  test("the render worker produces PNG and PDF for THIS order and Admin can read them", async ({ page }) => {
    await login(page, adminCredentials.email, adminCredentials.password);

    // Drive the real protected worker path (admin-authorized POST), the same
    // code the daily cron runs.
    for (let pass = 0; pass < 6; pass += 1) {
      const worker = await page.request.post("/api/admin/customizer/render/process", { data: { limit: 5 }, timeout: 120_000 });
      expect(worker.ok(), "an admin session must be allowed to run the worker").toBe(true);
      const processed = (await worker.json()).processed || [];
      if (!processed.length) break;
    }

    const snapshots = await page.request.get(`/api/admin/customizer/orders/${encodeURIComponent(placedOrderId)}/snapshots`);
    const orderSnapshots = (await snapshots.json()).snapshots || [];
    expect(orderSnapshots.length).toBeGreaterThan(0);

    const printFiles = orderSnapshots[0].printFiles || {};
    const entries = Object.values(printFiles) as any[];
    expect(entries.length, "production print files must be attached to the order snapshot").toBeGreaterThan(0);

    const formats = entries.map((file) => String(file.format));
    expect(formats).toContain("png");
    expect(formats).toContain("pdf");

    // Private production files are reachable only through a signed URL.
    for (const file of entries) {
      expect(file.signedUrl, "Admin must receive a signed URL for each production file").toBeTruthy();
      expect(file.checksum).toBeTruthy();
      const download = await page.request.get(file.signedUrl);
      expect(download.ok()).toBe(true);
      expect((await download.body()).byteLength).toBeGreaterThan(0);
    }

    expect(orderSnapshots[0].renderStatus).toBe("completed");
  });

  test("editing the saved design afterwards does not alter the placed order", async ({ page }) => {
    await login(page, customerCredentials.email, customerCredentials.password);

    // The ordered customization is locked; the attempt must fail safely.
    const attempt = await page.request.patch(`/api/customizations/${encodeURIComponent(customizationAId)}`, {
      data: { values: { bride_name: "MUTATED AFTER ORDER" } },
    });
    expect([403, 404, 409]).toContain(attempt.status());

    // And the frozen snapshot is byte-for-byte what it was.
    await login(page, adminCredentials.email, adminCredentials.password);
    const snapshots = await page.request.get(`/api/admin/customizer/orders/${encodeURIComponent(placedOrderId)}/snapshots`);
    const orderSnapshots = (await snapshots.json()).snapshots || [];
    expect(orderSnapshots[0].integrityHash).toBe(snapshotIntegrityHash);
  });
});

test("a repeated checkout submission id never creates a second order", async ({ page }) => {
  await login(page, customerCredentials.email, customerCredentials.password);
  const checkoutSubmissionId = `e2e-idempotency-${Date.now()}`;
  const body = {
    checkoutSubmissionId,
    customerName: "Idempotency Test",
    customerPhone: "+8801711000001",
    deliveryMethod: "store",
    items: [
      {
        productId: seedManifest.productId,
        productSlug: seedManifest.productSlug,
        title: "Idempotency test item",
        price: 100,
        quantity: 1,
        currency: "BDT",
      },
    ],
    message: "Idempotency test",
  };

  const first = await page.request.post("/api/order-requests", { data: body });
  expect(first.ok()).toBe(true);
  const firstPayload = await first.json();
  expect(firstPayload.ok).toBe(true);
  expect(first.status(), "a genuinely new order is a 201").toBe(201);

  // Same submission id, sent twice more (simulating a double click and a
  // network retry): must return the SAME order, never a new one.
  const second = await page.request.post("/api/order-requests", { data: body });
  const secondPayload = await second.json();
  expect(secondPayload.ok).toBe(true);
  expect(secondPayload.order.id).toBe(firstPayload.order.id);
  expect(second.status(), "an idempotent replay is a 200, not a fresh 201").toBe(200);
  expect(secondPayload.idempotent).toBe(true);

  const third = await page.request.post("/api/order-requests", { data: body });
  const thirdPayload = await third.json();
  expect(thirdPayload.order.id).toBe(firstPayload.order.id);

  // Database state, not just the response: exactly one order carries this id.
  const ownOrders = await page.request.get("/api/order-requests");
  const ownPayload = await ownOrders.json();
  const matching = (ownPayload.orders || []).filter((order: any) => order.id === firstPayload.order.id);
  expect(matching, "the retries must not have created extra orders").toHaveLength(1);

  // A genuinely new checkout (new submission id) must be free to create a
  // brand new order.
  const fresh = await page.request.post("/api/order-requests", { data: { ...body, checkoutSubmissionId: `e2e-idempotency-${Date.now()}-fresh` } });
  const freshPayload = await fresh.json();
  expect(freshPayload.ok).toBe(true);
  expect(freshPayload.order.id).not.toBe(firstPayload.order.id);
});

test("an idempotency token is not an authorization token: Customer B cannot reuse Customer A's submission id", async ({ browser }) => {
  const submissionId = `e2e-shared-token-${Date.now()}`;
  const orderBody = (name: string) => ({
    checkoutSubmissionId: submissionId,
    customerName: name,
    customerPhone: "+8801711000004",
    deliveryMethod: "store",
    items: [
      {
        productId: seedManifest.productId,
        productSlug: seedManifest.productSlug,
        title: "Shared token test item",
        price: 100,
        quantity: 1,
        currency: "BDT",
      },
    ],
  });

  // Customer A places a real order using submission id X.
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await login(pageA, customerCredentials.email, customerCredentials.password);
  const createdA = await pageA.request.post("/api/order-requests", { data: orderBody("Customer A") });
  expect(createdA.ok()).toBe(true);
  const orderA = (await createdA.json()).order;
  expect(orderA.id).toBeTruthy();

  // Customer A repeating X is idempotent — same order, no duplicate.
  const replayA = await pageA.request.post("/api/order-requests", { data: orderBody("Customer A") });
  expect((await replayA.json()).order.id).toBe(orderA.id);

  // Customer B now deliberately submits the SAME submission id X.
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await login(pageB, customerBEmail, customerBPassword);
  const attempt = await pageB.request.post("/api/order-requests", { data: orderBody("Customer B") });
  const attemptPayload = await attempt.json().catch(() => ({}));

  // Whatever the outcome, Customer B must NEVER receive Customer A's order.
  if (attemptPayload?.order) {
    expect(attemptPayload.order.id, "Customer B must never be handed Customer A's order").not.toBe(orderA.id);
    expect(attemptPayload.order.customerEmail).toBe(customerBEmail.toLowerCase());
  }

  // And Customer A's order must still be intact and still theirs alone.
  const listB = await pageB.request.get("/api/order-requests");
  const payloadB = await listB.json().catch(() => ({}));
  expect((payloadB.orders || []).some((order: any) => order.id === orderA.id)).toBe(false);

  const listA = await pageA.request.get("/api/order-requests");
  const payloadA = await listA.json();
  expect((payloadA.orders || []).filter((order: any) => order.id === orderA.id)).toHaveLength(1);

  // Customer B can still check out normally with their own fresh token.
  const ownToken = await pageB.request.post("/api/order-requests", {
    data: { ...orderBody("Customer B"), checkoutSubmissionId: `e2e-own-token-${Date.now()}` },
  });
  const ownPayload = await ownToken.json();
  expect(ownPayload.ok).toBe(true);
  expect(ownPayload.order.id).not.toBe(orderA.id);

  await contextA.close();
  await contextB.close();
});

test("checkout without a submission id is rejected rather than silently accepted", async ({ page }) => {
  await login(page, customerCredentials.email, customerCredentials.password);
  const response = await page.request.post("/api/order-requests", {
    data: { customerName: "No submission id", customerPhone: "+8801711000002", deliveryMethod: "store", items: [] },
  });
  expect(response.ok()).toBe(false);
});

test("manipulated checkout payloads cannot override trusted identity or pricing", async ({ page }) => {
  await login(page, customerCredentials.email, customerCredentials.password);
  const response = await page.request.post("/api/order-requests", {
    data: {
      checkoutSubmissionId: `e2e-manipulated-${Date.now()}`,
      customerEmail: "attacker@example.com",
      customerId: "00000000-0000-0000-0000-000000000000",
      customerName: "Manipulated",
      customerPhone: "+8801711000003",
      deliveryMethod: "store",
      items: [{ productId: seedManifest.productId, productSlug: seedManifest.productSlug, title: "Manipulated item", price: 1, quantity: 1, currency: "BDT" }],
      subtotal: 1,
      total: 1,
      deliveryCharge: -50,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (response.ok() && payload.order) {
    expect(payload.order.customerEmail).toBe(customerCredentials.email.toLowerCase());
    expect(payload.order.customerId).not.toBe("00000000-0000-0000-0000-000000000000");
    expect(payload.order.deliveryCharge).toBeGreaterThanOrEqual(0);
  } else {
    // Fail-closed is equally acceptable: the manipulated request is simply rejected.
    expect(response.ok()).toBe(false);
  }
});

test("Customer B cannot see Customer A's order, design, snapshot, or render output", async ({ page }) => {
  await login(page, customerBEmail, customerBPassword);

  const orders = await page.request.get("/api/order-requests");
  const ordersPayload = await orders.json().catch(() => ({}));
  const leaked = (ordersPayload.orders || []).find((order: any) => order.id === placedOrderId);
  expect(leaked, "Customer B's own order list must never include Customer A's order").toBeUndefined();

  const customization = await page.request.get(`/api/customizations/${encodeURIComponent(customizationAId)}`);
  expect([401, 403, 404]).toContain(customization.status());

  const render = await page.request.post("/api/customizer/render", { data: { customizationId: customizationAId, jobType: "preview" } });
  expect([401, 403, 404]).toContain(render.status());

  // Order design snapshots (and therefore the production PNG/PDF signed URLs)
  // are an Admin-only resource — a signed-in customer must be refused.
  const snapshots = await page.request.get(`/api/admin/customizer/orders/${encodeURIComponent(placedOrderId)}/snapshots`);
  expect([401, 403, 404]).toContain(snapshots.status());

  // Admin order and render-worker endpoints must reject a plain customer too.
  const adminOrders = await page.request.get("/api/admin/order-requests");
  expect([401, 403]).toContain(adminOrders.status());

  const worker = await page.request.post("/api/admin/customizer/render/process", { data: { limit: 1 } });
  expect([401, 403]).toContain(worker.status());

  // Print production is never customer-invokable, even on their OWN design.
  const printAttempt = await page.request.post("/api/customizer/render", { data: { customizationId: customizationAId, jobType: "print_pdf" } });
  expect([401, 403, 404]).toContain(printAttempt.status());
});

test("the render worker rejects an unauthenticated or wrongly-signed request", async ({ request }) => {
  // No session, no secret.
  const anonymous = await request.post("/api/admin/customizer/render/process", { data: { limit: 1 } });
  expect(anonymous.status()).toBe(401);

  // Cron-style GET with no bearer token, and with a wrong one.
  const noToken = await request.get("/api/admin/customizer/render/process");
  expect(noToken.status()).toBe(401);

  const wrongToken = await request.get("/api/admin/customizer/render/process", {
    headers: { authorization: "Bearer not-the-real-cron-secret" },
  });
  expect(wrongToken.status()).toBe(401);

  const wrongHeaderSecret = await request.post("/api/admin/customizer/render/process", {
    headers: { "x-render-secret": "not-the-real-worker-secret" },
    data: { limit: 1 },
  });
  expect(wrongHeaderSecret.status()).toBe(401);
});
