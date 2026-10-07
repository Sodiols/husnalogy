/**
 * Design Studio: the floating tool rail and its side panels, the studio's
 * magenta selection chrome, the small-text controls, and the Elements panel's
 * Shapes library — each checked through real interaction and the saved design.
 *
 * Set SHOT_DIR to also save screenshots of the rail, the panels and the
 * selection states there.
 */
import { expect, test, type Page } from "@playwright/test";
import { bodyPoint, selectedIds } from "./customizer-fixture";
import { addStudioShape, canvasSettings, openSidePanel, rail, sidePanel } from "./admin-studio-tools";

/** 10 pt on the fixture's 300 DPI card, in stored document px (type-units.ts). */
const TEN_POINTS = 41.67;

const TITLE = "Minimal Thank You Card";
const PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#3366cc"/></svg>')}`;
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
    { id: "t_big", page: "front", type: "text", text: "together with their families invite you", x: 750, y: 500, width: 1100, height: 120, zIndex: 1, textStyle: { fontFamily: "Inter", fontSize: 60, autoSizeMode: "fixed", multiline: true } },
    { id: "t_small", page: "front", type: "text", text: "dinner + dance", x: 750, y: 1200, width: 380, height: 52, zIndex: 2, textStyle: { fontFamily: "Inter", fontSize: TEN_POINTS, autoSizeMode: "fixed" } },
    { id: "i_photo", page: "front", type: "image", src: PHOTO, x: 400, y: 1700, width: 400, height: 400, zIndex: 3 },
  ],
};

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const header = (page: Page) => studio(page).locator("header");

async function openStudio(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__e2e/admin-dashboard?section=Products");
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  await page.evaluate(({ name, value }) => {
    const products = (window as any).__adminFixture.store.products.map((entry: any) => (entry.title === name ? { ...entry, customizerTemplate: value } : entry));
    window.sessionStorage.setItem("__adminFixtureDurable", JSON.stringify({ products, versions: {} }));
  }, { name: TITLE, value: TEMPLATE });
  await page.reload();
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: `Edit ${TITLE}` }).first().click();
  const enable = page.getByRole("switch", { name: /Enable product customizer/ });
  await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
  if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
  await page.getByRole("button", { name: "Open Design Studio" }).click();
  await expect(header(page)).toBeVisible();
  await expect.poll(() => bodyPoint(page, "t_big").then(() => true, () => false)).toBe(true);
}

async function select(page: Page, id: string) {
  const point = await bodyPoint(page, id);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => selectedIds(page)).toEqual([id]);
  await page.waitForTimeout(400);
}

