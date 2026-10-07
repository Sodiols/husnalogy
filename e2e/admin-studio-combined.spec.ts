/**
 * Design Studio: orientation controls, Crop button and multi-selection drag,
 * used together (Admin Problems 1–3, final regression scenarios).
 *
 * Every scenario ends with save → reload → reopen, and the reopened design must
 * be exactly what was saved.
 */
import { expect, test, type Page } from "@playwright/test";
import { addStudioFrame, addStudioText } from "./admin-studio-tools";
import { bodyPoint, selectedIds } from "./customizer-fixture";

const PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100" height="200" fill="#ff0000"/><rect x="100" width="100" height="200" fill="#0000ff"/></svg>')}`;
const TITLE = "Minimal Thank You Card";

function design(widthIn: number, heightIn: number) {
  const widthPx = Math.round(widthIn * 300);
  const heightPx = Math.round(heightIn * 300);
  const k = widthPx / 1500;
  const text = (id: string, label: string, x: number, y: number) => ({ id, page: "front", type: "text", text: label, x: x * k, y: y * k, width: 380 * k, height: 90 * k, textStyle: { fontFamily: "Inter", fontSize: Math.round(54 * k), autoSizeMode: "fixed" } });
  return {
    enabled: true, cardWidthIn: widthIn, cardHeightIn: heightIn, dpi: 300, canvasWidthPx: widthPx, canvasHeightPx: heightPx,
    pages: [{ id: "front", label: "Front", enabled: true }], defaultPage: "front", fields: [], guides: [],
    layers: [
      { ...text("t_1", "First", 400, 350), zIndex: 1 },
      { ...text("t_2", "Second", 1000, 350), zIndex: 2 },
      { id: "i_1", page: "front", type: "image", src: PHOTO, x: 400 * k, y: 900 * k, width: 360 * k, height: 360 * k, zIndex: 3 },
      { id: "i_2", page: "front", type: "image", src: PHOTO, x: 1000 * k, y: 900 * k, width: 360 * k, height: 280 * k, rotation: 15, zIndex: 4 },
    ],
  };
}

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const header = (page: Page) => studio(page).locator("header");

async function seedAndOpen(page: Page, template: Record<string, unknown> | null) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__e2e/admin-dashboard?section=Products");
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  if (template) {
    await page.evaluate(({ name, value }) => {
      const products = (window as any).__adminFixture.store.products.map((entry: any) => (entry.title === name ? { ...entry, customizerTemplate: value } : entry));
      window.sessionStorage.setItem("__adminFixtureDurable", JSON.stringify({ products, versions: {} }));
    }, { name: TITLE, value: template });
    await page.reload();
    await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  }
  await page.getByRole("button", { name: `Edit ${TITLE}` }).first().click();
  await page.getByRole("button", { name: "Open Design Studio" }).click();
  await expect(header(page)).toBeVisible();
  await expect(studio(page).locator('[data-canvas-surface] [data-layer-id="i_1"] image').first()).toBeAttached();
}

async function select(page: Page, ids: string[]) {
  const first = await bodyPoint(page, ids[0]);
  await page.mouse.click(first.x, first.y);
  await page.waitForTimeout(450);
  if (ids.length > 1) {
    await page.keyboard.down("Shift");
    for (const id of ids.slice(1)) {
      const point = await bodyPoint(page, id);
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(450);
    }
    await page.keyboard.up("Shift");
  }
  await expect.poll(async () => (await selectedIds(page)).sort()).toEqual(ids.slice().sort());
}

async function drag(page: Page, fromId: string, dx: number, dy: number) {
  const start = await bodyPoint(page, fromId);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) await page.mouse.move(start.x + (dx * step) / 12, start.y + (dy * step) / 12);
  await page.mouse.up();
  await page.waitForTimeout(450);
}

