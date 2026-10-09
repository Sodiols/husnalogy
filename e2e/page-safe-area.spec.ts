/**
 * Page-specific safe areas (stabilization task 02).
 *
 * Front inherits the template's safe area; Back has its own, wider margin.
 * The same long sentence must wrap at each page's own safe width — in the
 * studio canvas at every zoom, after a Settings change scoped to one page,
 * after save and reload, and in the customer editor (Customer Preview) — and
 * never at the other page's width. Measured from what is drawn.
 */
import { expect, test, type Page } from "@playwright/test";
import { addStudioText, openSidePanel } from "./admin-studio-tools";
import { selectedIds } from "./customizer-fixture";

const TITLE = "Minimal Thank You Card";
const FRONT_SAFE = 75;
const BACK_SAFE = 300;
const TEMPLATE = {
  enabled: true,
  cardWidthIn: 5,
  cardHeightIn: 7,
  dpi: 300,
  canvasWidthPx: 1500,
  canvasHeightPx: 2100,
  safeArea: { top: FRONT_SAFE, right: FRONT_SAFE, bottom: FRONT_SAFE, left: FRONT_SAFE },
  pages: [
    { id: "front", label: "Front", enabled: true },
    { id: "back", label: "Back", enabled: true, safeArea: { top: BACK_SAFE, right: BACK_SAFE, bottom: BACK_SAFE, left: BACK_SAFE } },
  ],
  defaultPage: "front",
  fields: [],
  guides: [],
  layers: [],
};
const LONG = "wedding invitations for our family and friends who travel from near and far";

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const header = (page: Page) => studio(page).locator("header");

async function openStudio(page: Page, seed = true) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__e2e/admin-dashboard?section=Products");
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  if (seed) {
    await page.evaluate(({ name, value }) => {
      const products = (window as any).__adminFixture.store.products.map((entry: any) => (entry.title === name ? { ...entry, customizerTemplate: value } : entry));
      window.sessionStorage.setItem("__adminFixtureDurable", JSON.stringify({ products, versions: {} }));
    }, { name: TITLE, value: TEMPLATE });
    await page.reload();
    await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  }
  await page.getByRole("button", { name: `Edit ${TITLE}` }).first().click();
  const enable = page.getByRole("switch", { name: /Enable product customizer/ });
  await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
  if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
  await page.getByRole("button", { name: "Open Design Studio" }).click();
  await expect(header(page)).toBeVisible();
}

/** The lines a text object draws and its drawn box (document units), from the largest rendering of it. */
const drawn = (page: Page, id: string) =>
  page.evaluate((layerId) => {
    const all = Array.from(document.querySelectorAll(`[data-layer-id="${layerId}"]`)) as SVGGElement[];
    const width = (el: Element) => (el as SVGGElement).ownerSVGElement?.getBoundingClientRect().width || 0;
    const group = all.reduce<SVGGElement | null>((best, el) => (!best || width(el) > width(best) ? el : best), null);
    const rect = group?.querySelector("clipPath rect");
    const box = rect ? ["x", "y", "width", "height"].map((name) => Number(rect.getAttribute(name))) : [0, 0, 0, 0];
    return { lines: Array.from(group?.querySelectorAll("tspan") || []).map((tspan) => tspan.textContent || ""), left: box[0], width: box[2] };
  }, id);

async function setZoom(page: Page, percent: number) {
  const field = studio(page).getByRole("textbox", { name: "Canvas zoom" }).or(studio(page).getByRole("spinbutton", { name: "Canvas zoom" })).first();
  await field.fill(String(percent));
  await field.press("Enter");
  await page.waitForTimeout(400);
}

async function goToPage(page: Page, label: string) {
  const pages = await openSidePanel(page, "Pages");
  await pages.getByRole("button", { name: label, exact: true }).click();
  await expect(pages.locator("[data-page-card][data-active] [data-page-label]")).toHaveText(label);
  await pages.getByRole("button", { name: "Close panel" }).click();
}

async function newText(page: Page, typed: string) {
  await addStudioText(page);
  await expect(page.locator('[aria-label="Edit text on canvas"]')).toBeVisible();
  await page.keyboard.type(typed, { delay: 5 });
  await page.keyboard.press("Control+Enter");
  let id = "";
  await expect.poll(async () => (id = (await selectedIds(page))[0] || "")).not.toBe("");
  await page.evaluate(() => document.fonts.ready);
  return id;
}

