/**
 * SHARED BROWSER PRIVACY against a seeded STAGING project, with REAL accounts
 * and real Supabase Auth/RLS/Storage (run with `npm run test:e2e:staging`).
 *
 * Customer A (seeded with a default address, phone, cart line and a saved
 * design) signs in and out; Customer B signs in on the SAME browser. B must
 * see none of A's address, phone, cart, design or recovery copy. A, back
 * again, finds everything on the account.
 *
 * The stub-based equivalents (e2e/shared-browser-privacy.spec.ts and
 * e2e/customer-recovery-isolation.spec.ts) run locally without any project.
 */
import { expect, test, type Page } from "@playwright/test";
import { login, requireSeededAcceptance, seedManifest } from "./helpers";

requireSeededAcceptance([
  ["customerAEmail", seedManifest.customerAEmail],
  ["customerBEmail", seedManifest.customerBEmail],
  ["password", seedManifest.password],
  ["addressAId", seedManifest.addressAId],
  ["customizationAId", seedManifest.customizationAId],
  ["productSlug", seedManifest.productSlug],
]);

const A_ADDRESS = "House 7, Road 3, E2E Lane";
const A_PHONE = "+8801711000001";

async function signOut(page: Page) {
  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expect(page).not.toHaveURL(/\/account/, { timeout: 30_000 });
}

async function openSavedAddresses(page: Page) {
  await page.goto("/account");
  const tab = page.getByRole("button", { name: /^Saved addresses/ }).first();
  await expect(async () => {
    await tab.click();
    await expect(page.getByRole("heading", { name: /^Saved Addresses \(/ })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

test("staging: customer B on A's browser sees none of A's account or design data", async ({ page }) => {
  // ---------------------------------------------------------------- A
  await login(page, seedManifest.customerAEmail, seedManifest.password, "/account");
  await openSavedAddresses(page);
  await expect(page.getByText(A_ADDRESS, { exact: false })).toBeVisible();
  await page.goto("/checkout");
  await expect(page.locator('[autocomplete="street-address"]')).toHaveValue(A_ADDRESS, { timeout: 30_000 });
  // A's saved design opens for A.
  await page.goto(`/products/${seedManifest.productSlug}/personalize?customizationId=${seedManifest.customizationAId}`);
  await expect(page.locator("[data-customizer-restore-overlay]")).toHaveCount(0, { timeout: 60_000 });
  await signOut(page);

  // ---------------------------------------------------------------- B
  await login(page, seedManifest.customerBEmail, seedManifest.password, "/account");
  await openSavedAddresses(page);
  await expect(page.getByText(A_ADDRESS, { exact: false })).toHaveCount(0);
  expect(await page.content()).not.toContain(A_PHONE);
  await page.goto("/checkout");
  await expect(page.locator('[autocomplete="street-address"]')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2_000);
  await expect(page.locator('[autocomplete="street-address"]')).toHaveValue("");
  await expect(page.locator('[autocomplete="tel"]')).toHaveValue("");
  await expect(page.getByText("Customizer E2E seeded cart line")).toHaveCount(0);
  // A's design id in B's address bar opens nothing of A's.
  await page.goto(`/products/${seedManifest.productSlug}/personalize?customizationId=${seedManifest.customizationAId}`);
  await expect(page.locator("[data-customizer-restore-overlay]")).toHaveCount(0, { timeout: 60_000 });
  expect(page.url()).not.toContain(seedManifest.customizationAId);
  // Nothing of A's is kept in this browser's storage under B.
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain(A_PHONE);
  expect(stored).not.toContain(A_ADDRESS);
  await signOut(page);

  // ---------------------------------------------------------------- A again
  await login(page, seedManifest.customerAEmail, seedManifest.password, "/account");
  await openSavedAddresses(page);
  await expect(page.getByText(A_ADDRESS, { exact: false })).toBeVisible();
});
