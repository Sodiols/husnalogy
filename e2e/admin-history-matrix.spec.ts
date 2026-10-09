/**
 * Undo and Redo across the studio's commands (stabilization task 13).
 *
 * For each command: the saved document and the drawn canvas are captured
 * before it; the command runs; ONE Undo must restore both exactly (document
 * data and what is drawn — text geometry, page state, groups); ONE Redo must
 * reproduce the command's own result exactly. One Undo per command also
 * proves the command wrote one history entry (a gesture that flooded history
 * would need several).
 */
import { expect, test, type Page } from "@playwright/test";
import { anchorPoint, bodyPoint, selectedIds } from "./customizer-fixture";
import { openSidePanel, orientationChoices } from "./admin-studio-tools";

const TITLE = "Minimal Thank You Card";
const TEMPLATE = {
  enabled: true, cardWidthIn: 5, cardHeightIn: 7, dpi: 300, canvasWidthPx: 1500, canvasHeightPx: 2100,
  safeArea: { top: 90, right: 90, bottom: 90, left: 90 },
  pages: [{ id: "front", label: "Front", enabled: true, backgroundColor: "#ffffff" }, { id: "back", label: "Back", enabled: true }],
  defaultPage: "front", fields: [], guides: [],
  layers: [
    { id: "t_title", page: "front", type: "text", name: "Title", text: "Anna and Ben", x: 750, y: 400, width: 700, height: 100, zIndex: 1, textStyle: { fontFamily: "Inter", fontSize: 70.83, color: "#303839", autoSizeMode: "width", textAlign: "center" } },
    { id: "s_a", page: "front", type: "shape", name: "Box A", shape: "rectangle", x: 400, y: 1000, width: 260, height: 160, zIndex: 2, fill: "#d4af37" },
    { id: "s_b", page: "front", type: "shape", name: "Box B", shape: "oval", x: 1000, y: 1300, width: 220, height: 160, zIndex: 3, fill: "#27307a" },
  ],
};

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const header = (page: Page) => studio(page).locator("header");
const toolbar = (page: Page) => page.locator("[data-admin-toolbar]");
/** What the canvas draws (its SVG markup), the editor's visible state. */
const drawn = (page: Page) => studio(page).locator("[data-canvas-surface] svg").first().evaluate((svg) => svg.outerHTML);
const emptyCanvas = (page: Page) => page.locator("[data-canvas-surface]").first().click({ position: { x: 5, y: 5 } });

async function openStudio(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__e2e/admin-dashboard?section=Products");
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  await page.evaluate(({ name, value }) => {
    const products = (window as any).__adminFixture.store.products.map((entry: any) => (entry.title === name ? { ...entry, customizerTemplate: value } : entry));
    window.sessionStorage.setItem("__adminFixtureDurable", JSON.stringify({ products, versions: {} }));
  }, { name: TITLE, value: TEMPLATE });
  await page.reload();
  await page.getByRole("button", { name: `Edit ${TITLE}` }).first().click();
  const enable = page.getByRole("switch", { name: /Enable product customizer/ });
  await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
  if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
  await page.getByRole("button", { name: "Open Design Studio" }).click();
  await expect(header(page)).toBeVisible();
  await bodyPoint(page, "s_a");
  await page.evaluate(() => document.fonts.ready);
}

/** The document as Save Draft sends it (layers and pages, the parts commands change). */
async function saved(page: Page) {
  const before = await page.evaluate(() => (window as any).__adminFixture.requests.length);
  await header(page).getByRole("button", { name: /Save Draft/ }).click();
  await expect.poll(() => page.evaluate((count) => (window as any).__adminFixture.requests.length > count, before)).toBe(true);
  await expect(header(page).getByText("Unsaved", { exact: true })).toHaveCount(0, { timeout: 15_000 });
  return page.evaluate(() => {
    const saves = (window as any).__adminFixture.requests.filter((entry: any) => /^\/api\/admin\/products(\/[^/]+)?$/.test(entry.path));
    const template = saves[saves.length - 1].body.customizerTemplate;
    return JSON.stringify({ layers: template.layers, pages: template.pages, canvas: [template.canvasWidthPx, template.canvasHeightPx] });
  });
}

async function select(page: Page, ...ids: string[]) {
  await emptyCanvas(page);
  for (const [index, id] of ids.entries()) {
    const point = await bodyPoint(page, id);
    if (index) await page.keyboard.down("Shift");
    await page.mouse.click(point.x, point.y);
    if (index) await page.keyboard.up("Shift");
    await page.waitForTimeout(250);
  }
  await expect.poll(async () => (await selectedIds(page)).slice().sort()).toEqual(ids.slice().sort());
}