async function crop(page: Page, id: string, dx: number) {
  await select(page, [id]);
  await page.locator("[data-admin-text-toolbar]").getByRole("button", { name: "Crop photo" }).click();
  const surface = page.getByRole("application", { name: /Crop photo/ });
  await expect(surface).toBeVisible();
  const box = (await surface.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) await page.mouse.move(box.x + box.width / 2 + (dx * step) / 8, box.y + box.height / 2);
  await page.mouse.up();
  await page.locator("[data-admin-crop-bar]").getByRole("button", { name: "Done" }).click();
  await expect(surface).toHaveCount(0);
  await page.waitForTimeout(450);
}

async function orient(page: Page, label: "Vertical" | "Horizontal") {
  await studio(page).getByRole("radiogroup", { name: "Artboard orientation" }).getByRole("radio", { name: label }).click();
  await expect(studio(page).getByRole("radiogroup", { name: "Artboard orientation" }).getByRole("radio", { name: label })).toHaveAttribute("aria-checked", "true");
}

/** Everything the canvas draws for the design: artboard + each layer's drawn box and in-frame transform. */
const snapshot = (page: Page) =>
  page.evaluate(() => {
    const surface = document.querySelector("[data-admin-customizer] [data-canvas-surface] svg")!;
    const layers = [...surface.querySelectorAll("[data-layer-id]")].map((group) => {
      const element = group.querySelector("image, tspan, text, rect, ellipse");
      return [group.getAttribute("data-layer-id"), group.getAttribute("transform") || "", ...["x", "y", "width", "height"].map((name) => element?.getAttribute(name) || ""), element?.parentElement?.getAttribute("transform") || ""].join("|");
    });
    return { viewBox: surface.getAttribute("viewBox"), layers };
  });

async function save(page: Page) {
  await header(page).getByRole("button", { name: /Save Draft/ }).click();
  await expect(header(page).getByText("Unsaved", { exact: true })).toHaveCount(0, { timeout: 15_000 });
}

/**
 * Distances between the selected objects' centres — unchanged by any drag. Read
 * from the objects' geometry (their hit proxies), not from the drawn artwork:
 * a cropped photo's unclipped image legitimately extends past its frame.
 */
const spacing = (page: Page, ids: string[]) =>
  page.evaluate((layerIds) => {
    const stage = (window as any).Konva.stages.find((candidate: any) => candidate.findOne("Transformer"));
    const centres = layerIds.map((id) => {
      const rect = stage.findOne((node: any) => node.name?.() === id).getClientRect();
      return [rect.x + rect.width / 2, rect.y + rect.height / 2];
    });
    // `+ 0` folds a rounded -0 into 0.
    return centres.slice(1).map((centre) => [Math.round(centre[0] - centres[0][0]) + 0, Math.round(centre[1] - centres[0][1]) + 0]);
  }, ids);

