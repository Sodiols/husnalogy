/**
 * New text grows with its words until the safe area, then wraps at words.
 *
 * Replays the reported video: Add Text, "hi", Enter, Done — then the break is
 * removed and a sentence typed. Before the fix every word landed on its own
 * line (the line break froze the text as a paragraph as wide as "hi"). Then
 * the safe-area limit, zoom independence, Undo/Redo, save/reload, a manual
 * side resize and the customer editor — all measured from what is drawn.
 *
 * Set SHOT_DIR to also save screenshots.
 */
import { expect, test, type Page } from "@playwright/test";
import { addStudioText } from "./admin-studio-tools";
import { anchorPoint, bodyPoint, selectedIds } from "./customizer-fixture";

const TITLE = "Minimal Thank You Card";
const SAFE = 75;
const TEMPLATE = {
  enabled: true,
  cardWidthIn: 5,
  cardHeightIn: 7,
  dpi: 300,
  canvasWidthPx: 1500,
  canvasHeightPx: 2100,
  safeArea: { top: SAFE, right: SAFE, bottom: SAFE, left: SAFE },
  pages: [{ id: "front", label: "Front", enabled: true }],
  defaultPage: "front",
  fields: [],
  guides: [],
  layers: [],
};
const LONG = "wedding invitations for our family and friends who travel from near and far";

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const header = (page: Page) => studio(page).locator("header");
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

/** The lines the canvas draws for a text object, and its drawn box in document units. */
const drawn = (page: Page, id: string) =>
  page.evaluate((layerId) => {
    const all = Array.from(document.querySelectorAll(`[data-layer-id="${layerId}"]`)) as SVGGElement[];
    const width = (el: Element) => (el as SVGGElement).ownerSVGElement?.getBoundingClientRect().width || 0;
    const group = all.reduce<SVGGElement | null>((best, el) => (!best || width(el) > width(best) ? el : best), null);
    const rect = group?.querySelector("clipPath rect");
    const box = rect ? ["x", "y", "width", "height"].map((name) => Number(rect.getAttribute(name))) : [0, 0, 0, 0];
    return {
      lines: Array.from(group?.querySelectorAll("tspan") || []).map((tspan) => tspan.textContent || ""),
      left: box[0],
      top: box[1],
      width: box[2],
      height: box[3],
    };
  }, id);

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

async function setZoom(page: Page, percent: number) {
  const field = studio(page).getByRole("textbox", { name: "Canvas zoom" }).or(studio(page).getByRole("spinbutton", { name: "Canvas zoom" })).first();
  await field.fill(String(percent));
  await field.press("Enter");
  await page.waitForTimeout(400);
}

async function newText(page: Page, typed: string) {
  await addStudioText(page);
  await expect(page.locator('[aria-label="Edit text on canvas"]')).toBeVisible();
  await page.keyboard.type(typed, { delay: 20 });
  await page.keyboard.press("Control+Enter");
  let id = "";
  await expect.poll(async () => (id = (await selectedIds(page))[0] || "")).not.toBe("");
  await page.evaluate(() => document.fonts.ready);
  return id;
}