async function savedTemplate(page: Page) {
  const before = await page.evaluate(() => (window as any).__adminFixture.requests.length);
  await header(page).getByRole("button", { name: /Save Draft/ }).click();
  await expect.poll(() => page.evaluate((count) => (window as any).__adminFixture.requests.length > count, before)).toBe(true);
  await expect(header(page).getByText("Unsaved", { exact: true })).toHaveCount(0, { timeout: 15_000 });
  return page.evaluate(() => {
    const saves = (window as any).__adminFixture.requests.filter((entry: any) => /^\/api\/admin\/products(\/[^/]+)?$/.test(entry.path));
    return saves[saves.length - 1].body.customizerTemplate;
  });
}

test("Front and Back wrap the same sentence at their own safe areas — every zoom, after save/reload, and for the customer", async ({ page }) => {
  await openStudio(page);
  const frontId = await newText(page, LONG);
  await expect.poll(async () => (await drawn(page, frontId)).lines.length).toBeGreaterThan(1);
  const front = await drawn(page, frontId);
  expect(front.width).toBe(1500 - 2 * FRONT_SAFE);
  expect(front.left).toBeGreaterThanOrEqual(FRONT_SAFE - 0.5);

  await goToPage(page, "Back");
  const backId = await newText(page, LONG);
  await expect.poll(async () => (await drawn(page, backId)).lines.length).toBeGreaterThan(front.lines.length);
  const back = await drawn(page, backId);
  // Back's own (narrower) safe width, not the template's.
  expect(back.width).toBe(1500 - 2 * BACK_SAFE);
  expect(back.left).toBeGreaterThanOrEqual(BACK_SAFE - 0.5);
  expect(back.left + back.width).toBeLessThanOrEqual(1500 - BACK_SAFE + 0.5);

  // Zoom never changes the logical wrap.
  for (const zoom of [50, 200, 100]) {
    await setZoom(page, zoom);
    expect((await drawn(page, backId)).lines).toEqual(back.lines);
  }

  // Saved and reloaded: each page keeps its safe area and its lines.
  const saved = await savedTemplate(page);
  expect(saved.pages.find((p: any) => p.id === "back").safeArea).toEqual({ top: BACK_SAFE, right: BACK_SAFE, bottom: BACK_SAFE, left: BACK_SAFE });
  await page.reload();
  await openStudio(page, false);
  await expect.poll(async () => (await drawn(page, frontId)).lines).toEqual(front.lines);
  await goToPage(page, "Back");
  await expect.poll(async () => (await drawn(page, backId)).lines).toEqual(back.lines);

  // The customer editor draws the same page-specific wrap.
  await header(page).getByRole("button", { name: "Customer Preview" }).click();
  await expect.poll(async () => (await drawn(page, frontId)).lines).toEqual(front.lines);
  await page.getByRole("button", { name: "Edit Back" }).first().click();
  await expect.poll(async () => (await drawn(page, backId)).lines).toEqual(back.lines);
});

test("Settings: a safe area scoped to one page changes only that page's wrap; it can inherit again", async ({ page }) => {
  await openStudio(page, true);
  const frontId = await newText(page, LONG);
  const before = await drawn(page, frontId);
  expect(before.width).toBe(1500 - 2 * FRONT_SAFE);

  await header(page).getByRole("button", { name: "Settings" }).click();
  const settings = studio(page).locator("[data-safe-area-settings]");
  await expect(settings).toContainText("Back has its own safe area.");
  await settings.getByRole("combobox", { name: "Safe area applies to" }).selectOption("front");
  for (const side of ["left", "right"]) {
    const field = settings.getByRole("textbox", { name: `Front safe area ${side}` }).or(settings.getByRole("spinbutton", { name: `Front safe area ${side}` })).first();
    await field.fill("250");
    await field.press("Enter");
  }
  let saved = await savedTemplate(page);
  expect(saved.pages.find((p: any) => p.id === "front").safeArea).toMatchObject({ left: 250, right: 250 });
  // The template-level area (inherited by nothing now) is unchanged.
  expect(saved.safeArea).toMatchObject({ left: FRONT_SAFE, right: FRONT_SAFE });

  await header(page).getByRole("button", { name: "Design" }).click();
  await expect.poll(async () => (await drawn(page, frontId)).width).toBe(1500 - 500);

  // Back to inheriting: the original wrap returns; Undo brings the override back.
  await header(page).getByRole("button", { name: "Settings" }).click();
  await settings.getByRole("combobox", { name: "Safe area applies to" }).selectOption("front");
  await settings.getByRole("button", { name: "Use the all-pages safe area for Front" }).click();
  saved = await savedTemplate(page);
  expect(saved.pages.find((p: any) => p.id === "front").safeArea).toBeUndefined();
  await header(page).getByRole("button", { name: "Design" }).click();
  await expect.poll(async () => (await drawn(page, frontId)).width).toBe(1500 - 2 * FRONT_SAFE);
  await page.locator("[data-canvas-surface]").first().click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawn(page, frontId)).width).toBe(1500 - 500);
});
