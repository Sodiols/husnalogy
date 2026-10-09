/**
 * Layers and Pages panel cost on multi-page documents (stabilization task 15).
 *
 * A MEASUREMENT harness: documents of 2, 10 and 20 pages, each page carrying
 * text, shapes and images, with the Pages panel open (one live preview per
 * page). It records, per document size:
 *
 *   - preview renders caused by ONE committed edit on the first page;
 *   - page-switch latency (card click → the canvas shows that page's layer);
 *   - the time one committed edit takes to settle.
 *
 * It asserts only the architectural contract: an edit on one page re-renders
 * that page's thumbnail, not every page's — the cost must not grow with the
 * number of pages. Timings are printed for the report, not asserted tightly
 * (a dev build on a shared machine is not a benchmark environment).
 */
import { expect, test, type Page } from "@playwright/test";
import { openSidePanel } from "./admin-studio-tools";
import { bodyPoint, selectedIds } from "./customizer-fixture";

const TITLE = "Minimal Thank You Card";
const PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#2f6fb0"/></svg>')}`;

function documentWith(pageCount: number) {
  const pages = Array.from({ length: pageCount }, (_, index) => ({ id: index === 0 ? "front" : index === 1 ? "back" : `page_${index + 1}`, label: index === 0 ? "Front" : index === 1 ? "Back" : `Page ${index + 1}`, enabled: true }));
  const layers: any[] = [];
  let z = 0;
  for (const page of pages) {
    for (let row = 0; row < 4; row += 1) {
      layers.push({ id: `t_${page.id}_${row}`, page: page.id, type: "text", text: `${page.label} line ${row} — wedding of Anna and Ben`, x: 750, y: 300 + row * 160, width: 1100, height: 90, zIndex: (z += 1), textStyle: { fontFamily: "Inter", fontSize: 54, autoSizeMode: "fixed" } });
    }
    for (let index = 0; index < 4; index += 1) {
      layers.push({ id: `s_${page.id}_${index}`, page: page.id, type: "shape", shape: index % 2 ? "oval" : "rectangle", x: 300 + index * 300, y: 1100, width: 200, height: 140, zIndex: (z += 1), fill: "#d4af37" });
    }
    for (let index = 0; index < 3; index += 1) {
      layers.push({ id: `i_${page.id}_${index}`, page: page.id, type: "image", src: PHOTO, x: 350 + index * 400, y: 1600, width: 320, height: 240, zIndex: (z += 1) });
    }
  }
  return { enabled: true, cardWidthIn: 5, cardHeightIn: 7, dpi: 300, canvasWidthPx: 1500, canvasHeightPx: 2100, pages, defaultPage: "front", fields: [], guides: [], layers };
}

async function openStudio(page: Page, template: any) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__e2e/admin-dashboard?section=Products");
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  await page.evaluate(({ name, value }) => {
    const products = (window as any).__adminFixture.store.products.map((entry: any) => (entry.title === name ? { ...entry, customizerTemplate: value } : entry));
    window.sessionStorage.setItem("__adminFixtureDurable", JSON.stringify({ products, versions: {} }));
  }, { name: TITLE, value: template });
  await page.reload();
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: `Edit ${TITLE}` }).first().click();
  const enable = page.getByRole("switch", { name: /Enable product customizer/ });
  await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
  if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
  await page.getByRole("button", { name: "Open Design Studio" }).click();
  await expect(page.locator("[data-admin-customizer] header")).toBeVisible();
  await bodyPoint(page, "s_front_0");
}

// The dev build's editor counters (lib/customizer/v2/dev-metrics.ts).
const metrics = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as any).__husnalogyCustomizerMetrics || null)));
const resetMetrics = (page: Page) =>
  page.evaluate(() => {
    const store = (window as any).__husnalogyCustomizerMetrics;
    if (!store) return;
    store.documentCommits = 0;
    store.byKind = {};
    store.events = {};
    store.renders = {};
  });

const results: Array<Record<string, number>> = [];

for (const pageCount of [2, 10, 20]) {
  test(`${pageCount} pages: one edit re-renders only its own page's thumbnail; page switching stays quick`, async ({ page }) => {
    test.setTimeout(180_000);
    await openStudio(page, documentWith(pageCount));
    const pagesPanel = await openSidePanel(page, "Pages");
    await expect(pagesPanel.locator("[data-page-card]")).toHaveCount(pageCount);
    await page.waitForTimeout(800);

    // Select a shape on the first page, then commit one edit (an arrow-key nudge).
    const point = await bodyPoint(page, "s_front_0");
    await page.mouse.click(point.x, point.y);
    await expect.poll(async () => (await selectedIds(page))[0]).toBe("s_front_0");
    await page.waitForTimeout(400);
    // The Front card's own drawing of the shape, to prove the thumbnail is not stale after the edit.
    const thumbShape = () => pagesPanel.locator('[data-page-card="front"] [data-layer-id="s_front_0"] rect').first().getAttribute("x");
    const thumbBefore = await thumbShape();
    await resetMetrics(page);
    const editStart = Date.now();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(600);
    const editMs = Date.now() - editStart - 600;
    const after = await metrics(page);
    expect(after, "dev metrics must be available (dev build)").toBeTruthy();
    const previewRenders = Number(after.renders?.preview || 0);
    await expect.poll(thumbShape).not.toBe(thumbBefore);

    // Page switching: card click until that page's first text is on the canvas.
    const target = pageCount > 2 ? `Page ${pageCount}` : "Back";
    const targetId = pageCount > 2 ? `page_${pageCount}` : "back";
    const switchStart = Date.now();
    await pagesPanel.getByRole("button", { name: target, exact: true }).click();
    await expect(page.locator(`[data-admin-customizer] [data-canvas-surface] [data-layer-id="t_${targetId}_0"]`).first()).toBeAttached();
    const switchMs = Date.now() - switchStart;

    results.push({ pages: pageCount, previewRendersPerEdit: previewRenders, editSettleMs: Math.max(0, editMs), pageSwitchMs: switchMs });
    console.log(`[pages-perf] ${JSON.stringify(results[results.length - 1])}`);
    // The canvas, plus the edited page's thumbnail (plus a small allowance for
    // a selection-chrome re-render) — not one render per page.
    expect(previewRenders).toBeLessThanOrEqual(4);
  });
}
