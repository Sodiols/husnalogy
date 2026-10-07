/**
 * SVG colour changing (Customizer Point 7).
 *
 * A MULTICOLOUR SVG — which the library does not classify as "tintable" —
 * still offers the colour control, can be recoloured and returned to its
 * Original colours, and keeps its colour through Undo, Redo, duplicate,
 * copy-paste and a refresh.
 */
import { expect, test, type Page } from "@playwright/test";
import { openSidePanel, selectEditTool } from "./admin-studio-tools";
import { bodyPoint, openFixture, selectedIds, switchToAdvancedCustomize, waitForEditor } from "./customizer-fixture";

const MULTICOLOUR_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="80" height="100" fill="#ff0000"/><rect x="120" width="80" height="50" fill="#0000ff"/></svg>',
)}`;

async function serveLibrary(page: Page) {
  await page.route(/\/api\/customizer\/elements(\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        ok: true,
        elements: [{ id: "el-multi", title: "Two Tone Ribbon", url: MULTICOLOUR_SVG, width: 200, height: 100, tintable: false, defaultColor: "", categoryId: "", mimeType: "image/svg+xml" }],
        categories: [],
        total: 1,
        page: 1,
        pageSize: 30,
      },
    }),
  );
}

/** The tint the canvas draws for a layer: its flood colour, or "" for Original. */
const drawnTint = (page: Page, layerId: string) =>
  page.evaluate((id) => {
    const layer = document.querySelector(`[data-customizer-canvas="main"] [data-layer-id="${id}"]`);
    if (!layer) return null;
    const image = layer.querySelector("image");
    if (!image?.getAttribute("filter")) return "";
    return layer.querySelector("feFlood")?.getAttribute("flood-color") || "";
  }, layerId);

const colourGroup = (page: Page) => page.getByRole("toolbar", { name: "Element options" }).getByRole("group", { name: "Element colour" });

async function setColour(page: Page, hex: string) {
  await colourGroup(page).locator('input[type="color"]').evaluate((input: HTMLInputElement, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, hex);
}

test.use({ viewport: { width: 1440, height: 900 } });

test("a multicolour SVG is recoloured, returns to Original, and keeps its colour through history, copies and refresh", async ({ page }) => {
  await serveLibrary(page);
  await openFixture(page, "?snap=0&autosave=1");
  await switchToAdvancedCustomize(page);
  const root = page.locator("[data-customizer-root]");
  await root.getByRole("button", { name: "Elements", exact: true }).click();
  await root.getByRole("button", { name: "Insert Two Tone Ribbon", exact: true }).click();
  const [element] = await selectedIds(page);
  expect(element).toBeTruthy();

  // The control is offered even though the asset is not "tintable", starting on Original.
  await expect(colourGroup(page)).toBeVisible();
  await expect(colourGroup(page).getByRole("button", { name: "Original" })).toHaveAttribute("aria-pressed", "true");
  expect(await drawnTint(page, element)).toBe("");

  await setColour(page, "#2e7d32");
  await expect.poll(() => drawnTint(page, element)).toBe("#2e7d32");

  await colourGroup(page).getByRole("button", { name: "Original" }).click();
  await expect.poll(() => drawnTint(page, element)).toBe("");
  await page.keyboard.press("Control+z");
  await expect.poll(() => drawnTint(page, element)).toBe("#2e7d32");
  await page.keyboard.press("Control+y");
  await expect.poll(() => drawnTint(page, element)).toBe("");
  await page.keyboard.press("Control+z");
  await expect.poll(() => drawnTint(page, element)).toBe("#2e7d32");

  // Duplicate and copy-paste carry the colour.
  await page.keyboard.press("Control+d");
  const [copy] = await selectedIds(page);
  expect(copy).not.toBe(element);
  await expect.poll(() => drawnTint(page, copy)).toBe("#2e7d32");
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  const [pasted] = await selectedIds(page);
  expect([element, copy]).not.toContain(pasted);
  await expect.poll(() => drawnTint(page, pasted)).toBe("#2e7d32");

  await page.reload();
  await waitForEditor(page);
  for (const id of [element, copy, pasted]) expect(await drawnTint(page, id)).toBe("#2e7d32");
});

test.describe("Design Studio", () => {
  const RASTER = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const studio = (page: Page) => page.locator("[data-admin-customizer]");
  const adminTint = (page: Page, layerId: string) =>
    page.evaluate((id) => {
      const layer = document.querySelector(`[data-admin-customizer] [data-canvas-surface] [data-layer-id="${id}"]`);
      if (!layer) return null;
      if (!layer.querySelector("image")?.getAttribute("filter")) return "";
      return layer.querySelector("feFlood")?.getAttribute("flood-color") || "";
    }, layerId);
  const adminColour = (page: Page) => studio(page).getByRole("group", { name: "Element colour" });

  async function insert(page: Page, title: string) {
    const before = await selectedIds(page);
    await openSidePanel(page, "Elements");
    await studio(page).getByRole("button", { name: `Insert ${title}`, exact: true }).click();
    let id = "";
    await expect.poll(async () => (id = (await selectedIds(page)).find((candidate) => !before.includes(candidate)) || "")).not.toBe("");
    // Back to the inspector (the library stays open for further inserts), then
    // select the new element again.
    await selectEditTool(page);
    const point = await bodyPoint(page, id);
    await page.mouse.click(point.x, point.y);
    await expect.poll(() => selectedIds(page)).toEqual([id]);
    return id;
  }

  test.beforeEach(async ({ page }) => {
    await page.goto("/__e2e/admin-dashboard?section=Products");
    await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
    await page.evaluate(({ svg, raster }) => {
      (window as any).__adminFixture.assets = [
        { id: "asset-multi", title: "Two Tone Ribbon", url: svg, editorUrl: svg, width: 200, height: 100, mimeType: "image/svg+xml", assetType: "element" },
        { id: "asset-photo", title: "Raster Badge", url: raster, editorUrl: raster, width: 100, height: 100, mimeType: "image/png", assetType: "element" },
      ];
    }, { svg: MULTICOLOUR_SVG, raster: RASTER });
    await page.getByRole("button", { name: "Add product" }).first().click();
    const enable = page.getByRole("switch", { name: /Enable product customizer/ });
    // The form renders after the click that opened it: wait for the switch (or a
    // studio that is already enabled) instead of checking visibility once.
    await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
    if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
    await page.getByRole("button", { name: "Open Design Studio" }).click();
    await expect(studio(page).locator("header")).toBeVisible();
  });

  test("a multicolour SVG is recoloured and returned to Original; Undo and Redo replay each step", async ({ page }) => {
    const id = await insert(page, "Two Tone Ribbon");
    await expect(adminColour(page)).toBeVisible();
    expect(await adminTint(page, id)).toBe("");
    await adminColour(page).locator('input[type="color"]').evaluate((input: HTMLInputElement) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "#00aa00");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect.poll(() => adminTint(page, id)).toBe("#00aa00");
    await adminColour(page).getByRole("button", { name: "Original" }).click();
    await expect.poll(() => adminTint(page, id)).toBe("");
    await page.keyboard.press("Control+z");
    await expect.poll(() => adminTint(page, id)).toBe("#00aa00");
    await page.keyboard.press("Control+y");
    await expect.poll(() => adminTint(page, id)).toBe("");
  });

  test("a raster element is not offered recolouring (it would become a silhouette)", async ({ page }) => {
    await insert(page, "Raster Badge");
    await expect(studio(page).getByText("Flip horizontal").first()).toBeVisible();
    await expect(adminColour(page)).toHaveCount(0);
  });
});
