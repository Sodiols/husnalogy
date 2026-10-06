/**
 * Admin Design Studio: group scope follows the selection (Customizer Point 2).
 *
 * The studio shares the customer canvas's Konva stage but owns its own
 * selection handler. Selecting something outside an entered group used to be
 * stripped back out by the group-scope filter, so the click selected nothing
 * and the studio stayed "inside" the group.
 */
import { expect, test, type Page } from "@playwright/test";
import { bodyPoint, selectedIds } from "./customizer-fixture";

const studio = (page: Page) => page.locator("[data-admin-customizer]");

async function openNewStudio(page: Page) {
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

async function click(page: Page, layerId: string, modifiers: Array<"Shift"> = []) {
  const point = await bodyPoint(page, layerId);
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.click(point.x, point.y);
  for (const key of modifiers) await page.keyboard.up(key);
  await page.waitForTimeout(300);
}

const expectSelection = (page: Page, ids: string[]) =>
  expect.poll(async () => (await selectedIds(page)).slice().sort(), { timeout: 5000 }).toEqual(ids.slice().sort());

test("admin: selecting outside an entered group leaves it, and its members resolve to the group again", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewStudio(page);
  await studio(page).getByRole("button", { name: "Frame", exact: true }).click();
  const [a] = await selectedIds(page);
  // Spread the copies out so each has a visible body to click.
  const spread = async () => {
    for (let index = 0; index < 12; index += 1) await page.keyboard.press("Shift+ArrowDown");
    await page.waitForTimeout(250);
  };
  await page.keyboard.press("Control+d");
  await page.waitForTimeout(250);
  const [b] = await selectedIds(page);
  await spread();
  await page.keyboard.press("Control+d");
  await page.waitForTimeout(250);
  const [c] = await selectedIds(page);
  await spread();
  expect(new Set([a, b, c]).size).toBe(3);

  await click(page, a);
  await click(page, b, ["Shift"]);
  await expectSelection(page, [a, b]);
  await page.keyboard.press("Control+g");
  await page.waitForTimeout(300);
  const [group] = await selectedIds(page);
  expect(group).not.toBe(a);

  // Enter the group, then click the object outside it.
  const point = await bodyPoint(page, group);
  await page.mouse.dblclick(point.x, point.y);
  await page.waitForTimeout(300);
  expect([a, b]).toContain((await selectedIds(page))[0]);
  await click(page, c);
  await expectSelection(page, [c]);

  // Out of the group again: a member click selects the GROUP.
  await click(page, group);
  await expectSelection(page, [group]);
});
