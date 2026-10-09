/**
 * Numeric fields (letter spacing, line height, font size, corner radius) edit
 * like ordinary text fields, in the Design Studio and the customer customizer:
 *
 *  - a click puts the caret where it lands, so Backspace removes ONE
 *    character, and the field can be emptied before typing a new number;
 *  - Tab into a field selects its value, so typing replaces it;
 *  - an emptied field committed by leaving it changes nothing;
 *  - in the studio inspector, letter spacing, line height and corner radius
 *    have up / down buttons inside the field: half a unit per click, never
 *    past the field's limits, and the value is what Save Draft sends.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { bodyPoint, openFixture, selectLayer, selectedIds, switchToAdvancedCustomize } from "./customizer-fixture";

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
    { id: "t_text", page: "front", type: "text", text: "Hello", x: 750, y: 600, width: 600, height: 120, zIndex: 1, textStyle: { fontFamily: "Inter", fontSize: 60, letterSpacing: 1.36, lineHeight: 1, autoSizeMode: "fixed" } },
    { id: "s_rect", page: "front", type: "shape", shape: "rounded-rectangle", x: 750, y: 1400, width: 400, height: 300, zIndex: 2, fill: "#d4af37", borderRadius: 4 },
  ],
};

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const field = (page: Page, name: string) => studio(page).locator(`input[aria-label="${name}"]`).last();

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
  await expect(studio(page).locator("header")).toBeVisible();
}

async function selectStudioLayer(page: Page, id: string) {
  const point = await bodyPoint(page, id);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => selectedIds(page)).toEqual([id]);
}

/** Click inside the field just before its right edge, as a person putting the caret after the last digit. */
async function clickAtEnd(page: Page, input: Locator, rightInset = 8) {
  await input.scrollIntoViewIfNeeded();
  const box = (await input.boundingBox())!;
  await page.mouse.click(box.x + box.width - rightInset, box.y + box.height / 2);
  await expect(input).toBeFocused();
  await page.keyboard.press("End");
}

/** The template Save Draft sends. */
async function savedTemplate(page: Page) {
  const before = await page.evaluate(() => (window as any).__adminFixture.requests.length);
  await studio(page).locator("header").getByRole("button", { name: /Save Draft/ }).click();
  await expect.poll(() => page.evaluate((count) => (window as any).__adminFixture.requests.length > count, before)).toBe(true);
  await expect(studio(page).locator("header").getByText("Unsaved", { exact: true })).toHaveCount(0, { timeout: 15_000 });
  return page.evaluate(() => {
    const saves = (window as any).__adminFixture.requests.filter((entry: any) => /^\/api\/admin\/products(\/[^/]+)?$/.test(entry.path));
    return saves[saves.length - 1].body.customizerTemplate;
  });
}
const savedLayer = (template: any, id: string) => template.layers.find((layer: any) => layer.id === id);

