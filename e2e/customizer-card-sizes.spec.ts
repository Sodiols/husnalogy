/**
 * Official card sizes as real artboards (Customizer Point 3).
 *
 * 3.5 × 5 in at 300 DPI is a 1050 × 1500 px canvas — in the customer editor,
 * in what it saves and restores, and in the Design Studio, where choosing the
 * size converts the design in one undoable step.
 */
import { expect, test, type Page } from "@playwright/test";
import { bodyPoint, canvasLayer, drag, openFixture, readDraft, rectAttrs, selectLayer, waitForEditor } from "./customizer-fixture";
import { addStudioFrame } from "./admin-studio-tools";

const viewBoxOf = (page: Page) =>
  page.evaluate(() => document.querySelector('[data-customizer-canvas="main"] svg')?.getAttribute("viewBox") || "");

const surfaceRatio = (page: Page, selector = '[data-customizer-canvas="main"]') =>
  page.evaluate((target) => {
    const box = document.querySelector(target)!.getBoundingClientRect();
    return box.width / box.height;
  }, selector);

test.use({ viewport: { width: 1440, height: 900 } });

test.describe("customer editor on a 3.5 × 5 card", () => {
  test("renders a 1050 × 1500 artboard with the design scaled, never stretched", async ({ page }) => {
    await openFixture(page, "?size=3.5x5&snap=0");
    expect(await viewBoxOf(page)).toBe("0 0 1050 1500");
    expect(await surfaceRatio(page)).toBeCloseTo(1050 / 1500, 2);
    // fx_shape is 300 × 120 on the 5 × 7 design; uniform 0.7 keeps its proportions.
    const shape = await rectAttrs(page, "fx_shape");
    expect(shape.width).toBeCloseTo(210, 0);
    expect(shape.height).toBeCloseTo(84, 0);
    await expect(canvasLayer(page, "fx_title")).toBeVisible();
  });

  test("editing works in its own coordinates and survives a refresh", async ({ page }) => {
    await openFixture(page, "?size=3.5x5&snap=0&autosave=1");
    await selectLayer(page, "fx_shape");
    const before = await rectAttrs(page, "fx_shape");
    const scale = await page.evaluate(() => (window as any).Konva.stages.find((stage: any) => stage.findOne("Transformer")).scaleX());
    const from = await bodyPoint(page, "fx_shape");
    await drag(page, from, { x: from.x + 60, y: from.y });
    const moved = await rectAttrs(page, "fx_shape");
    expect(Math.abs(moved.x - before.x - 60 / scale)).toBeLessThanOrEqual(2);
    await page.reload();
    await waitForEditor(page);
    expect(await viewBoxOf(page)).toBe("0 0 1050 1500");
    expect(await rectAttrs(page, "fx_shape")).toEqual(moved);
  });

  test("the 5 × 7 fixture is unchanged", async ({ page }) => {
    await openFixture(page, "?snap=0");
    expect(await viewBoxOf(page)).toBe("0 0 1500 2100");
    expect((await rectAttrs(page, "fx_shape")).width).toBe(300);
    expect(await readDraft(page)).toBeNull();
  });
});

test.describe("Design Studio card size", () => {
  async function openStudio(page: Page) {
    await page.goto("/__e2e/admin-dashboard?section=Products");
    await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Add product" }).first().click();
    const enable = page.getByRole("switch", { name: /Enable product customizer/ });
    // The form renders after the click that opened it: wait for the switch (or a
    // studio that is already enabled) instead of checking visibility once.
    await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
    if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
    await page.getByRole("button", { name: "Open Design Studio" }).click();
    await expect(page.locator("[data-admin-customizer] header")).toBeVisible();
  }

  const studio = (page: Page) => page.locator("[data-admin-customizer]");
  const pixels = (page: Page) => studio(page).locator("[data-artboard-pixels]");

  test("choosing 3.5 × 5 sets a 1050 × 1500 canvas and converts the design; one Undo restores 5 × 7", async ({ page }) => {
    await openStudio(page);
    await addStudioFrame(page);
    await studio(page).locator("header").getByRole("button", { name: "Settings", exact: true }).click();
    await expect(pixels(page)).toHaveText("1500 × 2100");

    await studio(page).getByLabel("Card size").selectOption("3.5x5");
    await expect(pixels(page)).toHaveText("1050 × 1500");
    await expect(studio(page).getByLabel("Card size")).toHaveValue("3.5x5");

    await studio(page).locator("header").getByRole("button", { name: "Design", exact: true }).click();
    await expect.poll(() => surfaceRatio(page, "[data-canvas-surface]").catch(() => 0)).toBeCloseTo(0.7, 2);

    await page.keyboard.press("Control+z");
    await studio(page).locator("header").getByRole("button", { name: "Settings", exact: true }).click();
    await expect(pixels(page)).toHaveText("1500 × 2100");
    await expect(studio(page).getByLabel("Card size")).toHaveValue("5x7");
  });
});
