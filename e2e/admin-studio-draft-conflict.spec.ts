/**
 * Two editors, one product draft (browser).
 *
 * Runs the real dashboard, product form and Design Studio on
 * /__e2e/admin-dashboard. `__adminFixture.externalDraftSave(id)` plays the
 * other tab or person: it saves a new draft revision on the mock server that
 * the open studio has not seen. The mock refuses a save carrying an older
 * revision exactly like PUT /api/admin/products/[id] (409 conflict).
 *
 * Proves:
 *   - a stale save is refused and said so; the designer's work stays local;
 *   - a conflict is never retried automatically, and autosave stops;
 *   - "Keep my version" replaces the other version only on that click;
 *   - after it, ordinary saves are pinned to the new revision again;
 *   - "Reload to see theirs" reloads without a leave-page prompt and offers
 *     the designer's design back from the recovery copy.
 */
import { expect, test, type Page } from "@playwright/test";
import { addStudioShape } from "./admin-studio-tools";

type Request = { method: string; path: string; body: any };

const TITLE = "Shared Draft Card";
const studio = (page: Page) => page.locator("[data-admin-customizer]");
const header = (page: Page) => studio(page).locator("header");
const unsavedChip = (page: Page) => header(page).getByText("Unsaved", { exact: true });
const saveDetail = (page: Page) => studio(page).locator("[data-save-detail]");
const banner = (page: Page) => page.locator("[data-studio-recovery]");

const requests = (page: Page): Promise<Request[]> =>
  page.evaluate(() => (window as any).__adminFixture.requests.map((entry: any) => ({ method: entry.method, path: entry.path, body: entry.body })));
const productSaves = async (page: Page) => (await requests(page)).filter((entry) => /^\/api\/admin\/products(\/[^/]+)?$/.test(entry.path));
const storedProduct = (page: Page) =>
  page.evaluate((title) => (window as any).__adminFixture.store.products.find((product: any) => product.title === title), TITLE);

async function openStudio(page: Page) {
  const enable = page.getByRole("switch", { name: /Enable product customizer/ });
  await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
  if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
  await page.getByRole("button", { name: "Open Design Studio" }).click();
  await expect(header(page)).toBeVisible();
}

/** A saved product whose draft another editor then changes. Leaves one unsaved edit in the studio. */
async function reachConflict(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__e2e/admin-dashboard?section=Products");
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Add product" }).first().click();
  await page.getByPlaceholder("Describe the product the way a customer would search for it").fill(TITLE);
  await openStudio(page);

  await addStudioShape(page, "oval");
  await header(page).getByRole("button", { name: "Save Draft" }).click();
  await expect(unsavedChip(page)).toHaveCount(0, { timeout: 15_000 });
  const product = await storedProduct(page);
  expect(product?.customizerTemplate?.updatedAt).toBeTruthy();

  await page.evaluate((id) => (window as any).__adminFixture.externalDraftSave(id), product.id);

  await addStudioShape(page, "oval");
  await header(page).getByRole("button", { name: "Save Draft" }).click();
  await expect(saveDetail(page)).toContainText("changed in another tab or by another person", { timeout: 15_000 });
  await expect(unsavedChip(page)).toBeVisible();
  return product.id as string;
}

test.describe("Design Studio: a draft changed elsewhere is never silently overwritten", () => {
  test("the stale save is refused, not retried, and replaced only on Keep my version", async ({ page }) => {
    const id = await reachConflict(page);
    const [, refused] = await productSaves(page);
    expect(refused.method).toBe("PUT");
    expect(refused.body.expectedTemplateUpdatedAt).toBeTruthy();
    const theirs = (await storedProduct(page)).customizerTemplate.updatedAt;
    expect(refused.body.expectedTemplateUpdatedAt).not.toBe(theirs);

    // No automatic retry (first retry would be at 5 s) and no autosave (4 s
    // after an edit) while the designer has not decided.
    const sentBefore = (await productSaves(page)).length;
    await addStudioShape(page, "oval");
    await page.waitForTimeout(7_000);
    expect((await productSaves(page)).length).toBe(sentBefore);
    expect((await storedProduct(page)).customizerTemplate.updatedAt).toBe(theirs);

    await saveDetail(page).getByRole("button", { name: "Keep my version" }).click();
    await expect(unsavedChip(page)).toHaveCount(0, { timeout: 15_000 });
    await expect(saveDetail(page)).toHaveCount(0);
    const overwrite = (await productSaves(page)).at(-1)!;
    expect(overwrite.path).toBe(`/api/admin/products/${id}`);
    expect(overwrite.body).not.toHaveProperty("expectedTemplateUpdatedAt");
    const mine = (await storedProduct(page)).customizerTemplate;
    expect(mine.updatedAt).not.toBe(theirs);
    expect(mine.layers.length).toBeGreaterThanOrEqual(3);

    // Back to normal: the next save is pinned to the revision just saved.
    await addStudioShape(page, "oval");
    await header(page).getByRole("button", { name: "Save Draft" }).click();
    await expect(unsavedChip(page)).toHaveCount(0, { timeout: 15_000 });
    const next = (await productSaves(page)).at(-1)!;
    expect(next.body.expectedTemplateUpdatedAt).toBe(mine.updatedAt);
  });

  test("Reload to see theirs reloads without a prompt and offers the designer's design back", async ({ page }) => {
    await reachConflict(page);
    let prompted = false;
    page.on("dialog", async (dialog) => {
      prompted = true;
      await dialog.accept();
    });

    await Promise.all([
      page.waitForEvent("load"),
      saveDetail(page).getByRole("button", { name: "Reload to see theirs" }).click(),
    ]);
    expect(prompted).toBe(false);
    const kept = await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith("husnalogy_studio_draft")));
    expect(kept.length).toBe(1);

    await expect(page.getByRole("button", { name: `Edit ${TITLE}` }).first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: `Edit ${TITLE}` }).first().click();
    await openStudio(page);
    await expect(banner(page)).toBeVisible();
    await expect(banner(page).getByRole("button", { name: "Restore unsaved changes" })).toBeVisible();
    await expect(banner(page).getByRole("button", { name: "Keep saved design" })).toBeVisible();
  });
});
