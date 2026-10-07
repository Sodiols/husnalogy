/**
 * Design Studio: visible Vertical / Horizontal artboard controls (Admin Problem 1).
 *
 * The canvas bar's control runs the existing orientation conversion
 * (lib/customizer/v2/artboard.ts changeTemplateOrientation): the card's
 * dimensions swap and the whole design is carried across with ONE uniform
 * mapping, as one undo step. Proven here through the real studio UI, the saved
 * draft, a reload and a publication.
 */
import { expect, test, type Page } from "@playwright/test";
import { orientationChoices } from "./admin-studio-tools";

const PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100" height="200" fill="#ff0000"/><rect x="100" width="100" height="200" fill="#0000ff"/></svg>',
)}`;

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const header = (page: Page) => studio(page).locator("header");

/** A populated 5 × 7 design with every kind of object the conversion must carry. */
function populatedTemplate(size: { widthIn: number; heightIn: number; widthPx: number; heightPx: number }) {
  const k = size.widthPx / 1500;
  return {
    enabled: true,
    cardWidthIn: size.widthIn,
    cardHeightIn: size.heightIn,
    dpi: 300,
    canvasWidthPx: size.widthPx,
    canvasHeightPx: size.heightPx,
    safeArea: { top: 90, right: 90, bottom: 90, left: 90 },
    bleed: { top: 45, right: 45, bottom: 45, left: 45 },
    pages: [{ id: "front", label: "Front", enabled: true }],
    defaultPage: "front",
    guides: [{ id: "guide_a", pageId: "front", axis: "horizontal", position: 300 * k, locked: false, hidden: false }],
    fields: [],
    settings: { showSafeArea: true, showBleed: true },
    layers: [
      { id: "bg", page: "front", type: "background", color: "#fbf7ef", x: size.widthPx / 2, y: size.heightPx / 2, width: size.widthPx, height: size.heightPx, zIndex: 0 },
      { id: "t_title", page: "front", type: "text", text: "Alex & Jordan", x: 750 * k, y: 400 * k, width: 900 * k, height: 120 * k, rotation: 0, zIndex: 2, textStyle: { fontFamily: "Inter", fontSize: Math.round(72 * k), textAlign: "center", autoSizeMode: "fixed" } },
      { id: "i_photo", page: "front", type: "image", src: PHOTO, x: 500 * k, y: 1000 * k, width: 500 * k, height: 500 * k, rotation: 0, zIndex: 3, imageTransform: { zoom: 1.4, offsetX: 30, offsetY: -20, cropX: 0.1, cropY: 0.1, cropWidth: 0.6, cropHeight: 0.6 } },
      { id: "f_frame", page: "front", type: "frame", src: PHOTO, x: 1050 * k, y: 1000 * k, width: 500 * k, height: 600 * k, rotation: 12, zIndex: 4, mask: { kind: "rounded", radius: 40 }, maskShape: "rounded" },
      { id: "s_rot", page: "front", type: "shape", shape: "rectangle", x: 750 * k, y: 1550 * k, width: 400 * k, height: 200 * k, rotation: 30, zIndex: 5, fill: "#d4af37", stroke: "#303839", strokeWidth: 6 },
      { id: "l_line", page: "front", type: "shape", shape: "line", x: 750 * k, y: 1800 * k, width: 900 * k, height: 6, rotation: 0, zIndex: 6, stroke: "#303839", strokeWidth: 4 },
      { id: "q_code", page: "front", type: "qrCode", value: "https://example.com", x: 1200 * k, y: 1800 * k, width: 200 * k, height: 200 * k, rotation: 0, zIndex: 7 },
      { id: "g_grp", page: "front", type: "group", x: 400 * k, y: 1800 * k, width: 400 * k, height: 200 * k, rotation: 0, zIndex: 8, childIds: ["t_sub", "s_dot"] },
      { id: "t_sub", page: "front", type: "text", text: "with love", groupId: "g_grp", x: 350 * k, y: 1800 * k, width: 300 * k, height: 80 * k, rotation: 0, zIndex: 9, textStyle: { fontFamily: "Inter", fontSize: Math.round(40 * k), autoSizeMode: "fixed" } },
      { id: "s_dot", page: "front", type: "shape", shape: "oval", groupId: "g_grp", x: 560 * k, y: 1800 * k, width: 80 * k, height: 80 * k, rotation: 0, zIndex: 10, fill: "#303839" },
    ],
  };
}

/**
 * Seed a product's design through the mock server's durable store and reload,
 * so the dashboard's first product fetch already returns it (writing the store
 * after the list has loaded would race the dashboard's own copy).
 */
async function seedDesign(page: Page, title: string, template: Record<string, unknown>) {
  await page.evaluate(({ name, value }) => {
    const products = (window as any).__adminFixture.store.products.map((entry: any) => (entry.title === name ? { ...entry, customizerTemplate: value } : entry));
    window.sessionStorage.setItem("__adminFixtureDurable", JSON.stringify({ products, versions: {} }));
  }, { name: title, value: template });
  await page.reload();
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
}

async function openProduct(page: Page, title: string, template?: Record<string, unknown>) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__e2e/admin-dashboard?section=Products");
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  if (template) await seedDesign(page, title, template);
  await page.getByRole("button", { name: `Edit ${title}` }).first().click();
  const enable = page.getByRole("switch", { name: /Enable product customizer/ });
  // The form renders after the click that opened it: wait for the switch (or a
  // studio that is already enabled) instead of checking visibility once.
  await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
  if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
  await page.getByRole("button", { name: "Open Design Studio" }).click();
  await expect(header(page)).toBeVisible();
}

/** The artboard the canvas actually draws. */
const drawnArtboard = (page: Page) =>
  page.evaluate(() => {
    const svg = document.querySelector("[data-admin-customizer] [data-canvas-surface] svg");
    return svg?.getAttribute("viewBox") || "";
  });

async function saveDraft(page: Page): Promise<any> {
  const before = await page.evaluate(() => (window as any).__adminFixture.requests.length);
  await header(page).getByRole("button", { name: /Save Draft/ }).click();
  await expect.poll(() => page.evaluate((count) => (window as any).__adminFixture.requests.slice(count).some((entry: any) => /^\/api\/admin\/products(\/[^/]+)?$/.test(entry.path)), before)).toBe(true);
  await expect(header(page).getByText("Unsaved", { exact: true })).toHaveCount(0, { timeout: 15_000 });
  return page.evaluate(() => {
    const saves = (window as any).__adminFixture.requests.filter((entry: any) => /^\/api\/admin\/products(\/[^/]+)?$/.test(entry.path));
    return saves[saves.length - 1].body.customizerTemplate;
  });
}

const byId = (template: any) => Object.fromEntries(template.layers.map((layer: any) => [layer.id, layer]));
const close = (actual: number, expected: number, tolerance = 0.05) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);

/** Every non-background layer moved by ONE uniform mapping; content-relative properties scaled with it. */
function expectUniformMapping(before: any, after: any) {
  const a = byId(before);
  const b = byId(after);
  const scale = b.t_title.width / a.t_title.width;
  const offsetX = b.t_title.x - a.t_title.x * scale;
  const offsetY = b.t_title.y - a.t_title.y * scale;
  for (const id of Object.keys(a)) {
    if (a[id].type === "background") continue;
    close(b[id].x, a[id].x * scale + offsetX);
    close(b[id].y, a[id].y * scale + offsetY);
    close(b[id].width, a[id].width * scale);
    if (a[id].type !== "shape" || a[id].shape !== "line") close(b[id].height, a[id].height * scale);
    expect(b[id].rotation).toBe(a[id].rotation);
    expect(b[id].groupId || "").toBe(a[id].groupId || "");
  }
  close(b.t_title.textStyle.fontSize, a.t_title.textStyle.fontSize * scale, 0.6);
  close(b.i_photo.imageTransform.offsetX, a.i_photo.imageTransform.offsetX * scale, 0.05);
  expect(b.i_photo.imageTransform.cropWidth).toBe(a.i_photo.imageTransform.cropWidth);
  expect(b.i_photo.imageTransform.zoom).toBe(a.i_photo.imageTransform.zoom);
  close(b.f_frame.mask.radius, a.f_frame.mask.radius * scale, 0.05);
  close(b.s_rot.strokeWidth, a.s_rot.strokeWidth * scale, 0.05);
  expect(b.g_grp.childIds).toEqual(a.g_grp.childIds);
  return scale;
}

test.describe("Design Studio orientation controls", () => {
  test("a new 5 × 7 card: Horizontal is 2100 × 1500, Vertical is 1500 × 2100 again", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/__e2e/admin-dashboard?section=Products");
    await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Add product" }).first().click();
    const enable = page.getByRole("switch", { name: /Enable product customizer/ });
    // The form renders after the click that opened it: wait for the switch (or a
    // studio that is already enabled) instead of checking visibility once.
    await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
    if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
    await page.getByRole("button", { name: "Open Design Studio" }).click();
    await expect(header(page)).toBeVisible();

    await expect(await orientationChoices(page)).toBeVisible();
    await expect((await orientationChoices(page)).getByRole("radio", { name: "Vertical" })).toHaveAttribute("aria-checked", "true");
    expect(await drawnArtboard(page)).toBe("0 0 1500 2100");
    await (await orientationChoices(page)).getByRole("radio", { name: "Horizontal" }).click();
    await expect.poll(() => drawnArtboard(page)).toBe("0 0 2100 1500");
    await expect((await orientationChoices(page)).getByRole("radio", { name: "Horizontal" })).toHaveAttribute("aria-checked", "true");
    await (await orientationChoices(page)).getByRole("radio", { name: "Vertical" }).click();
    await expect.poll(() => drawnArtboard(page)).toBe("0 0 1500 2100");
  });

  test("a populated design is carried across uniformly; one Undo and one Redo; saved, reloaded and published", async ({ page }) => {
    const title = "Minimal Thank You Card";
    await openProduct(page, title, populatedTemplate({ widthIn: 5, heightIn: 7, widthPx: 1500, heightPx: 2100 }));
    const portrait = await saveDraft(page);
    expect([portrait.canvasWidthPx, portrait.canvasHeightPx]).toEqual([1500, 2100]);

    await (await orientationChoices(page)).getByRole("radio", { name: "Horizontal" }).click();
    await expect.poll(() => drawnArtboard(page)).toBe("0 0 2100 1500");
    const landscape = await saveDraft(page);
    expect([landscape.canvasWidthPx, landscape.canvasHeightPx, landscape.cardWidthIn, landscape.cardHeightIn]).toEqual([2100, 1500, 7, 5]);
    const scale = expectUniformMapping(portrait, landscape);
    expect(scale).toBeLessThanOrEqual(1);
    // Print margins are physical: unchanged. The background covers the new page.
    expect(landscape.safeArea).toEqual(portrait.safeArea);
    expect(landscape.bleed).toEqual(portrait.bleed);
    expect(byId(landscape).bg).toMatchObject({ x: 1050, y: 750, width: 2100, height: 1500 });
    close(landscape.guides[0].position, portrait.guides[0].position * scale + (byId(landscape).t_title.y - byId(portrait).t_title.y * scale));
    // Every object sits inside the new safe area.
    for (const layer of landscape.layers.filter((entry: any) => entry.type !== "background" && entry.type !== "group")) {
      expect(layer.x - layer.width / 2).toBeGreaterThanOrEqual(90 - 60);
      expect(layer.x + layer.width / 2).toBeLessThanOrEqual(2100 - 90 + 60);
    }

    // ONE undo restores the portrait card exactly; ONE redo re-applies the conversion.
    const canvas = studio(page).locator("[data-canvas-surface]");
    await canvas.click({ position: { x: 4, y: 4 } });
    await page.keyboard.press("Control+z");
    await expect.poll(() => drawnArtboard(page)).toBe("0 0 1500 2100");
    const undone = await saveDraft(page);
    expect(undone.layers).toEqual(portrait.layers);
    expect(undone.guides).toEqual(portrait.guides);
    await page.keyboard.press("Control+y");
    await expect.poll(() => drawnArtboard(page)).toBe("0 0 2100 1500");
    const redone = await saveDraft(page);
    expect(redone.layers).toEqual(landscape.layers);

    // Publish the landscape draft: the version freezes exactly that design.
    await header(page).getByRole("button", { name: "Publish Changes" }).click();
    await studio(page).getByRole("button", { name: "Publish", exact: true }).click();
    await expect(studio(page).getByRole("status").first()).toContainText(/^Published\./, { timeout: 15_000 });
    const published = await page.evaluate(() => Object.values((window as any).__adminFixture.versions as Record<string, any[]>)[0][0].template);
    expect(published.layers).toEqual(redone.layers);
    expect([published.canvasWidthPx, published.canvasHeightPx]).toEqual([2100, 1500]);

    // Reload the page and open the same design again.
    await page.reload();
    await openProduct(page, title);
    await expect.poll(() => drawnArtboard(page)).toBe("0 0 2100 1500");
    await expect((await orientationChoices(page)).getByRole("radio", { name: "Horizontal" })).toHaveAttribute("aria-checked", "true");
    const reopened = await saveDraft(page);
    expect(reopened.layers).toEqual(redone.layers);

    // And back to vertical, carried across the same way.
    await (await orientationChoices(page)).getByRole("radio", { name: "Vertical" }).click();
    await expect.poll(() => drawnArtboard(page)).toBe("0 0 1500 2100");
    expectUniformMapping(reopened, await saveDraft(page));
  });

  test("3.5 × 5: Horizontal is 1500 × 1050", async ({ page }) => {
    await openProduct(page, "Minimal Thank You Card", populatedTemplate({ widthIn: 3.5, heightIn: 5, widthPx: 1050, heightPx: 1500 }));
    await expect.poll(() => drawnArtboard(page)).toBe("0 0 1050 1500");
    await (await orientationChoices(page)).getByRole("radio", { name: "Horizontal" }).click();
    await expect.poll(() => drawnArtboard(page)).toBe("0 0 1500 1050");
    const saved = await saveDraft(page);
    expect([saved.canvasWidthPx, saved.canvasHeightPx, saved.cardWidthIn, saved.cardHeightIn]).toEqual([1500, 1050, 5, 3.5]);
  });

  test("the control stays usable at a narrow admin width", async ({ page }) => {
    await openProduct(page, "Minimal Thank You Card", populatedTemplate({ widthIn: 5, heightIn: 7, widthPx: 1500, heightPx: 2100 }));
    await page.setViewportSize({ width: 1180, height: 800 });
    const horizontal = (await orientationChoices(page)).getByRole("radio", { name: "Horizontal" });
    await expect(horizontal).toBeVisible();
    const box = (await horizontal.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1180);
    await horizontal.click();
    await expect.poll(() => drawnArtboard(page)).toBe("0 0 2100 1500");
  });
});
