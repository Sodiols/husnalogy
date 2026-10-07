/**
 * Design Studio: the Layers and Pages side panels.
 *
 * Layers — one light-grey card per layer, top-most first: a line icon, then the
 * text's own words or the image's picture. Pages — a narrow strip of white
 * page cards, a live thumbnail above the page's name. Both are driven through
 * real interaction and checked against the canvas and the saved design.
 *
 * Set SHOT_DIR to also save screenshots of both panels.
 */
import { expect, test, type Page } from "@playwright/test";
import { addStudioText, openSidePanel, rail, sidePanel } from "./admin-studio-tools";
import { bodyPoint, selectedIds } from "./customizer-fixture";

const TITLE = "Minimal Thank You Card";
const PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#3366cc"/><circle cx="150" cy="100" r="60" fill="#ffcc00"/></svg>')}`;
const TEMPLATE = {
  enabled: true,
  cardWidthIn: 5,
  cardHeightIn: 7,
  dpi: 300,
  canvasWidthPx: 1500,
  canvasHeightPx: 2100,
  pages: [
    { id: "front", label: "Front", enabled: true },
    { id: "back", label: "Back", enabled: true, backgroundColor: "#000000" },
  ],
  defaultPage: "front",
  fields: [],
  guides: [],
  layers: [
    { id: "i_photo", page: "front", type: "image", name: "Image", src: PHOTO, x: 750, y: 1400, width: 900, height: 600, zIndex: 1 },
    { id: "t_wedding", page: "front", type: "text", name: "Text", text: "wedding", x: 750, y: 700, width: 420, height: 90, zIndex: 2, textStyle: { fontFamily: "Inter", fontSize: 70.83, autoSizeMode: "width", textAlign: "center" } },
    { id: "t_back", page: "back", type: "text", name: "Text", text: "thank you", x: 750, y: 1050, width: 420, height: 90, zIndex: 1, textStyle: { fontFamily: "Inter", fontSize: 70.83, autoSizeMode: "width", textAlign: "center", color: "#ffffff" } },
  ],
};

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const header = (page: Page) => studio(page).locator("header");
const rows = (page: Page) => sidePanel(page, "layers").locator("[data-layer-row]");
const rowLabels = (page: Page) => rows(page).evaluateAll((items) => items.map((item) => item.querySelector("[data-layer-label]")?.textContent?.trim() || (item.querySelector("[data-layer-thumbnail]") ? "[picture]" : "")));
const cards = (page: Page) => sidePanel(page, "pages").locator("[data-page-card]");
const cardLabels = (page: Page) => cards(page).locator("[data-page-label]").allInnerTexts();
const activeCard = (page: Page) => sidePanel(page, "pages").locator("[data-page-card][data-active]").locator("[data-page-label]");
const canvasHas = (page: Page, id: string) => studio(page).locator(`[data-canvas-surface] [data-layer-id="${id}"]`);

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
  await expect.poll(() => bodyPoint(page, "t_wedding").then(() => true, () => false)).toBe(true);
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

