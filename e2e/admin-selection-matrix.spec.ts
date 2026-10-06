/**
 * Admin Design Studio selection matrix (Customizer Point 2, admin).
 *
 * The studio mounts the same Konva interaction stage as the customer editor but
 * owns its own selection state, so every selection route is proven here too:
 * click, Shift-click, empty-canvas click, marquee (including a release outside
 * the canvas), Select All, Escape, and pressing another object while editing
 * text.
 */
import { expect, test, type Page } from "@playwright/test";
import { bodyPoint, docToScreen, hitAt, selectedIds } from "./customizer-fixture";

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const expectSelection = (page: Page, ids: string[]) =>
  expect.poll(async () => (await selectedIds(page)).slice().sort(), { timeout: 5000 }).toEqual(ids.slice().sort());

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

async function inserted(page: Page, previous: string[]): Promise<string> {
  let id = "";
  await expect.poll(async () => {
    const [current] = await selectedIds(page);
    id = current && !previous.includes(current) ? current : "";
    return id;
  }).not.toBe("");
  return id;
}

/** Three ovals, spread vertically so each has its own body and empty space around it. */
async function threeShapes(page: Page): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    await studio(page).getByRole("button", { name: "Shape", exact: true }).click();
    await page.getByRole("menu").getByRole("button", { name: "oval", exact: true }).click();
    ids.push(await inserted(page, ids));
    const steps = [-14, 0, 14][index];
    for (let step = 0; step < Math.abs(steps); step += 1) await page.keyboard.press(steps < 0 ? "Shift+ArrowUp" : "Shift+ArrowDown");
    await page.waitForTimeout(200);
  }
  return ids;
}

async function click(page: Page, id: string, modifiers: Array<"Shift"> = []) {
  const point = await bodyPoint(page, id);
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.click(point.x, point.y);
  for (const key of modifiers) await page.keyboard.up(key);
  await page.waitForTimeout(450);
}

test.describe("admin selection", () => {
  test.beforeEach(async ({ page }) => {
    await openNewStudio(page);
  });

  test("click selects one; an empty-canvas click clears the selection", async ({ page }) => {
    const [a, b] = await threeShapes(page);
    await click(page, a);
    await expectSelection(page, [a]);
    await click(page, b);
    await expectSelection(page, [b]);
    const empty = await docToScreen(page, 150, 150);
    expect(await hitAt(page, 150, 150)).toBeNull();
    await page.mouse.click(empty.x, empty.y);
    await expectSelection(page, []);
  });

  test("Shift-click adds and removes, and never moves anything", async ({ page }) => {
    const [a, b, c] = await threeShapes(page);
    await click(page, a);
    await click(page, b, ["Shift"]);
    await click(page, c, ["Shift"]);
    await expectSelection(page, [a, b, c]);
    await click(page, b, ["Shift"]);
    await expectSelection(page, [a, c]);
  });

  test("a marquee selects what it encloses, even when released outside the canvas", async ({ page }) => {
    const [a, b, c] = await threeShapes(page);
    const start = await docToScreen(page, 60, 60);
    const box = (await studio(page).locator("[data-canvas-surface]").boundingBox())!;
    await page.mouse.click(start.x, start.y);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    // Past the card's right edge and below its bottom: off the canvas entirely.
    const end = { x: box.x + box.width + 40, y: box.y + box.height + 10 };
    for (let step = 1; step <= 16; step += 1) await page.mouse.move(start.x + ((end.x - start.x) * step) / 16, start.y + ((end.y - start.y) * step) / 16);
    await page.mouse.up();
    await expectSelection(page, [a, b, c]);
  });

  test("Select All, then Escape clears", async ({ page }) => {
    const ids = await threeShapes(page);
    await click(page, ids[0]);
    await page.keyboard.press("Control+a");
    await expectSelection(page, ids);
    await page.keyboard.press("Escape");
    await expectSelection(page, []);
  });

  test("pressing another object while typing commits the text and selects that object", async ({ page }) => {
    const shapes = await threeShapes(page);
    // Read before typing starts: while the editor is open the canvas hit graph
    // is paused and the press is routed by geometry instead.
    const point = await bodyPoint(page, shapes[2]);
    await studio(page).getByRole("button", { name: "Text", exact: true }).click();
    const editor = page.locator('[aria-label="Edit text on canvas"]');
    await expect(editor).toBeVisible();
    await page.keyboard.type("Hello studio");
    await page.mouse.click(point.x, point.y);
    await expect(editor).toHaveCount(0);
    await expectSelection(page, [shapes[2]]);
    await expect(studio(page).locator("[data-canvas-surface]").getByText("Hello studio").first()).toBeVisible();
  });
});
