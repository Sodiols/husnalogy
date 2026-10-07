/**
 * Design Studio contextual toolbar (the six-reference rebuild + the Mask state).
 *
 * Runs the real studio on /__e2e/admin-dashboard, whose in-browser API mock
 * records every save. Every assertion reads either the saved template or the
 * rendered canvas, so a control that only LOOKS right fails here.
 *
 * Set SHOT_DIR to also write a screenshot of each toolbar state there.
 */
import { expect, test, type Page } from "@playwright/test";
import { bodyPoint, selectedIds } from "./customizer-fixture";

const PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="150" height="200" fill="#ff0000"/><rect x="150" width="150" height="200" fill="#0000ff"/></svg>',
)}`;
const NEW_PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#00aa00"/></svg>',
)}`;
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
    { id: "i_photo", page: "front", type: "image", src: PHOTO, x: 400, y: 400, width: 450, height: 300, zIndex: 1 },
    { id: "t_text", page: "front", type: "text", text: "Hello", x: 1100, y: 400, width: 500, height: 100, zIndex: 2, textStyle: { fontFamily: "Inter", fontSize: 60, color: "#303839", autoSizeMode: "fixed" } },
    { id: "s_circle", page: "front", type: "shape", shape: "circle", x: 400, y: 1100, width: 300, height: 300, zIndex: 3, fill: "#d4af37", stroke: "#303839", strokeWidth: 6 },
    { id: "s_rect", page: "front", type: "shape", shape: "rectangle", x: 1100, y: 1100, width: 300, height: 200, zIndex: 4, fill: "#8d6e63" },
    { id: "s_line", page: "front", type: "shape", shape: "line", x: 750, y: 1500, width: 600, height: 8, zIndex: 5, stroke: "#303839", strokeWidth: 6 },
    { id: "t_two", page: "front", type: "text", text: "Two", x: 1100, y: 1800, width: 300, height: 100, zIndex: 6, textStyle: { fontFamily: "Inter", fontSize: 50, autoSizeMode: "fixed" } },
  ],
};

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const header = (page: Page) => studio(page).locator("header");
const toolbar = (page: Page) => page.locator("[data-admin-toolbar]");
const panel = (page: Page) => page.locator("[data-admin-alignment-panel]");

async function seedDesign(page: Page, template: Record<string, unknown>) {
  await page.evaluate(({ name, value }) => {
    const products = (window as any).__adminFixture.store.products.map((entry: any) => (entry.title === name ? { ...entry, customizerTemplate: value } : entry));
    window.sessionStorage.setItem("__adminFixtureDurable", JSON.stringify({ products, versions: {} }));
  }, { name: TITLE, value: template });
  await page.reload();
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
}

async function openStudio(page: Page, options: { seed?: boolean; template?: Record<string, unknown>; width?: number } = {}) {
  await page.setViewportSize({ width: options.width ?? 1440, height: 900 });
  // Change image uploads with XHR; answer it here so nothing leaves the browser.
  await page.route("**/api/admin/customizer/assets", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ json: { ok: true, asset: { id: "asset-new", title: "New", url: NEW_PHOTO, editorUrl: NEW_PHOTO, bucket: "customizer-assets", originalPath: "admin/new.png", editorPath: "admin/new-editor.webp", thumbnailPath: "admin/new-thumb.webp", width: 2400, height: 2400, mimeType: "image/png" } } })
      : route.fallback(),
  );
  if (options.seed !== false) {
    await page.goto("/__e2e/admin-dashboard?section=Products");
    await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
    await seedDesign(page, options.template || TEMPLATE);
  }
  await page.getByRole("button", { name: `Edit ${TITLE}` }).first().click();
  const enable = page.getByRole("switch", { name: /Enable product customizer/ });
  await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
  if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
  await page.getByRole("button", { name: "Open Design Studio" }).click();
  await expect(header(page)).toBeVisible();
  await expect(studio(page).locator('[data-canvas-surface] [data-layer-id="i_photo"] image').first()).toBeAttached();
}

async function select(page: Page, ...ids: string[]) {
  for (const [index, id] of ids.entries()) {
    const point = await bodyPoint(page, id);
    if (index > 0) await page.keyboard.down("Shift");
    await page.mouse.click(point.x, point.y);
    if (index > 0) await page.keyboard.up("Shift");
  }
  await expect.poll(async () => (await selectedIds(page)).slice().sort()).toEqual(ids.slice().sort());
  await page.waitForTimeout(450);
}

/**
 * The studio's live document: its crash-recovery copy while there are unsaved
 * changes (written ~0.4s after each change, so read it through expect.poll),
 * otherwise the last saved — or seeded — template, which it then equals.
 */

for (const width of [1280, 1366, 1440, 1536, 1920]) {
  test(`measure ${width}`, async ({ page }) => {
    await openStudio(page, { width });
    const report: any[] = [];
    for (const ids of [["t_text"], ["i_photo"], ["s_circle"], ["s_line"], ["t_text", "s_rect"], ["i_photo", "s_circle"]]) {
      await select(page, ...ids);
      report.push(await page.evaluate((label) => {
        const bar = document.querySelector("[data-admin-toolbar]") as HTMLElement;
        const strip = bar.firstElementChild as HTMLElement;
        const host = bar.parentElement as HTMLElement;
        const sections = [...strip.children].map((child) => Math.round((child as HTMLElement).getBoundingClientRect().width));
        const controls = [...strip.querySelectorAll("button, [role=combobox], input")].filter((node) => (node as HTMLElement).offsetParent).map((node) => `${(node.getAttribute("aria-label") || node.textContent || "").trim().slice(0, 18)}:${Math.round((node as HTMLElement).getBoundingClientRect().width)}`);
        const left = document.querySelector("[data-admin-customizer] aside") as HTMLElement | null;
        return { label, kind: bar.getAttribute("data-admin-toolbar"), host: host.clientWidth, overflow: strip.scrollWidth - strip.clientWidth, content: strip.scrollWidth, sections, controls };
      }, ids.join("+")));
    }
    console.log(`MEASURE ${width} ${JSON.stringify(report)}`);
  });
}
