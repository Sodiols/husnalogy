import sharp from "sharp";
import { expect, test, type Browser, type Page, type Response } from "@playwright/test";
import {
  SEEDED_OPTIONS,
  adminCredentials,
  checkoutBody,
  createCartLine,
  customerCredentials,
  login,
  requireSeededAcceptance,
  seedManifest,
  supabaseAnonKey,
  sessionAccessToken,
  supabaseUrl,
} from "./helpers";

// Seeded staging only — these tests place REAL orders. See
// scripts/seed-customizer-test.mjs and HOSTINGER_DEPLOYMENT.md §3.

test.beforeAll(() => {
  requireSeededAcceptance([
    ["customer email", customerCredentials.email],
    ["customer password", customerCredentials.password],
    ["admin email", adminCredentials.email],
    ["seeded product", seedManifest.productId],
    ["seeded product slug", seedManifest.productSlug],
    ["seeded template", seedManifest.templateId],
    ["E2E_SUPABASE_URL", supabaseUrl],
    ["E2E_SUPABASE_ANON_KEY", supabaseAnonKey],
  ]);
});

async function fillCheckout(page: Page) {
  await page.getByLabel(/^Phone/i).fill("01711000009");
  await page.getByRole("button", { name: "Delivery", exact: true }).click();
  await page.getByLabel(/^City/i).fill("Sylhet");
  await page.getByLabel(/^Address/i).fill("42/4c Nurani, Bonkolapara, Subidbazar");
  const terms = page.getByRole("checkbox", { name: /accept the/i });
  await expect(terms).not.toBeChecked();
  await terms.check();
  await expect(page.getByRole("button", { name: "Place order" })).toBeEnabled();
}

async function ownOrderIds(page: Page): Promise<string[]> {
  const payload = await (await page.request.get("/api/order-requests")).json();
  return (payload.orders || []).map((order: { id: string }) => order.id);
}

async function adminTasks(browser: Browser, orderId: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, adminCredentials.email, adminCredentials.password);
  const payload = await (await page.request.get(`/api/admin/customizer/orders/${encodeURIComponent(orderId)}/snapshots`)).json();
  await context.close();
  return payload as { snapshots: any[]; productionTasks: any[]; notificationTasks: any[] };
}

async function placeFrom(page: Page): Promise<{ response: Response; submissionId: string }> {
  const request = page.waitForRequest((candidate) => candidate.url().includes("/api/order-requests") && candidate.method() === "POST");
  const response = page.waitForResponse((candidate) => candidate.url().includes("/api/order-requests") && candidate.request().method() === "POST");
  await page.getByRole("button", { name: "Place order" }).click();
  const submissionId = JSON.parse((await request).postData() || "{}").checkoutSubmissionId;
  return { response: await response, submissionId };
}

/**
 * A tab refused with CHECKOUT_IN_PROGRESS (the other tab held the checkout
 * preparation lease) shows an error; the customer presses Place order again
 * and is then shown the order the other tab placed. Returns the final body.
 */
