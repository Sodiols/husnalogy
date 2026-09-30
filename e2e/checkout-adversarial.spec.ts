import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  SEEDED_OPTIONS,
  checkoutBody,
  checkoutBodyWithCart,
  createCartLine,
  customerCredentials,
  login,
  requireSeededAcceptance,
  seedManifest,
  sessionAccessToken,
  supabaseAnonKey,
  supabaseUrl,
} from "./helpers";

// Adversarial checkout suite: every request here is something a customer can
// send by editing DevTools or scripting the API. Part 1 needs no account and
// never creates data (safe against any environment). Part 2 CREATES REAL
// ORDERS and therefore only runs against the seeded local/staging project
// (npm run seed:customizer:test) — never production.

const customerBEmail = process.env.E2E_CUSTOMER_B_EMAIL || seedManifest.customerBEmail || "";
const customerBPassword = process.env.E2E_CUSTOMER_B_PASSWORD || seedManifest.password || "";
const customizationAId = process.env.E2E_CUSTOMIZATION_A_ID || seedManifest.customizationAId || "";

test.describe("unauthenticated attacks (no data created)", () => {
  test("order, quote and customization writes require a session", async ({ request }) => {
    expect((await request.post("/api/order-requests", { data: checkoutBody() })).status()).toBe(401);
    expect((await request.get("/api/order-requests")).status()).toBe(401);
    expect((await request.post("/api/checkout/quote", { data: { items: [] } })).status()).toBe(401);
    expect((await request.post("/api/customizations", { data: {} })).status()).toBe(401);
    expect((await request.patch("/api/customizations/8f14e45f-ceea-4f67-9b1a-2a3c4d5e6f70", { data: {} })).status()).toBe(401);
    expect((await request.post("/api/customizer/upload", { multipart: { file: { name: "x.png", mimeType: "image/png", buffer: Buffer.from("x") } } })).status()).toBe(401);
  });

  test("cross-site origins are refused before anything else", async ({ request }) => {
    const response = await request.post("/api/order-requests", { data: checkoutBody(), headers: { Origin: "https://evil.example" } });
    expect(response.status()).toBe(403);
  });

  test("admin APIs refuse anonymous callers", async ({ request }) => {
    expect([401, 403]).toContain((await request.get("/api/admin/order-requests")).status());
    expect([401, 403]).toContain((await request.put("/api/admin/order-requests/any-id", { data: { status: "delivered" } })).status());
    expect([401, 403]).toContain((await request.post("/api/admin/customizer/render/process", { data: {} })).status());
    expect([401, 403]).toContain((await request.get("/api/admin/production/health")).status());
    expect([401, 403]).toContain((await request.get("/api/admin/production/health", { headers: { Authorization: "Bearer wrong-secret" } })).status());
    expect([401, 403]).toContain((await request.get("/api/admin/customizer/render/process", { headers: { Authorization: "Bearer wrong-secret" } })).status());
  });

  test("the original library asset file is not public", async ({ request }) => {
    const response = await request.get("/api/customizer/assets/8f14e45f-ceea-4f67-9b1a-2a3c4d5e6f70?variant=original", { maxRedirects: 0 });
    expect([401, 403, 404]).toContain(response.status());
  });

  test("unsupported methods are rejected", async ({ request }) => {
    expect((await request.put("/api/order-requests", { data: {} })).status()).toBe(405);
    expect((await request.delete("/api/checkout/quote")).status()).toBe(405);
  });
});

