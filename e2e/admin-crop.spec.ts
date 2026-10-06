/**
 * Admin Design Studio crop mode (Customizer Point 8, admin).
 *
 * Double-clicking a photo crops it: the frame stays put while the photo moves.
 * Cancel and Escape restore exactly what was there; Done and Enter write the
 * result once, as one undo step.
 */
import { expect, test, type Page } from "@playwright/test";
import { bodyPoint, selectedIds } from "./customizer-fixture";

/** Left half red, right half blue. */
const PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="200" height="400" fill="#ff0000"/><rect x="200" width="200" height="400" fill="#0000ff"/></svg>',
)}`;

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const surface = (page: Page) => page.getByRole("application", { name: /Crop photo/ });
const bar = (page: Page) => page.locator("[data-admin-crop-bar]");

async function openStudioWithPhoto(page: Page): Promise<string> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/admin/customizer/assets", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ json: { ok: true, asset: { id: "asset-crop", url: PHOTO, editorUrl: PHOTO, bucket: "admin", originalPath: "admin/crop.svg", editorPath: "admin/crop.svg", thumbnailPath: "admin/crop.svg", originalFilename: "crop.svg" } } })
      : route.continue(),
  );
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
  await studio(page).getByRole("button", { name: "Frame", exact: true }).click();
  let id = "";
  await expect.poll(async () => (id = (await selectedIds(page))[0] || "")).not.toBe("");
  // The Properties panel's "Layer image" input (the photo this frame shows).
  const layerImage = studio(page).getByText("Layer image (optional)", { exact: true }).locator("xpath=..");
  await layerImage.locator('input[type="file"]').setInputFiles({ name: "crop.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
  await expect(studio(page).locator(`[data-layer-id="${id}"] image`).first()).toBeAttached();
  return id;
}

const drawBox = (page: Page, id: string) =>
  page.evaluate((layerId) => {
    const image = document.querySelector(`[data-admin-customizer] [data-canvas-surface] [data-layer-id="${layerId}"] image`);
    return { x: Number(image?.getAttribute("x")), y: Number(image?.getAttribute("y")), width: Number(image?.getAttribute("width")) };
  }, id);

async function enterCrop(page: Page, id: string) {
  const point = await bodyPoint(page, id);
  await page.mouse.dblclick(point.x, point.y);
  await expect(surface(page)).toBeVisible();
}

async function pan(page: Page, dx: number, dy: number) {
  const box = (await surface(page).boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) await page.mouse.move(from.x + (dx * step) / 12, from.y + (dy * step) / 12);
  await page.mouse.up();
}

test.describe("admin crop", () => {
  test("Cancel restores exactly; Done keeps the new framing as one undo step", async ({ page }) => {
    const id = await openStudioWithPhoto(page);
    const original = await drawBox(page, id);

    await enterCrop(page, id);
    await pan(page, 60, 0);
    await expect.poll(async () => (await drawBox(page, id)).x).toBeGreaterThan(original.x);
    await bar(page).getByRole("button", { name: "Cancel" }).click();
    await expect(surface(page)).toHaveCount(0);
    expect(await drawBox(page, id)).toEqual(original);

    await enterCrop(page, id);
    await pan(page, 60, 0);
    await bar(page).getByRole("button", { name: "Done" }).click();
    await expect(surface(page)).toHaveCount(0);
    const cropped = await drawBox(page, id);
    expect(cropped.x).toBeGreaterThan(original.x);

    await page.keyboard.press("Control+z");
    await expect.poll(() => drawBox(page, id)).toEqual(original);
    await page.keyboard.press("Control+y");
    await expect.poll(() => drawBox(page, id)).toEqual(cropped);
  });

  test("Escape cancels, Enter is Done, and zoom follows the slider", async ({ page }) => {
    const id = await openStudioWithPhoto(page);
    const original = await drawBox(page, id);

    await enterCrop(page, id);
    await pan(page, 0, 40);
    await page.keyboard.press("Escape");
    await expect(surface(page)).toHaveCount(0);
    expect(await drawBox(page, id)).toEqual(original);
    // Escape ended crop only: the photo is still there and still selected.
    expect(await selectedIds(page)).toEqual([id]);

    await enterCrop(page, id);
    const zoom = bar(page).getByRole("textbox", { name: "Zoom photo" }).or(bar(page).getByRole("spinbutton", { name: "Zoom photo" })).first();
    await zoom.fill("200");
    await zoom.press("Tab");
    await expect.poll(async () => (await drawBox(page, id)).width).toBeCloseTo(original.width * 2, 0);
    // Enter on a crop-bar control acts on that control; back on the photo it is Done.
    await surface(page).click();
    await page.keyboard.press("Enter");
    await expect(surface(page)).toHaveCount(0);
    expect((await drawBox(page, id)).width).toBeCloseTo(original.width * 2, 0);
  });

  test("keys that would edit the document underneath are held while cropping", async ({ page }) => {
    const id = await openStudioWithPhoto(page);
    await enterCrop(page, id);
    await page.keyboard.press("Delete");
    await expect(studio(page).locator(`[data-layer-id="${id}"]`).first()).toBeAttached();
    const before = await drawBox(page, id);
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await drawBox(page, id)).x).toBeCloseTo(before.x + 1, 5);
    await page.keyboard.press("Escape");
  });
});
