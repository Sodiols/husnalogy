/**
 * Design Studio save / publish sequencing (browser).
 *
 * Runs the REAL admin dashboard, product form and Design Studio on
 * /__e2e/admin-dashboard, whose in-browser API mock answers product saves and
 * template publication statefully and lets a spec inject failures and latency
 * through `window.__adminFixture`. No administrator login and no database.
 *
 * Proves the contract in lib/customizer/studio-save.ts end to end:
 *   - publication is never requested after a failed validation or save;
 *   - a new product is published by the id its creation returned;
 *   - a saved-but-unpublished outcome is reported as exactly that;
 *   - the studio stays mounted through the whole sequence;
 *   - edits made while a save is running stay unsaved;
 *   - a template save never changes the product's hidden/active status;
 *   - double clicks send one request;
 *   - the saved design is what reopens.
 */

import { expect, test, type Page } from "@playwright/test";
import { addStudioFrame } from "./admin-studio-tools";

type Request = { method: string; path: string; body: any };

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const header = (page: Page) => studio(page).locator("header");
const unsavedChip = (page: Page) => header(page).getByText("Unsaved", { exact: true });
const statusNotice = (page: Page) => studio(page).getByRole("status").first();

async function openDashboard(page: Page) {
  await page.goto("/__e2e/admin-dashboard?section=Products");
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
}

async function requests(page: Page): Promise<Request[]> {
  return page.evaluate(() => (window as any).__adminFixture.requests.map((entry: any) => ({ method: entry.method, path: entry.path, body: entry.body })));
}

async function setControls(page: Page, patch: Record<string, unknown>) {
  await page.evaluate((values) => Object.assign((window as any).__adminFixture, values), patch);
}

async function openStudioFromForm(page: Page) {
  const enable = page.getByRole("switch", { name: /Enable product customizer/ });
  // The form renders after the click that opened it: wait for the switch (or a
  // studio that is already enabled) instead of checking visibility once.
  await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
  if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
  await page.getByRole("button", { name: "Open Design Studio" }).click();
  await expect(header(page)).toBeVisible();
}

async function addFrame(page: Page) {
  await addStudioFrame(page);
}

async function startNewProduct(page: Page, title: string) {
  await openDashboard(page);
  await page.getByRole("button", { name: "Add product" }).first().click();
  if (title) await page.getByPlaceholder("Describe the product the way a customer would search for it").fill(title);
  await openStudioFromForm(page);
}

async function publish(page: Page) {
  await header(page).getByRole("button", { name: "Publish Changes" }).click();
  await studio(page).getByRole("button", { name: "Publish", exact: true }).click();
}

const productSaves = (log: Request[]) => log.filter((entry) => /^\/api\/admin\/products(\/[^/]+)?$/.test(entry.path));
const publications = (log: Request[]) => log.filter((entry) => entry.path.endsWith("/publish"));