async function shot(page: Page, name: string, locator = studio(page)) {
  if (process.env.SHOT_DIR) await locator.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
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

/** The Konva selection chrome as drawn: colour, on-screen line weight, handles, and the small-text move control. */
const chrome = (page: Page) =>
  page.evaluate(() => {
    const stage = (window as any).Konva.stages.find((candidate: any) => candidate.findOne("Transformer"));
    const transformer = stage.findOne("Transformer");
    // On-screen size: what Konva actually draws, whatever it scales.
    const scale = transformer.getAbsoluteScale().x;
    const stageScale = stage.scaleX();
    const anchors = transformer.find("._anchor").filter((anchor: any) => anchor.visible() && !anchor.hasName("rotater"));
    const rotater = transformer.findOne(".rotater");
    // The selected object's own box (the Transformer's rect includes its controls).
    const box = transformer.nodes()[0].getClientRect();
    const move = stage.findOne(".small-text-move-control");
    return {
      color: transformer.borderStroke(),
      screenStroke: transformer.borderStrokeWidth() * scale,
      handles: anchors.map((anchor: any) => anchor.name().split(" ")[0]).sort(),
      cornerScreenSize: anchors.length ? anchors[0].width() * scale : 0,
      rotateBelow: rotater ? rotater.getAbsolutePosition().y > box.y + box.height : false,
      rotateScreenSize: rotater ? rotater.width() * scale : 0,
      moveVisible: Boolean(move && move.visible()),
      moveScreenRadius: move ? move.findOne("Circle").radius() * stageScale : 0,
    };
  });

async function setZoom(page: Page, percent: number) {
  const field = studio(page).getByRole("textbox", { name: "Canvas zoom" }).or(studio(page).getByRole("spinbutton", { name: "Canvas zoom" })).first();
  await field.fill(String(percent));
  await field.press("Enter");
  await page.waitForTimeout(400);
}

test.describe("tool rail", () => {
  test("nine tools in the reference order; each opens its working panel, Edit closes it", async ({ page }) => {
    await openStudio(page);
    const labels = await rail(page).getByRole("button").allInnerTexts();
    expect(labels.map((label) => label.trim())).toEqual(["Edit", "Add Text", "Uploads", "Background", "Elements", "Icons", "Options", "Moment", "Layers", "Pages"]);
    await expect(rail(page).getByRole("button", { name: "Edit" })).toHaveAttribute("aria-pressed", "true");
    await shot(page, "R1-rail", rail(page));

    // Layers: every layer of the page; Pages: a card per page.
    const layers = await openSidePanel(page, "Layers");
    await expect(rail(page).getByRole("button", { name: "Layers" })).toHaveAttribute("aria-pressed", "true");
    await expect(layers.locator("[data-layer-row]").first()).toBeVisible();
    const pages = await openSidePanel(page, "Pages");
    await expect(pages.locator("[data-page-card]")).toHaveCount(1);
    await openSidePanel(page, "Layers");
    await shot(page, "R1-layers");

    // Uploads: the existing asset library.
    await openSidePanel(page, "Uploads");
    await expect(sidePanel(page, "layers")).toHaveCount(0);
    // Background: the page's real colour, saved.
    const background = await openSidePanel(page, "Background");
    await background.getByRole("textbox", { name: "Custom background colour (hex)" }).fill("#FFEEDD");
    await background.getByRole("textbox", { name: "Custom background colour (hex)" }).press("Enter");
    // Options and Moment: the product options and the customer fields.
    await openSidePanel(page, "Options");
    const moment = await openSidePanel(page, "Moment");
    await expect(moment.getByRole("heading", { name: "Customer fields" })).toBeVisible();
    // Elements and Icons: the elements library, Icons straight into Graphics.
    const elements = await openSidePanel(page, "Elements");
    await expect(elements.getByRole("heading", { name: "Elements" })).toBeVisible();
    const icons = await openSidePanel(page, "Icons");
    await expect(icons.getByRole("heading", { name: "Graphics", level: 2 })).toBeVisible();
    // Edit: back to selecting, no side panel.
    await rail(page).getByRole("button", { name: "Edit", exact: true }).click();
    await expect(sidePanel(page)).toHaveCount(0);

    // Add Text: a new, editable text object.
    await rail(page).getByRole("button", { name: "Add Text", exact: true }).click();
    await expect(page.locator('[aria-label="Edit text on canvas"]')).toBeVisible();
    await page.keyboard.type("Rail text");
    await page.keyboard.press("Control+Enter");
    await expect(page.locator('[aria-label="Edit text on canvas"]')).toHaveCount(0);
    const saved = await savedTemplate(page);
    expect(saved.pages[0].backgroundColor).toBe("#ffeedd");
    expect(saved.layers.some((layer: any) => layer.type === "text" && layer.text === "Rail text")).toBe(true);
  });

  test("ruler guides and the hand tool live in the canvas bar's Settings", async ({ page }) => {
    await openStudio(page);
    const settings = await canvasSettings(page);
    await settings.getByRole("button", { name: "Horizontal guide" }).click();
    const pan = settings.getByRole("switch", { name: "Pan" });
    await pan.click();
    await expect(pan).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    const saved = await savedTemplate(page);
    expect(saved.guides).toHaveLength(1);
  });
});

test.describe("selection chrome", () => {
  test("a thin magenta outline with round handles and the rotate control below — the same on screen at every zoom", async ({ page }) => {
    await openStudio(page);
    await select(page, "t_big");
    for (const zoom of [50, 100, 150]) {
      await setZoom(page, zoom);
      const drawn = await chrome(page);
      expect(drawn.color, `zoom ${zoom}`).toBe("#E8399E");
      expect(drawn.screenStroke, `zoom ${zoom}`).toBeCloseTo(1.5, 1);
      expect(drawn.cornerScreenSize, `zoom ${zoom}`).toBeCloseTo(11, 0);
      expect(drawn.rotateScreenSize, `zoom ${zoom}`).toBeCloseTo(22, 0);
      expect(drawn.rotateBelow, `zoom ${zoom}`).toBe(true);
      expect(drawn.moveVisible).toBe(false);
    }
    await setZoom(page, 100);
    await shot(page, "R2-selection");
    // Selection chrome is UI only: the design is untouched by selecting.
    const saved = await savedTemplate(page).catch(() => null);
    if (saved) expect(layerIn(saved, "t_big").textStyle.color ?? "").not.toBe("#E8399E");
  });
});

test.describe("small text", () => {
  test("text of size 10 or less gets two corner handles and rotate + move controls; 11 gets the normal handles", async ({ page }) => {
    await openStudio(page);
    await select(page, "t_small");
    let drawn = await chrome(page);
    expect(drawn.handles).toEqual(["bottom-right", "top-left"]);
    expect(drawn.moveVisible).toBe(true);
    expect(drawn.moveScreenRadius).toBeCloseTo(11, 0);
    await shot(page, "R3-small-text");

    // The move control drags the text: one gesture, one undo step.
    const before = (await page.evaluate(() => (window as any).Konva.stages[0].findOne(".t_small")?.x())) ?? null;
    const control = await page.evaluate(() => {
      const stage = (window as any).Konva.stages.find((candidate: any) => candidate.findOne("Transformer"));
      const move = stage.findOne(".small-text-move-control");
      const position = move.getAbsolutePosition();
      const box = stage.container().getBoundingClientRect();
      return { x: box.left + position.x, y: box.top + position.y };
    });
    await page.mouse.move(control.x, control.y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) await page.mouse.move(control.x + step * 8, control.y - step * 6);
    await page.mouse.up();
    let saved = await savedTemplate(page);
    const moved = layerIn(saved, "t_small");
    expect(moved.x).toBeGreaterThan(750 + 100);
    expect(moved.y).toBeLessThan(1200 - 80);
    expect(before === null || before !== moved.x).toBe(true);
    await expect.poll(() => selectedIds(page)).toEqual(["t_small"]);
    await page.keyboard.press("Control+z");
    saved = await savedTemplate(page);
    expect(layerIn(saved, "t_small")).toMatchObject({ x: 750, y: 1200 });

    // The rotate control below it turns the text.
    await select(page, "t_small");
    const rotater = await page.evaluate(() => {
      const stage = (window as any).Konva.stages.find((candidate: any) => candidate.findOne("Transformer"));
      const anchor = stage.findOne("Transformer").findOne(".rotater").getAbsolutePosition();
      const box = stage.container().getBoundingClientRect();
      return { x: box.left + anchor.x, y: box.top + anchor.y };
    });
    await page.mouse.move(rotater.x, rotater.y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) await page.mouse.move(rotater.x + step * 12, rotater.y - step * 4);
    await page.mouse.up();
    saved = await savedTemplate(page);
    expect(Math.abs(Number(layerIn(saved, "t_small").rotation) || 0)).toBeGreaterThan(5);
    expect(layerIn(saved, "t_small").textStyle.fontSize).toBe(TEN_POINTS);

    // 10 pt → 11 pt: the normal handles return.
    await page.locator("[data-admin-toolbar]").getByRole("button", { name: "Increase Font size" }).click();
    await expect.poll(async () => (await chrome(page)).moveVisible).toBe(false);
    drawn = await chrome(page);
    expect(drawn.handles.length).toBeGreaterThan(2);
    // 11 pt → 10 pt: back to the small-text controls.
    await page.locator("[data-admin-toolbar]").getByRole("button", { name: "Decrease Font size" }).click();
    await expect.poll(async () => (await chrome(page)).moveVisible).toBe(true);
  });
});

test.describe("Elements: Shapes library", () => {
  test("the overview follows the reference order; See more opens a searchable library; Back and X work", async ({ page }) => {
    await openStudio(page);
    const panel = await openSidePanel(page, "Elements");
    const headings = await panel.locator("h3").allInnerTexts();
    expect(headings.slice(0, 7)).toEqual(["Dynamic Shapes", "Graphics", "Text", "Borders/Lines", "Shapes", "Frames", "QR Code"]);
    await expect(panel.getByRole("textbox", { name: "Search for elements" }).or(panel.getByRole("searchbox", { name: "Search for elements" }))).toBeVisible();
    await shot(page, "R4-elements", panel);

    await panel.getByRole("button", { name: "See more shapes" }).click();
    await expect(panel.getByRole("heading", { name: "Shapes" })).toBeVisible();
    const library = panel.locator("[data-shape-library] button");
    expect(await library.count()).toBeGreaterThanOrEqual(45);
    await shot(page, "R4-shapes", panel);
    const search = panel.getByRole("searchbox", { name: "Search in Shapes" });
    await search.fill("HEART");
    await expect.poll(() => library.count()).toBe(3);
    await search.fill("zebra");
    await expect(panel.getByText(/No shapes match/)).toBeVisible();
    await search.fill("");
    await panel.getByRole("button", { name: "Back to Elements" }).click();
    await expect(panel.getByRole("heading", { name: "Elements" })).toBeVisible();
    await panel.getByRole("button", { name: "Close Elements" }).click();
    await expect(sidePanel(page)).toHaveCount(0);

    // Searching the overview finds shapes too.
    const again = await openSidePanel(page, "Elements");
    await again.getByRole("searchbox", { name: "Search for elements" }).fill("star");
    await expect(again.getByRole("button", { name: "Add star shape", exact: true })).toBeVisible();
  });

  test("a library shape is a real shape: inserted, selected, styled, saved, and it can mask a photo", async ({ page }) => {
    await openStudio(page);
    await addStudioShape(page, "heart");
    await expect(page.locator("[data-admin-toolbar]")).toHaveAttribute("data-admin-toolbar", "shape");
    const [heartId] = await selectedIds(page);
    await page.locator("[data-admin-toolbar]").getByRole("button", { name: /^Fill color/ }).click();
    await page.getByRole("dialog", { name: /^Fill color/ }).getByRole("button", { name: "Fill color #7A1F2B" }).click();
    let saved = await savedTemplate(page);
    const heart = layerIn(saved, heartId);
    expect(heart).toMatchObject({ type: "shape", shape: "custom", libraryShapeId: "heart", fill: "#7A1F2B" });
    expect(heart.pathData).toMatch(/^M/);
    // Drawn as a vector path on the canvas.
    expect(await page.evaluate((id) => document.querySelector(`[data-admin-customizer] [data-canvas-surface] [data-layer-id="${id}"] path`)?.getAttribute("fill"), heartId)).toBe("#7A1F2B");

    // Heart + photo → Mask.
    const photo = await bodyPoint(page, "i_photo");
    const heartPoint = await bodyPoint(page, heartId);
    await page.mouse.click(heartPoint.x, heartPoint.y);
    await page.keyboard.down("Shift");
    await page.mouse.click(photo.x, photo.y);
    await page.keyboard.up("Shift");
    await expect(page.locator("[data-admin-toolbar]")).toHaveAttribute("data-admin-toolbar", "mask");
    await page.locator("[data-admin-toolbar]").getByRole("button", { name: "Mask", exact: true }).click();
    saved = await savedTemplate(page);
    expect(layerIn(saved, "i_photo").mask).toMatchObject({ kind: "path", viewBoxWidth: 100, viewBoxHeight: 100 });
    expect(saved.layers.some((layer: any) => layer.id === heartId)).toBe(false);
    // One undo brings the heart and the photo back.
    await page.keyboard.press("Control+z");
    saved = await savedTemplate(page);
    expect(saved.layers.some((layer: any) => layer.id === heartId)).toBe(true);
  });
});