test.describe("Layers panel", () => {
  test("real rows, top-most first: the text's words and the image's picture; selection follows both ways", async ({ page }) => {
    await openStudio(page);
    const panel = await openSidePanel(page, "Layers");
    await expect(panel.getByRole("heading", { name: "Layers" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Close panel" })).toBeVisible();
    // Top first: the text (zIndex 2) above the photo (zIndex 1). No raw ids.
    await expect.poll(() => rowLabels(page)).toEqual(["wedding", "[picture]"]);
    await expect(panel).not.toContainText("t_wedding");
    // The picture is the layer's own image, loaded.
    await expect.poll(() => panel.locator("[data-layer-thumbnail] img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await shot(page, "layers-panel");

    // Panel → canvas.
    await panel.getByRole("button", { name: "Image: Image" }).click();
    await expect.poll(() => selectedIds(page)).toEqual(["i_photo"]);
    await expect(panel.getByRole("button", { name: "Image: Image" })).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByRole("button", { name: "Text: wedding" })).toHaveAttribute("aria-pressed", "false");
    // Canvas → panel.
    const point = await bodyPoint(page, "t_wedding");
    await page.mouse.click(point.x, point.y);
    await expect.poll(() => selectedIds(page)).toEqual(["t_wedding"]);
    await expect(panel.getByRole("button", { name: "Text: wedding" })).toHaveAttribute("aria-pressed", "true");
    await shot(page, "layers-panel-selected");
  });

  test("add, duplicate, delete, Undo, Redo, save and reload keep the rows in step", async ({ page }) => {
    await openStudio(page);
    // Add: a new text appears, named by its words.
    await addStudioText(page);
    await page.keyboard.type("hello");
    await page.keyboard.press("Control+Enter");
    await openSidePanel(page, "Layers");
    await expect.poll(() => rowLabels(page)).toEqual(["hello", "wedding", "[picture]"]);

    // Duplicate from the row's own action.
    await sidePanel(page, "layers").getByRole("button", { name: "Text: wedding" }).hover();
    await sidePanel(page, "layers").getByRole("button", { name: "Duplicate wedding" }).click();
    // The copy lands on top of the stack, selected.
    await expect.poll(() => rowLabels(page)).toEqual(["wedding", "hello", "wedding", "[picture]"]);

    // Delete the selected copy.
    await expect.poll(async () => (await selectedIds(page)).length).toBe(1);
    await page.keyboard.press("Delete");
    await expect.poll(() => rowLabels(page)).toEqual(["hello", "wedding", "[picture]"]);

    // Undo brings it back; Redo removes it again.
    await page.keyboard.press("Control+z");
    await expect.poll(() => rowLabels(page)).toEqual(["wedding", "hello", "wedding", "[picture]"]);
    await page.keyboard.press("Control+y");
    await expect.poll(() => rowLabels(page)).toEqual(["hello", "wedding", "[picture]"]);

    // Hide is a real document change, shown on the row.
    await sidePanel(page, "layers").getByRole("button", { name: "Text: hello" }).hover();
    await sidePanel(page, "layers").getByRole("button", { name: "Hide hello" }).click();
    await expect(sidePanel(page, "layers").getByRole("button", { name: "Show hello" })).toBeVisible();

    // Save and reload: the same rows.
    const saved = await savedTemplate(page);
    expect(saved.layers.filter((layer: any) => layer.page === "front")).toHaveLength(3);
    await page.reload();
    await openStudio(page, false);
    await openSidePanel(page, "Layers");
    await expect.poll(() => rowLabels(page)).toEqual(["hello", "wedding", "[picture]"]);
    await expect(sidePanel(page, "layers").getByRole("button", { name: "Show hello" })).toBeVisible();
  });

  test("any row drags to a new place: the passed rows slide aside live, the drop restacks, Undo restores", async ({ page }) => {
    await openStudio(page);
    await openSidePanel(page, "Layers");
    await expect.poll(() => rowLabels(page)).toEqual(["wedding", "[picture]"]);

    // Press on the middle of the picture row (not a grip) and drag it up past the text row.
    const picture = rows(page).nth(1);
    const text = rows(page).nth(0);
    const from = (await picture.boundingBox())!;
    const to = (await text.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 20, { steps: 4 });
    await expect(picture).toHaveAttribute("data-dragging", "true");
    await page.mouse.move(from.x + from.width / 2, to.y + 4, { steps: 10 });
    // Before the drop, the text row has already slid down out of the way.
    await expect.poll(async () => (await text.boundingBox())!.y).toBeGreaterThan(to.y + 20);
    await page.mouse.up();

    await expect.poll(() => rowLabels(page)).toEqual(["[picture]", "wedding"]);
    await expect(rows(page).locator("[data-dragging]")).toHaveCount(0);
    // The drag did not also count as a click on the dropped row.
    await page.keyboard.press("Control+z");
    await expect.poll(() => rowLabels(page)).toEqual(["wedding", "[picture]"]);

    // A plain click still selects instead of dragging.
    await rows(page).nth(0).getByRole("button", { name: "Text: wedding" }).click();
    await expect(rows(page).nth(0)).toHaveAttribute("data-selected", "true");
  });
});

test.describe("Pages panel", () => {
  test("Front and Back cards switch the canvas; the active card follows; thumbnails are the real pages", async ({ page }) => {
    await openStudio(page);
    await expect(rail(page).getByRole("button", { name: "Pages", exact: true })).toBeVisible();
    const panel = await openSidePanel(page, "Pages");
    await expect(panel.getByRole("heading", { name: "Pages" })).toBeVisible();
    expect(await cardLabels(page)).toEqual(["Front", "Back"]);
    await expect(activeCard(page)).toHaveText("Front");
    // The thumbnails are the shared renderer drawing each page: Back is dark, Front holds its text.
    await expect(cards(page).nth(0).locator('[data-layer-id="t_wedding"]')).toHaveCount(1);
    await expect(cards(page).nth(1).locator('[data-layer-id="t_back"]')).toHaveCount(1);
    await expect.poll(() => cards(page).nth(1).locator("svg").first().evaluate((svg) => Array.from(svg.querySelectorAll("rect")).some((rect) => /^#0{3}(0{3})?$/i.test(rect.getAttribute("fill") || "")))).toBe(true);
    await shot(page, "pages-panel");

    await panel.getByRole("button", { name: "Back", exact: true }).click();
    await expect(activeCard(page)).toHaveText("Back");
    await expect(canvasHas(page, "t_back")).toHaveCount(1);
    await expect(canvasHas(page, "t_wedding")).toHaveCount(0);
    await panel.getByRole("button", { name: "Front", exact: true }).click();
    await expect(activeCard(page)).toHaveText("Front");
    await expect(canvasHas(page, "t_wedding")).toHaveCount(1);
  });

  test("add, duplicate, rename, delete, Undo, Redo, save and reload keep the cards in step", async ({ page }) => {
    await openStudio(page);
    const panel = await openSidePanel(page, "Pages");
    // Add.
    await panel.getByRole("button", { name: "Add page" }).click();
    await expect.poll(() => cards(page).count()).toBe(3);
    // Duplicate Front.
    await panel.getByRole("button", { name: "Page actions for Front" }).click();
    await panel.getByRole("button", { name: "Duplicate", exact: true }).click();
    await expect.poll(() => cards(page).count()).toBe(4);
    // Rename Back.
    await panel.getByRole("button", { name: "Page actions for Back" }).click();
    await panel.getByRole("button", { name: "Rename", exact: true }).click();
    // The name field offers the usual page names (a combobox).
    await panel.getByLabel("Page name").fill("Inside Left");
    await panel.getByLabel("Page name").press("Enter");
    await expect.poll(() => cardLabels(page)).toContain("Inside Left");
    const beforeDelete = await cardLabels(page);
    // Delete the added page.
    page.once("dialog", (dialog) => dialog.accept());
    const added = beforeDelete[beforeDelete.length - 1];
    await panel.getByRole("button", { name: `Page actions for ${added}` }).click();
    await panel.getByRole("button", { name: "Delete page…" }).click();
    await expect.poll(() => cards(page).count()).toBe(3);
    // Undo restores it, Redo removes it again.
    await page.keyboard.press("Control+z");
    await expect.poll(() => cardLabels(page)).toEqual(beforeDelete);
    await page.keyboard.press("Control+y");
    await expect.poll(() => cards(page).count()).toBe(3);
    const afterEdits = await cardLabels(page);

    // Save and reload: the same cards, the first page active.
    const saved = await savedTemplate(page);
    expect(saved.pages.map((entry: any) => entry.label)).toEqual(afterEdits);
    await page.reload();
    await openStudio(page, false);
    await openSidePanel(page, "Pages");
    await expect.poll(() => cardLabels(page)).toEqual(afterEdits);
    await expect(activeCard(page)).toHaveText(afterEdits[0]);
  });
});