test.describe("Design Studio inspector", () => {
  test("Backspace removes one character; a field can be emptied and retyped; Tab selects the value", async ({ page }) => {
    await openStudio(page);
    await selectStudioLayer(page, "t_text");
    const spacing = field(page, "Letter spacing");
    const lineHeight = field(page, "Line height");
    await expect(spacing).toHaveValue("1.36");
    await expect(lineHeight).toHaveValue("1");

    // A click leaves the caret where it landed (right of the up/down buttons' padding).
    await clickAtEnd(page, spacing, 40);
    expect(await spacing.evaluate((input: HTMLInputElement) => input.selectionStart === input.selectionEnd)).toBe(true);
    await page.keyboard.press("Backspace");
    await expect(spacing).toHaveValue("1.3");
    for (let index = 0; index < 3; index += 1) await page.keyboard.press("Backspace");
    await expect(spacing).toHaveValue("");
    await page.keyboard.type("2.5");
    await page.keyboard.press("Enter");
    await expect(spacing).toHaveValue("2.5");

    // A single-character value can be deleted too, then replaced.
    await clickAtEnd(page, lineHeight, 40);
    await page.keyboard.press("Backspace");
    await expect(lineHeight).toHaveValue("");
    await page.keyboard.type("1.25");
    await page.keyboard.press("Tab");
    await expect(lineHeight).toHaveValue("1.25");

    // Tab INTO a field selects the whole value: typing replaces it.
    await spacing.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(spacing).toBeFocused();
    await expect.poll(() => spacing.evaluate((input: HTMLInputElement) => input.selectionEnd! - input.selectionStart!)).toBe(3);
    await page.keyboard.type("4");
    await page.keyboard.press("Enter");
    await expect(spacing).toHaveValue("4");

    // Emptied and left: nothing changes.
    await clickAtEnd(page, spacing, 40);
    await page.keyboard.press("Backspace");
    await expect(spacing).toHaveValue("");
    await page.keyboard.press("Tab");
    await expect(spacing).toHaveValue("4");

    const saved = savedLayer(await savedTemplate(page), "t_text");
    expect(saved.textStyle).toMatchObject({ letterSpacing: 4, lineHeight: 1.25 });
  });

  test("letter spacing, line height and corner radius step by 0.5 with the up / down buttons, within their limits", async ({ page }) => {
    await openStudio(page);
    await selectStudioLayer(page, "t_text");
    const up = (name: string) => studio(page).getByRole("button", { name: `Increase ${name}`, exact: true });
    const down = (name: string) => studio(page).getByRole("button", { name: `Decrease ${name}`, exact: true });

    await up("Letter spacing").click();
    await expect(field(page, "Letter spacing")).toHaveValue("1.86");
    await up("Letter spacing").click();
    await expect(field(page, "Letter spacing")).toHaveValue("2.36");
    await down("Letter spacing").click();
    await expect(field(page, "Letter spacing")).toHaveValue("1.86");

    await up("Line height").click();
    await expect(field(page, "Line height")).toHaveValue("1.5");
    await down("Line height").click();
    await down("Line height").click();
    // 0.5 is line height's minimum: the down button stops there.
    await expect(field(page, "Line height")).toHaveValue("0.5");
    await expect(down("Line height")).toBeDisabled();

    // A step applies to what is typed so far, without leaving the field.
    await clickAtEnd(page, field(page, "Line height"), 40);
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("2");
    await up("Line height").click();
    await expect(field(page, "Line height")).toHaveValue("2.5");
    await expect(field(page, "Line height")).toBeFocused();
    await page.keyboard.press("Escape");

    let saved = savedLayer(await savedTemplate(page), "t_text");
    expect(saved.textStyle).toMatchObject({ letterSpacing: 1.86, lineHeight: 2.5 });

    await selectStudioLayer(page, "s_rect");
    const radius = field(page, "Shape corner radius");
    await expect(radius).toHaveValue("4");
    await up("Shape corner radius").click();
    await expect(radius).toHaveValue("4.5");
    for (let index = 0; index < 9; index += 1) await down("Shape corner radius").click();
    await expect(radius).toHaveValue("0");
    await expect(down("Shape corner radius")).toBeDisabled();
    await up("Shape corner radius").click();
    saved = savedLayer(await savedTemplate(page), "s_rect");
    expect(saved.borderRadius).toBe(0.5);
  });

  test("font size (pt): Backspace removes one digit and the new size is kept", async ({ page }) => {
    await openStudio(page);
    await selectStudioLayer(page, "t_text");
    const size = field(page, "Font size (pt)").or(field(page, "Font size")).first();
    const before = await size.inputValue();
    await clickAtEnd(page, size);
    await page.keyboard.press("Backspace");
    await expect(size).toHaveValue(before.slice(0, -1));
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await expect(size).toHaveValue("");
    await page.keyboard.type("36");
    await page.keyboard.press("Enter");
    await expect(size).toHaveValue("36");
  });
});

test.describe("customer customizer", () => {
  test("letter spacing and line height: Backspace removes one character, the field can be emptied and retyped", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFixture(page);
    await switchToAdvancedCustomize(page);
    await selectLayer(page, "fx_title");
    const root = page.locator("[data-customizer-root]");
    for (const [name, typed] of [["Letter spacing", "3"], ["Line height", "1.5"]] as const) {
      const input = root.locator(`input[aria-label="${name}"]`).first();
      await expect(input).toBeVisible();
      const before = await input.inputValue();
      await clickAtEnd(page, input, 6);
      await page.keyboard.press("Backspace");
      await expect(input).toHaveValue(before.slice(0, -1));
      for (let index = 0; index < before.length; index += 1) await page.keyboard.press("Backspace");
      await expect(input).toHaveValue("");
      await page.keyboard.type(typed);
      await page.keyboard.press("Enter");
      await expect(input).toHaveValue(typed);
    }
  });
});
