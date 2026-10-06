/**
 * Admin Design Studio: shape + photo clipping mask (Customizer Point 10).
 *
 * The studio's image + shape toolbar offers Mask when exactly one shape and one
 * photo area are selected. The result is the photo area itself, clipped by
 * the shared mask engine — one undo step, one redo step.
 */
import { expect, test, type Page } from "@playwright/test";
import { getMaskPath } from "../lib/customizer/v2/masks";
import { bodyPoint, selectedIds } from "./customizer-fixture";

const studio = (page: Page) => page.locator("[data-admin-customizer]");
/** A layer as the studio canvas draws it. */
const canvasLayer = (page: Page, id: string) => studio(page).locator(`[data-layer-id="${id}"]`);

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

/** The id of the object just inserted, once the canvas has selected it. */
async function inserted(page: Page, previous: string[] = []): Promise<string> {
  let id = "";
  await expect.poll(async () => {
    const [current] = await selectedIds(page);
    id = current && !previous.includes(current) ? current : "";
    return id;
  }).not.toBe("");
  return id;
}

async function nudgeDown(page: Page) {
  for (let index = 0; index < 12; index += 1) await page.keyboard.press("Shift+ArrowDown");
  await page.waitForTimeout(250);
}

/** Geometry the canvas draws for a layer: its clip path, or the ellipse of a shape. */
const drawn = (page: Page, id: string) =>
  page.evaluate((layerId) => {
    const group = document.querySelector(`[data-admin-customizer] [data-canvas-surface] [data-layer-id="${layerId}"]`);
    const ellipse = group?.querySelector("ellipse");
    return {
      // A photo area without a picture yet draws its outline as a placeholder
      // path; with a picture the same outline is the clip path.
      clip: (group?.querySelector("clipPath path") || group?.querySelector("path"))?.getAttribute("d") || "",
      ellipse: ellipse
        ? { cx: Number(ellipse.getAttribute("cx")), cy: Number(ellipse.getAttribute("cy")), rx: Number(ellipse.getAttribute("rx")), ry: Number(ellipse.getAttribute("ry")) }
        : null,
    };
  }, id);

test("admin: an oval and a photo area become one clipped photo; Undo and Redo replay it in one step", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewStudio(page);

  await studio(page).getByRole("button", { name: "Frame", exact: true }).click();
  const photo = await inserted(page);
  // Move the photo area off the centre so the shape has its own body to click.
  await nudgeDown(page);

  await studio(page).getByRole("button", { name: "Shape", exact: true }).click();
  await page.getByRole("menu").getByRole("button", { name: "oval", exact: true }).click();
  const shape = await inserted(page, [photo]);
  const oval = (await drawn(page, shape)).ellipse!;
  expect(oval).not.toBeNull();
  const photoBefore = (await drawn(page, photo)).clip;

  await click(page, shape);
  await click(page, photo, ["Shift"]);
  await expect.poll(async () => (await selectedIds(page)).sort()).toEqual([photo, shape].sort());
  await expect(page.locator("[data-admin-toolbar]")).toHaveAttribute("data-admin-toolbar", "mask");
  await page.locator("[data-admin-toolbar]").getByRole("button", { name: "Mask", exact: true }).click();

  // The shape is gone; the photo area is clipped to exactly the oval it replaced.
  await expect(canvasLayer(page, shape)).toHaveCount(0);
  expect(await selectedIds(page)).toEqual([photo]);
  const expected = getMaskPath({ kind: "oval" }, { x: oval.cx - oval.rx, y: oval.cy - oval.ry, width: oval.rx * 2, height: oval.ry * 2 }).d;
  expect((await drawn(page, photo)).clip).toBe(expected);

  await page.keyboard.press("Control+z");
  await expect(canvasLayer(page, shape).first()).toBeAttached();
  expect((await drawn(page, photo)).clip).toBe(photoBefore);

  await page.keyboard.press("Control+y");
  await expect(canvasLayer(page, shape)).toHaveCount(0);
  expect((await drawn(page, photo)).clip).toBe(expected);

  // The Mask shape control names the clip's outline and can replace it.
  await expect(studio(page).getByRole("combobox", { name: "Mask shape" })).toHaveValue("oval");
});

test("admin: Clipping mask is unavailable for two shapes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewStudio(page);
  await studio(page).getByRole("button", { name: "Shape", exact: true }).click();
  await page.getByRole("menu").getByRole("button", { name: "rectangle", exact: true }).click();
  const first = await inserted(page);
  await nudgeDown(page);
  await studio(page).getByRole("button", { name: "Shape", exact: true }).click();
  await page.getByRole("menu").getByRole("button", { name: "circle", exact: true }).click();
  const second = await inserted(page, [first]);
  await click(page, first);
  await click(page, second, ["Shift"]);
  await expect.poll(async () => (await selectedIds(page)).length).toBe(2);
  // Two shapes get the generic multi-selection toolbar, which has no Mask.
  await expect(page.locator("[data-admin-toolbar]")).toHaveAttribute("data-admin-toolbar", "multi");
  await expect(page.locator("[data-admin-toolbar]").getByRole("button", { name: "Mask", exact: true })).toHaveCount(0);
});
