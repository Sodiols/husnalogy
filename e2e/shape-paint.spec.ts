/**
 * Shape and line colours with a real Transparent (Customizer Point 5).
 *
 * Transparent must be the renderer's "no paint" (`fill="none"`), never white,
 * and must survive Undo, Redo and a refresh exactly like any other colour.
 */
import { expect, test, type Page } from "@playwright/test";
import { addStudioShape } from "./admin-studio-tools";
import { openFixture, selectLayer, waitForEditor } from "./customizer-fixture";

const shapePaint = (page: Page, layerId: string, selector = "rect") =>
  page.evaluate(
    ({ id, tag }) => {
      const node = document.querySelector(`[data-customizer-canvas="main"] [data-layer-id="${id}"] ${tag}`);
      return { fill: node?.getAttribute("fill"), stroke: node?.getAttribute("stroke"), strokeWidth: node?.getAttribute("stroke-width") };
    },
    { id: layerId, tag: selector },
  );

const panel = (page: Page) => page.locator('[aria-label="Selected item controls"]');
const paintGroup = (page: Page, label: string) => panel(page).getByRole("group", { name: label, exact: true });

test.use({ viewport: { width: 1440, height: 900 } });

test.describe("customer shape paint", () => {
  test("Fill Colour and Line Colour go Transparent (\"none\"), and Undo, Redo and refresh keep it exact", async ({ page }) => {
    await openFixture(page, "?snap=0&autosave=1");
    await selectLayer(page, "fx_shape");
    await expect(paintGroup(page, "Fill Colour")).toBeVisible();
    await expect(paintGroup(page, "Line Colour")).toBeVisible();
    await expect(panel(page).locator('input[aria-label="Line Weight"]')).toBeVisible();
    const original = await shapePaint(page, "fx_shape");
    expect(original.fill?.toLowerCase()).toBe("#d4af37");

    await paintGroup(page, "Fill Colour").getByRole("button", { name: "Transparent" }).click();
    await expect.poll(async () => (await shapePaint(page, "fx_shape")).fill).toBe("none");
    await expect(paintGroup(page, "Fill Colour").getByRole("button", { name: "Transparent" })).toHaveAttribute("aria-pressed", "true");

    await paintGroup(page, "Line Colour").getByRole("button", { name: "Transparent" }).click();
    await expect.poll(async () => (await shapePaint(page, "fx_shape")).stroke).toBe("none");

    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await shapePaint(page, "fx_shape")).stroke?.toLowerCase()).toBe("#303839");
    expect((await shapePaint(page, "fx_shape")).fill).toBe("none");
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await shapePaint(page, "fx_shape")).fill?.toLowerCase()).toBe("#d4af37");
    await page.keyboard.press("Control+y");
    await page.keyboard.press("Control+y");
    await expect.poll(async () => await shapePaint(page, "fx_shape")).toMatchObject({ fill: "none", stroke: "none" });

    await page.reload();
    await waitForEditor(page);
    expect(await shapePaint(page, "fx_shape")).toMatchObject({ fill: "none", stroke: "none" });

    // Choosing a colour again brings the paint back.
    await selectLayer(page, "fx_shape");
    await paintGroup(page, "Fill Colour").getByRole("button", { name: "Transparent" }).click();
    await expect.poll(async () => (await shapePaint(page, "fx_shape")).fill?.toLowerCase()).toBe("#d4af37");
  });

  test("Line Weight changes the stroke width", async ({ page }) => {
    await openFixture(page, "?snap=0");
    await selectLayer(page, "fx_shape");
    const weight = panel(page).locator('input[aria-label="Line Weight"]');
    await weight.fill("12");
    await weight.press("Enter");
    await expect.poll(async () => (await shapePaint(page, "fx_shape")).strokeWidth).toBe("12");
  });

  test("a line offers Line Colour (with Transparent) and Line Weight", async ({ page }) => {
    await openFixture(page, "?snap=0");
    await selectLayer(page, "fx_line");
    await expect(paintGroup(page, "Fill Colour")).toHaveCount(0);
    await paintGroup(page, "Line Colour").getByRole("button", { name: "Transparent" }).click();
    await expect.poll(async () => (await shapePaint(page, "fx_line", "line")).stroke).toBe("none");
  });

  test("with a template palette, only its colours are offered — plus Transparent", async ({ page }) => {
    await openFixture(page, "?snap=0");
    // The fixture has no palette; the free picker and Transparent are both offered.
    await selectLayer(page, "fx_shape");
    await expect(paintGroup(page, "Fill Colour").getByLabel("Fill Colour colour")).toHaveCount(1);
    await expect(paintGroup(page, "Fill Colour").getByRole("button", { name: "Transparent" })).toHaveCount(1);
  });
});

