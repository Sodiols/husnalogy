/**
 * Text curve in the Design Studio (lib/customizer/v2/text-curve.ts).
 *
 * Drives the real studio on /__e2e/admin-dashboard: the Design tab control,
 * the canvas rendering, the selection frame, undo/redo, multiline, the saved
 * template and a reopen. The renderer and print parity are covered by
 * lib/customizer/v2/__tests__/text-curve.test.ts and e2e/render-parity.spec.ts.
 */
import { expect, test, type Page } from "@playwright/test";
import { bodyPoint, selectedIds } from "./customizer-fixture";

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
    { id: "t_names", page: "front", type: "text", text: "Olivia & Noah", x: 750, y: 900, width: 900, height: 120, zIndex: 1, textStyle: { fontFamily: "Inter", fontSize: 110, color: "#303839", autoSizeMode: "width" } },
  ],
};

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const header = (page: Page) => studio(page).locator("header");
const control = (page: Page) => page.locator("[data-text-curve-control]");
const slider = (page: Page) => control(page).locator('input[type="range"]');
const valueBox = (page: Page) => control(page).locator('input:not([type="range"])');
/** The curve the canvas draws, or null for straight text. Never waits: an absent element is an answer. */
async function drawnCurve(page: Page): Promise<string | null> {
  const curved = page.locator('[data-canvas-surface] [data-layer-id="t_names"] [data-text-curve]');
  if (!(await curved.count())) return null;
  return curved.first().getAttribute("data-text-curve", { timeout: 2_000 }).catch(() => null);
}

async function seedDesign(page: Page) {
  await page.evaluate(({ name, value }) => {
    const products = (window as any).__adminFixture.store.products.map((entry: any) => (entry.title === name ? { ...entry, customizerTemplate: value } : entry));
    window.sessionStorage.setItem("__adminFixtureDurable", JSON.stringify({ products, versions: {} }));
  }, { name: TITLE, value: TEMPLATE });
  await page.reload();
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
}

async function openStudio(page: Page) {
  await page.getByRole("button", { name: `Edit ${TITLE}` }).first().click();
  const enable = page.getByRole("switch", { name: /Enable product customizer/ });
  await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
  if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
  await page.getByRole("button", { name: "Open Design Studio" }).click();
  await expect(header(page)).toBeVisible();
  await expect(page.locator('[data-canvas-surface] [data-layer-id="t_names"]').first()).toBeAttached();
}

async function selectNames(page: Page) {
  const point = await bodyPoint(page, "t_names");
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => selectedIds(page)).toEqual(["t_names"]);
  await expect(control(page)).toBeVisible();
}

/** A real pointer drag along the slider track, so the browser fires the same events a designer's hand does. */
async function dragSliderTo(page: Page, value: number) {
  const box = (await slider(page).boundingBox())!;
  const start = await slider(page).inputValue();
  const toX = (v: number) => box.x + ((v + 100) / 200) * box.width;
  await page.mouse.move(toX(Number(start)), box.y + box.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) {
    const v = Number(start) + ((value - Number(start)) * step) / 12;
    await page.mouse.move(toX(v), box.y + box.height / 2);
  }
  await page.mouse.up();
}

async function typeCurve(page: Page, value: string) {
  await valueBox(page).fill(value);
  await valueBox(page).press("Enter");
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

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.goto("/__e2e/admin-dashboard?section=Products");
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  await seedDesign(page);
  await openStudio(page);
  await selectNames(page);
});

test("the Text curve control sits under Letter spacing / Line height and above Text growth", async ({ page }) => {
  const order = await page.locator("[data-customizer-text-interaction] span.block").allTextContents();
  const at = (label: string) => order.indexOf(label);
  expect(at("Letter spacing")).toBeGreaterThan(-1);
  expect(at("Text curve")).toBeGreaterThan(at("Line height"));
  expect(at("Text growth")).toBeGreaterThan(at("Text curve"));
  await expect(slider(page)).toHaveAttribute("min", "-100");
  await expect(slider(page)).toHaveAttribute("max", "100");
  await expect(slider(page)).toHaveValue("0");
  // Straight by default: no path, no Reset.
  expect(await drawnCurve(page)).toBeNull();
  await expect(control(page).getByRole("button", { name: "Reset" })).toHaveCount(0);
});

test("dragging bends the text live, keeps its centre, and lands as ONE undo step", async ({ page }) => {
  const layer = page.locator('[data-canvas-surface] [data-layer-id="t_names"]').first();
  const straight = (await layer.boundingBox())!;
  await dragSliderTo(page, 60);
  await expect.poll(() => drawnCurve(page)).not.toBeNull();
  const curve = Number(await drawnCurve(page));
  expect(curve).toBeGreaterThan(40);
  // Slider and number agree.
  await expect(valueBox(page)).toHaveValue(String(curve));
  await expect(slider(page)).toHaveValue(String(curve));
  // Bent upward in place: taller, same centre.
  const arched = (await layer.boundingBox())!;
  expect(arched.height).toBeGreaterThan(straight.height * 1.6);
  expect(Math.abs(arched.x + arched.width / 2 - (straight.x + straight.width / 2))).toBeLessThan(6);
  await expect(layer.locator("textPath")).toHaveText("Olivia & Noah");

  // One drag = one undo step back to straight, and redo restores it.
  await header(page).getByRole("button", { name: /^Undo/ }).click();
  await expect.poll(() => drawnCurve(page)).toBeNull();
  await expect(layer).toContainText("Olivia & Noah");
  await header(page).getByRole("button", { name: /^Redo/ }).click();
  await expect.poll(() => drawnCurve(page)).toBe(String(curve));
});

test("typed values are validated, negative values smile, Reset straightens", async ({ page }) => {
  await typeCurve(page, "250");
  await expect.poll(() => drawnCurve(page)).toBe("100");
  await expect(valueBox(page)).toHaveValue("100");
  await typeCurve(page, "-45");
  await expect.poll(() => drawnCurve(page)).toBe("-45");
  await control(page).getByRole("button", { name: "Reset" }).click();
  await expect.poll(() => drawnCurve(page)).toBeNull();
  await expect(slider(page)).toHaveValue("0");
});

test("rapid slider changes settle on the final value with no broken geometry", async ({ page }) => {
  for (const value of [10, 90, -80, 35, -5, 70]) await dragSliderTo(page, value);
  await expect.poll(() => drawnCurve(page)).toBe(await valueBox(page).inputValue());
  const markup = await page.locator('[data-canvas-surface] [data-layer-id="t_names"]').first().innerHTML();
  expect(markup).not.toMatch(/NaN|Infinity/);
});

test("Multiline disables the curve without losing it", async ({ page }) => {
  await typeCurve(page, "40");
  await expect.poll(() => drawnCurve(page)).toBe("40");
  await page.getByLabel("Multiline (wraps in box)").check();
  await expect(slider(page)).toBeDisabled();
  await expect(control(page)).toContainText("Text curve works on single-line text.");
  await expect.poll(() => drawnCurve(page)).toBeNull();
  await page.getByLabel("Multiline (wraps in box)").uncheck();
  await expect.poll(() => drawnCurve(page)).toBe("40");
});

test("the curve is saved, and survives reopening the design", async ({ page }) => {
  await typeCurve(page, "-30");
  await expect.poll(() => drawnCurve(page)).toBe("-30");
  const saved = await savedTemplate(page);
  expect(saved.layers.find((layer: any) => layer.id === "t_names").textStyle.curve).toBe(-30);
  // Reopen from the saved product.
  await page.reload();
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  await openStudio(page);
  await expect.poll(() => drawnCurve(page)).toBe("-30");
});
