/**
 * MANDATORY SCENARIO — SHARED BROWSER PRIVACY (account data).
 *
 * Customer A signs in, saves an address, a phone number and a profile photo,
 * has a cart, a wishlist and an order, and signs out. Customer B signs in on
 * the SAME browser and opens their account, checkout and orders. B must see
 * none of A's data. A, back on the browser, finds everything still on the
 * account. (The customizer half — designs, photos and recovery — is
 * e2e/customer-recovery-isolation.spec.ts.)
 *
 * Also proves the legacy browser keys (written by the old build, owner
 * unknown) are deleted rather than shown to anyone.
 *
 * Stub-only run (no real Supabase can be reached):
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 E2E_FRESH_SERVER=1 E2E_PORT=3105 \
 *     npx playwright test e2e/shared-browser-privacy.spec.ts --workers=1
 */
import { expect, test, type Page } from "@playwright/test";
import { StubAccountServer } from "./account-stub";
import { STUB_CUSTOMER, signInStubCustomer, signOutStubCustomer, supabaseIsStubbed, type StubIdentity } from "./customer-stub";
import { startSupabaseHttpStub } from "./supabase-http-stub";

const A: StubIdentity = STUB_CUSTOMER;
const B: StubIdentity = { id: "e2e00000-0000-4000-8000-0000000000b2", email: "customer.b@example.test", name: "Customer B" };
const A_ADDRESS = "House 7, Road 3, Private Lane A";
const A_PHONE = "01711000777";

