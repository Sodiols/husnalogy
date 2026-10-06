/**
 * Right-click object menu and toolbar cleanup (Customizer Point 9).
 *
 * Every structural command (copy, paste, duplicate, arrange, group, lock,
 * delete) is reached through ONE menu — opened by a right click or by the
 * "More actions" button (the touch fallback) — and runs the same command the
 * keyboard shortcut does.
 */
import { expect, test, type Page } from "@playwright/test";
import { bodyPoint, canvasLayer, docToScreen, hitAt, openFixture, rectAttrs, selectLayer, selectedIds, switchToAdvancedCustomize } from "./customizer-fixture";

const menu = (page: Page) => page.getByRole("menu", { name: "Object actions" });
const items = async (page: Page) => (await menu(page).getByRole("menuitem").allTextContents()).map((text) => text.replace(/\s+/g, " ").trim());
const has = async (page: Page, label: string) => (await items(page)).some((text) => text.startsWith(label));

async function rightClick(page: Page, layerId: string) {
  const point = await bodyPoint(page, layerId);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await expect(menu(page)).toBeVisible();
}

async function choose(page: Page, label: string) {
  await menu(page).getByRole("menuitem", { name: label, exact: true }).click();
  await expect(menu(page)).toHaveCount(0);
}

/** Paint order of the main canvas's layers, bottom first. */
const paintOrder = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('[data-customizer-canvas="main"] [data-layer-id]')].map((node) => node.getAttribute("data-layer-id")));

test.use({ viewport: { width: 1440, height: 900 } });