test.describe("Design Studio: orientation, crop and multi-drag together", () => {
  test("scenario 1: drag, orientation, drag, crop, drag, undo and redo, save and reload", async ({ page }) => {
    await seedAndOpen(page, design(5, 7));
    const all = ["t_1", "t_2", "i_1", "i_2"];
    await select(page, all);
    const rigid = await spacing(page, all);
    await drag(page, "i_1", 60, 40);
    await drag(page, "i_1", -30, 50);
    expect(await spacing(page, all)).toEqual(rigid);

    await orient(page, "Horizontal");
    await select(page, all);
    const landscapeRigid = await spacing(page, all);
    await drag(page, "t_1", 50, -20);
    expect(await spacing(page, all)).toEqual(landscapeRigid);

    await crop(page, "i_2", 40);
    await select(page, all);
    await drag(page, "i_1", -40, 30);
    expect(await spacing(page, all)).toEqual(landscapeRigid);
    const finalState = await snapshot(page);

    // Undo the drag, the crop and the previous drag; redo all three.
    const states = [finalState];
    for (let index = 0; index < 3; index += 1) {
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(200);
      states.push(await snapshot(page));
    }
    expect(new Set(states.map((state) => JSON.stringify(state))).size).toBe(4);
    for (let index = 2; index >= 0; index -= 1) {
      await page.keyboard.press("Control+y");
      await expect.poll(() => snapshot(page)).toEqual(states[index]);
    }

    await save(page);
    await page.reload();
    await seedAndOpen(page, null);
    await expect.poll(() => snapshot(page)).toEqual(finalState);
  });

  test("scenario 2: 5 × 7 → Horizontal, drag, crop, save, reload, back to Vertical", async ({ page }) => {
    await seedAndOpen(page, design(5, 7));
    await orient(page, "Horizontal");
    expect((await snapshot(page)).viewBox).toBe("0 0 2100 1500");
    const ids = ["t_1", "i_1", "i_2"];
    await select(page, ids);
    const rigid = await spacing(page, ids);
    await drag(page, "t_1", 70, 30);
    expect(await spacing(page, ids)).toEqual(rigid);
    await crop(page, "i_1", -50);
    await save(page);
    const saved = await snapshot(page);
    await page.reload();
    await seedAndOpen(page, null);
    await expect.poll(() => snapshot(page)).toEqual(saved);
    await orient(page, "Vertical");
    expect((await snapshot(page)).viewBox).toBe("0 0 1500 2100");
    expect((await snapshot(page)).layers).toHaveLength(saved.layers.length);
  });

  test("scenario 3: 3.5 × 5 → Horizontal, add text and a photo, drag, crop, undo, redo, save and reload", async ({ page }) => {
    await page.route("**/api/admin/customizer/assets", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ json: { ok: true, asset: { id: "asset-s3", url: PHOTO, editorUrl: PHOTO, bucket: "admin", originalPath: "admin/s3.svg", editorPath: "admin/s3.svg", thumbnailPath: "admin/s3.svg", originalFilename: "s3.svg" } } })
        : route.continue(),
    );
    await seedAndOpen(page, design(3.5, 5));
    expect((await snapshot(page)).viewBox).toBe("0 0 1050 1500");
    await orient(page, "Horizontal");
    expect((await snapshot(page)).viewBox).toBe("0 0 1500 1050");

    // A new text and a new photo.
    await addStudioText(page);
    await expect(page.locator('[aria-label="Edit text on canvas"]')).toBeVisible();
    await page.keyboard.type("Added");
    await page.keyboard.press("Control+Enter");
    let textId = "";
    await expect.poll(async () => (textId = (await selectedIds(page))[0] || "")).not.toBe("");
    for (let index = 0; index < 6; index += 1) await page.keyboard.press("Shift+ArrowUp");
    await addStudioFrame(page);
    let photoId = "";
    await expect.poll(async () => (photoId = (await selectedIds(page)).find((id) => id !== textId) || "")).not.toBe("");
    for (let index = 0; index < 14; index += 1) await page.keyboard.press("Shift+ArrowDown");
    await studio(page).getByText("Layer image (optional)", { exact: true }).locator("xpath=..").locator('input[type="file"]').setInputFiles({ name: "s3.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
    await expect(studio(page).locator(`[data-canvas-surface] [data-layer-id="${photoId}"] image`).first()).toBeAttached();
    await page.waitForTimeout(450);

    const ids = [textId, photoId, "t_2"];
    await select(page, ids);
    const rigid = await spacing(page, ids);
    await drag(page, photoId, 40, -30);
    expect(await spacing(page, ids)).toEqual(rigid);
    await crop(page, photoId, 30);
    const cropped = await snapshot(page);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => JSON.stringify(await snapshot(page))).not.toBe(JSON.stringify(cropped));
    await page.keyboard.press("Control+y");
    await expect.poll(() => snapshot(page)).toEqual(cropped);

    await save(page);
    await page.reload();
    await seedAndOpen(page, null);
    await expect.poll(() => snapshot(page)).toEqual(cropped);
  });
});