test.describe("shared browser: account data never crosses accounts", () => {
  test.skip(!supabaseIsStubbed, "Needs NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:<dead port> on the dev server.");
  // Server-side auth for /account, /checkout and /orders: the run's stand-in
  // (e2e/global-setup.ts), started here too when this spec runs on its own.
  test.beforeAll(startSupabaseHttpStub);

  let accounts: StubAccountServer;

  test.beforeEach(async ({ context, page, baseURL }) => {
    // The generic stub routes first, then the per-account ones: in Playwright
    // the most recently registered route answers first.
    await signInStubCustomer(context, baseURL || "http://127.0.0.1:3000", A);
    await signOutStubCustomer(context);
    accounts = new StubAccountServer();
    await accounts.install(context);
    await page.setViewportSize({ width: 1440, height: 900 });
    const a = accounts.account(A.id);
    a.orders = [{ id: "order-a-private", productTitle: "A's Private Order", total: 1200, currency: "BDT", status: "pending", paymentStatus: "unpaid", createdAt: "2026-10-07T10:00:00.000Z", items: [] }];
    a.cart = [{ id: "c0ffee00-0000-4000-8000-0000000000c1", user_id: A.id, product_id: "p-a", product_title: "A's Cart Card", unit_price: 100, quantity: 1, metadata: {}, created_at: "2026-10-07T10:00:00.000Z" }];
    a.wishlist = [{ id: "c0ffee00-0000-4000-8000-0000000000d1", user_id: A.id, product_id: "p-a", product_title: "A's Wishlist Card", price: 100, metadata: {}, created_at: "2026-10-07T10:00:00.000Z" }];
  });

  /** Open an account view; the page is server-rendered, so a click can land before hydration and is retried. */
  async function openAccountView(page: Page, label: RegExp) {
    await page.goto("/account");
    const tab = page.getByRole("button", { name: label }).first();
    const title = label.source.includes("Saved") ? /^Saved Addresses \(/ : /^Profile Settings$/;
    await expect(tab).toBeVisible({ timeout: 30_000 });
    await expect(async () => {
      await tab.click();
      await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
  }

  test("A's address, phone, photo, cart, wishlist and orders never reach B; A keeps them", async ({ page, context, baseURL }) => {
    const base = baseURL || "http://127.0.0.1:3000";
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error?.message || error)));
    page.on("console", (message) => {
      if (message.type() === "error") pageErrors.push(`console: ${message.text()}`);
    });

    // A browser used by the OLD build: global, ownerless account keys.
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem("husnalogy_saved_addresses", JSON.stringify([{ id: "legacy", customerName: "Legacy Stranger", addressLine1: "99 Legacy Road", customerPhone: "0170000LEGACY", city: "Dhaka" }]));
      localStorage.setItem("husnalogy_profile", JSON.stringify({ phone: "0179900LEGACY" }));
      localStorage.setItem("husnalogy_orders", JSON.stringify([{ id: "order-legacy", productTitle: "Legacy Stranger Order" }]));
    });

    /* ----------------------------------------------------------- customer A */
    await signInStubCustomer(context, base, A);
    await openAccountView(page, /^Saved addresses/);
    await expect(page.getByText("Legacy Stranger")).toHaveCount(0);
    expect(await page.evaluate(() => ["husnalogy_saved_addresses", "husnalogy_profile", "husnalogy_orders"].map((key) => localStorage.getItem(key)))).toEqual([null, null, null]);

    await page.getByRole("button", { name: /Add (your first )?address/i }).first().click();
    await page.getByLabel(/^Full name/).fill("Ayesha Rahman");
    await page.getByLabel(/^Phone number/).fill(A_PHONE);
    await page.getByLabel(/^City/).fill("Dhaka");
    await page.getByLabel(/^Full address/).fill(A_ADDRESS);
    await page.getByRole("button", { name: "Save Address" }).click();
    await expect(page.getByText(A_ADDRESS, { exact: false })).toBeVisible();
    expect(accounts.account(A.id).addresses).toHaveLength(1);

    await expect(async () => {
      await page.getByRole("button", { name: /^Profile/ }).first().click();
      await expect(page.getByRole("heading", { name: /^Profile Settings$/ })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await page.getByLabel(/^Phone number/).fill(A_PHONE);
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByText("Profile updated.")).toBeVisible();
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
    await page.getByTestId("profile-photo-input").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: png });
    await expect(page.getByText("Photo updated.")).toBeVisible();
    // Persists: a reload reads it back from the account, not from a blob: preview.
    await page.reload();
    await expect(async () => {
      await page.getByRole("button", { name: /^Profile/ }).first().click();
      await expect(page.getByRole("heading", { name: /^Profile Settings$/ })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(page.locator(`img[src*="owner=${A.id}"]:visible`).first()).toBeVisible();
    await expect(page.getByLabel(/^Phone number/)).toHaveValue(A_PHONE);

    // A sees their own cart, wishlist and orders (so B's view below is a real comparison).
    await page.goto("/checkout");
    await expect(page.getByText("A's Cart Card").first()).toBeVisible({ timeout: 30_000 });
    await page.goto("/favorites");
    await expect(page.getByText("A's Wishlist Card").first()).toBeVisible({ timeout: 30_000 });
    await page.goto("/orders");
    await expect(page.getByText("A's Private Order").first()).toBeVisible({ timeout: 30_000 });

    // Nothing of A's account data is kept in this browser's storage.
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    expect(stored).not.toContain(A_PHONE);
    expect(stored).not.toContain(A_ADDRESS);

    /* -------------------------------- A signs out; B signs in, same browser */
    await signOutStubCustomer(context);
    await signInStubCustomer(context, base, B);

    await openAccountView(page, /^Saved addresses/);
    await expect(page.getByText("No saved addresses yet.")).toBeVisible();
    await expect(page.getByText(A_ADDRESS, { exact: false })).toHaveCount(0);
    await expect(async () => {
      await page.getByRole("button", { name: /^Profile/ }).first().click();
      await expect(page.getByRole("heading", { name: /^Profile Settings$/ })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(page.getByLabel(/^Phone number/)).toHaveValue("");
    await expect(page.locator(`img[src*="owner=${A.id}"]`)).toHaveCount(0);
    expect(await page.content()).not.toContain(A_PHONE);

    await page.goto("/checkout");
    await expect(page.locator('[autocomplete="street-address"]')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await expect(page.locator('[autocomplete="street-address"]')).toHaveValue("");
    await expect(page.locator('[autocomplete="tel"]')).toHaveValue("");
    await expect(page.getByText("A's Cart Card")).toHaveCount(0);

    await page.goto("/orders");
    await page.waitForTimeout(2000);
    await expect(page.getByText("A's Private Order")).toHaveCount(0);
    await expect(page.getByText("Legacy Stranger Order")).toHaveCount(0);

    await page.goto("/favorites");
    await page.waitForTimeout(1500);
    await expect(page.getByText("A's Wishlist Card")).toHaveCount(0);

    // B's own writes went only to B's account.
    expect(accounts.writes.filter((write) => write.owner === B.id)).toEqual([]);

    /* ----------------------------------------------------- A comes back */
    await signOutStubCustomer(context);
    await signInStubCustomer(context, base, A);
    await page.goto("/checkout");
    // A's own default address prefills A's checkout.
    await expect(page.locator('[autocomplete="street-address"]')).toHaveValue(A_ADDRESS, { timeout: 30_000 });
    await expect(page.locator('[autocomplete="tel"]')).toHaveValue(A_PHONE);
    await openAccountView(page, /^Saved addresses/);
    await expect(page.getByText(A_ADDRESS, { exact: false })).toBeVisible();
    expect(pageErrors, "pages raised errors").toEqual([]);
  });
});