test.describe("Design Studio shape paint", () => {
  test("the inspector sets a transparent fill on a new shape", async ({ page }) => {
    await page.goto("/__e2e/admin-dashboard?section=Products");
    await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Add product" }).first().click();
    const enable = page.getByRole("switch", { name: /Enable product customizer/ });
    // The form renders after the click that opened it: wait for the switch (or a
    // studio that is already enabled) instead of checking visibility once.
    await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
    if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
    await page.getByRole("button", { name: "Open Design Studio" }).click();
    const studio = page.locator("[data-admin-customizer]");
    await expect(studio.locator("header")).toBeVisible();

    await addStudioShape(page, "rectangle");
    const fill = studio.getByRole("group", { name: "Fill Colour", exact: true });
    await expect(fill).toBeVisible();
    const rectFill = () =>
      page.evaluate(() => {
        const rects = [...document.querySelectorAll("[data-canvas-surface] svg rect")];
        return rects.map((rect) => rect.getAttribute("fill"));
      });
    await fill.getByRole("button", { name: "Transparent" }).click();
    await expect.poll(rectFill).toContain("none");
    await expect(fill.getByRole("button", { name: "Transparent" })).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("Design Studio paint, end to end", () => {
  test("transparent fill and line, line weight, one undo per change, and the saved draft keeps \"none\"", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/__e2e/admin-dashboard?section=Products");
    await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Add product" }).first().click();
    await page.getByPlaceholder("Describe the product the way a customer would search for it").fill("Paint Card");
    const enable = page.getByRole("switch", { name: /Enable product customizer/ });
    // The form renders after the click that opened it: wait for the switch (or a
    // studio that is already enabled) instead of checking visibility once.
    await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
    if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
    await page.getByRole("button", { name: "Open Design Studio" }).click();
    const studio = page.locator("[data-admin-customizer]");
    await expect(studio.locator("header")).toBeVisible();
    await addStudioShape(page, "rectangle");

    const paint = () =>
      page.evaluate(() => {
        const rect = document.querySelector("[data-admin-customizer] [data-canvas-surface] [data-layer-id] rect");
        return { fill: rect?.getAttribute("fill"), stroke: rect?.getAttribute("stroke"), width: rect?.getAttribute("stroke-width") };
      });
    const fill = studio.getByRole("group", { name: "Fill Colour", exact: true });
    const line = studio.getByRole("group", { name: "Line Colour", exact: true });
    // A new rectangle has a fill and no line: Line Colour starts Transparent.
    expect(await paint()).toMatchObject({ fill: "#F8F6F1", stroke: "none" });
    await expect(line.getByRole("button", { name: "Transparent" })).toHaveAttribute("aria-pressed", "true");

    await line.getByRole("button", { name: "Transparent" }).click();
    await expect.poll(async () => (await paint()).stroke).toBe("#303839");
    await fill.getByRole("button", { name: "Transparent" }).click();
    await expect.poll(async () => (await paint()).fill).toBe("none");

    // One undo per change: the fill comes back first, then the line goes again.
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await paint()).fill).toBe("#F8F6F1");
    expect((await paint()).stroke).toBe("#303839");
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await paint()).stroke).toBe("none");
    await page.keyboard.press("Control+y");
    await page.keyboard.press("Control+y");
    await expect.poll(paint).toMatchObject({ fill: "none", stroke: "#303839" });
    await line.getByRole("button", { name: "Transparent" }).click();
    await expect.poll(async () => (await paint()).stroke).toBe("none");

    await studio.locator("header").getByRole("button", { name: /Save Draft/ }).click();
    await expect(studio.locator("header").getByText("Unsaved", { exact: true })).toHaveCount(0, { timeout: 15_000 });
    const saved = await page.evaluate(() => {
      const saves = (window as any).__adminFixture.requests.filter((entry: any) => /^\/api\/admin\/products(\/[^/]+)?$/.test(entry.path));
      return saves[saves.length - 1].body.customizerTemplate.layers.find((layer: any) => layer.type === "shape");
    });
    expect(saved).toMatchObject({ fill: "none", stroke: "none" });
  });
});
