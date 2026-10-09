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
/** One of the header's save-state chips: Saved, Saving…, Unsaved, Local only, Save failed, Offline. */
const saveChip = (page: Page, label: string) => header(page).locator("[data-save-status]").getByText(label, { exact: true });
const banner = (page: Page) => page.locator("[data-studio-recovery]");
const layerCount = (page: Page) =>
  page.evaluate(() => new Set([...document.querySelectorAll("[data-admin-customizer] [data-layer-id]")].map((node) => node.getAttribute("data-layer-id"))).size);

const requests = (page: Page): Promise<Request[]> =>
  page.evaluate(() => (window as any).__adminFixture.requests.map((entry: any) => ({ method: entry.method, path: entry.path, body: entry.body })));
const productSaves = (log: Request[]) => log.filter((entry) => /^\/api\/admin\/products(\/[^/]+)?$/.test(entry.path));

async function startNewProduct(page: Page, title = "", actor = "") {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/__e2e/admin-dashboard?section=Products${actor ? `&actor=${actor}` : ""}`);
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

test.describe("Design Studio recovery is scoped to the studio account (shared browser)", () => {
  const ADMIN_A = "e2e00000-0000-4000-8000-0000000000a1";
  const DESIGNER_B = "e2e00000-0000-4000-8000-0000000000b2";

  test("Admin A's unsaved new design is never offered to Admin/Designer B; A gets it back", async ({ page }) => {
    // Admin A starts a new design and leaves it unsaved (recovery snapshot written).
    await startNewProduct(page, "", ADMIN_A);
    const baseline = await layerCount(page);
    const shape = await addOval(page);
    await expect(unsavedChip(page)).toBeVisible();
    await page.waitForTimeout(700);
    await expect.poll(() => page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith("husnalogy_studio_draft")).length)).toBe(1);
    const stored = await page.evaluate(() => Object.keys(window.localStorage).find((key) => key.startsWith("husnalogy_studio_draft"))!);
    expect(stored).toContain(`:${ADMIN_A}:new`);

    // A signs out; B signs in on the same browser and opens a new Studio.
    await startNewProduct(page, "", DESIGNER_B);
    await page.waitForTimeout(800);
    await expect(banner(page)).toHaveCount(0);
    expect(await layerCount(page)).toBe(baseline);
    await expect(studio(page).locator(`[data-layer-id="${shape}"]`)).toHaveCount(0);

    // A comes back: their own unsaved design is offered again.
    await startNewProduct(page, "", ADMIN_A);
    await expect(banner(page)).toBeVisible();
    await banner(page).getByRole("button", { name: "Restore unsaved changes" }).click();
    await expect(studio(page).locator(`[data-layer-id="${shape}"]`).first()).toBeAttached();
  });
});

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

  // Superseded rule (stabilization task 03): a NEW product used to wait for a
  // manual Save Draft, depending on browser-only recovery until then. It is now
  // created on the server as a DRAFT by autosave once it has a name.
  test("a named new product is created on the server as a draft by autosave — never published — then updated in place", async ({ page }) => {
    await startNewProduct(page, "Autosaved New Card");
    const first = await addOval(page);
    // Before the first save it exists only here, and says so.
    await expect(saveChip(page, "Local only")).toBeVisible();
    await expect(unsavedChip(page)).toBeVisible();
    await expect.poll(async () => productSaves(await requests(page)).length, { timeout: 15_000 }).toBe(1);
    await expect(saveChip(page, "Saved")).toBeVisible({ timeout: 15_000 });
    await expect(saveChip(page, "Local only")).toHaveCount(0);
    const [created] = productSaves(await requests(page));
    expect(created.method).toBe("POST");
    // A template save never sends a status: the server makes a new product a draft.
    expect(created.body).not.toHaveProperty("status");
    expect(created.body.customizerTemplate.layers.map((layer: any) => layer.id)).toContain(first);
    const stored = await page.evaluate(() => (window as any).__adminFixture.store.products.find((product: any) => product.title === "Autosaved New Card"));
    expect(stored.status).toBe("draft");
    expect(await page.evaluate(() => (window as any).__adminFixture.versions)).toEqual({});

    // The next pause updates the SAME product.
    const second = await addOval(page);
    await expect.poll(async () => productSaves(await requests(page)).length, { timeout: 15_000 }).toBe(2);
    const [, updated] = productSaves(await requests(page));
    expect(`${updated.method} ${updated.path}`).toBe(`PUT /api/admin/products/${stored.id}`);
    expect(updated.body.customizerTemplate.layers.map((layer: any) => layer.id)).toContain(second);
    await expect(saveChip(page, "Saved")).toBeVisible({ timeout: 15_000 });
    // Saved on the server: nothing is left for local recovery.
    const keys = await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith("husnalogy_studio_draft")));
    expect(keys).toEqual([]);

    // Another browser session (a fresh tab with only the server's data) opens the same design.
    const durable = await page.evaluate(() => window.sessionStorage.getItem("__adminFixtureDurable"));
    const other = await page.context().newPage();
    await other.goto("/__e2e/admin-dashboard?section=Products");
    await other.evaluate((value) => window.sessionStorage.setItem("__adminFixtureDurable", value || ""), durable);
    await other.reload();
    await other.getByRole("button", { name: "Edit Autosaved New Card" }).first().click();
    await other.getByRole("button", { name: "Open Design Studio" }).click();
    await expect(other.locator(`[data-admin-customizer] [data-layer-id="${first}"]`).first()).toBeAttached();
    await expect(other.locator(`[data-admin-customizer] [data-layer-id="${second}"]`).first()).toBeAttached();
    await other.close();
  });

  test("a new product without a name is never sent: it stays Local only and says what it needs", async ({ page }) => {
    await startNewProduct(page, "");
    await addOval(page);
    await page.waitForTimeout(6000);
    expect(productSaves(await requests(page))).toEqual([]);
    await expect(unsavedChip(page)).toBeVisible();
    await expect(saveChip(page, "Local only")).toBeVisible();
    await expect(saveChip(page, "Saved")).toHaveCount(0);
    await expect(page.locator("[data-save-detail]")).toContainText("Give the product a name");
    // The work is still protected locally.
    const keys = await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith("husnalogy_studio_draft")));
    expect(keys.length).toBe(1);
  });

  test("a failed autosave says Save failed, keeps the work unsaved, and retries until the server confirms", async ({ page }) => {
    await startNewProduct(page, "Retry Card");
    await addOval(page);
    await expect(saveChip(page, "Saved")).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => ((window as any).__adminFixture.failNextProductSave = "Database unavailable."));
    const edited = await addOval(page);
    await expect(saveChip(page, "Save failed")).toBeVisible({ timeout: 15_000 });
    await expect(saveChip(page, "Saved")).toHaveCount(0);
    await expect(unsavedChip(page)).toBeVisible();
    await expect(page.locator("[data-save-detail]")).toContainText("Database unavailable.");
    // No edit needed: the retry (5 s) saves it.
    await expect(saveChip(page, "Saved")).toBeVisible({ timeout: 20_000 });
    await expect(saveChip(page, "Save failed")).toHaveCount(0);
    const [last] = productSaves(await requests(page)).slice(-1);
    expect(last.body.customizerTemplate.layers.map((layer: any) => layer.id)).toContain(edited);
  });

  test("offline: the header says so and nothing is attempted; reconnecting saves at once", async ({ page, context }) => {
    await startNewProduct(page, "Offline Card");
    await addOval(page);
    await expect(saveChip(page, "Saved")).toBeVisible({ timeout: 15_000 });
    const before = productSaves(await requests(page)).length;
    await context.setOffline(true);
    const edited = await addOval(page);
    await expect(saveChip(page, "Offline")).toBeVisible();
    await page.waitForTimeout(6000);
    expect(productSaves(await requests(page)).length).toBe(before);
    await expect(page.locator("[data-save-detail]")).toContainText("You're offline");
    await context.setOffline(false);
    await expect(saveChip(page, "Saved")).toBeVisible({ timeout: 15_000 });
    const [last] = productSaves(await requests(page)).slice(-1);
    expect(last.body.customizerTemplate.layers.map((layer: any) => layer.id)).toContain(edited);
  });

  test("a new product's first autosave and a Save Draft right behind it create ONE product", async ({ page }) => {
    await startNewProduct(page, "Race Card");
    await page.evaluate(() => ((window as any).__adminFixture.productSaveDelayMs = 6000));
    await addOval(page);
    // The autosave POST has started (logged before the delayed answer)…
    await expect.poll(async () => productSaves(await requests(page)).length, { timeout: 15_000 }).toBe(1);
    await expect(saveChip(page, "Saving…")).toBeVisible();
    await addOval(page);
    // …while it is in flight Save Draft cannot start a second creation (it is
    // disabled), and once the creation lands it updates that same product.
    await expect(saveChip(page, "Local only")).toBeVisible();
    await expect(header(page).getByRole("button", { name: /^(Save Draft|Saving…)$/ })).toBeDisabled();
    await page.evaluate(() => ((window as any).__adminFixture.productSaveDelayMs = 0));
    await header(page).getByRole("button", { name: /^(Save Draft|Saving…)$/ }).click();
    await expect(saveChip(page, "Saved")).toBeVisible({ timeout: 20_000 });
    const saves = productSaves(await requests(page)).map((entry) => `${entry.method} ${entry.path}`);
    expect(saves.filter((entry) => entry.startsWith("POST"))).toEqual(["POST /api/admin/products"]);
    expect(saves.slice(1).every((entry) => entry === "PUT /api/admin/products/prod-new-1")).toBe(true);
    const products = await page.evaluate(() => (window as any).__adminFixture.store.products.filter((product: any) => product.title === "Race Card").length);
    expect(products).toBe(1);
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
