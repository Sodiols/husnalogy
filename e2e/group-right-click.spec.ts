/**
 * Right click selects what a left click selects (stabilization task 04).
 *
 * A right click on a group's member used to select the MEMBER (raw Konva node
 * id) while a left click on the same pixel selects the GROUP; the object menu
 * then offered and ran commands on the wrong object, and right-clicking inside
 * a multi-selection collapsed it. Both editors share the interaction stage,
 * so both are covered.
 */
import { expect, test, type Page } from "@playwright/test";
import { bodyPoint, docToScreen, selectedIds } from "./customizer-fixture";

const TITLE = "Minimal Thank You Card";
const TEMPLATE = {
  enabled: true, cardWidthIn: 5, cardHeightIn: 7, dpi: 300, canvasWidthPx: 1500, canvasHeightPx: 2100,
  pages: [{ id: "front", label: "Front", enabled: true }], defaultPage: "front", fields: [], guides: [],
  layers: [
    { id: "s_a", page: "front", type: "shape", shape: "rectangle", x: 400, y: 700, width: 260, height: 160, zIndex: 1, fill: "#d4af37" },
    { id: "g_grp", page: "front", type: "group", x: 950, y: 1150, width: 460, height: 200, zIndex: 2, childIds: ["s_g1", "s_g2"] },
    { id: "s_g1", page: "front", type: "shape", shape: "rectangle", groupId: "g_grp", x: 820, y: 1150, width: 200, height: 200, zIndex: 3, fill: "#303839" },
    { id: "s_g2", page: "front", type: "shape", shape: "oval", groupId: "g_grp", x: 1080, y: 1150, width: 200, height: 200, zIndex: 4, fill: "#27307A" },
  ],
};

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const header = (page: Page) => studio(page).locator("header");
const menu = (page: Page) => page.getByRole("menu", { name: "Object actions" });
const menuLabels = async (page: Page) =>
  (await menu(page).getByRole("menuitem").allTextContents()).map((text) => text.replace(/\s+/g, " ").trim());
const expectSelection = (page: Page, ids: string[]) =>
  expect.poll(async () => (await selectedIds(page)).slice().sort(), { timeout: 5000 }).toEqual(ids.slice().sort());

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
  await expect(header(page)).toBeVisible();
  await bodyPoint(page, "g_grp");
}

/** Document-space centres: a press lands on the object's own pixels, as a designer's does. */
const CENTRES: Record<string, [number, number]> = { s_a: [400, 700], s_g1: [820, 1150], s_g2: [1080, 1150], fx_group_text: [640, 2000] };

async function press(page: Page, layerId: string, button: "left" | "right" = "left", shift = false) {
  const point = await docToScreen(page, ...CENTRES[layerId]);
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.click(point.x, point.y, { button });
  if (shift) await page.keyboard.up("Shift");
  await page.waitForTimeout(300);
}

async function clearSelection(page: Page) {
  await page.keyboard.press("Escape");
  await page.locator("[data-canvas-surface]").first().click({ position: { x: 5, y: 5 } });
  await expectSelection(page, []);
}

async function savedLayers(page: Page) {
  const before = await page.evaluate(() => (window as any).__adminFixture.requests.length);
  await header(page).getByRole("button", { name: /Save Draft/ }).click();
  await expect.poll(() => page.evaluate((count) => (window as any).__adminFixture.requests.length > count, before)).toBe(true);
  await expect(header(page).getByText("Unsaved", { exact: true })).toHaveCount(0, { timeout: 15_000 });
  return page.evaluate(() => {
    const saves = (window as any).__adminFixture.requests.filter((entry: any) => /^\/api\/admin\/products(\/[^/]+)?$/.test(entry.path));
    return saves[saves.length - 1].body.customizerTemplate.layers as any[];
  });
}