test.describe("Design Studio save and publish", () => {
  test("a new product is created, then published by the id the creation returned", async ({ page }) => {
    await startNewProduct(page, "Studio Created Card");
    await addFrame(page);
    await expect(unsavedChip(page)).toBeVisible();

    await publish(page);
    await expect(statusNotice(page)).toContainText("Published. New customers now see this design.", { timeout: 15_000 });
    // The studio stayed mounted through the whole sequence.
    await expect(header(page)).toBeVisible();
    await expect(unsavedChip(page)).toHaveCount(0);

    const log = await requests(page);
    const saves = productSaves(log);
    expect(saves.map((entry) => `${entry.method} ${entry.path}`)).toEqual(["POST /api/admin/products"]);
    // A template save never sends a status: the server keeps what it has.
    expect(saves[0].body).not.toHaveProperty("status");
    const published = publications(log);
    expect(published.map((entry) => entry.path)).toEqual(["/api/admin/customizer/templates/prod-new-1/publish"]);
    expect(published[0].body.expectedDraftUpdatedAt).toMatch(/^2026-10-04T08:00:00\.\d{6}\+00:00$/);

    // A second save updates the SAME product instead of creating another.
    await addFrame(page);
    await header(page).getByRole("button", { name: "Save Draft" }).click();
    await expect(unsavedChip(page)).toHaveCount(0, { timeout: 15_000 });
    expect(productSaves(await requests(page)).map((entry) => `${entry.method} ${entry.path}`)).toEqual([
      "POST /api/admin/products",
      "PUT /api/admin/products/prod-new-1",
    ]);
  });

  test("failed validation never publishes and keeps the design unsaved", async ({ page }) => {
    await startNewProduct(page, "");
    await addFrame(page);
    await publish(page);

    await expect(statusNotice(page)).toContainText("Not published — the draft was not saved: Enter a product name.");
    await expect(studio(page).getByRole("alert")).toContainText("Enter a product name.");
    await expect(unsavedChip(page)).toBeVisible();
    const log = await requests(page);
    expect(productSaves(log)).toEqual([]);
    expect(publications(log)).toEqual([]);
  });

  test("a failed save never publishes and keeps the design unsaved", async ({ page }) => {
    await startNewProduct(page, "Failing Save Card");
    await addFrame(page);
    await setControls(page, { failNextProductSave: "Database unavailable." });
    await publish(page);

    await expect(statusNotice(page)).toContainText("Not published — the draft was not saved: Database unavailable.");
    await expect(unsavedChip(page)).toBeVisible();
    await expect(header(page)).toBeVisible();
    const log = await requests(page);
    expect(productSaves(log)).toHaveLength(1);
    expect(publications(log)).toEqual([]);
  });

  test("a failed publication reports a saved but unpublished draft", async ({ page }) => {
    await startNewProduct(page, "Failing Publish Card");
    await addFrame(page);
    await setControls(page, { failNextPublish: "Snapshot storage offline." });
    await publish(page);

    await expect(statusNotice(page)).toContainText("Draft saved, but it was not published: Snapshot storage offline.");
    // The draft itself WAS saved, so it is not unsaved — but nothing published.
    await expect(unsavedChip(page)).toHaveCount(0);
    const versions = await page.evaluate(() => (window as any).__adminFixture.versions);
    expect(versions["prod-new-1"] || []).toEqual([]);
  });

  test("edits made while a save is running stay unsaved, and double clicks send one request", async ({ page }) => {
    await startNewProduct(page, "Slow Save Card");
    await addFrame(page);
    await setControls(page, { productSaveDelayMs: 2_000 });

    // The button reads "Saving…" while busy, so match both labels.
    const saveButton = header(page).getByRole("button", { name: /^(Save Draft|Saving…)$/ });
    // Two clicks before React re-renders: only the synchronous guard can stop
    // the second one.
    await saveButton.dblclick();
    await expect(saveButton).toHaveText("Saving…");
    await expect(saveButton).toBeDisabled();
    // Edit while the request is in flight.
    await addFrame(page);

    await expect(saveButton).toHaveText("Save Draft", { timeout: 15_000 });
    expect(productSaves(await requests(page))).toHaveLength(1);
    // Only the revision that was sent is clean; the later edit is not.
    await expect(unsavedChip(page)).toBeVisible();
    // The studio did not close and the in-flight edit is still on the canvas.
    const saved = productSaves(await requests(page))[0].body.customizerTemplate.layers.length;
    await setControls(page, { productSaveDelayMs: 0 });
    await saveButton.click();
    await expect(unsavedChip(page)).toHaveCount(0, { timeout: 15_000 });
    const resaved = productSaves(await requests(page))[1].body.customizerTemplate.layers.length;
    expect(resaved).toBe(saved + 1);
  });

  test("a template save keeps a hidden product hidden, and the saved design reopens", async ({ page }) => {
    await openDashboard(page);
    const title = "Birthday Celebration Card with an Unusually Long Product Title";
    await page.getByRole("button", { name: `Edit ${title}` }).first().click();
    await openStudioFromForm(page);
    await addFrame(page);
    await addFrame(page);
    await header(page).getByRole("button", { name: "Save Draft" }).click();
    await expect(unsavedChip(page)).toHaveCount(0, { timeout: 15_000 });

    const [save] = productSaves(await requests(page));
    expect(save.method).toBe("PUT");
    expect(save.body).not.toHaveProperty("status");
    const status = await page.evaluate((name) => (window as any).__adminFixture.store.products.find((product: any) => product.title === name)?.status, title);
    expect(status).toBe("hidden");

    // Leave the studio and the form, then reopen the product from the list.
    await header(page).getByRole("button", { name: /back/i }).first().click();
    await expect(studio(page)).toHaveCount(0);
    await page.getByRole("button", { name: `Edit ${title}` }).first().click();
    await expect(page.getByText(/2 layers · 2 customer fields/)).toBeVisible({ timeout: 15_000 });
  });
});