/** Undo returns the exact document and drawing; Redo the exact result. */
async function checkHistory(page: Page, name: string, setup: () => Promise<void>, command: () => Promise<void>) {
  await setup();
  const docBefore = await saved(page);
  const drawnBefore = await drawn(page);
  await setup();
  await command();
  await page.waitForTimeout(300);
  const docAfter = await saved(page);
  const drawnAfter = await drawn(page);
  expect(docAfter, `${name}: the command changed nothing`).not.toBe(docBefore);

  await emptyCanvas(page);
  await page.keyboard.press("Control+z");
  await expect.poll(() => drawn(page), { message: `${name}: Undo did not restore the canvas` }).toBe(drawnBefore);
  expect(await saved(page), `${name}: Undo did not restore the document`).toBe(docBefore);

  await page.keyboard.press("Control+y");
  await expect.poll(() => drawn(page), { message: `${name}: Redo did not reproduce the canvas` }).toBe(drawnAfter);
  expect(await saved(page), `${name}: Redo did not reproduce the document`).toBe(docAfter);
  // Leave the document as it started for the next command.
  await page.keyboard.press("Control+z");
  await expect.poll(() => drawn(page)).toBe(drawnBefore);
}

test("every command is one undo step that restores the document and the drawing; Redo replays it", async ({ page }) => {
  test.setTimeout(420_000);
  await openStudio(page);
  const none = async () => undefined;

  // One key press is one command (five presses are five steps, as in most editors).
  await checkHistory(page, "move (nudge)", () => select(page, "s_a"), () => page.keyboard.press("Shift+ArrowRight"));

  await checkHistory(page, "move (drag gesture)", none, async () => {
    const point = await bodyPoint(page, "s_b");
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    for (let step = 1; step <= 12; step += 1) await page.mouse.move(point.x - step * 6, point.y + step * 3);
    await page.mouse.up();
  });

  await checkHistory(page, "resize (handle gesture)", () => select(page, "s_a"), async () => {
    const handle = await anchorPoint(page, "bottom-right");
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) await page.mouse.move(handle.x + step * 4, handle.y + step * 3);
    await page.mouse.up();
  });

  await checkHistory(page, "rotate (handle gesture)", () => select(page, "s_a"), async () => {
    const handle = await anchorPoint(page, "rotater");
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) await page.mouse.move(handle.x + step * 6, handle.y + step * 2);
    await page.mouse.up();
  });

  await checkHistory(page, "delete", () => select(page, "s_b"), () => page.keyboard.press("Delete"));
  await checkHistory(page, "duplicate", () => select(page, "s_a"), () => page.keyboard.press("Control+d"));
  await checkHistory(page, "group", () => select(page, "s_a", "s_b"), () => page.keyboard.press("Control+g"));

  await checkHistory(page, "layer order (bring to front)", () => select(page, "s_a"), async () => {
    const point = await bodyPoint(page, "s_a");
    await page.mouse.click(point.x, point.y, { button: "right" });
    await page.getByRole("menu", { name: "Object actions" }).getByRole("menuitem", { name: "Bring to front", exact: true }).click();
  });

  await checkHistory(page, "alignment (left edges)", () => select(page, "s_a", "s_b"), async () => {
    await toolbar(page).getByRole("button", { name: "Alignment", exact: true }).click();
    await page.locator("[data-admin-alignment-panel]").getByRole("button", { name: "Align left" }).first().click();
    await page.locator("[data-admin-alignment-panel]").getByRole("button", { name: "Close alignment" }).click();
  });

  await checkHistory(page, "font size (text geometry follows)", () => select(page, "t_title"), async () => {
    const field = toolbar(page).getByRole("textbox", { name: "Font size" }).or(toolbar(page).getByRole("spinbutton", { name: "Font size" })).first();
    await field.fill("24");
    await field.press("Enter");
  });

  await checkHistory(page, "page background colour", none, async () => {
    const panel = await openSidePanel(page, "Background");
    await panel.getByRole("button", { name: "Colour #ec008c", exact: true }).click();
    await panel.getByRole("button", { name: "Close panel" }).click();
  });

  await checkHistory(page, "orientation (whole design carried across)", none, async () => {
    await (await orientationChoices(page)).getByRole("radio", { name: "Horizontal" }).click();
    await page.keyboard.press("Escape");
  });
});
