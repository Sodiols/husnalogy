/**
 * Design Studio: a visible Crop button (Admin Problem 2).
 *
 * The selection toolbar's Crop button, the object menu's Crop photo and
 * double-clicking all enter the SAME crop session (AdminCanvas beginCrop),
 * whose bar is the customer editor's crop toolbar. Cancel restores the photo
 * exactly; Done writes once — one undo step — and survives save and reload.
 */
import { expect, test, type Page } from "@playwright/test";
import { anchorPoint, bodyPoint, selectedIds } from "./customizer-fixture";
import { orientationChoices } from "./admin-studio-tools";

const PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100" height="200" fill="#ff0000"/><rect x="100" width="100" height="200" fill="#0000ff"/></svg>',
)}`;
const TITLE = "Minimal Thank You Card";

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const header = (page: Page) => studio(page).locator("header");
const toolbar = (page: Page) => page.locator("[data-admin-text-toolbar]");
const cropButton = (page: Page) => toolbar(page).getByRole("button", { name: "Crop photo" });
const cropSurface = (page: Page) => page.getByRole("application", { name: /Crop photo/ });
const cropBar = (page: Page) => page.locator("[data-admin-crop-bar]");

const TEMPLATE = {
  enabled: true,
  cardWidthIn: 5,
  cardHeightIn: 7,
  dpi: 300,
  canvasWidthPx: 1500,
  canvasHeightPx: 2100,
  pages: [{ id: "front", label: "Front", enabled: true }],
  defaultPage: "front",
  fields: [],
  guides: [],
  layers: [
    { id: "i_photo", page: "front", type: "image", src: PHOTO, x: 400, y: 400, width: 400, height: 400, zIndex: 1 },
    { id: "f_frame", page: "front", type: "frame", src: PHOTO, x: 1100, y: 400, width: 400, height: 400, zIndex: 2, mask: { kind: "rounded", radius: 40 }, maskShape: "rounded" },
    { id: "m_clip", page: "front", type: "image", src: PHOTO, x: 400, y: 1000, width: 400, height: 300, zIndex: 3, mask: { kind: "oval" }, maskShape: "oval" },
    { id: "t_text", page: "front", type: "text", text: "Hello", x: 1100, y: 1000, width: 500, height: 100, zIndex: 4, textStyle: { fontFamily: "Inter", fontSize: 60, autoSizeMode: "fixed" } },
    { id: "s_shape", page: "front", type: "shape", shape: "rectangle", x: 400, y: 1500, width: 300, height: 200, zIndex: 5, fill: "#d4af37" },
    { id: "l_line", page: "front", type: "shape", shape: "line", x: 1100, y: 1450, width: 500, height: 6, zIndex: 6, stroke: "#303839", strokeWidth: 6 },
    { id: "q_code", page: "front", type: "qrCode", value: "https://example.com", x: 1100, y: 1700, width: 200, height: 200, zIndex: 7 },
    { id: "f_empty", page: "front", type: "frame", src: "", x: 400, y: 1850, width: 300, height: 300, zIndex: 8 },
    { id: "g_grid", page: "front", type: "grid", columns: 2, rows: 1, x: 1100, y: 1950, width: 400, height: 200, zIndex: 9, slots: [{ id: "slot_1", src: PHOTO }, { id: "slot_2", src: PHOTO }] },
  ],
};

/**
 * Seed a product's design through the mock server's durable store and reload,
 * so the dashboard's first product fetch already returns it (writing the store
 * after the list has loaded would race the dashboard's own copy).
 */
async function seedDesign(page: Page, title: string, template: Record<string, unknown>) {
  await page.evaluate(({ name, value }) => {
    const products = (window as any).__adminFixture.store.products.map((entry: any) => (entry.title === name ? { ...entry, customizerTemplate: value } : entry));
    window.sessionStorage.setItem("__adminFixtureDurable", JSON.stringify({ products, versions: {} }));
  }, { name: title, value: template });
  await page.reload();
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
}

async function openStudio(page: Page, seed = true) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__e2e/admin-dashboard?section=Products");
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  if (seed) await seedDesign(page, TITLE, TEMPLATE);
  await page.getByRole("button", { name: `Edit ${TITLE}` }).first().click();
  const enable = page.getByRole("switch", { name: /Enable product customizer/ });
  // The form renders after the click that opened it: wait for the switch (or a
  // studio that is already enabled) instead of checking visibility once.
  await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
  if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
  await page.getByRole("button", { name: "Open Design Studio" }).click();
  await expect(header(page)).toBeVisible();
  await expect(studio(page).locator('[data-canvas-surface] [data-layer-id="i_photo"] image').first()).toBeAttached();
}

async function select(page: Page, id: string) {
  const point = await bodyPoint(page, id);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => selectedIds(page)).toEqual([id]);
  // Past the double-click window, so the next press on it is a fresh click.
  await page.waitForTimeout(450);
}

/** Everything that decides where the photo is drawn: its box and its in-frame transform. */
const drawn = (page: Page, id: string) =>
  page.evaluate((layerId) => {
    const group = document.querySelector(`[data-admin-customizer] [data-canvas-surface] [data-layer-id="${layerId}"]`);
    const image = group?.querySelector("image");
    return {
      box: ["x", "y", "width", "height"].map((name) => Number(image?.getAttribute(name))),
      inner: image?.parentElement?.getAttribute("transform") || "",
    };
  }, id);

async function pan(page: Page, dx: number, dy: number) {
  const box = (await cropSurface(page).boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(from.x + (dx * step) / 10, from.y + (dy * step) / 10);
  await page.mouse.up();
}

async function setZoom(page: Page, percent: number) {
  const field = cropBar(page).getByRole("textbox", { name: "Zoom photo" }).or(cropBar(page).getByRole("spinbutton", { name: "Zoom photo" })).first();
  await field.fill(String(percent));
  await field.press("Tab");
}

async function savedTemplate(page: Page) {
  const before = await page.evaluate(() => (window as any).__adminFixture.requests.length);
  await header(page).getByRole("button", { name: /Save Draft/ }).click();
  await expect.poll(() => page.evaluate((count) => (window as any).__adminFixture.requests.length > count, before)).toBe(true);
  await expect(header(page).getByText("Unsaved", { exact: true })).toHaveCount(0, { timeout: 15_000 });
  return page.evaluate(() => {
    const saves = (window as any).__adminFixture.requests.filter((entry: any) => /^\/api\/admin\/products(\/[^/]+)?$/.test(entry.path));
    return saves[saves.length - 1].body.customizerTemplate;
  });
}

test.describe("admin Crop button", () => {
  test("shown only for one photo that can be cropped", async ({ page }) => {
    await openStudio(page);
    for (const id of ["i_photo", "f_frame", "m_clip"]) {
      await select(page, id);
      await expect(cropButton(page), id).toBeVisible();
    }
    for (const id of ["t_text", "s_shape", "l_line", "q_code", "f_empty", "g_grid"]) {
      await select(page, id);
      await expect(cropButton(page), id).toHaveCount(0);
    }
    await select(page, "i_photo");
    const frame = await bodyPoint(page, "f_frame");
    await page.keyboard.down("Shift");
    await page.mouse.click(frame.x, frame.y);
    await page.keyboard.up("Shift");
    await expect.poll(async () => (await selectedIds(page)).length).toBe(2);
    await expect(cropButton(page)).toHaveCount(0);
  });

  test("the button, the object menu and double-click all open the same crop mode", async ({ page }) => {
    await openStudio(page);
    await select(page, "i_photo");
    await cropButton(page).click();
    await expect(cropSurface(page)).toBeVisible();
    await expect(cropBar(page).getByRole("toolbar", { name: "Crop photo" })).toBeVisible();
    await cropBar(page).getByRole("button", { name: "Cancel" }).click();
    await expect(cropSurface(page)).toHaveCount(0);

    const point = await bodyPoint(page, "f_frame");
    await page.mouse.click(point.x, point.y, { button: "right" });
    await page.getByRole("menu", { name: "Object actions" }).getByRole("menuitem", { name: "Crop photo", exact: true }).click();
    await expect(cropSurface(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(cropSurface(page)).toHaveCount(0);

    await page.waitForTimeout(450);
    const clip = await bodyPoint(page, "m_clip");
    await page.mouse.dblclick(clip.x, clip.y);
    await expect(cropSurface(page)).toBeVisible();
    await cropBar(page).getByRole("button", { name: "Cancel" }).click();
  });

  test("Cancel after moving, zooming, rotating and flipping restores the photo exactly", async ({ page }) => {
    await openStudio(page);
    for (const id of ["i_photo", "f_frame", "m_clip"]) {
      await select(page, id);
      const before = await drawn(page, id);
      await cropButton(page).click();
      await pan(page, 50, -30);
      await setZoom(page, 180);
      await cropBar(page).getByRole("button", { name: "Rotate photo 90°" }).click();
      await cropBar(page).getByRole("button", { name: "Flip horizontally" }).click();
      await expect.poll(() => drawn(page, id)).not.toEqual(before);
      await cropBar(page).getByRole("button", { name: "Cancel" }).click();
      await expect(cropSurface(page)).toHaveCount(0);
      expect(await drawn(page, id), id).toEqual(before);
    }
    // Nothing from the abandoned crops reached the document.
    const saved = await savedTemplate(page);
    for (const layer of saved.layers.filter((entry: any) => ["i_photo", "f_frame", "m_clip"].includes(entry.id))) {
      // The seeded photos start uncropped, and so they must still be.
      expect(layer.imageTransform ?? {}, layer.id).toEqual({});
    }
  });

  test("Done keeps the crop as one undo step; save and reload keep it identical", async ({ page }) => {
    await openStudio(page);
    await select(page, "i_photo");
    const original = await drawn(page, "i_photo");
    await cropButton(page).click();
    await pan(page, 60, 20);
    await setZoom(page, 160);
    await cropBar(page).getByRole("button", { name: "Flip vertically" }).click();
    await cropBar(page).getByRole("button", { name: "Done" }).click();
    await expect(cropSurface(page)).toHaveCount(0);
    const cropped = await drawn(page, "i_photo");
    expect(cropped).not.toEqual(original);

    // One crop session is ONE undo step.
    await page.keyboard.press("Control+z");
    await expect.poll(() => drawn(page, "i_photo")).toEqual(original);
    await page.keyboard.press("Control+y");
    await expect.poll(() => drawn(page, "i_photo")).toEqual(cropped);

    const saved = (await savedTemplate(page)).layers.find((layer: any) => layer.id === "i_photo");
    expect(saved.imageTransform).toMatchObject({ zoom: 1.6, flipY: true });
    expect(saved.imageTransform.offsetX).not.toBe(0);

    await page.reload();
    await openStudio(page, false);
    await expect.poll(() => drawn(page, "i_photo")).toEqual(cropped);
  });

  test("Reset returns the photo to its default framing", async ({ page }) => {
    await openStudio(page);
    await select(page, "i_photo");
    const original = await drawn(page, "i_photo");
    await cropButton(page).click();
    await pan(page, 40, 40);
    await setZoom(page, 220);
    await cropBar(page).getByRole("button", { name: "Reset crop" }).click();
    await expect.poll(() => drawn(page, "i_photo")).toEqual(original);
    await cropBar(page).getByRole("button", { name: "Done" }).click();
    expect(await drawn(page, "i_photo")).toEqual(original);
  });

  test("crop still works after an orientation change, a resize, a rotation and a duplicate", async ({ page }) => {
    await openStudio(page);
    const cropAndCheck = async (id: string) => {
      await select(page, id);
      const before = await drawn(page, id);
      await cropButton(page).click();
      await pan(page, 40, 0);
      await cropBar(page).getByRole("button", { name: "Done" }).click();
      await expect(cropSurface(page)).toHaveCount(0);
      expect(await drawn(page, id)).not.toEqual(before);
    };

    await (await orientationChoices(page)).getByRole("radio", { name: "Horizontal" }).click();
    await expect.poll(() => page.evaluate(() => document.querySelector("[data-admin-customizer] [data-canvas-surface] svg")?.getAttribute("viewBox"))).toBe("0 0 2100 1500");
    await cropAndCheck("i_photo");

    await select(page, "f_frame");
    const corner = await anchorPoint(page, "bottom-right");
    await page.mouse.move(corner.x, corner.y);
    await page.mouse.down();
    for (let step = 1; step <= 8; step += 1) await page.mouse.move(corner.x + step * 5, corner.y + step * 5);
    await page.mouse.up();
    await page.waitForTimeout(450);
    await cropAndCheck("f_frame");

    await select(page, "m_clip");
    const rotater = await anchorPoint(page, "rotater");
    const centre = await bodyPoint(page, "m_clip");
    await page.mouse.move(rotater.x, rotater.y);
    await page.mouse.down();
    for (let step = 1; step <= 8; step += 1) await page.mouse.move(rotater.x + ((centre.x + 200 - rotater.x) * step) / 8, rotater.y + ((centre.y - rotater.y) * step) / 8);
    await page.mouse.up();
    await page.waitForTimeout(450);
    await cropAndCheck("m_clip");

    await select(page, "i_photo");
    await page.keyboard.press("Control+d");
    let copy = "";
    await expect.poll(async () => (copy = (await selectedIds(page))[0] || "")).not.toBe("i_photo");
    const originalAfter = await drawn(page, "i_photo");
    await page.waitForTimeout(450);
    await cropButton(page).click();
    await pan(page, -40, 0);
    await cropBar(page).getByRole("button", { name: "Done" }).click();
    // Cropping the copy leaves the original alone.
    expect(await drawn(page, "i_photo")).toEqual(originalAfter);
    expect((await drawn(page, copy)).box).not.toEqual(originalAfter.box);
  });
});
