/**
 * New text: 17 pt, a box that hugs the words, one size everywhere.
 *
 * The reproduction: a 5 x 7 in card, Add Text, "wedding invitations" at 17.
 * Measured from what the canvas draws, once the real font has loaded: the
 * selection ends at the last glyph, the text is drawn at 17 pt on the 300 DPI
 * artboard (70.83 document px), and the box follows every edit — typing,
 * deleting, letter spacing, size — through undo, redo, save and reload. The
 * customer editor's Add Text makes the same object.
 *
 * Set SHOT_DIR to also save screenshots.
 */
import { expect, test, type Page } from "@playwright/test";
import { addStudioText } from "./admin-studio-tools";
import { bodyPoint, selectedIds } from "./customizer-fixture";

const TITLE = "Minimal Thank You Card";
const SEVENTEEN_POINTS = 70.83;
const TEN_POINTS = 41.67;
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
  layers: [],
};

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const header = (page: Page) => studio(page).locator("header");
const fontSizeField = (page: Page) => page.locator("[data-admin-toolbar]").getByRole("textbox", { name: "Font size" }).or(page.locator("[data-admin-toolbar]").getByRole("spinbutton", { name: "Font size" })).first();
const content = (page: Page) => studio(page).getByText("Text content", { exact: true }).locator("xpath=..").locator("textarea");

async function shot(page: Page, name: string) {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
}

async function openStudio(page: Page, seed = true) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__e2e/admin-dashboard?section=Products");
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  if (seed) {
    await page.evaluate(({ name, value }) => {
      const products = (window as any).__adminFixture.store.products.map((entry: any) => (entry.title === name ? { ...entry, customizerTemplate: value } : entry));
      window.sessionStorage.setItem("__adminFixtureDurable", JSON.stringify({ products, versions: {} }));
    }, { name: TITLE, value: TEMPLATE });
    await page.reload();
    await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  }
  await page.getByRole("button", { name: `Edit ${TITLE}` }).first().click();
  const enable = page.getByRole("switch", { name: /Enable product customizer/ });
  await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
  if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
  await page.getByRole("button", { name: "Open Design Studio" }).click();
  await expect(header(page)).toBeVisible();
}

/**
 * What the canvas draws for one text object, in DOCUMENT px: the glyphs'
 * extent (the SVG text's own box) and the selection (the Transformer's node),
 * plus the drawn font size and the artboard height.
 */
const drawn = (page: Page, id: string) =>
  page.evaluate((layerId) => {
    // The main canvas, not a page thumbnail that draws the same layer smaller.
    const all = Array.from(document.querySelectorAll(`[data-layer-id="${layerId}"] text`)) as SVGTextElement[];
    const width = (el: SVGTextElement) => el.ownerSVGElement?.getBoundingClientRect().width || 0;
    const svg = all.reduce<SVGTextElement | null>((best, el) => (!best || width(el) > width(best) ? el : best), null)?.ownerSVGElement;
    const texts = all.filter((el) => el.ownerSVGElement === svg);
    const viewBox = svg?.viewBox.baseVal;
    const svgRect = svg!.getBoundingClientRect();
    const toDoc = viewBox && viewBox.width ? viewBox.width / svgRect.width : 1;
    const rects = texts.map((text) => text.getBoundingClientRect()).filter((rect) => rect.width > 0);
    const glyphWidth = (Math.max(...rects.map((rect) => rect.right)) - Math.min(...rects.map((rect) => rect.left))) * toDoc;
    const stage = (window as any).Konva.stages.find((candidate: any) => candidate.findOne("Transformer")?.nodes().length);
    const node = stage.findOne("Transformer").nodes()[0];
    const box = node.getClientRect();
    const move = stage.findOne(".small-text-move-control");
    return {
      glyphWidth,
      selectionWidth: box.width * toDoc,
      // The size the renderer drew, in document px (the SVG's own units).
      fontSize: Number.parseFloat(texts[0].style.fontSize || texts[0].closest<SVGElement>("[style*='font-size']")?.style.fontSize || "0"),
      artboardHeight: viewBox?.height || 0,
      smallText: Boolean(move && move.visible()),
    };
  }, id);

/** The selection hugs the glyphs: no blank region, and no clipping. */
async function expectHug(page: Page, id: string) {
  await expect.poll(async () => {
    const box = await drawn(page, id);
    return box.selectionWidth - box.glyphWidth;
  }).toBeLessThan(Math.ceil(SEVENTEEN_POINTS * 0.12) + 12);
  const box = await drawn(page, id);
  expect(box.selectionWidth).toBeGreaterThanOrEqual(box.glyphWidth - 2);
  return box;
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

async function select(page: Page, id: string) {
  const point = await bodyPoint(page, id);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => selectedIds(page)).toEqual([id]);
}

async function setFontSize(page: Page, points: number) {
  await fontSizeField(page).fill(String(points));
  await fontSizeField(page).press("Enter");
}