test.describe("authenticated attacks against the seeded project (creates orders)", () => {
  test.beforeAll(() => {
    requireSeededAcceptance([
      ["customer email", customerCredentials.email],
      ["customer password", customerCredentials.password],
      ["Customer B email", customerBEmail],
      ["seeded product", seedManifest.productId],
      ["Customer A customization", customizationAId],
      ["E2E_SUPABASE_URL", supabaseUrl],
      ["E2E_SUPABASE_ANON_KEY", supabaseAnonKey],
    ]);
  });

  const post = (request: APIRequestContext, data: unknown, headers: Record<string, string> = {}) =>
    request.post("/api/order-requests", { data, headers });
  const signIn = (page: Page) => login(page, customerCredentials.email, customerCredentials.password);

  test("valid order is priced by the server, starts unpaid/pending, and consumes its cart line", async ({ page }) => {
    await signIn(page);
    const body = await checkoutBodyWithCart(page);
    const response = await post(page.request, body);
    expect(response.status()).toBe(201);
    const { order } = await response.json();
    expect(order.total).toBe(1200);
    expect(order.paymentStatus).toBe("unpaid");
    expect(order.status).toBe("pending");
    expect(order.currency).toBe("BDT");
    // The same cart line cannot be ordered again, even with a new submission id.
    const again = await post(page.request, { ...body, checkoutSubmissionId: `${body.checkoutSubmissionId}-again` });
    expect(again.status()).toBe(409);
    expect((await again.json()).orderId).toBe(order.id);
  });

  for (const [label, extra] of [
    ["price", { price: 1 }],
    ["subtotal", { subtotal: 1 }],
    ["total", { total: 1 }],
    ["deliveryCharge (negative)", { deliveryCharge: -100 }],
    ["deliveryCharge (zero)", { deliveryCharge: 0 }],
    ["currency", { currency: "USD" }],
    ["paymentStatus", { paymentStatus: "paid" }],
    ["status", { status: "delivered" }],
    ["customerId", { customerId: "00000000-0000-0000-0000-000000000000" }],
    ["customerEmail", { customerEmail: "victim@example.com" }],
  ] as Array<[string, Record<string, unknown>]>) {
    test(`rejects a forged ${label}`, async ({ page }) => {
      await signIn(page);
      expect((await post(page.request, await checkoutBodyWithCart(page, extra))).status()).toBe(400);
    });
  }

  for (const [label, extra] of [
    ["unit price", { price: 0.01 }],
    ["title", { title: "Free card" }],
    ["image", { image: "https://evil.example/x.png" }],
    ["sku", { sku: "FREE" }],
    ["currency", { currency: "USD" }],
  ] as Array<[string, Record<string, unknown>]>) {
    test(`rejects a forged line ${label}`, async ({ page }) => {
      await signIn(page);
      expect((await post(page.request, await checkoutBodyWithCart(page, {}, extra))).status()).toBe(400);
    });
  }

  test("a forged option price suffix is charged the configured surcharge", async ({ page }) => {
    await signIn(page);
    const body = await checkoutBodyWithCart(page, {}, { selectedOptions: { ...SEEDED_OPTIONS, printing: "High Definition +$0" } });
    const response = await post(page.request, body);
    expect(response.status()).toBe(201);
    expect((await response.json()).order.total).toBe(1200.4);
  });

  for (const [label, selectedOptions] of [
    ["unknown option", { ...SEEDED_OPTIONS, paper: "Gold Leaf" }],
    ["unknown option group", { ...SEEDED_OPTIONS, discount: "100%" }],
  ] as Array<[string, Record<string, unknown>]>) {
    test(`rejects an ${label}`, async ({ page }) => {
      await signIn(page);
      expect((await post(page.request, await checkoutBodyWithCart(page, {}, { selectedOptions }))).status()).toBe(422);
    });
  }

  for (const [label, quantity] of [
    ["zero", 0],
    ["negative", -1],
    ["decimal", 1.5],
    ["huge", 99_999_999],
  ] as Array<[string, number]>) {
    test(`rejects a ${label} quantity`, async ({ page }) => {
      await signIn(page);
      const body = checkoutBody({ items: [{ productId: seedManifest.productId, quantity, selectedOptions: SEEDED_OPTIONS, cartItemId: "8f14e45f-ceea-4f67-9b1a-2a3c4d5e6f70" }] });
      expect((await post(page.request, body)).status()).toBe(400);
    });
  }

  test("rejects an unknown product id, bad contact data, missing terms and missing address", async ({ page }) => {
    await signIn(page);
    const unknownProduct = checkoutBody({ items: [{ productId: "product-that-does-not-exist", quantity: 1, selectedOptions: SEEDED_OPTIONS, cartItemId: "8f14e45f-ceea-4f67-9b1a-2a3c4d5e6f70" }] });
    expect((await post(page.request, unknownProduct)).status()).toBe(422);
    expect((await post(page.request, await checkoutBodyWithCart(page, { customerPhone: "12345" }))).status()).toBe(400);
    expect((await post(page.request, await checkoutBodyWithCart(page, { acceptTerms: false }))).status()).toBe(400);
    expect((await post(page.request, await checkoutBodyWithCart(page, { deliveryMethod: "delivery" }))).status()).toBe(400);
  });

  test("invalid JSON and oversized bodies are refused", async ({ page }) => {
    await signIn(page);
    const invalid = await page.request.post("/api/order-requests", { data: "{not json", headers: { "Content-Type": "application/json" } });
    expect(invalid.status()).toBe(400);
    const huge = await post(page.request, checkoutBody({ deliveryNote: "x".repeat(200_000) }));
    expect(huge.status()).toBe(413);
  });

  test("concurrent duplicate submissions (same id) create exactly one order", async ({ page }) => {
    await signIn(page);
    const body = await checkoutBodyWithCart(page);
    const responses = await Promise.all(Array.from({ length: 5 }, () => post(page.request, body)));
    const payloads = await Promise.all(responses.map((response) => response.json()));
    expect(payloads.every((payload) => payload.ok)).toBe(true);
    expect(new Set(payloads.map((payload) => payload.order.id)).size).toBe(1);
    expect(responses.filter((response) => response.status() === 201)).toHaveLength(1);
  });

  test("same cart, DIFFERENT submission ids, concurrently → one order, the rest refused as already ordered", async ({ page }) => {
    await signIn(page);
    const body = await checkoutBodyWithCart(page);
    const responses = await Promise.all(
      Array.from({ length: 4 }, (_, index) => post(page.request, { ...body, checkoutSubmissionId: `${body.checkoutSubmissionId}-tab${index}` })),
    );
    const created = responses.filter((response) => response.status() === 201);
    const refused = responses.filter((response) => response.status() === 409);
    expect(created).toHaveLength(1);
    expect(refused).toHaveLength(3);
    const orderId = (await created[0].json()).order.id;
    for (const response of refused) {
      const payload = await response.json();
      expect(payload.code).toBe("CART_ALREADY_ORDERED");
      expect(payload.orderId).toBe(orderId);
    }
  });

  test("Customer A cannot use Customer B's cart line, design, order or snapshot", async ({ browser }) => {
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await login(pageB, customerBEmail, customerBPassword);
    const cartLineB = await createCartLine(pageB, { productId: seedManifest.productId });
    const orderB = (await (await post(pageB.request, await checkoutBodyWithCart(pageB))).json()).order;

    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await signIn(pageA);
    const useCartB = await post(pageA.request, checkoutBody({ items: [{ productId: seedManifest.productId, quantity: 1, selectedOptions: SEEDED_OPTIONS, cartItemId: cartLineB }] }));
    expect(useCartB.status()).toBe(409);
    expect((await useCartB.json()).code).toBe("CART_ITEM_NOT_FOUND");

    const ordersA = await (await pageA.request.get("/api/order-requests")).json();
    expect((ordersA.orders || []).some((order: { id: string }) => order.id === orderB.id)).toBe(false);
    expect([401, 403]).toContain((await pageA.request.get(`/api/admin/customizer/orders/${orderB.id}/snapshots`)).status());

    // B's cart through Supabase REST from A's session: RLS returns nothing.
    const tokenA = await sessionAccessToken(pageA);
    const rows = await fetch(`${supabaseUrl}/rest/v1/cart_items?id=eq.${cartLineB}`, { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${tokenA}` } }).then((response) => response.json());
    expect(rows).toEqual([]);
    const ordersViaRest = await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${orderB.id}`, { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${tokenA}` } }).then((response) => response.json());
    expect(ordersViaRest).toEqual([]);
    await contextA.close();
    await contextB.close();
  });

  test("another customer's design is refused (as not found)", async ({ page }) => {
    await login(page, customerBEmail, customerBPassword);
    const body = await checkoutBodyWithCart(page, {}, { customizationId: customizationAId });
    expect((await post(page.request, body)).status()).toBe(404);
    expect((await page.request.get(`/api/customizations/${customizationAId}`)).status()).toBe(404);
    expect((await page.request.patch(`/api/customizations/${customizationAId}`, { data: { values: {} } })).status()).toBe(404);
  });

  test("POST cannot be used to update, and PATCH cannot move or escalate a design", async ({ page }) => {
    await signIn(page);
    const viaPost = await page.request.post("/api/customizations", { data: { customizationId: customizationAId, values: {} } });
    expect(viaPost.status()).toBe(400);
    for (const data of [{ productId: "another-product" }, { templateVersion: 999 }, { status: "ordered" }, { orderId: "order-x" }, { printFiles: { front: { path: "x" } } }]) {
      expect([400, 409]).toContain((await page.request.patch(`/api/customizations/${customizationAId}`, { data })).status());
    }
  });

  test("direct Supabase REST writes to server-managed columns and tables fail", async ({ page }) => {
    await signIn(page);
    const token = await sessionAccessToken(page);
    const headers = { apikey: supabaseAnonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" };
    for (const patch of [{ status: "ordered" }, { print_files: { front: {} } }, { template_version: 999 }, { selected_options: { printing: "High Definition +$0" } }]) {
      const response = await fetch(`${supabaseUrl}/rest/v1/product_customizations?id=eq.${customizationAId}`, { method: "PATCH", headers, body: JSON.stringify(patch) });
      expect([401, 403]).toContain(response.status);
    }
    for (const table of ["production_tasks", "notification_tasks", "checkout_cart_claims"]) {
      const response = await fetch(`${supabaseUrl}/rest/v1/${table}`, { method: "POST", headers, body: JSON.stringify({ order_id: "x" }) });
      expect([401, 403]).toContain(response.status);
    }
    const rpc = await fetch(`${supabaseUrl}/rest/v1/rpc/create_checkout_order`, { method: "POST", headers, body: JSON.stringify({ p_order: {}, p_items: [], p_snapshots: [], p_guards: {} }) });
    expect([401, 403, 404]).toContain(rpc.status);
  });

  test("customers cannot reach admin order management or production health", async ({ page }) => {
    await signIn(page);
    expect([401, 403]).toContain((await page.request.get("/api/admin/order-requests")).status());
    expect([401, 403]).toContain((await page.request.put("/api/admin/order-requests/any", { data: { paymentStatus: "paid" } })).status());
    expect([401, 403]).toContain((await page.request.get("/api/admin/production/health")).status());
  });
});
