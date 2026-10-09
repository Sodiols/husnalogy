/**
 * Leaving the Design Studio with unsaved work (stabilization task 07).
 *
 * "Back to Product" used to close the studio at once, and closing the product
 * form or switching dashboard sections dropped the design without a word.
 * Now: nothing unsaved → no prompt; unsaved → Save and exit / Continue
 * editing / Discard changes (or, for a design that cannot reach the server
 * yet, keep the changes and add a name); a failed save never closes the
 * studio; a save in flight is waited for; and the dashboard asks before the
 * product form is left with an unsaved design.
 */
import { expect, test, type Page } from "@playwright/test";
import { addStudioShape } from "./admin-studio-tools";
import { selectedIds } from "./customizer-fixture";

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const header = (page: Page) => studio(page).locator("header");
const exitDialog = (page: Page) => page.getByRole("dialog", { name: "Leave the Design Studio?" });
const openStudioButton = (page: Page) => page.getByRole("button", { name: "Open Design Studio" });
const productSaves = (page: Page) =>
  page.evaluate(() => (window as any).__adminFixture.requests.filter((entry: any) => /^\/api\/admin\/products(\/[^/]+)?$/.test(entry.path)).map((entry: any) => ({ method: entry.method, path: entry.path, body: entry.body })));
const setControls = (page: Page, controls: Record<string, unknown>) =>
  page.evaluate((values) => Object.assign((window as any).__adminFixture, values), controls);

async function openDashboard(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__e2e/admin-dashboard?section=Products");
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
}

async function openStudioFromForm(page: Page) {
  const enable = page.getByRole("switch", { name: /Enable product customizer/ });
  await expect(enable.or(openStudioButton(page)).first()).toBeVisible({ timeout: 30_000 });
  if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
  await openStudioButton(page).click();
  await expect(header(page)).toBeVisible();
}

async function startNewProduct(page: Page, title: string) {
  await openDashboard(page);
  await page.getByRole("button", { name: "Add product" }).first().click();
  if (title) await page.getByPlaceholder("Describe the product the way a customer would search for it").fill(title);
  await openStudioFromForm(page);
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

const back = (page: Page) => header(page).getByRole("button", { name: "Back to Product" }).click();
const layerOnCanvas = (page: Page, id: string) => studio(page).locator(`[data-canvas-surface] [data-layer-id="${id}"]`);

test("nothing unsaved: Back closes at once, no prompt", async ({ page }) => {
  await startNewProduct(page, "Exit Clean Card");
  await addOval(page);
  await header(page).getByRole("button", { name: /Save Draft/ }).click();
  await expect(header(page).locator("[data-save-status]").getByText("Saved", { exact: true })).toBeVisible({ timeout: 15_000 });
  await back(page);
  await expect(exitDialog(page)).toHaveCount(0);
  await expect(openStudioButton(page)).toBeVisible();
});

test("unsaved: Continue editing stays; Save and exit saves, then closes", async ({ page }) => {
  await startNewProduct(page, "Exit Save Card");
  await setControls(page, { productSaveDelayMs: 0 });
  const id = await addOval(page);
  await back(page);
  await expect(exitDialog(page)).toBeVisible();
  await expect(exitDialog(page)).toContainText("not saved to the server yet");
  await exitDialog(page).getByRole("button", { name: "Continue editing" }).click();
  await expect(exitDialog(page)).toHaveCount(0);
  await expect(header(page)).toBeVisible();

  await back(page);
  await exitDialog(page).getByRole("button", { name: "Save and exit" }).click();
  await expect(openStudioButton(page)).toBeVisible({ timeout: 15_000 });
  const saves = await productSaves(page);
  expect(saves.length).toBeGreaterThan(0);
  expect(saves[saves.length - 1].body.customizerTemplate.layers.map((layer: any) => layer.id)).toContain(id);
});

test("a failed save keeps the studio open and says so; Try again then exits", async ({ page }) => {
  await startNewProduct(page, "Exit Fail Card");
  const id = await addOval(page);
  await setControls(page, { failNextProductSave: "Database unavailable." });
  await back(page);
  await exitDialog(page).getByRole("button", { name: "Save and exit" }).click();
  await expect(exitDialog(page)).toContainText("Database unavailable.");
  await expect(exitDialog(page)).toContainText("Nothing was lost");
  await expect(header(page)).toBeVisible();
  await expect(layerOnCanvas(page, id).first()).toBeAttached();
  await exitDialog(page).getByRole("button", { name: "Try again" }).click();
  await expect(openStudioButton(page)).toBeVisible({ timeout: 15_000 });
});

test("a save in flight is waited for before the studio closes", async ({ page }) => {
  await startNewProduct(page, "Exit Inflight Card");
  await setControls(page, { productSaveDelayMs: 4000 });
  const id = await addOval(page);
  // The autosave has started and is still running.
  await expect.poll(async () => (await productSaves(page)).length, { timeout: 15_000 }).toBe(1);
  await back(page);
  await expect(exitDialog(page)).toContainText("still being saved");
  await exitDialog(page).getByRole("button", { name: "Save and exit" }).click();
  await expect(openStudioButton(page)).toBeVisible({ timeout: 20_000 });
  const stored = await page.evaluate(() => (window as any).__adminFixture.store.products.find((product: any) => product.title === "Exit Inflight Card"));
  expect(stored.customizerTemplate.layers.map((layer: any) => layer.id)).toContain(id);
});

test("Discard changes returns to the last saved design and clears the recovery copy", async ({ page }) => {
  await startNewProduct(page, "Exit Discard Card");
  const kept = await addOval(page);
  await header(page).getByRole("button", { name: /Save Draft/ }).click();
  await expect(header(page).locator("[data-save-status]").getByText("Saved", { exact: true })).toBeVisible({ timeout: 15_000 });
  // Hold the next autosave so the change is still unsaved when leaving.
  await setControls(page, { productSaveDelayMs: 30_000 });
  const dropped = await addOval(page);
  await back(page);
  await exitDialog(page).getByRole("button", { name: "Discard changes" }).click();
  await expect(openStudioButton(page)).toBeVisible();
  await setControls(page, { productSaveDelayMs: 0 });
  const keys = await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith("husnalogy_studio_draft")));
  expect(keys).toEqual([]);
  await openStudioButton(page).click();
  await expect(layerOnCanvas(page, kept).first()).toBeAttached();
  await expect(layerOnCanvas(page, dropped)).toHaveCount(0);
});

