/**
 * Text growth direction in the Design Studio (Customizer Point 11, admin).
 *
 * The edge the direction names holds still while the text gets taller — more
 * lines, a bigger font — and the box returns exactly when the text shrinks
 * back. Measured from what the canvas draws, in the box's own rotated frame.
 */
import { expect, test, type Page } from "@playwright/test";
import { anchorPoint, bodyPoint, selectedIds } from "./customizer-fixture";

const studio = (page: Page) => page.locator("[data-admin-customizer]");

async function openStudioWithText(page: Page): Promise<string> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__e2e/admin-dashboard?section=Products");
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Add product" }).first().click();
  await page.getByPlaceholder("Describe the product the way a customer would search for it").fill("Growth Card");
  const enable = page.getByRole("switch", { name: /Enable product customizer/ });
  // The form renders after the click that opened it: wait for the switch (or a
  // studio that is already enabled) instead of checking visibility once.
  await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
  if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
  await page.getByRole("button", { name: "Open Design Studio" }).click();
  await expect(studio(page).locator("header")).toBeVisible();
  await studio(page).getByRole("button", { name: "Text", exact: true }).click();
  const editor = page.locator('[aria-label="Edit text on canvas"]');
  await expect(editor).toBeVisible();
  await page.keyboard.type("One");
  await page.keyboard.press("Control+Enter");
  await expect(editor).toHaveCount(0);
  let id = "";
  await expect.poll(async () => (id = (await selectedIds(page))[0] || "")).not.toBe("");
  await expect(growth(page)).toBeVisible();
  return id;
}

const growth = (page: Page) => studio(page).getByRole("radiogroup", { name: "Text growth" });
const content = (page: Page) => studio(page).getByText("Text content", { exact: true }).locator("xpath=..").locator("textarea");

/** The drawn box's top, centre and bottom (mid-points), in canvas units, after its rotation. */
const edges = (page: Page, id: string) =>
  page.evaluate((layerId) => {
    const group = document.querySelector(`[data-admin-customizer] [data-canvas-surface] [data-layer-id="${layerId}"] > g`)!;
    const rect = group.querySelector("clipPath rect")!;
    const [x, y, w, h] = ["x", "y", "width", "height"].map((name) => Number(rect.getAttribute(name)));
    const match = /rotate\(([-\d.e]+) ([-\d.e]+) ([-\d.e]+)\)/.exec(group.getAttribute("transform") || "");
    const [angle, cx, cy] = match ? match.slice(1).map(Number) : [0, x + w / 2, y + h / 2];
    const radians = (angle * Math.PI) / 180;
    const turn = (px: number, py: number) => ({
      x: cx + (px - cx) * Math.cos(radians) - (py - cy) * Math.sin(radians),
      y: cy + (px - cx) * Math.sin(radians) + (py - cy) * Math.cos(radians),
    });
    return { top: turn(x + w / 2, y), centre: turn(x + w / 2, y + h / 2), bottom: turn(x + w / 2, y + h), height: h, angle };
  }, id);

const near = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(0.5);
};

const ANCHOR = { up: "bottom", center: "centre", down: "top" } as const;
const LABEL = { up: "Upward", center: "Center", down: "Downward" } as const;

test.describe("Design Studio text growth", () => {
  for (const direction of ["up", "center", "down"] as const) {
    test(`${LABEL[direction]}: the ${ANCHOR[direction]} holds while lines are added and removed, and the box returns exactly`, async ({ page }) => {
      const id = await openStudioWithText(page);
      await growth(page).getByRole("radio", { name: new RegExp(LABEL[direction]) }).click();
      await expect(growth(page).getByRole("radio", { name: new RegExp(LABEL[direction]) })).toHaveAttribute("aria-checked", "true");
      const before = await edges(page, id);

      await content(page).fill("One\nTwo\nThree\nFour");
      await expect.poll(async () => (await edges(page, id)).height).toBeGreaterThan(before.height * 2);
      const grown = await edges(page, id);
      near(grown[ANCHOR[direction]], before[ANCHOR[direction]]);

      await content(page).fill("One");
      await expect.poll(async () => (await edges(page, id)).height).toBe(before.height);
      const back = await edges(page, id);
      near(back.top, before.top);
      near(back.bottom, before.bottom);
    });
  }

  test("a rotated text grows along its own axis: Upward keeps its bottom edge", async ({ page }) => {
    const id = await openStudioWithText(page);
    await growth(page).getByRole("radio", { name: /Upward/ }).click();
    const rotater = await anchorPoint(page, "rotater");
    const centre = await bodyPoint(page, id);
    await page.mouse.move(rotater.x, rotater.y);
    await page.mouse.down();
    for (let step = 1; step <= 12; step += 1) await page.mouse.move(rotater.x + (centre.x + 260 - rotater.x) * (step / 12), rotater.y + (centre.y - 60 - rotater.y) * (step / 12));
    await page.mouse.up();
    await expect.poll(async () => Math.abs((await edges(page, id)).angle)).toBeGreaterThan(10);
    const before = await edges(page, id);

    await content(page).fill("One\nTwo\nThree");
    await expect.poll(async () => (await edges(page, id)).height).toBeGreaterThan(before.height * 2);
    near((await edges(page, id)).bottom, before.bottom);
    // Repeated edits never drift.
    for (const text of ["One\nTwo", "One\nTwo\nThree\nFour\nFive", "One"]) {
      await content(page).fill(text);
      await page.waitForTimeout(150);
      near((await edges(page, id)).bottom, before.bottom);
    }
  });

  test("a bigger font grows the box upward; Undo and Redo replay the choice; the saved draft keeps it", async ({ page }) => {
    const id = await openStudioWithText(page);
    const upward = growth(page).getByRole("radio", { name: /Upward/ });
    await upward.click();
    await expect(upward).toHaveAttribute("aria-checked", "true");
    // The choice is one undo step: Undo restores the previous direction, Redo the new one.
    const point = await bodyPoint(page, id);
    await page.mouse.click(point.x, point.y);
    await page.keyboard.press("Control+z");
    await expect(upward).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Control+y");
    await expect(upward).toHaveAttribute("aria-checked", "true");
    const before = await edges(page, id);
    const size = studio(page).getByRole("textbox", { name: "Font size" }).or(studio(page).getByRole("spinbutton", { name: "Font size" })).first();
    await size.fill("120");
    await size.press("Enter");
    await expect.poll(async () => (await edges(page, id)).height).toBeGreaterThan(before.height);
    near((await edges(page, id)).bottom, before.bottom);


    await studio(page).locator("header").getByRole("button", { name: /Save Draft/ }).click();
    await expect(studio(page).locator("header").getByText("Unsaved", { exact: true })).toHaveCount(0, { timeout: 15_000 });
    const saved = await page.evaluate(() => {
      const saves = (window as any).__adminFixture.requests.filter((entry: any) => /^\/api\/admin\/products(\/[^/]+)?$/.test(entry.path));
      return saves[saves.length - 1].body.customizerTemplate.layers.find((layer: any) => layer.type === "text");
    });
    expect(saved.textStyle.growthDirection).toBe("up");
  });
});