test.describe("Design Studio: right click and left click resolve the same object", () => {
  test("a member of a group: both clicks select the GROUP, and the menu acts on the group", async ({ page }) => {
    await openStudio(page);
    await press(page, "s_g2");
    await expectSelection(page, ["g_grp"]);
    await clearSelection(page);

    await press(page, "s_g2", "right");
    await expect(menu(page)).toBeVisible();
    await expectSelection(page, ["g_grp"]);
    expect(await menuLabels(page)).toEqual(expect.arrayContaining([expect.stringMatching(/^Ungroup/), expect.stringMatching(/^Edit group contents/)]));

    // Duplicate from the menu duplicates the whole group (one undo step).
    await menu(page).getByRole("menuitem", { name: /^Duplicate/ }).click();
    await expect(menu(page)).toHaveCount(0);
    let layers = await savedLayers(page);
    expect(layers.filter((layer) => layer.type === "group")).toHaveLength(2);
    expect(layers.filter((layer) => layer.type === "shape")).toHaveLength(5);
    await page.locator("[data-canvas-surface]").first().click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    layers = await savedLayers(page);
    expect(layers.filter((layer) => layer.type === "group")).toHaveLength(1);
    expect(layers.filter((layer) => layer.type === "shape")).toHaveLength(3);
    await page.keyboard.press("Control+y");
    layers = await savedLayers(page);
    expect(layers.filter((layer) => layer.type === "group")).toHaveLength(2);
  });

  test("right-clicking inside a multi-selection keeps it", async ({ page }) => {
    await openStudio(page);
    await press(page, "s_a");
    await press(page, "s_g1", "left", true);
    await expectSelection(page, ["s_a", "g_grp"]);
    await press(page, "s_g2", "right");
    await expect(menu(page)).toBeVisible();
    await expectSelection(page, ["s_a", "g_grp"]);
    expect(await menuLabels(page)).toEqual(expect.arrayContaining([expect.stringMatching(/^Group/)]));
    await page.keyboard.press("Escape");
    // Outside it, a right click selects just that object.
    await clearSelection(page);
    await press(page, "s_a");
    await press(page, "s_g1", "left", true);
    await press(page, "s_a", "right");
    await expectSelection(page, ["s_a", "g_grp"]);
  });

  test("inside an entered group a right click targets the member, like a left click", async ({ page }) => {
    await openStudio(page);
    const point = await docToScreen(page, ...CENTRES.s_g2);
    await page.mouse.dblclick(point.x, point.y);
    await page.waitForTimeout(300);
    await press(page, "s_g1");
    await expectSelection(page, ["s_g1"]);
    await press(page, "s_g2", "right");
    await expect(menu(page)).toBeVisible();
    await expectSelection(page, ["s_g2"]);
    expect((await menuLabels(page)).some((label) => label.startsWith("Ungroup"))).toBe(false);
    // Hide from the menu hides the member, not the group.
    await menu(page).getByRole("menuitem", { name: /^Hide/ }).click();
    const layers = await savedLayers(page);
    expect(layers.find((layer) => layer.id === "s_g2").hidden).toBe(true);
    expect(layers.find((layer) => layer.id === "g_grp").hidden || false).toBe(false);
  });
});

test.describe("Customer editor: right click and left click resolve the same object", () => {
  test("a member of a customer group selects the group either way", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/__e2e/customizer");
    await expect(page.locator("[data-customizer-root]")).toBeVisible();
    const toggle = page.getByRole("button", { name: /^(Advanced Customize|Advanced)$/ });
    if (await toggle.count()) await toggle.first().click();
    await bodyPoint(page, "fx_group");
    const point = await docToScreen(page, ...CENTRES.fx_group_text);
    await page.mouse.click(point.x, point.y);
    await expectSelection(page, ["fx_group"]);
    await page.keyboard.press("Escape");
    await page.mouse.click(point.x, point.y, { button: "right" });
    await expectSelection(page, ["fx_group"]);
  });
});
