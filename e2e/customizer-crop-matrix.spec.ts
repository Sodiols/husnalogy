/**
 * Crop reliability matrix (Customizer Point 8).
 *
 * Complements customizer-interaction-contract.spec.ts (gesture pan/zoom,
 * history and autosave races) with every TOOLBAR crop action: zoom, rotate,
 * rotate 90°, flip, reset — and their Cancel / Done / Undo / Redo / refresh
 * behaviour, frames, zoom levels and touch layouts.
 *
 * "Exactly as before" is checked on two levels: the drawn image markup and the
 * persisted `imageTransform`.
 */
import { expect, test, type Page } from "@playwright/test";
import { bodyPoint, canvasLayer, centreOf, drag, enterCrop, openFixture, readDraft, selectLayer, waitForEditor } from "./customizer-fixture";

const PHOTO = "fx_photo_crop";

const drawn = (page: Page, layerId: string) =>
  page.evaluate((id) => document.querySelector(`[data-customizer-canvas="main"] [data-layer-id="${id}"]`)?.innerHTML || "", layerId);

const savedTransform = async (page: Page, layerId = PHOTO) => {
  const draft = await readDraft(page);
  const editorState = draft?.renderData?.editorState || {};
  const user = (editorState.userLayers || []).find((layer: any) => layer.id === layerId);
  return (user ? user.imageTransform : editorState.layerOverrides?.[layerId]?.imageTransform) || {};
};

const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Crop photo" });
const cropSurface = (page: Page) => page.getByRole("application", { name: /crop photo/i });

async function stepper(page: Page, label: string, value: string) {
  const input = toolbar(page).locator(`input[aria-label="${label}"]`);
  await input.fill(value);
  await input.press("Enter");
  await page.waitForTimeout(150);
}

async function pan(page: Page, dx: number, dy: number) {
  const from = await centreOf(cropSurface(page));
  await drag(page, from, { x: from.x + dx, y: from.y + dy }, 16);
  await page.waitForTimeout(400);
}

const done = (page: Page) => toolbar(page).getByRole("button", { name: "Done", exact: true }).click();
const cancel = (page: Page) => toolbar(page).getByRole("button", { name: "Cancel", exact: true }).click();

test.use({ viewport: { width: 1440, height: 900 } });

