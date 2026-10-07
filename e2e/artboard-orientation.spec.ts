/**
 * Portrait / Landscape artboard (Customizer Point 6).
 *
 * The orientation switch is a real, atomic change of the artboard: one Undo
 * reverts it, one Redo restores it, and the customer editor renders and edits
 * a landscape card in its own coordinates.
 */
import { expect, test, type Page } from "@playwright/test";
import { addStudioFrame } from "./admin-studio-tools";
import { bodyPoint, canvasLayer, drag, openFixture, rectAttrs, selectLayer, waitForEditor } from "./customizer-fixture";

const ratioOf = (page: Page, selector: string) =>
  page.evaluate((target) => {
    const box = document.querySelector(target)!.getBoundingClientRect();
    return box.width / box.height;
  }, selector);

test.use({ viewport: { width: 1440, height: 900 } });

test("Design Studio: Horizontal (Landscape) swaps the canvas to 2100 × 1500; one Undo and one Redo", async ({ page }) => {
  await page.goto("/__e2e/admin-dashboard?section=Products");
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Add product" }).first().click();
  const enable = page.getByRole("switch", { name: /Enable product customizer/ });
  // The form renders after the click that opened it: wait for the switch (or a
  // studio that is already enabled) instead of checking visibility once.
  await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
  if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
  await page.getByRole("button", { name: "Open Design Studio" }).click();
  const studio = page.locator("[data-admin-customizer]");
  const header = studio.locator("header");
  await expect(header).toBeVisible();
  await addStudioFrame(page);

  const pixels = studio.locator("[data-artboard-pixels]");
  const orientation = studio.getByLabel("Orientation");
  await header.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(orientation).toHaveValue("portrait");
  await orientation.selectOption("landscape");
  await expect(pixels).toHaveText("2100 × 1500");
  await expect(orientation).toHaveValue("landscape");

  await header.getByRole("button", { name: "Design", exact: true }).click();
  await expect.poll(() => ratioOf(page, "[data-canvas-surface]").catch(() => 0)).toBeCloseTo(2100 / 1500, 2);

  await page.keyboard.press("Control+z");
  await expect.poll(() => ratioOf(page, "[data-canvas-surface]").catch(() => 0)).toBeCloseTo(1500 / 2100, 2);
  await page.keyboard.press("Control+y");
  await expect.poll(() => ratioOf(page, "[data-canvas-surface]").catch(() => 0)).toBeCloseTo(2100 / 1500, 2);
  await header.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(pixels).toHaveText("2100 × 1500");
});

test.describe("customer editor on a landscape card", () => {
  test("renders 2100 × 1500 with every object undistorted and editable; a refresh keeps edits", async ({ page }) => {
    await openFixture(page, "?orientation=landscape&snap=0&autosave=1");
    expect(await page.evaluate(() => document.querySelector('[data-customizer-canvas="main"] svg')?.getAttribute("viewBox"))).toBe("0 0 2100 1500");
    expect(await ratioOf(page, '[data-customizer-canvas="main"]')).toBeCloseTo(1.4, 2);
    // fx_shape keeps its 300 : 120 proportions.
    const shape = await rectAttrs(page, "fx_shape");
    expect(shape.width / shape.height).toBeCloseTo(2.5, 2);
    await expect(canvasLayer(page, "fx_title")).toBeVisible();

    await selectLayer(page, "fx_shape");
    const before = await rectAttrs(page, "fx_shape");
    const scale = await page.evaluate(() => (window as any).Konva.stages.find((stage: any) => stage.findOne("Transformer")).scaleX());
    const from = await bodyPoint(page, "fx_shape");
    await drag(page, from, { x: from.x + 50, y: from.y });
    const moved = await rectAttrs(page, "fx_shape");
    expect(Math.abs(moved.x - before.x - 50 / scale)).toBeLessThanOrEqual(2);
    await page.reload();
    await waitForEditor(page);
    expect(await rectAttrs(page, "fx_shape")).toEqual(moved);
  });
});