test.describe("Design Studio: text grows until the safe area, then wraps", () => {
  test("the video's steps: 'hi', Enter, Done, then the break removed and a sentence typed — one line, never a word per line", async ({ page }) => {
    await openStudio(page);
    await addStudioText(page);
    await page.keyboard.type("hi", { delay: 40 });
    await page.keyboard.press("Enter");
    await page.keyboard.press("Control+Enter");
    let id = "";
    await expect.poll(async () => (id = (await selectedIds(page))[0] || "")).not.toBe("");
    await expect.poll(async () => (await drawn(page, id)).lines.length).toBe(2);

    // Later: the break removed, more typed (through the inspector, a second edit session).
    await content(page).fill("hi hi hi how are you");
    await expect.poll(async () => (await drawn(page, id)).lines).toEqual(["hi hi hi how are you"]);
    const sentence = await drawn(page, id);
    await shot(page, "safe-width-sentence");

    // Back to "hi": the box shrinks to it again.
    await content(page).fill("hi");
    await expect.poll(async () => (await drawn(page, id)).width).toBeLessThan(sentence.width / 4);
  });

  test("grows with every word; at the safe area it stops and wraps at words; deleting returns to one line", async ({ page }) => {
    await openStudio(page);
    const id = await newText(page, "hi");
    const widths: number[] = [];
    for (const text of ["hi", "hi hi", "hi hi hi how are you"]) {
      await content(page).fill(text);
      await expect.poll(async () => (await drawn(page, id)).lines).toEqual([text]);
      widths.push((await drawn(page, id)).width);
    }
    expect(widths[1]).toBeGreaterThan(widths[0]);
    expect(widths[2]).toBeGreaterThan(widths[1]);
    expect(widths[2]).toBeLessThan(1500 - 2 * SAFE);

    await content(page).fill(LONG);
    await expect.poll(async () => (await drawn(page, id)).lines.length).toBeGreaterThan(1);
    const wrapped = await drawn(page, id);
    // Exactly the safe area's width, inside it; whole words on every line.
    expect(wrapped.width).toBe(1500 - 2 * SAFE);
    expect(wrapped.left).toBeGreaterThanOrEqual(SAFE - 0.5);
    expect(wrapped.left + wrapped.width).toBeLessThanOrEqual(1500 - SAFE + 0.5);
    const words = new Set(LONG.split(" "));
    for (const line of wrapped.lines) for (const word of line.trim().split(/\s+/)) expect(words.has(word)).toBe(true);
    // Auto height: one line's height per line.
    expect(wrapped.height).toBeGreaterThan(widths.length && (await drawn(page, id)).lines.length * 60);
    await shot(page, "safe-width-wrapped");

    // Zoom never changes the wrap.
    for (const zoom of [50, 200, 100]) {
      await setZoom(page, zoom);
      expect((await drawn(page, id)).lines).toEqual(wrapped.lines);
    }

    // Undo / Redo restore the exact geometry.
    await page.locator("[data-canvas-surface]").first().click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await drawn(page, id)).lines).toEqual(["hi hi hi how are you"]);
    await page.keyboard.press("Control+y");
    await expect.poll(async () => (await drawn(page, id)).lines).toEqual(wrapped.lines);

    // Save and reload: the same lines, the same mode.
    const saved = await savedTemplate(page);
    const layer = saved.layers.find((entry: any) => entry.id === id);
    expect(layer.textStyle).toMatchObject({ autoSizeMode: "safe-width", fontSize: 70.83 });
    await page.reload();
    await openStudio(page, false);
    await expect.poll(async () => (await drawn(page, id)).lines).toEqual(wrapped.lines);

    // Deleting words: back to one tight line.
    const point = await bodyPoint(page, id);
    await page.mouse.click(point.x, point.y);
    await content(page).fill("wedding invitations");
    await expect.poll(async () => (await drawn(page, id)).lines).toEqual(["wedding invitations"]);
    expect((await drawn(page, id)).width).toBeLessThan(wrapped.width * 0.6);
  });

  test("a font-size change re-wraps, and returns", async ({ page }) => {
    await openStudio(page);
    const id = await newText(page, "wedding invitations for our family");
    await expect.poll(async () => (await drawn(page, id)).lines).toHaveLength(1);
    const size = page.locator("[data-admin-toolbar]").getByRole("textbox", { name: "Font size" }).or(page.locator("[data-admin-toolbar]").getByRole("spinbutton", { name: "Font size" })).first();
    await size.fill("30");
    await size.press("Enter");
    await expect.poll(async () => (await drawn(page, id)).lines.length).toBeGreaterThan(1);
    await size.fill("17");
    await size.press("Enter");
    await expect.poll(async () => (await drawn(page, id)).lines).toEqual(["wedding invitations for our family"]);
  });

  test("a manual side resize makes it a fixed-width paragraph that keeps its width while typing", async ({ page }) => {
    await openStudio(page);
    const id = await newText(page, "wedding invitations for our family");
    const before = await drawn(page, id);
    await page.waitForTimeout(300);
    const handle = await anchorPoint(page, "middle-right");
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) await page.mouse.move(handle.x - step * 14, handle.y);
    await page.mouse.up();
    await expect.poll(async () => (await drawn(page, id)).width).toBeLessThan(before.width - 60);
    const manual = await drawn(page, id);
    expect(manual.lines.length).toBeGreaterThan(1);
    let saved = await savedTemplate(page);
    expect(saved.layers.find((entry: any) => entry.id === id).textStyle.autoSizeMode).toBe("height");

    // Typing keeps the chosen width.
    await content(page).fill("wedding invitations for our family and friends");
    await expect.poll(async () => (await drawn(page, id)).lines.length).toBeGreaterThan(manual.lines.length);
    expect(Math.abs((await drawn(page, id)).width - manual.width)).toBeLessThanOrEqual(1);

    // Undo returns it to automatic width.
    await page.locator("[data-canvas-surface]").first().click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    saved = await savedTemplate(page);
    expect(saved.layers.find((entry: any) => entry.id === id).textStyle.autoSizeMode).toBe("safe-width");
  });
});

test.describe("Customer editor: text grows until the safe area, then wraps", () => {
  test("a sentence stays on one line while there is room; a long one wraps at words", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/__e2e/customizer");
    const root = page.locator("[data-customizer-root]");
    await expect(root).toBeVisible();
    const toggle = page.getByRole("button", { name: /^(Advanced Customize|Advanced)$/ });
    if (await toggle.count()) await toggle.first().click();
    await root.getByRole("button", { name: "Text", exact: true }).click();
    const editor = page.locator('[aria-label="Edit text on canvas"]');
    await expect(editor).toBeVisible();
    await page.keyboard.type("hi hi hi how are you", { delay: 15 });
    // The object being typed into, found by what it draws.
    let id = "";
    await expect
      .poll(async () => (id = await page.evaluate(() => {
        const group = Array.from(document.querySelectorAll("[data-layer-id]")).find((element) => element.textContent?.includes("hi hi hi how are you"));
        return group?.getAttribute("data-layer-id") || "";
      })))
      .not.toBe("");
    await expect.poll(async () => (await drawn(page, id)).lines).toEqual(["hi hi hi how are you"]);
    await editor.fill(LONG);
    await expect.poll(async () => (await drawn(page, id)).lines.length).toBeGreaterThan(1);
    await page.keyboard.press("Control+Enter");
    await shot(page, "safe-width-customer");
  });
});