test.describe("crop matrix", () => {
  test.beforeEach(async ({ page }) => {
    await openFixture(page, "?snap=0&autosave=1");
  });

  test("open crop and Cancel without touching anything changes nothing", async ({ page }) => {
    const before = await drawn(page, PHOTO);
    await enterCrop(page, PHOTO);
    await cancel(page);
    await expect(cropSurface(page)).toHaveCount(0);
    expect(await drawn(page, PHOTO)).toBe(before);
    await expect(page.getByRole("button", { name: /^Undo/ }).first()).toBeDisabled();
  });

  test("EVERY crop control, then Cancel: the image returns exactly to its state before crop opened", async ({ page }) => {
    const before = await drawn(page, PHOTO);
    const savedBefore = await savedTransform(page);
    await enterCrop(page, PHOTO);
    await pan(page, 60, -30);
    await stepper(page, "Zoom photo", "180");
    await stepper(page, "Image rotation", "17");
    await toolbar(page).getByRole("button", { name: "Rotate photo 90°" }).click();
    await toolbar(page).getByRole("button", { name: "Flip horizontally" }).click();
    await toolbar(page).getByRole("button", { name: "Flip vertically" }).click();
    await stepper(page, "Crop X position", "45");
    expect(await drawn(page, PHOTO)).not.toBe(before);

    await cancel(page);
    await expect(cropSurface(page)).toHaveCount(0);
    expect(await drawn(page, PHOTO)).toBe(before);
    // Nothing from the session may persist — not even after autosave settles.
    await page.waitForTimeout(2500);
    expect(await savedTransform(page)).toEqual(savedBefore);
    await page.reload();
    await waitForEditor(page);
    expect(await drawn(page, PHOTO)).toBe(before);
  });

  test("EVERY crop control, then Done: the complete crop persists and a refresh restores it exactly", async ({ page }) => {
    await enterCrop(page, PHOTO);
    await pan(page, 50, 20);
    await stepper(page, "Zoom photo", "160");
    await stepper(page, "Image rotation", "12");
    await toolbar(page).getByRole("button", { name: "Rotate photo 90°" }).click();
    await toolbar(page).getByRole("button", { name: "Flip horizontally" }).click();
    await done(page);
    await expect(cropSurface(page)).toHaveCount(0);
    const after = await drawn(page, PHOTO);
    await expect.poll(async () => (await savedTransform(page)).zoom).toBe(1.6);
    const saved = await savedTransform(page);
    expect(saved).toMatchObject({ zoom: 1.6, rotation: 102, flipX: true });
    expect(Number(saved.offsetX)).not.toBe(0);

    await page.reload();
    await waitForEditor(page);
    expect(await drawn(page, PHOTO)).toBe(after);
    expect(await savedTransform(page)).toEqual(saved);
  });

  test("Reset returns the photo to its untouched crop; Done keeps the reset", async ({ page }) => {
    const before = await drawn(page, PHOTO);
    await enterCrop(page, PHOTO);
    await stepper(page, "Zoom photo", "220");
    await toolbar(page).getByRole("button", { name: "Flip vertically" }).click();
    await pan(page, 40, 40);
    await toolbar(page).getByRole("button", { name: "Reset crop" }).click();
    await done(page);
    expect(await drawn(page, PHOTO)).toBe(before);
  });

  test("Done, then one Undo returns the pre-crop image; Redo brings the crop back", async ({ page }) => {
    const before = await drawn(page, PHOTO);
    await enterCrop(page, PHOTO);
    await toolbar(page).getByRole("button", { name: "Rotate photo 90°" }).click();
    await toolbar(page).getByRole("button", { name: "Flip horizontally" }).click();
    await done(page);
    const after = await drawn(page, PHOTO);
    // The confirmed session is ONE step, however many controls it used.
    await page.keyboard.press("Control+z");
    await expect.poll(() => drawn(page, PHOTO)).toBe(before);
    await page.keyboard.press("Control+y");
    await expect.poll(() => drawn(page, PHOTO)).toBe(after);
    await page.keyboard.press("Control+z");
    await expect.poll(() => drawn(page, PHOTO)).toBe(before);
  });

  test("rapid crop changes settle on the last value and save it", async ({ page }) => {
    await enterCrop(page, PHOTO);
    for (const value of ["120", "140", "160", "180", "200"]) await stepper(page, "Zoom photo", value);
    for (let index = 0; index < 4; index += 1) await toolbar(page).getByRole("button", { name: "Rotate photo 90°" }).click();
    await done(page);
    await expect.poll(async () => (await savedTransform(page)).zoom).toBe(2);
    expect(Number((await savedTransform(page)).rotation) % 360).toBe(0);
  });

  test("a held crop pan never reaches the saved draft before it is released", async ({ page }) => {
    const savedBefore = await savedTransform(page);
    await enterCrop(page, PHOTO);
    const from = await centreOf(cropSurface(page));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) await page.mouse.move(from.x + step * 6, from.y);
    await page.waitForTimeout(2500);
    expect(await savedTransform(page)).toEqual(savedBefore);
    await page.mouse.up();
    await cancel(page);
    await page.waitForTimeout(1500);
    expect(await savedTransform(page)).toEqual(savedBefore);
  });

  test("a frame crops the same way: Done persists through a refresh, Cancel restores", async ({ page }) => {
    const before = await drawn(page, "fx_frame");
    await selectLayer(page, "fx_frame");
    const point = await bodyPoint(page, "fx_frame");
    await page.mouse.dblclick(point.x, point.y);
    await expect(cropSurface(page)).toBeVisible();
    await toolbar(page).getByRole("button", { name: "Flip horizontally" }).click();
    await cancel(page);
    expect(await drawn(page, "fx_frame")).toBe(before);

    await page.mouse.dblclick(point.x, point.y);
    await expect(cropSurface(page)).toBeVisible();
    await stepper(page, "Zoom photo", "150");
    await done(page);
    const after = await drawn(page, "fx_frame");
    expect(after).not.toBe(before);
    await page.waitForTimeout(1500);
    await page.reload();
    await waitForEditor(page);
    expect(await drawn(page, "fx_frame")).toBe(after);
  });

  test("a grid slot crops the same way: Cancel restores the slot, Done persists through a refresh", async ({ page }) => {
    // Grid slots have their own toolbar; it drives the same crop session.
    const gridZoom = async (value: string) => {
      const input = page.locator('input[aria-label="Grid photo zoom"]');
      await input.fill(value);
      await input.press("Enter");
      await page.waitForTimeout(150);
    };
    const gridButton = (name: string) => page.locator("[data-customer-toolbar-dock]").getByRole("button", { name, exact: true });
    const openSlotCrop = async () => {
      await selectLayer(page, "fx_grid");
      const point = await bodyPoint(page, "fx_grid");
      await page.mouse.dblclick(point.x, point.y);
      await page.getByRole("button", { name: "Crop", exact: true }).first().click();
      await expect(page.getByRole("application", { name: /crop grid photo/i })).toBeVisible();
    };
    const before = await drawn(page, "fx_grid");
    await openSlotCrop();
    await gridZoom("190");
    await page.getByRole("button", { name: "Flip photo horizontally" }).click();
    await gridButton("Cancel").click();
    expect(await drawn(page, "fx_grid")).toBe(before);

    await openSlotCrop();
    await gridZoom("170");
    await gridButton("Done").click();
    const after = await drawn(page, "fx_grid");
    expect(after).not.toBe(before);
    await page.waitForTimeout(1500);
    await page.reload();
    await waitForEditor(page);
    expect(await drawn(page, "fx_grid")).toBe(after);
  });

  test("a crop pan at 200% canvas zoom moves the photo by the pointer delta in document units", async ({ page }) => {
    const zoom = page.getByRole("textbox", { name: /zoom/i }).first();
    await zoom.fill("200");
    await zoom.press("Enter");
    await page.waitForTimeout(500);
    await canvasLayer(page, PHOTO).scrollIntoViewIfNeeded();
    await enterCrop(page, PHOTO);
    const scale = await page.evaluate(() => (window as any).Konva.stages.find((stage: any) => stage.findOne("Transformer")).scaleX());
    await pan(page, 40, 0);
    await done(page);
    await expect.poll(async () => Number((await savedTransform(page)).offsetX)).toBeCloseTo(40 / scale, 0);
  });
});

test.describe("crop on a phone", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test("the crop toolbar works by touch, and Cancel still restores exactly", async ({ page }) => {
    await openFixture(page, "?snap=0");
    const before = await drawn(page, PHOTO);
    const point = await bodyPoint(page, PHOTO);
    await page.touchscreen.tap(point.x, point.y);
    await page.getByRole("toolbar", { name: "Photo options" }).getByRole("button", { name: "Crop" }).tap();
    await expect(cropSurface(page)).toBeVisible();
    await toolbar(page).getByRole("button", { name: "Rotate photo 90°" }).tap();
    expect(await drawn(page, PHOTO)).not.toBe(before);
    await toolbar(page).getByRole("button", { name: "Cancel", exact: true }).tap();
    expect(await drawn(page, PHOTO)).toBe(before);
  });
});