async function settleRefusedTab(page: Page, first: { status: number; body: any }) {
  if (first.status !== 409 || first.body.code !== "CHECKOUT_IN_PROGRESS") return first;
  await expect(page.getByText(/already being placed in another tab/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Place order" })).toBeEnabled({ timeout: 30_000 });
  const again = await placeFrom(page);
  return { status: again.response.status(), body: await again.response.json() };
}

test.describe.serial("complete customer journey", () => {
  let orderId = "";

  test("home → browse → product → personalize → save → reload → upload → cart → quantity → checkout → confirmation → history", async ({ page, browser }) => {
    await page.goto("/");
    await expect(page.locator("main").first()).toBeVisible();
    await page.goto("/products");
    await expect(page.locator("a[href^='/products/']").first()).toBeVisible();

    await login(page, customerCredentials.email, customerCredentials.password, `/products/${seedManifest.productSlug}`);
    await page.goto(`/products/${seedManifest.productSlug}`);
    await expect(page.getByRole("heading").first()).toBeVisible();

    // A brand-new design (no customization id).
    await page.goto(`/products/${seedManifest.productSlug}/personalize`);
    const root = page.locator("[data-customizer-root]");
    await expect(root).toBeVisible();
    const nameField = root.getByRole("textbox").first();
    await nameField.fill("E2E Journey Couple");
    await expect(root.getByText(/Saved/).first()).toBeVisible({ timeout: 30_000 });

    // Reload restores the saved draft.
    await page.reload();
    await expect(page.locator("[data-customizer-root]").getByRole("textbox").first()).toHaveValue("E2E Journey Couple", { timeout: 30_000 });

    // Upload a real image through the hardened upload route.
    const png = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: { r: 210, g: 190, b: 170 } } }).png().toBuffer();
    const uploadResponse = page.waitForResponse((candidate) => candidate.url().includes("/api/customizer/upload"));
    await page.locator("[data-customizer-root] input[type='file']").first().setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
    expect((await uploadResponse).ok()).toBe(true);

    await page.getByRole("button", { name: /Next: Review/i }).click();
    const approval = page.locator('input[type="checkbox"]').last();
    if (await approval.count()) await approval.check();
    await page.getByRole("button", { name: /Add to cart|Update cart/i }).click();
    await expect(page).toHaveURL(/\/cart/);

    // Edit the cart: quantity 1 → 2.
    await page.getByRole("button", { name: "+" }).first().click();
    await expect(page.getByText("2", { exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: /checkout/i }).click();
    await expect(page).toHaveURL(/\/checkout/);
    await fillCheckout(page);
    const { response } = await placeFrom(page);
    expect(response.status()).toBe(201);
    const payload = await response.json();
    orderId = payload.order.id;
    expect(payload.order.items[0].quantity).toBe(2);
    expect(payload.order.items[0].customizationId).toBeTruthy();
    expect(payload.order.paymentStatus).toBe("unpaid");
    await expect(page.getByText(/Order placed/i).first()).toBeVisible();

    // Refresh after success never offers the order again.
    await page.reload();
    await expect(page.getByRole("button", { name: /Place order|Order placed/ })).toBeDisabled();

    // Order history and details.
    await page.goto("/orders");
    await expect(page.getByText(orderId).first()).toBeVisible();
    expect(await ownOrderIds(page)).toContain(orderId);

    // Snapshot, production task and notifications, as Admin sees them.
    const tasks = await adminTasks(browser, orderId);
    expect(tasks.snapshots).toHaveLength(1);
    expect(tasks.snapshots[0].orderItemId).toBe(payload.order.items[0].id);
    expect(tasks.productionTasks).toHaveLength(1);
    expect(tasks.productionTasks[0].order_item_id).toBe(payload.order.items[0].id);
    expect(tasks.notificationTasks).toHaveLength(2);
  });
});