test.describe("Design Studio: new text", () => {
  test("Add Text, 'wedding invitations': 17 pt, a box that hugs the words, live through every edit", async ({ page }) => {
    await openStudio(page);
    await addStudioText(page);
    await expect(page.locator('[aria-label="Edit text on canvas"]')).toBeVisible();
    await page.keyboard.type("wedding");
    await page.keyboard.press("Control+Enter");
    let id = "";
    await expect.poll(async () => (id = (await selectedIds(page))[0] || "")).not.toBe("");
    await page.evaluate(() => document.fonts.ready);

    // TEST 1–3: 17, auto width, and the box is the word.
    await expect(fontSizeField(page)).toHaveValue("17");
    const wedding = await expectHug(page, id);
    expect(wedding.fontSize).toBe(SEVENTEEN_POINTS);
    // 17 pt on a 7 in card: the drawn size is 17/504 of the artboard's height.
    expect(wedding.fontSize / wedding.artboardHeight).toBeCloseTo(17 / (7 * 72), 4);

    // TEST 4: typing more widens it…
    await content(page).fill("wedding invitations");
    await expect.poll(async () => (await drawn(page, id)).selectionWidth).toBeGreaterThan(wedding.selectionWidth * 2);
    const invitations = await expectHug(page, id);
    await page.waitForTimeout(300);
    await shot(page, "text-17-wedding-invitations");
    // …well short of the old fixed boxes (1000 px, half the card).
    expect(invitations.selectionWidth).toBeLessThan(750);

    // TEST 5: …and deleting narrows it back exactly.
    await content(page).fill("wedding");
    await expect.poll(async () => Math.round((await drawn(page, id)).selectionWidth)).toBe(Math.round(wedding.selectionWidth));

    // TEST 8: letter spacing widens and narrows it.
    const spacing = studio(page).getByRole("textbox", { name: "Letter spacing" }).or(studio(page).getByRole("spinbutton", { name: "Letter spacing" })).first();
    const original = await spacing.inputValue();
    await spacing.fill("12");
    await spacing.press("Enter");
    await expect.poll(async () => (await drawn(page, id)).selectionWidth).toBeGreaterThan(wedding.selectionWidth + 40);
    await expectHug(page, id);
    await spacing.fill(original);
    await spacing.press("Enter");
    await expect.poll(async () => Math.round((await drawn(page, id)).selectionWidth)).toBe(Math.round(wedding.selectionWidth));

    // TEST 9: 17 → 10 shrinks it, and the compact small-text controls appear.
    await setFontSize(page, 10);
    await expect.poll(async () => (await drawn(page, id)).fontSize).toBe(TEN_POINTS);
    const small = await expectHug(page, id);
    expect(small.selectionWidth).toBeLessThan(wedding.selectionWidth * 0.7);
    await expect.poll(async () => (await drawn(page, id)).smallText).toBe(true);

    // TEST 10: 10 → 17 returns exactly, with the normal controls.
    await setFontSize(page, 17);
    await expect.poll(async () => (await drawn(page, id)).fontSize).toBe(SEVENTEEN_POINTS);
    await expect.poll(async () => Math.round((await drawn(page, id)).selectionWidth)).toBe(Math.round(wedding.selectionWidth));
    expect((await drawn(page, id)).smallText).toBe(false);

    // TEST 12: Undo and Redo restore size and geometry exactly.
    await page.keyboard.press("Control+z");
    await expect(fontSizeField(page)).toHaveValue("10");
    await expect.poll(async () => Math.round((await drawn(page, id)).selectionWidth)).toBe(Math.round(small.selectionWidth));
    await page.keyboard.press("Control+y");
    await expect(fontSizeField(page)).toHaveValue("17");
    await expect.poll(async () => Math.round((await drawn(page, id)).selectionWidth)).toBe(Math.round(wedding.selectionWidth));

    // TEST 11: save and reload — same text, 17, the tight box, same place.
    const saved = await savedTemplate(page);
    const layer = saved.layers.find((entry: any) => entry.id === id);
    expect(layer.text).toBe("wedding");
    expect(layer.textStyle).toMatchObject({ fontSize: SEVENTEEN_POINTS, autoSizeMode: "safe-width", multiline: false });
    expect(layer.width).toBeLessThan(400);
    await page.reload();
    await openStudio(page, false);
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(async () => (await page.locator(`[data-layer-id="${id}"] text`).count()) > 0).toBe(true);
    await select(page, id);
    const reloaded = await expectHug(page, id);
    expect(reloaded.fontSize).toBe(SEVENTEEN_POINTS);
    expect(Math.abs(reloaded.selectionWidth - wedding.selectionWidth)).toBeLessThanOrEqual(1);
    await expect(fontSizeField(page)).toHaveValue("17");
  });
});

test.describe("Customer editor: new text", () => {
  test("Add Text makes the same 17 pt object, and its box hugs the words", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/__e2e/customizer");
    const root = page.locator("[data-customizer-root]");
    await expect(root).toBeVisible();
    const toggle = page.getByRole("button", { name: /^(Advanced Customize|Advanced)$/ });
    if (await toggle.count()) await toggle.first().click();
    await root.getByRole("button", { name: "Text", exact: true }).click();
    await expect(page.locator('[aria-label="Edit text on canvas"]')).toBeVisible();
    await page.keyboard.type("wedding invitations");
    await page.keyboard.press("Control+Enter");
    let id = "";
    await expect.poll(async () => (id = (await selectedIds(page))[0] || "")).not.toBe("");
    await page.evaluate(() => document.fonts.ready);
    const box = await expectHug(page, id);
    expect(box.fontSize).toBe(SEVENTEEN_POINTS);
    await expect(root.getByRole("textbox", { name: "Font size" }).or(root.getByRole("spinbutton", { name: "Font size" })).first()).toHaveValue("17");
    await shot(page, "text-17-customer");
  });
});
