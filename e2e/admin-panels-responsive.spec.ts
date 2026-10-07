/**
 * Design Studio side panels at COMMON DESKTOP SIZES (1280 × 720 to
 * 1920 × 1080): every rail panel open beside the inspector.
 *
 * For each size and panel: the page never scrolls sideways; the panel and the
 * inspector sit fully inside the window; no control inside either is cut off
 * at its edge (a row that scrolls sideways on purpose is allowed); the canvas
 * workspace between them keeps a usable width; and the contextual toolbar
 * over the workspace still fits with the panel open.
 */
import { expect, test, type Page } from "@playwright/test";
import { openSidePanel } from "./admin-studio-tools";
import { bodyPoint, selectedIds } from "./customizer-fixture";

const TITLE = "Minimal Thank You Card";
const TEMPLATE = {
  enabled: true,
  cardWidthIn: 5,
  cardHeightIn: 7,
  dpi: 300,
  canvasWidthPx: 1500,
  canvasHeightPx: 2100,
  pages: [{ id: "front", label: "Front", enabled: true }, { id: "back", label: "Back", enabled: true }],
  defaultPage: "front",
  fields: [],
  guides: [],
  layers: [
    { id: "t_text", page: "front", type: "text", text: "Hello", x: 750, y: 500, width: 600, height: 120, zIndex: 1, textStyle: { fontFamily: "Inter", fontSize: 60, color: "#303839", autoSizeMode: "fixed" } },
    { id: "s_circle", page: "front", type: "shape", shape: "circle", x: 750, y: 1300, width: 400, height: 400, zIndex: 2, fill: "#d4af37" },
  ],
};

const SIZES = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1920, height: 1080 },
];
const PANELS = ["Add Text", "Uploads", "Background", "Elements", "Icons", "Options", "Moment", "Layers", "Pages"] as const;

const studio = (page: Page) => page.locator("[data-admin-customizer]");

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
  await expect(studio(page).locator("header")).toBeVisible();
}

/** Layout of the open side panel, the inspector and the workspace between them. */
const layout = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector("[data-admin-customizer]") as HTMLElement;
    const panel = root.querySelector("[data-admin-side-panel]") as HTMLElement | null;
    const inspector = [...root.querySelectorAll("aside")].find((node) => !node.hasAttribute("data-admin-side-panel")) as HTMLElement | undefined;
    const name = (node: Element) => (node.getAttribute("aria-label") || node.getAttribute("title") || node.textContent || node.tagName).trim().slice(0, 40);
    /** Controls cut off at their container's edge, ignoring rows that scroll sideways on purpose. */
    const cutOff = (box: HTMLElement | null | undefined) => {
      if (!box) return ["(missing)"];
      const edge = box.getBoundingClientRect();
      return [...box.querySelectorAll("button, input, select, textarea, [role=slider], [role=combobox]")]
        .filter((node) => (node as HTMLElement).offsetParent)
        .filter((node) => {
          for (let parent = node.parentElement; parent && parent !== box; parent = parent.parentElement) {
            const overflowX = getComputedStyle(parent).overflowX;
            if ((overflowX === "auto" || overflowX === "scroll") && parent.scrollWidth > parent.clientWidth) return false;
          }
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && (rect.left < edge.left - 0.5 || rect.right > edge.right + 0.5);
        })
        .map(name);
    };
    const panelBox = panel?.getBoundingClientRect();
    const inspectorBox = inspector?.getBoundingClientRect();
    return {
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      panelInside: Boolean(panelBox && panelBox.left >= 0 && panelBox.right <= window.innerWidth + 0.5 && panelBox.width >= 260),
      inspectorInside: Boolean(inspectorBox && inspectorBox.left >= 0 && inspectorBox.right <= window.innerWidth + 0.5 && inspectorBox.width >= 280),
      panelSideways: panel ? panel.scrollWidth - panel.clientWidth : -1,
      workspace: panelBox && inspectorBox ? inspectorBox.left - panelBox.right : 0,
      panelCut: cutOff(panel),
      inspectorCut: cutOff(inspector),
    };
  });

/** The contextual toolbar fits: no row overflow, nothing outside its visible box. */
const toolbarFits = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector("[data-admin-toolbar]") as HTMLElement | null;
    if (!bar) return { present: false, overflow: 0, clipped: [] as string[] };
    const row = (bar.querySelector("[class*='overflow-x-auto']") as HTMLElement | null) || bar;
    const box = bar.getBoundingClientRect();
    const clipped = [...bar.querySelectorAll("button, input, [role=combobox]")]
      .filter((node) => (node as HTMLElement).offsetParent && !/^Scroll tools/.test(node.getAttribute("aria-label") || ""))
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.left < box.left - 0.5 || rect.right > box.right + 0.5;
      })
      .map((node) => (node.getAttribute("aria-label") || node.textContent || "").trim());
    return { present: true, overflow: row.scrollWidth - row.clientWidth, clipped };
  });

for (const size of SIZES) {
  test(`every side panel fits beside the inspector at ${size.width} × ${size.height}`, async ({ page }) => {
    await openStudio(page);
    await page.setViewportSize(size);

    for (const label of PANELS) {
      const panel = await openSidePanel(page, label);
      await expect(panel).toBeVisible();
      // Let the panel's content (lists, previews) settle before measuring.
      await page.waitForTimeout(300);
      const result = await layout(page);
      expect(result.pageOverflow, `${size.width} ${label}: page scrolls sideways`).toBeLessThanOrEqual(0);
      expect(result.panelInside, `${size.width} ${label}: panel inside the window`).toBe(true);
      expect(result.inspectorInside, `${size.width} ${label}: inspector inside the window`).toBe(true);
      expect(result.panelSideways, `${size.width} ${label}: panel scrolls sideways`).toBeLessThanOrEqual(1);
      expect(result.panelCut, `${size.width} ${label}: panel controls cut off`).toEqual([]);
      expect(result.inspectorCut, `${size.width} ${label}: inspector controls cut off`).toEqual([]);
      expect(result.workspace, `${size.width} ${label}: canvas workspace width`).toBeGreaterThanOrEqual(480);
    }

    // With a panel open, a selection's toolbar still fits over the workspace.
    await openSidePanel(page, "Elements");
    for (const id of ["t_text", "s_circle"]) {
      const point = await bodyPoint(page, id);
      await page.mouse.click(point.x, point.y);
      await expect.poll(() => selectedIds(page)).toEqual([id]);
      await page.waitForTimeout(450);
      const bar = await toolbarFits(page);
      expect(bar.present, `${size.width} ${id}: toolbar shown`).toBe(true);
      expect(bar.overflow, `${size.width} ${id}: toolbar overflow`).toBeLessThanOrEqual(1);
      expect(bar.clipped, `${size.width} ${id}: toolbar controls clipped`).toEqual([]);
    }
  });
}
