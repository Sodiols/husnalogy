/**
 * Shape and line colours with a real Transparent (Customizer Point 5).
 *
 * Transparent must be the renderer's "no paint" (`fill="none"`), never white,
 * and must survive Undo, Redo and a refresh exactly like any other colour.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
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

/**
 * Dragging inside Chrome's colour picker delivers a BURST of `input` events in
 * one task. Committing each one used to throw React's "Maximum update depth
 * exceeded" (PaintControl → every colour input). The burst must update the
 * design live, without that error. Ends on #9f9fa0.
 */
const BURST_FINAL = "#9f9fa0";
async function dragColourPicker(input: Locator) {
  await input.evaluate((element: HTMLInputElement) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    for (let step = 0; step < 120; step += 1) {
      const channel = (40 + step).toString(16).padStart(2, "0");
      setter.call(element, `#${channel}${channel}a0`);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}
const closeColourPicker = (input: Locator) => input.evaluate((element: HTMLInputElement) => element.dispatchEvent(new Event("change", { bubbles: true })));
function updateDepthErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Maximum update depth/.test(message.text())) errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    if (/Maximum update depth/.test(error.message)) errors.push(error.message);
  });
  return errors;
}

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

  test("dragging the Fill Colour picker updates the shape live without exceeding React's update depth", async ({ page }) => {
    const errors = updateDepthErrors(page);
    await openFixture(page, "?snap=0");
    await selectLayer(page, "fx_shape");
    const input = paintGroup(page, "Fill Colour").getByLabel("Fill Colour colour");
    await dragColourPicker(input);
    await expect.poll(async () => (await shapePaint(page, "fx_shape")).fill?.toLowerCase()).toBe(BURST_FINAL);
    await closeColourPicker(input);
    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
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

test.describe("Design Studio: a line's toolbar colour offers Transparent (task 08)", () => {
  test("transparent hides the stroke but keeps the line: selectable from Layers, colour restores it, Undo/Redo, copy/paste, save", async ({ page }) => {
    const TITLE = "Minimal Thank You Card";
    const template = {
      enabled: true, cardWidthIn: 5, cardHeightIn: 7, dpi: 300, canvasWidthPx: 1500, canvasHeightPx: 2100,
      pages: [{ id: "front", label: "Front", enabled: true }], defaultPage: "front", fields: [], guides: [],
      layers: [{ id: "ln", name: "Line", page: "front", type: "shape", shape: "line", x: 750, y: 1000, width: 700, height: 24, zIndex: 1, stroke: "#27307a", strokeWidth: 8 }],
    };
    await page.goto("/__e2e/admin-dashboard?section=Products");
    await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
    await page.evaluate(({ name, value }) => {
      const products = (window as any).__adminFixture.store.products.map((entry: any) => (entry.title === name ? { ...entry, customizerTemplate: value } : entry));
      window.sessionStorage.setItem("__adminFixtureDurable", JSON.stringify({ products, versions: {} }));
    }, { name: TITLE, value: template });
    await page.reload();
    await page.getByRole("button", { name: `Edit ${TITLE}` }).first().click();
    const enable = page.getByRole("switch", { name: /Enable product customizer/ });
    await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
    if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
    await page.getByRole("button", { name: "Open Design Studio" }).click();
    const studio = page.locator("[data-admin-customizer]");
    const header = studio.locator("header");
    const toolbar = page.locator("[data-admin-toolbar]");
    const lineStroke = (id = "ln") => page.evaluate((layerId) => document.querySelector(`[data-admin-customizer] [data-canvas-surface] [data-layer-id="${layerId}"] line`)?.getAttribute("stroke"), id);
    const saved = async () => {
      const before = await page.evaluate(() => (window as any).__adminFixture.requests.length);
      await header.getByRole("button", { name: /Save Draft/ }).click();
      await expect.poll(() => page.evaluate((count) => (window as any).__adminFixture.requests.length > count, before)).toBe(true);
      await expect(header.getByText("Unsaved", { exact: true })).toHaveCount(0, { timeout: 15_000 });
      return page.evaluate(() => {
        const saves = (window as any).__adminFixture.requests.filter((entry: any) => /^\/api\/admin\/products(\/[^/]+)?$/.test(entry.path));
        return saves[saves.length - 1].body.customizerTemplate.layers as any[];
      });
    };

    // Select the line from Layers and make its colour Transparent from the toolbar.
    await studio.getByRole("navigation", { name: "Design tools" }).getByRole("button", { name: "Layers", exact: true }).click();
    await studio.locator('[data-admin-side-panel="layers"]').getByText("Line", { exact: true }).first().click();
    await toolbar.getByRole("button", { name: /^Line color/ }).click();
    // The toolbar popover's swatch (the inspector has its own Transparent button).
    await page.locator('[data-toolbar-menu-item][aria-label="Transparent"]').click();
    await expect.poll(() => lineStroke()).toBe("none");
    let layers = await saved();
    expect(layers.find((layer) => layer.id === "ln")).toMatchObject({ stroke: "none", strokeWidth: 8, width: 700, x: 750, y: 1000 });

    // Still there and selectable: Layers selects it; the weight still edits.
    await page.locator("[data-canvas-surface]").first().click({ position: { x: 5, y: 5 } });
    await studio.locator('[data-admin-side-panel="layers"]').getByText("Line", { exact: true }).first().click();
    await expect(toolbar.getByRole("button", { name: /^Line color: Transparent/ })).toBeVisible();

    // Undo restores the colour; Redo hides it again.
    await page.keyboard.press("Control+z");
    await expect.poll(() => lineStroke()).toBe("#27307a");
    await page.keyboard.press("Control+y");
    await expect.poll(() => lineStroke()).toBe("none");

    // Copy and paste keep the transparent stroke.
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    layers = await saved();
    const lines = layers.filter((layer) => layer.shape === "line");
    expect(lines).toHaveLength(2);
    expect(lines.every((layer) => layer.stroke === "none")).toBe(true);

    // A colour brings it back.
    await studio.locator('[data-admin-side-panel="layers"]').getByText("Line", { exact: true }).first().click();
    await toolbar.getByRole("button", { name: /^Line color/ }).click();
    const hex = page.getByRole("textbox", { name: /hex/i }).last();
    await hex.fill("#ff0000");
    await hex.press("Enter");
    await expect.poll(async () => (await saved()).filter((layer) => layer.shape === "line").some((layer) => layer.stroke === "#ff0000")).toBe(true);
  });
});

test.describe("Design Studio paint, end to end", () => {
  test("dragging the Fill Colour picker: live, no update-depth error, one undo step per frame", async ({ page }) => {
    const errors = updateDepthErrors(page);
    await page.goto("/__e2e/admin-dashboard?section=Products");
    await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Add product" }).first().click();
    await page.getByPlaceholder("Describe the product the way a customer would search for it").fill("Picker Card");
    const enable = page.getByRole("switch", { name: /Enable product customizer/ });
    await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
    if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
    await page.getByRole("button", { name: "Open Design Studio" }).click();
    const studio = page.locator("[data-admin-customizer]");
    await expect(studio.locator("header")).toBeVisible();
    await addStudioShape(page, "rectangle");
    const fillOf = () => page.evaluate(() => document.querySelector("[data-admin-customizer] [data-canvas-surface] [data-layer-id] rect")?.getAttribute("fill"));
    expect(await fillOf()).toBe("#F8F6F1");

    const input = studio.getByRole("group", { name: "Fill Colour", exact: true }).getByLabel("Fill Colour colour");
    await dragColourPicker(input);
    await expect.poll(fillOf).toBe(BURST_FINAL);
    await closeColourPicker(input);
    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
    // The whole burst landed within one frame: one undo step, not 120.
    await page.keyboard.press("Control+z");
    await expect.poll(fillOf).toBe("#F8F6F1");
    await page.keyboard.press("Control+y");
    await expect.poll(fillOf).toBe(BURST_FINAL);
  });

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