test.describe("real multi-tab and multi-device checkout of ONE cart", () => {
  test("two TABS (same browser session) → exactly one order", async ({ browser }) => {
    const context = await browser.newContext();
    const tabA = await context.newPage();
    await login(tabA, customerCredentials.email, customerCredentials.password);
    await createCartLine(tabA, { productId: seedManifest.productId, quantity: 1 });
    const before = await ownOrderIds(tabA);

    const tabB = await context.newPage();
    await tabA.goto("/checkout");
    await tabB.goto("/checkout");
    await fillCheckout(tabA);
    await fillCheckout(tabB);

    const [a, b] = await Promise.all([placeFrom(tabA), placeFrom(tabB)]);
    const first = await Promise.all([a, b].map(async ({ response }) => ({ status: response.status(), body: await response.json() })));
    // Same submission id → idempotent replay (200); a concurrent tab → refused
    // while the other prepares (409 CHECKOUT_IN_PROGRESS) or after the cart was
    // consumed (409 CART_ALREADY_ORDERED). Never two creations.
    expect(first.filter((result) => result.status === 201)).toHaveLength(1);
    expect(first.every((result) => [201, 200, 409].includes(result.status))).toBe(true);
    const settled = [first[0].status === 201 ? first[0] : await settleRefusedTab(tabA, first[0]), first[1].status === 201 ? first[1] : await settleRefusedTab(tabB, first[1])];
    expect(settled.every((result) => result.status === 201 || result.status === 200 || result.body.code === "CART_ALREADY_ORDERED" || result.body.code === "SUBMISSION_REUSED")).toBe(true);

    const after = await ownOrderIds(tabA);
    const created = after.filter((id) => !before.includes(id));
    expect(created).toHaveLength(1);
    await expect(tabA.getByText(/Order placed/i).first()).toBeVisible();
    await expect(tabB.getByText(/Order placed/i).first()).toBeVisible();

    const tasks = await adminTasks(browser, created[0]);
    expect(tasks.notificationTasks).toHaveLength(2);
    expect(tasks.productionTasks).toHaveLength(0); // plain product: no production, and no duplicates
    expect(tasks.snapshots).toHaveLength(0);
    await context.close();
  });

  test("two DEVICES (separate sessions, different submission ids) → exactly one order, the other told it is already ordered", async ({ browser }) => {
    const deviceA = await browser.newContext();
    const deviceB = await browser.newContext();
    const pageA = await deviceA.newPage();
    const pageB = await deviceB.newPage();
    await login(pageA, customerCredentials.email, customerCredentials.password);
    await login(pageB, customerCredentials.email, customerCredentials.password);
    await createCartLine(pageA, { productId: seedManifest.productId, quantity: 1 });
    const before = await ownOrderIds(pageA);

    await pageA.goto("/checkout");
    await pageB.goto("/checkout");
    await fillCheckout(pageA);
    await fillCheckout(pageB);

    const [a, b] = await Promise.all([placeFrom(pageA), placeFrom(pageB)]);
    expect(a.submissionId).not.toBe(b.submissionId);
    const results = await Promise.all([a, b].map(async ({ response }) => ({ status: response.status(), body: await response.json() })));
    const created = results.filter((result) => result.status === 201);
    const refusedIndex = results.findIndex((result) => result.status === 409);
    expect(created).toHaveLength(1);
    expect(refusedIndex).toBeGreaterThanOrEqual(0);
    expect(["CHECKOUT_IN_PROGRESS", "CART_ALREADY_ORDERED"]).toContain(results[refusedIndex].body.code);
    // The refused device is shown the other device's order (after one retry
    // when it was refused while that order was still being prepared).
    const refused = await settleRefusedTab(refusedIndex === 0 ? pageA : pageB, results[refusedIndex]);
    expect(refused.body.code).toBe("CART_ALREADY_ORDERED");
    expect(refused.body.orderId).toBe(created[0].body.order.id);
    const tasks = await adminTasks(browser, created[0].body.order.id);
    expect(tasks.notificationTasks).toHaveLength(2);

    const newOrders = (await ownOrderIds(pageA)).filter((id) => !before.includes(id));
    expect(newOrders).toEqual([created[0].body.order.id]);
    // Both devices end on the same confirmation, not an error.
    await expect(pageA.getByText(/Order placed/i).first()).toBeVisible();
    await expect(pageB.getByText(/Order placed/i).first()).toBeVisible();
    await deviceA.close();
    await deviceB.close();
  });

  test("a NEW cart for the same product later is a new legitimate order", async ({ page }) => {
    await login(page, customerCredentials.email, customerCredentials.password);
    const first = await createCartLine(page, { productId: seedManifest.productId });
    const one = await page.request.post("/api/order-requests", {
      data: checkoutBody({ items: [{ productId: seedManifest.productId, quantity: 1, selectedOptions: SEEDED_OPTIONS, cartItemId: first }] }),
    });
    const second = await createCartLine(page, { productId: seedManifest.productId });
    const two = await page.request.post("/api/order-requests", {
      data: checkoutBody({ items: [{ productId: seedManifest.productId, quantity: 1, selectedOptions: SEEDED_OPTIONS, cartItemId: second }] }),
    });
    expect(one.status()).toBe(201);
    expect(two.status()).toBe(201);
    expect((await one.json()).order.id).not.toBe((await two.json()).order.id);
  });
});

