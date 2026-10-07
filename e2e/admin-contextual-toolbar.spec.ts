/**
 * Design Studio contextual toolbar (the six-reference rebuild + the Mask state).
 *
 * Runs the real studio on /__e2e/admin-dashboard, whose in-browser API mock
 * records every save. Every assertion reads either the saved template or the
 * rendered canvas, so a control that only LOOKS right fails here.
 *
 * Set SHOT_DIR to also write a screenshot of each toolbar state there.
 */
import { expect, test, type Page } from "@playwright/test";
import { bodyPoint, selectedIds } from "./customizer-fixture";

const PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="150" height="200" fill="#ff0000"/><rect x="150" width="150" height="200" fill="#0000ff"/></svg>',
)}`;
const NEW_PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#00aa00"/></svg>',
)}`;
const TITLE = "Minimal Thank You Card";

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
    { id: "i_photo", page: "front", type: "image", src: PHOTO, x: 400, y: 400, width: 450, height: 300, zIndex: 1 },
    { id: "t_text", page: "front", type: "text", text: "Hello", x: 1100, y: 400, width: 500, height: 100, zIndex: 2, textStyle: { fontFamily: "Inter", fontSize: 60, color: "#303839", autoSizeMode: "fixed" } },
    { id: "s_circle", page: "front", type: "shape", shape: "circle", x: 400, y: 1100, width: 300, height: 300, zIndex: 3, fill: "#d4af37", stroke: "#303839", strokeWidth: 6 },
    { id: "s_rect", page: "front", type: "shape", shape: "rectangle", x: 1100, y: 1100, width: 300, height: 200, zIndex: 4, fill: "#8d6e63" },
    { id: "s_line", page: "front", type: "shape", shape: "line", x: 750, y: 1500, width: 600, height: 8, zIndex: 5, stroke: "#303839", strokeWidth: 6 },
    { id: "t_two", page: "front", type: "text", text: "Two", x: 1100, y: 1800, width: 300, height: 100, zIndex: 6, textStyle: { fontFamily: "Inter", fontSize: 50, autoSizeMode: "fixed" } },
  ],
};

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const header = (page: Page) => studio(page).locator("header");
const toolbar = (page: Page) => page.locator("[data-admin-toolbar]");
const panel = (page: Page) => page.locator("[data-admin-alignment-panel]");

async function seedDesign(page: Page, template: Record<string, unknown>) {
  await page.evaluate(({ name, value }) => {
    const products = (window as any).__adminFixture.store.products.map((entry: any) => (entry.title === name ? { ...entry, customizerTemplate: value } : entry));
    window.sessionStorage.setItem("__adminFixtureDurable", JSON.stringify({ products, versions: {} }));
  }, { name: TITLE, value: template });
  await page.reload();
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
}

async function openStudio(page: Page, options: { seed?: boolean; template?: Record<string, unknown>; width?: number } = {}) {
  await page.setViewportSize({ width: options.width ?? 1440, height: 900 });
  // Change image uploads with XHR; answer it here so nothing leaves the browser.
  await page.route("**/api/admin/customizer/assets", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ json: { ok: true, asset: { id: "asset-new", title: "New", url: NEW_PHOTO, editorUrl: NEW_PHOTO, bucket: "customizer-assets", originalPath: "admin/new.png", editorPath: "admin/new-editor.webp", thumbnailPath: "admin/new-thumb.webp", width: 2400, height: 2400, mimeType: "image/png" } } })
      : route.fallback(),
  );
  if (options.seed !== false) {
    await page.goto("/__e2e/admin-dashboard?section=Products");
    await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
    await seedDesign(page, options.template || TEMPLATE);
  }
  await page.getByRole("button", { name: `Edit ${TITLE}` }).first().click();
  const enable = page.getByRole("switch", { name: /Enable product customizer/ });
  await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
  if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
  await page.getByRole("button", { name: "Open Design Studio" }).click();
  await expect(header(page)).toBeVisible();
  await expect(studio(page).locator('[data-canvas-surface] [data-layer-id="i_photo"] image').first()).toBeAttached();
}

async function select(page: Page, ...ids: string[]) {
  for (const [index, id] of ids.entries()) {
    const point = await bodyPoint(page, id);
    if (index > 0) await page.keyboard.down("Shift");
    await page.mouse.click(point.x, point.y);
    if (index > 0) await page.keyboard.up("Shift");
  }
  await expect.poll(async () => (await selectedIds(page)).slice().sort()).toEqual(ids.slice().sort());
  await page.waitForTimeout(450);
}