test("a design that cannot be saved yet: keep the changes, then the dashboard asks before the form is left", async ({ page }) => {
  await startNewProduct(page, "");
  const id = await addOval(page);
  await back(page);
  await expect(exitDialog(page)).toContainText("only on this device");
  await expect(exitDialog(page).getByRole("button", { name: "Save and exit" })).toHaveCount(0);
  await exitDialog(page).getByRole("button", { name: "Keep changes and add a name" }).click();
  await expect(openStudioButton(page)).toBeVisible();
  // The work is still here and protected locally.
  const keys = await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith("husnalogy_studio_draft")));
  expect(keys.length).toBe(1);

  // Closing the form asks; Cancel keeps it.
  await page.getByRole("button", { name: "Close product form" }).click();
  const confirm = page.getByRole("dialog").filter({ hasText: "Leave without saving the design?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(openStudioButton(page)).toBeVisible();
  await openStudioButton(page).click();
  await expect(layerOnCanvas(page, id).first()).toBeAttached();
  await back(page);
  await exitDialog(page).getByRole("button", { name: "Keep changes and add a name" }).click();

  // Switching section asks too; leaving keeps the recovery copy for next time.
  await page.getByRole("navigation").getByRole("button", { name: "Dashboard", exact: true }).first().click();
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Leave without saving" }).click();
  await expect(openStudioButton(page)).toHaveCount(0);
  const after = await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith("husnalogy_studio_draft")));
  expect(after.length).toBe(1);
});

test("a saved design leaves the form without any prompt", async ({ page }) => {
  await startNewProduct(page, "Exit No Prompt Card");
  await addOval(page);
  await header(page).getByRole("button", { name: /Save Draft/ }).click();
  await expect(header(page).locator("[data-save-status]").getByText("Saved", { exact: true })).toBeVisible({ timeout: 15_000 });
  await back(page);
  await page.getByRole("button", { name: "Close product form" }).click();
  await expect(page.getByRole("dialog").filter({ hasText: "Leave without saving the design?" })).toHaveCount(0);
  await expect(openStudioButton(page)).toHaveCount(0);
});