/** Does this cart line still exist for the signed-in customer (Supabase REST, RLS)? */
async function cartLineExists(page: Page, id: string) {
  const token = await sessionAccessToken(page);
  const response = await fetch(`${supabaseUrl}/rest/v1/cart_items?select=id&id=eq.${id}`, { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${token}` } });
  return ((await response.json()) as unknown[]).length > 0;
}

test("two TABS checking out ONE PERSONALIZED cart line simultaneously → one order, one cart consumption, one snapshot, no duplicate tasks", async ({ browser }) => {
  const context = await browser.newContext();
  const tabA = await context.newPage();
  await login(tabA, customerCredentials.email, customerCredentials.password);
  const created = await tabA.request.post("/api/customizations", {
    data: { productId: seedManifest.productId, templateId: seedManifest.templateId, templateVersion: 1, status: "in_cart", values: { guest_name: "Two Tabs" }, selectedOptions: SEEDED_OPTIONS },
  });
  expect(created.ok()).toBe(true);
  const customizationId = (await created.json()).customization.id;
  const cartItemId = await createCartLine(tabA, { productId: seedManifest.productId, quantity: 1, customizationId });
  const before = await ownOrderIds(tabA);

  const tabB = await context.newPage();
  await tabA.goto("/checkout");
  await tabB.goto("/checkout");
  await fillCheckout(tabA);
  await fillCheckout(tabB);
  const [a, b] = await Promise.all([placeFrom(tabA), placeFrom(tabB)]);
  const first = await Promise.all([a, b].map(async ({ response }) => ({ status: response.status(), body: await response.json() })));
  expect(first.filter((result) => result.status === 201)).toHaveLength(1);
  for (const [index, result] of first.entries()) {
    if (result.status === 201) continue;
    expect([200, 409]).toContain(result.status); // controlled: replay, in progress, or already ordered
    const settled = await settleRefusedTab(index === 0 ? tabA : tabB, result);
    expect(settled.status === 200 || ["CART_ALREADY_ORDERED", "SUBMISSION_REUSED"].includes(settled.body.code)).toBe(true);
  }

  const created201 = first.find((result) => result.status === 201)!;
  const orderId = created201.body.order.id;
  expect((await ownOrderIds(tabA)).filter((id) => !before.includes(id))).toEqual([orderId]);
  expect(await cartLineExists(tabA, cartItemId)).toBe(false);
  const tasks = await adminTasks(browser, orderId);
  expect(tasks.snapshots).toHaveLength(1);
  expect(tasks.snapshots[0].customizationId).toBe(customizationId);
  expect(tasks.productionTasks).toHaveLength(1);
  expect(tasks.notificationTasks).toHaveLength(2);
  expect(created201.body.order.items).toHaveLength(1);
  await context.close();
});

test("one order with TWO personalized designs links each snapshot and task to its own item", async ({ page, browser }) => {
  await login(page, customerCredentials.email, customerCredentials.password);
  const designIds: string[] = [];
  for (const names of ["Design One", "Design Two"]) {
    const created = await page.request.post("/api/customizations", {
      data: {
        productId: seedManifest.productId,
        templateId: seedManifest.templateId,
        templateVersion: 1,
        status: "in_cart",
        values: { guest_name: names },
        selectedOptions: SEEDED_OPTIONS,
      },
    });
    expect(created.ok()).toBe(true);
    designIds.push((await created.json()).customization.id);
  }
  const items = [];
  for (const [index, customizationId] of designIds.entries()) {
    const quantity = index + 1;
    items.push({
      productId: seedManifest.productId,
      quantity,
      selectedOptions: SEEDED_OPTIONS,
      customizationId,
      cartItemId: await createCartLine(page, { productId: seedManifest.productId, quantity, customizationId }),
    });
  }
  const response = await page.request.post("/api/order-requests", { data: checkoutBody({ items }) });
  expect(response.status()).toBe(201);
  const order = (await response.json()).order;
  const tasks = await adminTasks(browser, order.id);
  expect(tasks.snapshots).toHaveLength(2);
  for (const item of order.items) {
    const snapshot = tasks.snapshots.find((candidate) => candidate.customizationId === item.customizationId);
    expect(snapshot.orderItemId, `snapshot for ${item.customizationId}`).toBe(item.id);
    const task = tasks.productionTasks.find((candidate) => candidate.snapshot_id === snapshot.id);
    expect(task.order_item_id).toBe(item.id);
  }
  expect(new Set(tasks.snapshots.map((snapshot) => snapshot.orderItemId)).size).toBe(2);
});