test.describe("object menu", () => {
  test.beforeEach(async ({ page }) => {
    await openFixture(page, "?snap=0");
  });

  test("text: edit, clipboard, arrange and delete; Bring to front really reorders, Delete really deletes", async ({ page }) => {
    await rightClick(page, "fx_free_text");
    for (const label of ["Edit text", "Copy", "Duplicate", "Bring to front", "Bring forward", "Send backward", "Send to back", "Delete"]) {
      expect(await has(page, label), label).toBe(true);
    }
    await choose(page, "Send to back");
    const order = await paintOrder(page);
    expect(order.indexOf("fx_free_text")).toBeLessThan(order.indexOf("fx_title"));
    await rightClick(page, "fx_free_text");
    await choose(page, "Delete");
    await expect(canvasLayer(page, "fx_free_text")).toHaveCount(0);
    await page.keyboard.press("Control+z");
    await expect(canvasLayer(page, "fx_free_text")).toHaveCount(1);
  });

  test("image and frame: Replace photo and Crop photo; Crop opens crop mode", async ({ page }) => {
    await rightClick(page, "fx_photo_crop");
    expect(await has(page, "Replace photo")).toBe(true);
    expect(await has(page, "Crop photo")).toBe(true);
    await choose(page, "Crop photo");
    await expect(page.getByRole("application", { name: /crop photo/i })).toBeVisible();
    await page.keyboard.press("Escape");
    await rightClick(page, "fx_frame");
    expect(await has(page, "Crop photo")).toBe(true);
  });

  test("shape and grid offer the structural commands they are permitted", async ({ page }) => {
    await rightClick(page, "fx_shape");
    expect(await has(page, "Copy")).toBe(true);
    expect(await has(page, "Delete")).toBe(true);
    await page.keyboard.press("Escape");
    await rightClick(page, "fx_grid");
    expect(await has(page, "Bring to front")).toBe(true);
  });

  test("multiple selection: Group; a group: Ungroup and Edit group contents", async ({ page }) => {
    await selectLayer(page, "fx_free_text");
    await selectLayer(page, "fx_shape", ["Shift"]);
    await rightClick(page, "fx_shape");
    expect(await has(page, "Edit text")).toBe(false);
    await choose(page, "Group");
    const [group] = await selectedIds(page);
    expect(group).toMatch(/group/);
    await rightClick(page, group);
    expect(await has(page, "Ungroup")).toBe(true);
    expect(await has(page, "Edit group contents")).toBe(true);
    await choose(page, "Ungroup");
    expect((await selectedIds(page)).sort()).toEqual(["fx_free_text", "fx_shape"]);
  });

  test("a customer object can be locked and unlocked from the menu", async ({ page }) => {
    await switchToAdvancedCustomize(page);
    const root = page.locator("[data-customizer-root]");
    await root.getByRole("button", { name: "Elements", exact: true }).click();
    await root.getByRole("button", { name: "Add Square", exact: true }).click();
    const [square] = await selectedIds(page);
    await rightClick(page, square);
    await choose(page, "Lock");
    await rightClick(page, square);
    expect(await has(page, "Unlock")).toBe(true);
    await choose(page, "Unlock");
  });

  test("an SVG element offers copy, duplicate, arrange, lock and delete", async ({ page }) => {
    const svg = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40" fill="#d4af37"/></svg>')}`;
    await page.route(/\/api\/customizer\/elements(\?.*)?$/, (route) =>
      route.fulfill({ json: { ok: true, elements: [{ id: "el-1", title: "Gold Dot", url: svg, width: 100, height: 100, tintable: true, defaultColor: "#d4af37", categoryId: "", mimeType: "image/svg+xml" }], categories: [], total: 1, page: 1, pageSize: 30 } }),
    );
    await switchToAdvancedCustomize(page);
    const root = page.locator("[data-customizer-root]");
    await root.getByRole("button", { name: "Elements", exact: true }).click();
    await root.getByRole("button", { name: "Insert Gold Dot", exact: true }).click();
    const [element] = await selectedIds(page);
    await rightClick(page, element);
    for (const label of ["Copy", "Duplicate", "Bring to front", "Lock", "Delete"]) expect(await has(page, label), label).toBe(true);
    await choose(page, "Delete");
    await expect(canvasLayer(page, element)).toHaveCount(0);
  });

  test("Copy from the menu, then Paste here on empty artboard lands the copy under the pointer", async ({ page }) => {
    await rightClick(page, "fx_shape");
    await choose(page, "Copy");
    const target = { x: 120, y: 700 };
    expect(await hitAt(page, target.x, target.y)).toBeNull();
    const screen = await docToScreen(page, target.x, target.y);
    await page.mouse.click(screen.x, screen.y, { button: "right" });
    await expect(menu(page)).toBeVisible();
    expect(await items(page)).toEqual([expect.stringMatching(/^Paste here/)]);
    await choose(page, "Paste here");
    const [pasted] = await selectedIds(page);
    expect(pasted).not.toBe("fx_shape");
    const box = await rectAttrs(page, pasted);
    expect(Math.abs(box.x + box.width / 2 - target.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height / 2 - target.y)).toBeLessThanOrEqual(1);
  });

  test("a right click and a quick left click on a photo are not a double click", async ({ page }) => {
    const point = await bodyPoint(page, "fx_photo_crop");
    await page.mouse.click(point.x, point.y, { button: "right" });
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await page.mouse.click(point.x, point.y);
    await page.mouse.click(point.x, point.y, { button: "right" });
    await expect(menu(page)).toBeVisible();
    await expect(page.getByRole("application", { name: /crop photo/i })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(150);
    await expect(page.getByRole("application", { name: /crop photo/i })).toHaveCount(0);
  });

  test("empty artboard with nothing copied opens no menu", async ({ page }) => {
    const screen = await docToScreen(page, 90, 90);
    await page.mouse.click(screen.x, screen.y, { button: "right" });
    await page.waitForTimeout(300);
    await expect(menu(page)).toHaveCount(0);
  });

  test("keyboard Copy/Paste and the menu share one clipboard", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    await page.keyboard.press("Control+c");
    await rightClick(page, "fx_frame");
    await choose(page, "Paste");
    const [pasted] = await selectedIds(page);
    expect(pasted).not.toBe("fx_shape");
    expect((await rectAttrs(page, pasted)).width).toBe(300);
  });

  test("structural commands are gone from the upper toolbars; More actions opens the same menu", async ({ page }) => {
    await selectLayer(page, "fx_free_text");
    const dock = page.locator("[data-customer-toolbar-dock]");
    for (const name of ["Delete text", "Duplicate text", "Delete selection", "Duplicate selection"]) {
      await expect(dock.getByRole("button", { name })).toHaveCount(0);
    }
    await dock.getByRole("button", { name: "More actions" }).click();
    await expect(menu(page)).toBeVisible();
    expect(await has(page, "Delete")).toBe(true);
    await choose(page, "Duplicate");
    expect((await selectedIds(page))[0]).not.toBe("fx_free_text");
  });
});

test.describe("touch fallback", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test("without a right click, More actions reaches the object menu", async ({ page }) => {
    await openFixture(page, "?snap=0");
    const point = await bodyPoint(page, "fx_shape");
    await page.touchscreen.tap(point.x, point.y);
    await page.locator("[data-customer-toolbar-dock]").getByRole("button", { name: "More actions" }).tap();
    await expect(menu(page)).toBeVisible();
    await menu(page).getByRole("menuitem", { name: "Delete", exact: true }).tap();
    await expect(canvasLayer(page, "fx_shape")).toHaveCount(0);
  });
});
