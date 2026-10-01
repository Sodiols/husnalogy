import { expect, test, type Page } from "@playwright/test";
import { adminCredentials, createCartLine, customerCredentials, login, requireSeededAcceptance, seedManifest } from "./helpers";

/**
 * Storefront flows on the seeded STAGING project with a normal (listed,
 * non-personalized) product: browse → product page → options (incl. Paper
 * Style) → add to cart → cart quantity and removal → COD checkout → order
 * history/details → admin visibility; plus session expiry, unauthorized admin
 * access and cross-customer isolation. Creates real staging orders.
 */
const customerB = {
  email: process.env.E2E_CUSTOMER_B_EMAIL || seedManifest.customerBEmail || "",
  password: process.env.E2E_CUSTOMER_B_PASSWORD || seedManifest.password || "",
};

test.beforeAll(() => {
  requireSeededAcceptance([
    ["normal product", seedManifest.normalProductSlug],
    ["customer email", customerCredentials.email],
    ["customer password", customerCredentials.password],
    ["Customer B email", customerB.email],
    ["admin email", adminCredentials.email],
  ]);
});

const option = (page: Page, label: string) => page.getByRole("button", { name: label });

async function cartLineFor(page: Page, title: string) {
  return page.locator("article").filter({ hasText: title });
}

test.describe.serial("storefront: normal product to confirmed COD order", () => {
  let orderId = "";

  test("homepage, product listing and product page load", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main").first()).toBeVisible();
    await page.goto("/products");
    const card = page.locator(`a[href="/products/${seedManifest.normalProductSlug}"]`).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/products/${seedManifest.normalProductSlug}`));
    await expect(page.getByRole("heading", { name: /E2E Standard Card/ }).first()).toBeVisible();
  });

  test("option selection (Paper Style, size, paper) and add to cart; quantity edit and removal in the cart", async ({ page }) => {
    await login(page, customerCredentials.email, customerCredentials.password, `/products/${seedManifest.normalProductSlug}`);
    await option(page, "Folded Card").click();
    await expect(option(page, "Folded Card")).toHaveAttribute("aria-pressed", "true");
    await option(page, "Blank White Envelopes").click();
    // A second, independent line used only to prove removal.
    await createCartLine(page, { productId: seedManifest.productId, quantity: 1 });
    await page.getByRole("button", { name: "Add to Cart", exact: true }).click();
    await page.goto("/cart");

    const line = await cartLineFor(page, "E2E Standard Card");
    await expect(line).toBeVisible({ timeout: 30_000 });
    await line.getByRole("button", { name: "+" }).click();
    await expect(line.getByText("2", { exact: true })).toBeVisible();

    const removable = await cartLineFor(page, "E2E cart line");
    await expect(removable.first()).toBeVisible();
    const before = await page.locator("article").count();
    await removable.first().getByRole("button", { name: "Remove" }).click();
    await expect.poll(() => page.locator("article").count()).toBe(before - 1);
  });

  test("checkout: customer details, delivery, terms, Cash on Delivery, place order, confirmation, cart consumed", async ({ page }) => {
    await login(page, customerCredentials.email, customerCredentials.password, "/checkout");
    await page.getByLabel(/^Phone/i).fill("01711000077");
    await page.getByRole("button", { name: "Delivery", exact: true }).click();
    await page.getByLabel(/^City/i).fill("Sylhet");
    await page.getByLabel(/^Address/i).fill("42/4c Nurani, Bonkolapara, Subidbazar");
    const terms = page.getByRole("checkbox", { name: /accept the/i });
    await expect(terms).not.toBeChecked();
    await expect(page.getByText(/Cash on Delivery/i).first()).toBeVisible();
    await terms.check();
    const response = page.waitForResponse((candidate) => candidate.url().includes("/api/order-requests") && candidate.request().method() === "POST");
    await page.getByRole("button", { name: "Place order" }).click();
    const placed = await response;
    expect(placed.status()).toBe(201);
    const body = await placed.json();
    orderId = body.order.id;
    expect(body.order.paymentStatus).toBe("unpaid");
    expect(body.order.items.some((item: { productTitle: string; selectedOptions: Record<string, string> }) => item.productTitle === "E2E Standard Card" && /folded/i.test(String(item.selectedOptions.paperStyle)))).toBe(true);
    await expect(page.getByText(/Order placed/i).first()).toBeVisible();
    await page.goto("/cart");
    await expect(await cartLineFor(page, "E2E Standard Card")).toHaveCount(0);
  });

  test("order history and order details show the order to its customer", async ({ page }) => {
    expect(orderId).toBeTruthy();
    await login(page, customerCredentials.email, customerCredentials.password, "/orders");
    const card = page.locator("article").filter({ hasText: `Order ${orderId}` });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText("E2E Standard Card").first()).toBeVisible();
    await expect(card.getByText(/Cash on Delivery/)).toBeVisible();
    await expect(card.getByText(/Delivery/).first()).toBeVisible();
  });

  test("admin sees the order in the dashboard", async ({ page }) => {
    await login(page, adminCredentials.email, adminCredentials.password, "/admin/dashboard?section=Order%20Requests");
    await expect(page.getByText(orderId).first()).toBeVisible({ timeout: 30_000 });
  });

  test("Customer B can neither list nor read Customer A's order", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, customerB.email, customerB.password, "/orders");
    const listed = await (await page.request.get("/api/order-requests")).json();
    expect((listed.orders || []).map((order: { id: string }) => order.id)).not.toContain(orderId);
    await expect(page.getByText(`Order ${orderId}`)).toHaveCount(0);
    await context.close();
  });
});

test.describe("authorization in the browser", () => {
  test("a customer cannot open the admin dashboard or admin APIs", async ({ page }) => {
    await login(page, customerCredentials.email, customerCredentials.password);
    const dashboard = await page.goto("/admin/dashboard");
    expect(dashboard?.status()).toBe(404);
    expect((await page.request.get("/api/admin/production/health")).status()).toBe(401);
    expect((await page.request.get("/api/admin/order-requests")).status()).toBeGreaterThanOrEqual(401);
  });

  test("an expired session (auth cookies gone) loses access to orders and checkout", async ({ page, context }) => {
    await login(page, customerCredentials.email, customerCredentials.password, "/orders");
    expect((await page.request.get("/api/order-requests")).status()).toBe(200);
    await context.clearCookies();
    await page.evaluate(() => { window.localStorage.clear(); window.sessionStorage.clear(); });
    expect((await page.request.get("/api/order-requests")).status()).toBe(401);
    await page.goto("/orders");
    await expect(page.getByText(/Sign in to view your orders/i)).toBeVisible({ timeout: 30_000 });
  });
});
