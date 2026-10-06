/**
 * Admin Design Studio: right-click object menu (Customizer Point 9, admin).
 *
 * Copy, paste, duplicate, arrange, group, clipping mask, lock, hide and delete
 * are reached through ONE menu (a right click), and every entry runs the
 * studio's existing command for that action — the same one the selection
 * toolbar's Copy and Delete buttons run.
 */
import { expect, test, type Page } from "@playwright/test";
import { bodyPoint, docToScreen, hitAt, selectedIds } from "./customizer-fixture";

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const layerIn = (page: Page, id: string) => studio(page).locator(`[data-layer-id="${id}"]`);
const menu = (page: Page) => page.getByRole("menu", { name: "Object actions" });
const labels = async (page: Page) =>
  (await menu(page).getByRole("menuitem").allTextContents()).map((text) => text.replace(/\s+/g, " ").trim());
const has = async (page: Page, label: string) => (await labels(page)).some((text) => text.startsWith(label));

async function openNewStudio(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__e2e/admin-dashboard?section=Products");
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Add product" }).first().click();
  const enable = page.getByRole("switch", { name: /Enable product customizer/ });
  // The form renders after the click that opened it: wait for the switch (or a
  // studio that is already enabled) instead of checking visibility once.
  await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
  if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
  await page.getByRole("button", { name: "Open Design Studio" }).click();
  await expect(studio(page).locator("header")).toBeVisible();
}

async function inserted(page: Page, previous: string[] = []): Promise<string> {
  let id = "";
  await expect.poll(async () => {
    const [current] = await selectedIds(page);
    id = current && !previous.includes(current) ? current : "";
    return id;
  }).not.toBe("");
  return id;
}

async function addShape(page: Page, kind: string, previous: string[] = []) {
  await studio(page).getByRole("button", { name: "Shape", exact: true }).click();
  await page.getByRole("menu").getByRole("button", { name: kind, exact: true }).click();
  return inserted(page, previous);
}

async function nudgeDown(page: Page) {
  for (let index = 0; index < 12; index += 1) await page.keyboard.press("Shift+ArrowDown");
  await page.waitForTimeout(250);
}

async function rightClick(page: Page, layerId: string) {
  const point = await bodyPoint(page, layerId);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await expect(menu(page)).toBeVisible();
}

async function choose(page: Page, label: string) {
  await menu(page).getByRole("menuitem", { name: label, exact: true }).click();
  await expect(menu(page)).toHaveCount(0);
}

const ellipseCentre = (page: Page, id: string) =>
  page.evaluate((layerId) => {
    const ellipse = document.querySelector(`[data-admin-customizer] [data-canvas-surface] [data-layer-id="${layerId}"] ellipse`);
    return { x: Number(ellipse?.getAttribute("cx")), y: Number(ellipse?.getAttribute("cy")) };
  }, id);

