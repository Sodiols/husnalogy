/**
 * Design Studio crash-safe recovery and autosave (Customizer Point 1, admin).
 *
 * Runs the real dashboard, product form and studio on /__e2e/admin-dashboard,
 * whose in-browser API mock records every save. A reload of that page also
 * resets the mock, exactly like losing the tab: whatever the studio had not
 * saved survives only in the browser's recovery copy.
 */
import { expect, test, type Page } from "@playwright/test";
import { addStudioShape } from "./admin-studio-tools";
import { selectedIds } from "./customizer-fixture";

type Request = { method: string; path: string; body: any };

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const header = (page: Page) => studio(page).locator("header");
const unsavedChip = (page: Page) => header(page).getByText("Unsaved", { exact: true });
const banner = (page: Page) => page.locator("[data-studio-recovery]");
const layerCount = (page: Page) =>
  page.evaluate(() => new Set([...document.querySelectorAll("[data-admin-customizer] [data-layer-id]")].map((node) => node.getAttribute("data-layer-id"))).size);

const requests = (page: Page): Promise<Request[]> =>
  page.evaluate(() => (window as any).__adminFixture.requests.map((entry: any) => ({ method: entry.method, path: entry.path, body: entry.body })));
const productSaves = (log: Request[]) => log.filter((entry) => /^\/api\/admin\/products(\/[^/]+)?$/.test(entry.path));

async function startNewProduct(page: Page, title = "") {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__e2e/admin-dashboard?section=Products");
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Add product" }).first().click();
  if (title) await page.getByPlaceholder("Describe the product the way a customer would search for it").fill(title);
  const enable = page.getByRole("switch", { name: /Enable product customizer/ });
  // The form renders after the click that opened it: wait for the switch (or a
  // studio that is already enabled) instead of checking visibility once.
  await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
  if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
  await page.getByRole("button", { name: "Open Design Studio" }).click();
  await expect(header(page)).toBeVisible();
}

async function addOval(page: Page) {
  const before = await selectedIds(page);
  await addStudioShape(page, "oval");
  let id = "";
  await expect.poll(async () => {
    const [current] = await selectedIds(page);
    id = current && !before.includes(current) ? current : "";
    return id;
  }).not.toBe("");
  return id;
}

test.describe("Design Studio recovery", () => {
  test("a refresh before saving keeps the work: reopening offers it back, Restore brings it back as one undo step", async ({ page }) => {
    await startNewProduct(page);
    const baseline = await layerCount(page);
    const shape = await addOval(page);
    await expect(unsavedChip(page)).toBeVisible();
    // The page is lost before anything was saved.
    await page.waitForTimeout(700);
    await page.reload();

    await startNewProduct(page);
    await expect(banner(page)).toBeVisible();
    expect(await layerCount(page)).toBe(baseline);
    await banner(page).getByRole("button", { name: "Restore unsaved changes" }).click();
    await expect(banner(page)).toHaveCount(0);
    await expect(studio(page).locator(`[data-layer-id="${shape}"]`).first()).toBeAttached();
    await expect(unsavedChip(page)).toBeVisible();

    await page.keyboard.press("Control+z");
    await expect(studio(page).locator(`[data-layer-id="${shape}"]`)).toHaveCount(0);
    await page.keyboard.press("Control+y");
    await expect(studio(page).locator(`[data-layer-id="${shape}"]`).first()).toBeAttached();
  });

  test("Keep saved design discards the copy for good", async ({ page }) => {
    await startNewProduct(page);
    await addOval(page);
    await page.waitForTimeout(700);
    await page.reload();
    await startNewProduct(page);
    await banner(page).getByRole("button", { name: "Keep saved design" }).click();
    await expect(banner(page)).toHaveCount(0);
    await page.reload();
    await startNewProduct(page);
    await page.waitForTimeout(500);
    await expect(banner(page)).toHaveCount(0);
  });

  test("a saved design leaves nothing to recover", async ({ page }) => {
    await startNewProduct(page, "Recovery Saved Card");
    await addOval(page);
    await header(page).getByRole("button", { name: /Save Draft/ }).click();
    await expect(unsavedChip(page)).toHaveCount(0, { timeout: 15_000 });
    const keys = await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith("husnalogy_studio_draft")));
    expect(keys).toEqual([]);
  });

  test("an existing product autosaves once editing pauses — no button press needed", async ({ page }) => {
    await startNewProduct(page, "Autosave Card");
    await addOval(page);
    await header(page).getByRole("button", { name: /Save Draft/ }).click();
    await expect(unsavedChip(page)).toHaveCount(0, { timeout: 15_000 });
    const savesBefore = productSaves(await requests(page)).length;

    const second = await addOval(page);
    await expect(unsavedChip(page)).toBeVisible();
    await expect.poll(async () => productSaves(await requests(page)).length, { timeout: 15_000 }).toBe(savesBefore + 1);
    const [last] = productSaves(await requests(page)).slice(-1);
    expect(last.method).toBe("PUT");
    expect(last.body.customizerTemplate.layers.map((layer: any) => layer.id)).toContain(second);
    await expect(unsavedChip(page)).toHaveCount(0);
  });

  test("a new product is never created by autosave", async ({ page }) => {
    await startNewProduct(page, "Not Yet Saved Card");
    await addOval(page);
    await page.waitForTimeout(6000);
    expect(productSaves(await requests(page))).toEqual([]);
    await expect(unsavedChip(page)).toBeVisible();
  });

  test("leaving with unsaved changes asks first", async ({ page }) => {
    await startNewProduct(page);
    await addOval(page);
    const dialog = new Promise<string>((resolve) => page.once("dialog", (prompt) => {
      resolve(prompt.type());
      void prompt.dismiss();
    }));
    await page.close({ runBeforeUnload: true });
    expect(await dialog).toBe("beforeunload");
  });
});
