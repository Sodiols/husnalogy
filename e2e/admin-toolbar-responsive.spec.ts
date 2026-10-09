/**
 * Design Studio contextual toolbar at COMMON DESKTOP SIZES (1280 × 720 to
 * 1920 × 1080) with the studio's side panels open, as an admin works.
 *
 * In every selection state — text, small text, image, shape, line, multiple
 * selection, group, image + shape (Mask), crop and eraser — every approved
 * control is fully inside the visible bar (nothing clipped, nothing scrolled
 * out of sight), the bar is one row, Alignment opens its panel, and there is
 * no Effects or Remove BG control anywhere (product decision).
 */
import { expect, test, type Page } from "@playwright/test";
import { openSidePanel } from "./admin-studio-tools";
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
    { id: "t_small", page: "front", type: "text", text: "RSVP by June", x: 750, y: 1960, width: 220, height: 30, zIndex: 7, textStyle: { fontFamily: "Inter", fontSize: 17, color: "#303839", autoSizeMode: "width" } },
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

const SIZES = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1920, height: 1080 },
];

/** Overflow of a bar's row and any control that is not fully inside the bar's visible box. */
async function fit(page: Page, selector: string) {
  return page.evaluate((query) => {
    const bar = document.querySelector(query) as HTMLElement | null;
    if (!bar) return { present: false, overflow: 0, clipped: [] as string[], names: [] as string[] };
    const row = (bar.querySelector("[class*='overflow-x-auto']") as HTMLElement | null) || bar;
    const box = bar.getBoundingClientRect();
    const viewport = { left: 0, right: window.innerWidth };
    const controls = [...bar.querySelectorAll("button, input, [role=combobox]")].filter((node) => (node as HTMLElement).offsetParent && !(node as HTMLElement).closest("[aria-hidden=true]"));
    const name = (node: Element) => (node.getAttribute("aria-label") || node.textContent || "").trim();
    const clipped = controls
      .filter((node) => !/^Scroll tools/.test(name(node)))
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.left < Math.max(box.left, viewport.left) - 0.5 || rect.right > Math.min(box.right, viewport.right) + 0.5 || rect.width < 16;
      })
      .map(name);
    return { present: true, overflow: row.scrollWidth - row.clientWidth, clipped, names: controls.map(name) };
  }, selector);
}

function expectFits(result: Awaited<ReturnType<typeof fit>>, label: string) {
  expect(result.present, `${label}: bar shown`).toBe(true);
  expect(result.overflow, `${label}: row overflow (px)`).toBeLessThanOrEqual(1);
  expect(result.clipped, `${label}: controls clipped or out of sight`).toEqual([]);
  expect(result.names.join(" | "), `${label}: no Effects / Remove BG`).not.toMatch(/effects|remove\s*b(ack)?g/i);
}

for (const size of SIZES) {
  test(`every toolbar state fits at ${size.width} × ${size.height}`, async ({ page }) => {
    await openStudio(page, { width: size.width });
    await page.setViewportSize(size);

    const states: Array<[string, string[]]> = [
      ["text", ["t_text"]],
      ["small text", ["t_small"]],
      ["image", ["i_photo"]],
      ["shape", ["s_circle"]],
      ["line", ["s_line"]],
      ["multiple selection", ["t_text", "s_rect"]],
      ["image + shape (Mask)", ["i_photo", "s_circle"]],
    ];
    for (const [label, ids] of states) {
      await select(page, ...ids);
      expectFits(await fit(page, "[data-admin-toolbar]"), `${size.width} ${label}`);
    }

    // Group selection.
    await select(page, "t_text", "s_rect");
    await toolbar(page).getByRole("button", { name: "Group" }).click();
    await expect(toolbar(page)).toHaveAttribute("data-admin-toolbar", "group");
    expectFits(await fit(page, "[data-admin-toolbar]"), `${size.width} group`);
    await page.keyboard.press("Control+z");

    // Alignment is reachable and opens its panel from the widest bar (shape).
    await select(page, "s_circle");
    await toolbar(page).getByRole("button", { name: "Alignment" }).click();
    await expect(panel(page)).toBeVisible();
    await toolbar(page).getByRole("button", { name: "Alignment" }).click();
    await expect(panel(page)).toHaveCount(0);

    // Crop mode and the eraser have their own bars.
    await select(page, "i_photo");
    await toolbar(page).getByRole("button", { name: "Crop photo" }).click();
    expectFits(await fit(page, "[data-admin-crop-bar]"), `${size.width} crop`);
    await page.locator("[data-admin-crop-bar]").getByRole("button", { name: "Cancel" }).click();
    await expect(toolbar(page)).toBeVisible();
    await toolbar(page).getByRole("button", { name: "Eraser" }).click();
    expectFits(await fit(page, "[data-admin-eraser-bar]"), `${size.width} eraser`);
    await page.locator("[data-admin-eraser-bar]").getByRole("button", { name: "Cancel" }).click();
  });
}

test("a workspace narrower than the supported sizes scrolls the bar intentionally, with visible scroll buttons", async ({ page }) => {
  await openStudio(page, { width: 1024 });
  // The compact shape bar fits completely here: nothing hidden, nothing to scroll.
  await select(page, "s_circle");
  await expect(toolbar(page).getByRole("button", { name: "Scroll tools right" })).toHaveCount(0);
  expect(await toolbar(page).evaluate((bar) => {
    const strip = bar.querySelector(".overflow-x-auto") as HTMLElement;
    return strip.scrollWidth - strip.clientWidth;
  })).toBeLessThanOrEqual(1);
  // With a side panel open the canvas column is narrower than any supported
  // size: the text bar (the widest state) then scrolls, with visible buttons.
  await openSidePanel(page, "Elements");
  await select(page, "t_text");
  const right = toolbar(page).getByRole("button", { name: "Scroll tools right" });
  await expect(right).toBeVisible();
  await right.click();
  await expect(toolbar(page).getByRole("button", { name: "Scroll tools left" })).toBeVisible();
  // Keyboard reaches every control: tabbing to Alignment scrolls it into view.
  const alignment = toolbar(page).getByRole("button", { name: "Alignment", exact: true });
  await alignment.focus();
  await alignment.click();
  await expect(panel(page)).toBeVisible();
});