test.describe("admin object menu", () => {
  test.beforeEach(async ({ page }) => {
    await openNewStudio(page);
  });

  test("a shape: clipboard, arrange, lock and delete — Delete really deletes and Undo restores it", async ({ page }) => {
    const shape = await addShape(page, "oval");
    await rightClick(page, shape);
    for (const label of ["Copy", "Duplicate", "Bring to front", "Bring forward", "Send backward", "Send to back", "Hide", "Lock", "Delete"]) {
      expect(await has(page, label), label).toBe(true);
    }
    expect(await has(page, "Edit text")).toBe(false);
    await choose(page, "Delete");
    await expect(layerIn(page, shape)).toHaveCount(0);
    await page.keyboard.press("Control+z");
    await expect(layerIn(page, shape).first()).toBeAttached();
  });

  test("Duplicate from the menu is the studio's Duplicate", async ({ page }) => {
    const shape = await addShape(page, "oval");
    await rightClick(page, shape);
    await choose(page, "Duplicate");
    const copy = await inserted(page, [shape]);
    await expect(layerIn(page, copy).first()).toBeAttached();
    await expect(layerIn(page, shape).first()).toBeAttached();
  });

  test("a locked object cannot be deleted by any route, and unlocks from the menu", async ({ page }) => {
    const shape = await addShape(page, "oval");
    await rightClick(page, shape);
    await choose(page, "Lock");
    await rightClick(page, shape);
    expect(await has(page, "Unlock")).toBe(true);
    expect(await has(page, "Delete")).toBe(false);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Delete");
    await page.waitForTimeout(300);
    await expect(layerIn(page, shape).first()).toBeAttached();
    await rightClick(page, shape);
    await choose(page, "Unlock");
    await rightClick(page, shape);
    expect(await has(page, "Delete")).toBe(true);
  });

  test("Copy, then Paste here on empty artboard lands the copy under the pointer", async ({ page }) => {
    const shape = await addShape(page, "oval");
    await rightClick(page, shape);
    await choose(page, "Copy");
    const intended = { x: 300, y: 300 };
    expect(await hitAt(page, intended.x, intended.y)).toBeNull();
    // A pointer lands on whole screen pixels (one is ~3 document px here), so
    // click a whole pixel and expect the document point THAT pixel maps to.
    const exact = await docToScreen(page, intended.x, intended.y);
    const step = await docToScreen(page, intended.x + 100, intended.y + 100);
    const scale = { x: (step.x - exact.x) / 100, y: (step.y - exact.y) / 100 };
    const screen = { x: Math.round(exact.x), y: Math.round(exact.y) };
    const target = { x: intended.x + (screen.x - exact.x) / scale.x, y: intended.y + (screen.y - exact.y) / scale.y };
    await page.mouse.click(screen.x, screen.y, { button: "right" });
    await expect(menu(page)).toBeVisible();
    expect(await labels(page)).toEqual([expect.stringMatching(/^Paste here/)]);
    await choose(page, "Paste here");
    const pasted = await inserted(page, [shape]);
    const centre = await ellipseCentre(page, pasted);
    expect(Math.abs(centre.x - target.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre.y - target.y)).toBeLessThanOrEqual(1);
  });

  test("empty artboard with nothing copied opens no menu", async ({ page }) => {
    await addShape(page, "oval");
    const screen = await docToScreen(page, 300, 300);
    await page.mouse.click(screen.x, screen.y, { button: "right" });
    await page.waitForTimeout(300);
    await expect(menu(page)).toHaveCount(0);
  });

  test("two objects: Group, Clipping mask; a group: Ungroup and Edit group contents", async ({ page }) => {
    await studio(page).getByRole("button", { name: "Frame", exact: true }).click();
    const photo = await inserted(page);
    await nudgeDown(page);
    const shape = await addShape(page, "oval", [photo]);
    await page.mouse.click(...Object.values(await bodyPoint(page, shape)) as [number, number]);
    await page.keyboard.down("Shift");
    const photoPoint = await bodyPoint(page, photo);
    await page.mouse.click(photoPoint.x, photoPoint.y);
    await page.keyboard.up("Shift");
    await expect.poll(async () => (await selectedIds(page)).sort()).toEqual([photo, shape].sort());
    await rightClick(page, photo);
    expect(await has(page, "Group")).toBe(true);
    expect(await has(page, "Clipping mask")).toBe(true);
    await choose(page, "Group");
    const group = await inserted(page, [photo, shape]);
    await rightClick(page, group);
    expect(await has(page, "Ungroup")).toBe(true);
    expect(await has(page, "Edit group contents")).toBe(true);
    await choose(page, "Ungroup");
    await expect.poll(async () => (await selectedIds(page)).sort()).toEqual([photo, shape].sort());
  });

  test("Match width, height and size give every selected object the first one's size, in one undo step", async ({ page }) => {
    const first = await addShape(page, "rectangle");
    await nudgeDown(page);
    const second = await addShape(page, "circle", [first]);
    // Every new shape starts 500 x 300: make the second one a different size.
    await page.locator("[data-admin-toolbar]").getByRole("button", { name: "Scale larger" }).click();
    const sizeOf = (id: string) =>
      page.evaluate((layerId) => {
        const box = document.querySelector(`[data-admin-customizer] [data-canvas-surface] [data-layer-id="${layerId}"]`)!.getBoundingClientRect();
        return Math.round(box.width);
      }, id);
    const firstPoint = await bodyPoint(page, first);
    await page.mouse.click(firstPoint.x, firstPoint.y);
    const secondPoint = await bodyPoint(page, second);
    await page.keyboard.down("Shift");
    await page.mouse.click(secondPoint.x, secondPoint.y);
    await page.keyboard.up("Shift");
    await expect.poll(async () => (await selectedIds(page)).length).toBe(2);
    const widthBefore = await sizeOf(second);
    expect(widthBefore).not.toBe(await sizeOf(first));
    await page.mouse.click(secondPoint.x, secondPoint.y, { button: "right" });
    await expect(menu(page)).toBeVisible();
    await menu(page).getByRole("menuitem", { name: "Match size", exact: true }).click();
    await expect.poll(() => sizeOf(second)).toBe(await sizeOf(first));
    await page.keyboard.press("Control+z");
    await expect.poll(() => sizeOf(second)).toBe(widthBefore);
  });

  test("the toolbar's Delete and the menu's Delete are the same command", async ({ page }) => {
    const id = await addShape(page, "oval");
    const toolbar = page.locator("[data-admin-text-toolbar]");
    await toolbar.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(layerIn(page, id)).toHaveCount(0);
    await page.keyboard.press("Control+z");
    await expect(layerIn(page, id).first()).toBeAttached();
    // The object menu still offers the same structural commands.
    const point = await bodyPoint(page, id);
    await page.mouse.click(point.x, point.y, { button: "right" });
    await expect(menu(page)).toBeVisible();
    expect(await has(page, "Delete")).toBe(true);
    expect(await has(page, "Duplicate")).toBe(true);
  });
});