/**
 * The studio's live document: its crash-recovery copy while there are unsaved
 * changes (written ~0.4s after each change, so read it through expect.poll),
 * otherwise the last saved — or seeded — template, which it then equals.
 */
async function liveLayers(page: Page): Promise<any[]> {
  return page.evaluate((title) => {
    const key = Object.keys(window.localStorage).find((name) => name.startsWith("husnalogy_studio_draft"));
    if (key) return JSON.parse(window.localStorage.getItem(key) || "{}")?.template?.layers || [];
    const fixture = (window as any).__adminFixture;
    const saves = fixture.requests.filter((entry: any) => /^\/api\/admin\/products(\/[^/]+)?$/.test(entry.path) && entry.body?.customizerTemplate);
    if (saves.length) return saves[saves.length - 1].body.customizerTemplate.layers;
    return fixture.store.products.find((product: any) => product.title === title)?.customizerTemplate?.layers || [];
  }, TITLE);
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
const layerIn = (template: any, id: string) => template.layers.find((layer: any) => layer.id === id);

const rendered = (page: Page, id: string) =>
  page.evaluate((layerId) => {
    const group = document.querySelector(`[data-admin-customizer] [data-canvas-surface] [data-layer-id="${layerId}"]`);
    return group ? group.outerHTML : "";
  }, id);

async function shot(page: Page, name: string) {
  if (!process.env.SHOT_DIR) return;
  await toolbar(page).screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
}

async function buttonNames(page: Page) {
  return toolbar(page).evaluate((bar) =>
    [...bar.querySelectorAll("button")].filter((button) => (button as HTMLElement).offsetParent !== null).map((button) => button.getAttribute("aria-label") || button.textContent?.trim() || ""),
  );
}

test.describe("contextual toolbar states", () => {
  test("each selection gets its own toolbar, in the reference order, with nothing extra", async ({ page }) => {
    await openStudio(page);

    await select(page, "t_text");
    await expect(toolbar(page)).toHaveAttribute("data-admin-toolbar", "text");
    await expect(toolbar(page).getByRole("button", { name: "Font", exact: true })).toContainText("Font:");
    await expect(toolbar(page).getByRole("button", { name: "Font", exact: true })).toContainText("Inter");
    expect(await buttonNames(page)).toEqual([
      "Font", "Decrease Font size", "Increase Font size", "Text colour: #303839", "Bold", "Italic", "Text alignment and growth",
      "Copy", "Delete", "Scale smaller", "Scale larger", "Alignment",
    ]);
    await expect(toolbar(page).getByText("Font size", { exact: true })).toBeVisible();
    await expect(toolbar(page).getByText("Effects")).toHaveCount(0);
    // At a 1440px desktop with both side panels open, the whole bar fits: no scrolling needed.
    expect(await toolbar(page).evaluate((bar) => {
      const strip = bar.firstElementChild as HTMLElement;
      return strip.scrollWidth - strip.clientWidth;
    })).toBeLessThanOrEqual(1);
    await shot(page, "A-text");

    await select(page, "s_circle");
    await expect(toolbar(page)).toHaveAttribute("data-admin-toolbar", "shape");
    expect(await buttonNames(page)).toEqual([
      "Fill color: #d4af37", "Line color: #303839", "Decrease Line weight", "Increase Line weight",
      "Copy", "Delete", "Scale smaller", "Scale larger", "Fit", "Fill", "Alignment",
    ]);
    await shot(page, "D-shape");

    await select(page, "i_photo");
    await expect(toolbar(page)).toHaveAttribute("data-admin-toolbar", "image");
    expect(await buttonNames(page)).toEqual([
      "Change image", "Eraser", "Crop photo", "Copy", "Delete", "Scale smaller", "Scale larger", "Fit", "Fill", "Alignment",
    ]);
    await shot(page, "E-image");

    await select(page, "t_text", "s_rect");
    await expect(toolbar(page)).toHaveAttribute("data-admin-toolbar", "multi");
    expect(await buttonNames(page)).toEqual(["Copy", "Delete", "Group", "Scale smaller", "Scale larger", "Alignment"]);
    await shot(page, "F-multi");

    // Image + shape: the Mask toolbar, whichever was selected first.
    for (const order of [["i_photo", "s_circle"], ["s_circle", "i_photo"]]) {
      await page.mouse.click(5, 450);
      await select(page, ...order);
      await expect(toolbar(page)).toHaveAttribute("data-admin-toolbar", "mask");
      expect(await buttonNames(page)).toEqual(["Copy", "Delete", "Group", "Mask", "Scale smaller", "Scale larger", "Alignment"]);
    }
    await shot(page, "G-mask");

    // A photo and a line cannot clip: generic multi toolbar.
    await select(page, "i_photo", "s_line");
    await expect(toolbar(page)).toHaveAttribute("data-admin-toolbar", "multi");
  });

  test("stays one row on a narrow workspace and scrolls sideways to its last control", async ({ page }) => {
    await openStudio(page, { width: 1024 });
    await select(page, "t_text");
    const box = (await toolbar(page).boundingBox())!;
    expect(box.height).toBeLessThan(56);
    const alignment = toolbar(page).getByRole("button", { name: "Alignment", exact: true });
    await alignment.scrollIntoViewIfNeeded();
    await alignment.click();
    await expect(panel(page)).toBeVisible();
  });
});

test.describe("text toolbar", () => {
  test("font size, colour, bold, italic, alignment and growth all edit the text; each is one undo step", async ({ page }) => {
    await openStudio(page);
    await select(page, "t_text");

    // The field reads points (60 px on this 300 DPI card is 14.4 pt); + adds 1 pt.
    await toolbar(page).getByRole("button", { name: "Increase Font size" }).click();
    await expect.poll(async () => layerIn({ layers: await liveLayers(page) }, "t_text")?.textStyle?.fontSize).toBe(64.17);
    const field = toolbar(page).getByRole("textbox", { name: "Font size" }).or(toolbar(page).getByRole("spinbutton", { name: "Font size" })).first();
    await field.fill("17");
    await field.press("Enter");
    await expect.poll(async () => layerIn({ layers: await liveLayers(page) }, "t_text")?.textStyle?.fontSize).toBe(70.83);
    await toolbar(page).getByRole("button", { name: "Decrease Font size" }).click();

    await toolbar(page).getByRole("button", { name: "Bold" }).click();
    await expect(toolbar(page).getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
    await toolbar(page).getByRole("button", { name: "Italic" }).click();
    await expect(toolbar(page).getByRole("button", { name: "Italic" })).toHaveAttribute("aria-pressed", "true");

    await toolbar(page).getByRole("button", { name: /^Text colour/ }).click();
    await page.getByRole("dialog", { name: /^Text colour/ }).getByRole("button", { name: "Text colour #7A1F2B" }).click();

    await toolbar(page).getByRole("button", { name: "Text alignment and growth" }).click();
    const menu = page.locator("[data-admin-text-align-menu]");
    await menu.getByRole("radio", { name: "Align text right" }).click();
    await expect(menu.getByRole("radio", { name: "Align text right" })).toHaveAttribute("aria-checked", "true");
    await menu.getByRole("radio", { name: "Grow upward" }).click();
    await expect(menu.getByRole("radio", { name: "Grow upward" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");

    const saved = layerIn(await savedTemplate(page), "t_text");
    // 17 pt − 1 pt = 16 pt = 66.67 px.
    expect(saved.textStyle).toMatchObject({ fontSize: 66.67, fontStyle: "italic", color: "#7A1F2B", textAlign: "right", growthDirection: "up" });
    expect(Number(saved.textStyle.fontWeight)).toBeGreaterThanOrEqual(600);

    // Growth (up) and alignment (right) are single undo steps each.
    await page.mouse.click(5, 450);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => layerIn({ layers: await liveLayers(page) }, "t_text")?.textStyle?.growthDirection).not.toBe("up");
    await page.keyboard.press("Control+z");
    await expect.poll(async () => layerIn({ layers: await liveLayers(page) }, "t_text")?.textStyle?.textAlign).not.toBe("right");
    await page.keyboard.press("Control+y");
    await expect.poll(async () => layerIn({ layers: await liveLayers(page) }, "t_text")?.textStyle?.textAlign).toBe("right");
  });

  test("the font pill opens the categorised font picker", async ({ page }) => {
    await openStudio(page);
    await select(page, "t_text");
    await toolbar(page).getByRole("button", { name: "Font", exact: true }).click();
    const list = page.getByRole("listbox", { name: "Font" });
    await expect(list).toBeVisible();
    for (const category of ["All Fonts", "Serif", "Script"]) await expect(list.getByText(category, { exact: true }).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
  });

  test("Copy, paste, Delete and Scale use the shared commands", async ({ page }) => {
    await openStudio(page);
    await select(page, "t_text");
    await toolbar(page).getByRole("button", { name: "Copy" }).click();
    await expect(toolbar(page).getByRole("status")).toHaveText("Copied");
    const countBefore = (await liveLayers(page)).length || TEMPLATE.layers.length;
    await page.mouse.click(5, 450);
    await page.keyboard.press("Control+v");
    await expect.poll(async () => (await liveLayers(page)).length).toBe(countBefore + 1);

    await select(page, "t_text");
    await toolbar(page).getByRole("button", { name: "Scale larger" }).click();
    await expect.poll(async () => layerIn({ layers: await liveLayers(page) }, "t_text")?.textStyle?.fontSize).toBeCloseTo(66, 0);
    await toolbar(page).getByRole("button", { name: "Scale smaller" }).click();
    await expect.poll(async () => layerIn({ layers: await liveLayers(page) }, "t_text")?.textStyle?.fontSize).toBeCloseTo(60, 0);

    await toolbar(page).getByRole("button", { name: "Delete" }).click();
    await expect(studio(page).locator('[data-canvas-surface] [data-layer-id="t_text"]')).toHaveCount(0);
    await page.keyboard.press("Control+z");
    await expect(studio(page).locator('[data-canvas-surface] [data-layer-id="t_text"]').first()).toBeAttached();
  });
});

test.describe("shape toolbar", () => {
  test("transparent fill and line, line weight, Fit and Fill persist through save and reload", async ({ page }) => {
    await openStudio(page);
    await select(page, "s_circle");
    await toolbar(page).getByRole("button", { name: /^Fill color/ }).click();
    await page.getByRole("dialog", { name: /^Fill color/ }).getByRole("button", { name: "Transparent" }).click();
    await expect.poll(async () => await rendered(page, "s_circle")).toContain('fill="none"');
    await toolbar(page).getByRole("button", { name: /^Line color/ }).click();
    await page.getByRole("dialog", { name: /^Line color/ }).getByRole("button", { name: "Line color #D4AF37" }).click();
    await toolbar(page).getByRole("button", { name: "Increase Line weight" }).click();
    await toolbar(page).getByRole("button", { name: "Fit", exact: true }).click();
    let saved = layerIn(await savedTemplate(page), "s_circle");
    // Fit scales the circle five times over (300 → 1500), its line weight with it.
    expect(saved).toMatchObject({ fill: "none", stroke: "#D4AF37", strokeWidth: 35, x: 750, y: 1050 });
    expect(saved.width).toBeCloseTo(1500, 0);

    await toolbar(page).getByRole("button", { name: "Fill", exact: true }).click();
    saved = layerIn(await savedTemplate(page), "s_circle");
    expect(saved.width).toBeCloseTo(2100, 0);
    // Undo returns to the Fit size.
    await page.keyboard.press("Control+z");
    await expect.poll(async () => layerIn({ layers: await liveLayers(page) }, "s_circle")?.width).toBeCloseTo(1500, 0);

    await page.reload();
    await openStudio(page, { seed: false });
    const reloaded = layerIn({ layers: await liveLayers(page) }, "s_circle") || {};
    expect(await rendered(page, "s_circle")).toContain('fill="none"');
    expect(reloaded.strokeWidth ?? 35).toBe(35);
  });

  test("a line gets line colour and weight but no fill or Fit/Fill", async ({ page }) => {
    await openStudio(page);
    await select(page, "s_line");
    await expect(toolbar(page)).toHaveAttribute("data-admin-toolbar", "line");
    expect(await buttonNames(page)).toEqual(["Line color: #303839", "Decrease Line weight", "Increase Line weight", "Copy", "Delete", "Scale smaller", "Scale larger", "Alignment"]);
  });
});

test.describe("image toolbar", () => {
  test("Change image replaces the picture and keeps the frame; Fit and Fill switch its framing", async ({ page }) => {
    await openStudio(page);
    await select(page, "i_photo");
    await toolbar(page).locator("[data-admin-change-image]").setInputFiles({ name: "new.png", mimeType: "image/png", buffer: Buffer.from("png") });
    await expect.poll(async () => await rendered(page, "i_photo")).toContain("00aa00");
    await toolbar(page).getByRole("button", { name: "Fit", exact: true }).click();
    await expect(toolbar(page).getByRole("button", { name: "Fit", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => await rendered(page, "i_photo")).toContain('preserveAspectRatio="xMidYMid meet"');
    const saved = layerIn(await savedTemplate(page), "i_photo");
    expect(saved).toMatchObject({ assetId: "asset-new", originalPath: "admin/new.png", editorPath: "admin/new-editor.webp", fitMode: "contain", x: 400, y: 400, width: 450, height: 300 });
    await toolbar(page).getByRole("button", { name: "Fill", exact: true }).click();
    await expect(toolbar(page).getByRole("button", { name: "Fill", exact: true })).toHaveAttribute("aria-pressed", "true");
    // Change image + Fit + Fill: three undo steps back to the original picture.
    await page.mouse.click(5, 450);
    for (let step = 0; step < 3; step += 1) await page.keyboard.press("Control+z");
    await expect.poll(async () => await rendered(page, "i_photo")).toContain("ff0000");
  });

  test("Crop opens the existing crop session", async ({ page }) => {
    await openStudio(page);
    await select(page, "i_photo");
    await toolbar(page).getByRole("button", { name: "Crop photo" }).click();
    await expect(page.getByRole("application", { name: /Crop photo/ })).toBeVisible();
    await expect(toolbar(page)).toHaveCount(0);
    await page.locator("[data-admin-crop-bar]").getByRole("button", { name: "Cancel" }).click();
    await expect(toolbar(page)).toBeVisible();
  });
});

test.describe("eraser", () => {
  async function scrub(page: Page) {
    const surface = page.locator("[data-admin-eraser-surface]");
    await expect(surface).toBeVisible();
    const point = await page.evaluate(() => {
      const box = document.querySelector('[data-admin-customizer] [data-canvas-surface] [data-layer-id="i_photo"]')!.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width };
    });
    await page.mouse.move(point.x - point.width * 0.3, point.y);
    await page.mouse.down();
    for (let step = 1; step <= 12; step += 1) await page.mouse.move(point.x - point.width * 0.3 + (point.width * 0.6 * step) / 12, point.y);
    await page.mouse.up();
  }
  const eraserBar = (page: Page) => page.locator("[data-admin-eraser-bar]");

  test("strokes preview live, Undo/Redo step through them, Apply commits once and survives save and reload", async ({ page }) => {
    await openStudio(page);
    await select(page, "i_photo");
    await toolbar(page).getByRole("button", { name: "Eraser" }).click();
    await expect(eraserBar(page)).toBeVisible();
    await expect(toolbar(page)).toHaveCount(0);

    await scrub(page);
    await expect.poll(async () => await rendered(page, "i_photo")).toContain('data-erased="true"');
    await eraserBar(page).getByRole("button", { name: "Undo erase" }).click();
    await expect.poll(async () => await rendered(page, "i_photo")).not.toContain('data-erased="true"');
    await eraserBar(page).getByRole("button", { name: "Redo erase" }).click();
    await expect.poll(async () => await rendered(page, "i_photo")).toContain('data-erased="true"');
    // Nothing has reached the document yet.
    expect(layerIn({ layers: await liveLayers(page) }, "i_photo")?.eraseMask).toBeUndefined();

    await eraserBar(page).getByRole("button", { name: "Apply" }).click();
    await expect(eraserBar(page)).toHaveCount(0);
    const saved = layerIn(await savedTemplate(page), "i_photo");
    expect(saved.eraseMask.strokes).toHaveLength(1);
    expect(saved.eraseMask.strokes[0].points.length).toBeGreaterThan(4);
    // The picture itself is untouched.
    expect(saved.src).toBe(PHOTO);

    await page.reload();
    await openStudio(page, { seed: false });
    await expect.poll(async () => await rendered(page, "i_photo")).toContain('data-erased="true"');

    // Apply was one step: one undo brings the whole picture back.
    await select(page, "i_photo");
    await toolbar(page).getByRole("button", { name: "Eraser" }).click();
    await eraserBar(page).getByRole("button", { name: "Restore all" }).click();
    await expect.poll(async () => await rendered(page, "i_photo")).not.toContain('data-erased="true"');
    await page.keyboard.press("Enter");
    await expect(eraserBar(page)).toHaveCount(0);
    expect(layerIn(await savedTemplate(page), "i_photo").eraseMask).toBeUndefined();
    await page.keyboard.press("Control+z");
    await expect.poll(async () => await rendered(page, "i_photo")).toContain('data-erased="true"');
  });

  test("Cancel and Escape leave no trace", async ({ page }) => {
    await openStudio(page);
    await select(page, "i_photo");
    await toolbar(page).getByRole("button", { name: "Eraser" }).click();
    await scrub(page);
    await eraserBar(page).getByRole("button", { name: "Cancel" }).click();
    await expect.poll(async () => await rendered(page, "i_photo")).not.toContain('data-erased="true"');
    await toolbar(page).getByRole("button", { name: "Eraser" }).click();
    await scrub(page);
    await page.keyboard.press("Escape");
    await expect.poll(async () => await rendered(page, "i_photo")).not.toContain('data-erased="true"');
    await expect(header(page).getByText("Unsaved", { exact: true })).toHaveCount(0);
  });
});

test.describe("Alignment panel", () => {
  test("opens from the toolbar, closes with X, and every section acts on the selection", async ({ page }) => {
    await openStudio(page);
    await select(page, "s_rect");
    await toolbar(page).getByRole("button", { name: "Alignment", exact: true }).click();
    await expect(panel(page)).toBeVisible();
    for (const section of ["Align", "Distribute", "Flip", "Scale", "Rotate"]) await expect(panel(page).getByRole("button", { name: section, exact: true })).toBeVisible();
    await shot(page, "C-panel-toolbar");
    if (process.env.SHOT_DIR) await panel(page).screenshot({ path: `${process.env.SHOT_DIR}/C-panel.png` });

    // One object: Artboard only; distribution needs more objects.
    await expect(panel(page).getByRole("radio", { name: "Selection" }).first()).toBeDisabled();
    await expect(panel(page).getByRole("button", { name: "Distribute horizontally" })).toBeDisabled();
    await panel(page).getByRole("button", { name: "Align left" }).click();
    await expect.poll(async () => layerIn({ layers: await liveLayers(page) }, "s_rect")?.x).toBe(150);
    await panel(page).getByRole("button", { name: "Align bottom" }).click();
    await expect.poll(async () => layerIn({ layers: await liveLayers(page) }, "s_rect")?.y).toBe(2000);

    await panel(page).getByRole("button", { name: "Flip horizontally" }).click();
    await expect.poll(async () => layerIn({ layers: await liveLayers(page) }, "s_rect")?.flipX).toBe(true);
    await panel(page).getByRole("button", { name: "Rotate 90° clockwise" }).click();
    await expect.poll(async () => layerIn({ layers: await liveLayers(page) }, "s_rect")?.rotation).toBe(90);
    const degrees = panel(page).getByRole("textbox", { name: "Rotation in degrees" });
    await degrees.fill("45");
    await degrees.press("Enter");
    await expect.poll(async () => layerIn({ layers: await liveLayers(page) }, "s_rect")?.rotation).toBe(45);
    await panel(page).getByRole("button", { name: "Rotate 90° counter-clockwise" }).click();
    await expect.poll(async () => layerIn({ layers: await liveLayers(page) }, "s_rect")?.rotation).toBe(-45);
    await panel(page).getByRole("button", { name: "Scale larger" }).click();
    await expect.poll(async () => layerIn({ layers: await liveLayers(page) }, "s_rect")?.width).toBeCloseTo(330, 0);

    // Every action was its own undo step.
    await page.keyboard.press("Control+z");
    await expect.poll(async () => layerIn({ layers: await liveLayers(page) }, "s_rect")?.width).toBe(300);

    // Several objects: Selection and Artboard, distribute across the artboard.
    await select(page, "s_rect", "s_circle");
    await panel(page).getByRole("radio", { name: "Selection" }).first().check();
    await panel(page).getByRole("button", { name: "Align top" }).click();
    await expect.poll(async () => {
      const layers = await liveLayers(page);
      return [layerIn({ layers }, "s_circle")?.y, layerIn({ layers }, "s_rect")?.y].every((value) => typeof value === "number");
    }).toBe(true);
    await panel(page).getByRole("radio", { name: "Artboard" }).last().check();
    await panel(page).getByRole("button", { name: "Distribute horizontally" }).click();

    const saved = await savedTemplate(page);
    expect(layerIn(saved, "s_rect")).toMatchObject({ flipX: true, rotation: -45 });

    await panel(page).getByRole("button", { name: "Close alignment" }).click();
    await expect(panel(page)).toHaveCount(0);
  });
});

test.describe("multi-selection toolbar", () => {
  test("Group, Ungroup, Scale and Delete act on the whole selection, each in one step", async ({ page }) => {
    await openStudio(page);
    await select(page, "t_text", "s_rect");
    const before = await liveLayers(page);
    await toolbar(page).getByRole("button", { name: "Scale larger" }).click();
    await expect.poll(async () => layerIn({ layers: await liveLayers(page) }, "s_rect")?.width).toBeCloseTo(330, 0);
    const scaled = await liveLayers(page);
    const gap = (layers: any[]) => Math.hypot(layerIn({ layers }, "s_rect").x - layerIn({ layers }, "t_text").x, layerIn({ layers }, "s_rect").y - layerIn({ layers }, "t_text").y);
    if (before.length) expect(gap(scaled) / gap(before)).toBeCloseTo(1.1, 1);

    await toolbar(page).getByRole("button", { name: "Group" }).click();
    await expect(toolbar(page)).toHaveAttribute("data-admin-toolbar", "group");
    await toolbar(page).getByRole("button", { name: "Ungroup" }).click();
    await expect(toolbar(page)).toHaveAttribute("data-admin-toolbar", "multi");

    await toolbar(page).getByRole("button", { name: "Delete" }).click();
    await expect(studio(page).locator('[data-canvas-surface] [data-layer-id="t_text"]')).toHaveCount(0);
    await expect(studio(page).locator('[data-canvas-surface] [data-layer-id="s_rect"]')).toHaveCount(0);
    await page.keyboard.press("Control+z");
    await expect(studio(page).locator('[data-canvas-surface] [data-layer-id="t_text"]').first()).toBeAttached();
    await expect(studio(page).locator('[data-canvas-surface] [data-layer-id="s_rect"]').first()).toBeAttached();
  });
});

test.describe("image + shape Mask", () => {
  test("Mask clips the photo to the shape in one step; it crops, scales, aligns, copies and survives reload", async ({ page }) => {
    await openStudio(page);
    await select(page, "s_circle", "i_photo");
    await toolbar(page).getByRole("button", { name: "Mask" }).click();
    // The shape is consumed; the photo is selected and shows the image toolbar.
    await expect(studio(page).locator('[data-canvas-surface] [data-layer-id="s_circle"]')).toHaveCount(0);
    await expect.poll(() => selectedIds(page)).toEqual(["i_photo"]);
    await expect(toolbar(page)).toHaveAttribute("data-admin-toolbar", "image");
    await expect(toolbar(page).getByRole("button", { name: "Crop photo" })).toBeVisible();
    await expect.poll(async () => layerIn({ layers: await liveLayers(page) }, "i_photo")?.mask).toEqual({ kind: "oval" });
    let clip = layerIn({ layers: await liveLayers(page) }, "i_photo");
    expect(clip).toMatchObject({ x: 400, y: 1100, width: 300, height: 300 });

    // Undo restores both objects exactly; redo restores the clip.
    await page.keyboard.press("Control+z");
    await expect(studio(page).locator('[data-canvas-surface] [data-layer-id="s_circle"]').first()).toBeAttached();
    await expect.poll(async () => layerIn({ layers: await liveLayers(page) }, "i_photo")?.mask).toBeUndefined();
    expect(layerIn({ layers: await liveLayers(page) }, "i_photo")).toMatchObject({ x: 400, y: 400, width: 450, height: 300 });
    await page.keyboard.press("Control+y");
    await expect(studio(page).locator('[data-canvas-surface] [data-layer-id="s_circle"]')).toHaveCount(0);

    // Crop inside the mask: the clip stays put while the picture moves.
    await select(page, "i_photo");
    await toolbar(page).getByRole("button", { name: "Crop photo" }).click();
    const surface = page.getByRole("application", { name: /Crop photo/ });
    const box = (await surface.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let step = 1; step <= 8; step += 1) await page.mouse.move(box.x + box.width / 2 + step * 4, box.y + box.height / 2);
    await page.mouse.up();
    await page.locator("[data-admin-crop-bar]").getByRole("button", { name: "Done" }).click();
    await expect.poll(async () => Number(layerIn({ layers: await liveLayers(page) }, "i_photo")?.imageTransform?.offsetX) || 0).not.toBe(0);
    clip = layerIn({ layers: await liveLayers(page) }, "i_photo");
    expect(clip.imageTransform.offsetX).not.toBe(0);
    expect(clip).toMatchObject({ mask: { kind: "oval" }, x: 400, y: 1100 });

    // Scale, align and Fit keep the clip.
    await toolbar(page).getByRole("button", { name: "Scale larger" }).click();
    await toolbar(page).getByRole("button", { name: "Alignment", exact: true }).click();
    await panel(page).getByRole("button", { name: "Align left" }).click();
    await toolbar(page).getByRole("button", { name: "Fit", exact: true }).click();
    await expect.poll(async () => layerIn({ layers: await liveLayers(page) }, "i_photo")?.fitMode).toBe("contain");
    clip = layerIn({ layers: await liveLayers(page) }, "i_photo");
    expect(clip.mask).toEqual({ kind: "oval" });
    expect(clip.width).toBeCloseTo(330, 0);
    expect(clip.x).toBeCloseTo(165, 0);

    // Copy / paste makes an independent clip.
    await toolbar(page).getByRole("button", { name: "Copy" }).click();
    await page.mouse.click(5, 450);
    await page.keyboard.press("Control+v");
    await expect.poll(async () => (await liveLayers(page)).filter((layer: any) => layer.mask?.kind === "oval" && layer.src === PHOTO).length).toBe(2);

    const saved = await savedTemplate(page);
    expect(saved.layers.filter((layer: any) => layer.mask?.kind === "oval")).toHaveLength(2);
    expect(saved.layers.some((layer: any) => layer.id === "s_circle")).toBe(false);
    await page.reload();
    await openStudio(page, { seed: false });
    expect(await rendered(page, "i_photo")).toMatch(/clip-path="url\(#[^"]*-clip-i_photo\)"/);
    expect(layerIn({ layers: (await savedTemplate(page)).layers }, "i_photo")).toMatchObject({ mask: { kind: "oval" }, x: clip.x, y: clip.y, width: clip.width });
  });

  test("Publish freezes the masked design into the published version", async ({ page }) => {
    await openStudio(page);
    await select(page, "i_photo", "s_circle");
    await toolbar(page).getByRole("button", { name: "Mask", exact: true }).click();
    await expect.poll(() => selectedIds(page)).toEqual(["i_photo"]);
    await header(page).getByRole("button", { name: "Publish Changes" }).click();
    await studio(page).getByRole("button", { name: "Publish", exact: true }).click();
    await expect.poll(() => page.evaluate(() => {
      const versions = Object.values((window as any).__adminFixture.versions || {}) as any[][];
      return versions.flat().length;
    }), { timeout: 15_000 }).toBe(1);
    const published = await page.evaluate(() => (Object.values((window as any).__adminFixture.versions) as any[][]).flat()[0].template);
    expect(layerIn(published, "i_photo")).toMatchObject({ mask: { kind: "oval" }, x: 400, y: 1100, width: 300, height: 300 });
    expect(published.layers.some((layer: any) => layer.id === "s_circle")).toBe(false);
  });

  test("a rotated rectangle keeps its rotation when it becomes the mask", async ({ page }) => {
    const template = { ...TEMPLATE, layers: TEMPLATE.layers.map((layer) => (layer.id === "s_rect" ? { ...layer, rotation: 30 } : layer)) };
    await openStudio(page, { template });
    await select(page, "i_photo", "s_rect");
    await toolbar(page).getByRole("button", { name: "Mask" }).click();
    await expect.poll(() => selectedIds(page)).toEqual(["i_photo"]);
    await expect.poll(async () => layerIn({ layers: await liveLayers(page) }, "i_photo")?.mask).toEqual({ kind: "rectangle" });
    expect(layerIn({ layers: await liveLayers(page) }, "i_photo")).toMatchObject({ rotation: 30, width: 300, height: 200 });
  });
});
