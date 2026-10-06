/**
 * Text growth direction in the customer editor (Customizer Point 11).
 *
 * The customer picks Upward, Center or Downward from the text alignment menu.
 * The named edge holds while they type — live, not only after Done — and the
 * choice survives Undo, a refresh and a duplicate.
 */
import { expect, test, type Page } from "@playwright/test";
import { openFixture, readDraft, selectedIds, switchToAdvancedCustomize, waitForEditor } from "./customizer-fixture";

const root = (page: Page) => page.locator("[data-customizer-root]");
const editor = (page: Page) => page.locator('[aria-label="Edit text on canvas"]');

/** The drawn box's top, centre and bottom mid-points in canvas units, after its rotation. */
const edges = (page: Page, id: string) =>
  page.evaluate((layerId) => {
    const group = document.querySelector(`[data-customizer-canvas="main"] [data-layer-id="${layerId}"] > g`)!;
    const rect = group.querySelector("clipPath rect")!;
    const [x, y, w, h] = ["x", "y", "width", "height"].map((name) => Number(rect.getAttribute(name)));
    const match = /rotate\(([-\d.e]+) ([-\d.e]+) ([-\d.e]+)\)/.exec(group.getAttribute("transform") || "");
    const [angle, cx, cy] = match ? match.slice(1).map(Number) : [0, x + w / 2, y + h / 2];
    const radians = (angle * Math.PI) / 180;
    const turn = (px: number, py: number) => ({
      x: cx + (px - cx) * Math.cos(radians) - (py - cy) * Math.sin(radians),
      y: cy + (px - cx) * Math.sin(radians) + (py - cy) * Math.cos(radians),
    });
    return { top: turn(x + w / 2, y), centre: turn(x + w / 2, y + h / 2), bottom: turn(x + w / 2, y + h), height: h };
  }, id);

const near = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(0.5);
};

async function addParagraph(page: Page): Promise<string> {
  await openFixture(page, "?snap=0");
  await switchToAdvancedCustomize(page);
  await root(page).getByRole("button", { name: "Text", exact: true }).click();
  await expect(editor(page)).toBeVisible();
  await page.keyboard.type("One");
  await page.keyboard.press("Control+Enter");
  await expect(editor(page)).toHaveCount(0);
  let id = "";
  await expect.poll(async () => (id = (await selectedIds(page))[0] || "")).not.toBe("");
  return id;
}

async function chooseGrowth(page: Page, label: "upward" | "center" | "downward") {
  await page.getByRole("button", { name: /^Text alignment/ }).first().click();
  const option = page.getByRole("menuitemradio", { name: `Text grows ${label}` });
  await option.click();
  await page.getByRole("button", { name: /^Text alignment/ }).first().click();
  await expect(page.getByRole("menuitemradio", { name: `Text grows ${label}` })).toHaveAttribute("aria-checked", "true");
  // Close with the menu's own button: Escape would also clear the selection.
  await page.getByRole("button", { name: /^Text alignment/ }).first().click();
  await expect(page.getByRole("menu", { name: "Text alignment" })).toHaveCount(0);
}

test.use({ viewport: { width: 1440, height: 900 } });

test.describe("customer text growth", () => {
  test("Upward: the bottom edge holds while typing, after Done, after Undo and after a refresh", async ({ page }) => {
    const id = await addParagraph(page);
    await chooseGrowth(page, "upward");
    const before = await edges(page, id);

    await root(page).getByRole("button", { name: "Edit Text", exact: true }).click();
    await expect(editor(page)).toBeVisible();
    await page.keyboard.press("End");
    for (const line of ["Two", "Three"]) {
      await page.keyboard.press("Enter");
      await page.keyboard.type(line);
      // Live, while the editor is still open.
      await expect.poll(async () => (await edges(page, id)).height).toBeGreaterThan(before.height);
      near((await edges(page, id)).bottom, before.bottom);
    }
    await page.keyboard.press("Control+Enter");
    await expect(editor(page)).toHaveCount(0);
    const grown = await edges(page, id);
    expect(grown.height).toBeGreaterThan(before.height * 2);
    near(grown.bottom, before.bottom);

    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await edges(page, id)).height).toBe(before.height);
    near((await edges(page, id)).bottom, before.bottom);
    await page.keyboard.press("Control+y");
    await expect.poll(async () => (await edges(page, id)).height).toBe(grown.height);

    await expect.poll(async () => (await readDraft(page))?.renderData?.editorState?.userLayers?.find((layer: any) => layer.id === id)?.textStyle?.growthDirection).toBe("up");
    await page.reload();
    await waitForEditor(page);
    const restored = await edges(page, id);
    expect(restored.height).toBe(grown.height);
    near(restored.bottom, before.bottom);
  });

  test("Center and Downward hold the centre and the top", async ({ page }) => {
    const id = await addParagraph(page);
    for (const [label, anchor] of [["center", "centre"], ["downward", "top"]] as const) {
      await chooseGrowth(page, label);
      const before = await edges(page, id);
      await root(page).getByRole("button", { name: "Edit Text", exact: true }).click();
      await expect(editor(page)).toBeVisible();
      await page.keyboard.press("Control+End");
      await page.keyboard.press("Enter");
      await page.keyboard.type("More");
      await page.keyboard.press("Control+Enter");
      await expect(editor(page)).toHaveCount(0);
      const after = await edges(page, id);
      expect(after.height).toBeGreaterThan(before.height);
      near(after[anchor], before[anchor]);
    }
  });

  test("a duplicate keeps the direction", async ({ page }) => {
    const id = await addParagraph(page);
    await chooseGrowth(page, "upward");
    await page.keyboard.press("Control+d");
    let copy = "";
    await expect.poll(async () => (copy = (await selectedIds(page)).find((candidate) => candidate !== id) || "")).not.toBe("");
    await expect.poll(async () => (await readDraft(page))?.renderData?.editorState?.userLayers?.find((layer: any) => layer.id === copy)?.textStyle?.growthDirection).toBe("up");
  });
});
