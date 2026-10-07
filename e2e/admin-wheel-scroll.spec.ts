/**
 * Design Studio: the mouse wheel scrolls a zoomed-in artboard.
 *
 * Plain wheel scrolls up and down, Shift+wheel sideways; only the hidden part
 * of the card scrolls (at Fit the wheel leaves it alone). Ctrl/⌘+wheel zooms
 * at the pointer. Selection, hit testing and the zoom buttons stay correct
 * after scrolling.
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
    { id: "t_top", page: "front", type: "text", name: "Top", text: "top line", x: 750, y: 500, width: 600, height: 90, zIndex: 1, textStyle: { fontFamily: "Inter", fontSize: 70.83, autoSizeMode: "safe-width" } },
    { id: "t_bottom", page: "front", type: "text", name: "Bottom", text: "bottom line", x: 750, y: 1800, width: 600, height: 90, zIndex: 2, textStyle: { fontFamily: "Inter", fontSize: 70.83, autoSizeMode: "safe-width" } },
  ],
};

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const zoomField = (page: Page) => studio(page).getByRole("group", { name: "Canvas zoom" }).getByRole("textbox").or(studio(page).getByRole("group", { name: "Canvas zoom" }).getByRole("spinbutton")).first();

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
  await expect.poll(() => bodyPoint(page, "t_top").then(() => true, () => false)).toBe(true);
}

/** Where the card sits on screen, and the workspace around it. */
const geometry = (page: Page) =>
  page.evaluate(() => {
    const surface = document.querySelector("[data-admin-customizer] [data-canvas-surface]")!.getBoundingClientRect();
    const workspace = document.querySelector("[data-admin-customizer] [data-canvas-workspace]")!.getBoundingClientRect();
    return { left: surface.left, top: surface.top, width: surface.width, height: surface.height, workspace: { left: workspace.left, top: workspace.top, right: workspace.right, bottom: workspace.bottom } };
  });

async function setZoom(page: Page, percent: number) {
  await zoomField(page).fill(String(percent));
  await zoomField(page).press("Enter");
  await page.waitForTimeout(400);
}

async function wheelAtCentre(page: Page, dx: number, dy: number, modifier?: "Shift" | "Control") {
  const g = await geometry(page);
  await page.mouse.move((g.workspace.left + g.workspace.right) / 2, (g.workspace.top + g.workspace.bottom) / 2 - 60);
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.wheel(dx, dy);
  if (modifier) await page.keyboard.up(modifier);
  await page.waitForTimeout(250);
}

test.describe("Design Studio: wheel scrolling", () => {
  test("at Fit the wheel leaves the card alone; zoomed in it scrolls down, up and sideways, never past the edge", async ({ page }) => {
    await openStudio(page);
    const fitted = await geometry(page);
    await wheelAtCentre(page, 0, 400);
    expect((await geometry(page)).top).toBeCloseTo(fitted.top, 0);

    await setZoom(page, 250);
    const zoomed = await geometry(page);
    expect(zoomed.height).toBeGreaterThan(fitted.height * 2);

    // Down: the card moves up.
    await wheelAtCentre(page, 0, 300);
    await expect.poll(async () => (await geometry(page)).top).toBeLessThan(zoomed.top - 200);
    // Far down: it stops with the card's bottom edge just inside the workspace.
    for (let index = 0; index < 15; index += 1) await wheelAtCentre(page, 0, 400);
    const bottom = await geometry(page);
    expect(bottom.top + bottom.height).toBeGreaterThan(bottom.workspace.bottom - 120);
    expect(bottom.top + bottom.height).toBeLessThan(bottom.workspace.bottom + 1);
    // The lower text is now reachable and selectable.
    const point = await bodyPoint(page, "t_bottom");
    await page.mouse.click(point.x, point.y);
    await expect.poll(() => selectedIds(page)).toEqual(["t_bottom"]);
    // The selection outline sits on the text it selected.
    const aligned = await page.evaluate(() => {
      const stage = (window as any).Konva.stages.find((candidate: any) => candidate.findOne("Transformer")?.nodes().length);
      const node = stage.findOne("Transformer").nodes()[0].getClientRect();
      const box = stage.container().getBoundingClientRect();
      const text = Array.from(document.querySelectorAll('[data-layer-id="t_bottom"] text')).reduce<DOMRect | null>((best, el) => {
        const rect = (el as Element).getBoundingClientRect();
        return !best || rect.width > best.width ? rect : best;
      }, null)!;
      return { selectionCentreY: box.top + node.y + node.height / 2, textCentreY: text.top + text.height / 2 };
    });
    expect(Math.abs(aligned.selectionCentreY - aligned.textCentreY)).toBeLessThan(6);

    // Up again: back to the top edge, not beyond.
    for (let index = 0; index < 20; index += 1) await wheelAtCentre(page, 0, -400);
    const top = await geometry(page);
    expect(top.top).toBeLessThan(top.workspace.top + 1 + 60);
    expect(top.top).toBeGreaterThan(top.workspace.top - 1);

    // Shift+wheel scrolls sideways.
    const before = await geometry(page);
    await wheelAtCentre(page, 0, 300, "Shift");
    await expect.poll(async () => (await geometry(page)).left).toBeLessThan(before.left - 50);
  });

  test("Ctrl+wheel zooms at the pointer, and the zoom buttons keep a scrolled view in place", async ({ page }) => {
    await openStudio(page);
    await wheelAtCentre(page, 0, -300, "Control");
    await expect.poll(async () => Number((await zoomField(page).inputValue()).replace("%", ""))).toBeGreaterThan(150);

    await setZoom(page, 250);
    for (let index = 0; index < 4; index += 1) await wheelAtCentre(page, 0, 300);
    await page.getByRole("button", { name: "Zoom out" }).click();
    await page.waitForTimeout(400);
    // Still on screen: the view zoomed about its centre instead of jumping.
    const g = await geometry(page);
    expect(g.top).toBeLessThan(g.workspace.bottom);
    expect(g.top + g.height).toBeGreaterThan(g.workspace.top);
    // Fit brings everything back.
    await page.getByRole("button", { name: "Zoom options" }).click();
    await page.getByRole("menuitem", { name: "Fit to screen" }).click();
    await page.waitForTimeout(400);
    const fitted = await geometry(page);
    expect(fitted.top).toBeGreaterThanOrEqual(fitted.workspace.top - 1);
    expect(fitted.top + fitted.height).toBeLessThanOrEqual(fitted.workspace.bottom + 1);
  });
});
