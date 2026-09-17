/**
 * Admin design-builder canvas contract (hardening brief §32).
 *
 * Runs against /__e2e/admin-canvas: the real AdminCanvas, the shared Konva
 * interaction stage on the ADMIN surface, the shared renderer, and the
 * builder's own `applyCanvasLayerPatches` commit. No administrator login and no
 * Supabase product are needed, so a failure is an engine regression.
 */

import { expect, test, type Page } from "@playwright/test";

type Point = { x: number; y: number };
type Metrics = {
  documentCommits: number;
  events: Record<string, number>;
  renders: Record<string, number>;
};

const count = (record: Record<string, number>, key: string) => record[key] || 0;

async function open(page: Page, errors: string[]): Promise<void> {
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/__e2e/admin-canvas");
  await expect(page.locator('[data-customizer-canvas="admin"] [data-layer-id="fx_shape"]')).toBeVisible({ timeout: 30_000 });
  // The SVG artwork renders BEFORE the interaction layer exists: Konva ships in
  // its own `next/dynamic` chunk, so on a cold dev start the shapes are on
  // screen while that chunk is still compiling. Every helper below asks Konva's
  // hit graph where to press, so waiting for the stage is the precondition —
  // waiting only for the artwork made the first tests of a cold run flake.
  await page.waitForFunction(() => Boolean((window as any).Konva?.stages?.length), null, { timeout: 30_000 });
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(900);
  await reset(page);
}

async function reset(page: Page): Promise<void> {
  await page.evaluate(() => {
    const metrics = (window as any).__husnalogyCustomizerMetrics;
    metrics.documentCommits = 0;
    metrics.byKind = {};
    metrics.events = {};
    metrics.renders = {};
  });
}

const read = (page: Page): Promise<Metrics> =>
  page.evaluate(() => JSON.parse(JSON.stringify((window as any).__husnalogyCustomizerMetrics)));

/** A point Konva's hit graph resolves to the layer's body, not a handle. */
async function bodyPoint(page: Page, layerId: string): Promise<Point> {
  const point = await page.evaluate((id) => {
    const stage = (window as any).Konva.stages[0];
    const proxy = stage.findOne((node: any) => node.name?.() === id);
    if (!proxy) return null;
    const rect = proxy.getClientRect();
    const box = stage.container().getBoundingClientRect();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const candidates: Point[] = [];
    for (let gy = 1; gy < 10; gy += 1) for (let gx = 1; gx < 10; gx += 1) {
      candidates.push({ x: rect.x + (rect.width * gx) / 10, y: rect.y + (rect.height * gy) / 10 });
    }
    candidates.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
    const hit = candidates.find((candidate) => stage.getIntersection(candidate)?.name?.() === id);
    return hit ? { x: box.left + hit.x, y: box.top + hit.y } : null;
  }, layerId);
  if (!point) throw new Error(`no pressable body point for ${layerId}`);
  return point;
}

async function anchorPoint(page: Page, name: string): Promise<Point> {
  const point = await page.evaluate((anchor) => {
    const stage = (window as any).Konva.stages[0];
    const transformer = stage.findOne("Transformer");
    const node = transformer?.nodes().length ? transformer.findOne(`.${anchor}`) : null;
    if (!node) return null;
    const rect = node.getClientRect();
    const box = stage.container().getBoundingClientRect();
    return { x: box.left + rect.x + rect.width / 2, y: box.top + rect.y + rect.height / 2 };
  }, name);
  if (!point) throw new Error(`anchor ${name} not on screen`);
  return point;
}

/** The layer's proxy position in DOCUMENT units, independent of zoom. */
const documentX = (page: Page, layerId: string) =>
  page.evaluate((id) => (window as any).Konva.stages[0].findOne((n: any) => n.name?.() === id)?.x(), layerId);

const selectedCount = (page: Page) =>
  page.evaluate(() => (window as any).Konva.stages[0].findOne("Transformer")?.nodes().length || 0);

async function select(page: Page, layerId: string, additive = false): Promise<void> {
  const point = await bodyPoint(page, layerId);
  if (additive) await page.keyboard.down("Shift");
  await page.mouse.click(point.x, point.y);
  if (additive) await page.keyboard.up("Shift");
  await page.waitForTimeout(350);
}

async function drag(page: Page, from: Point, dx: number, dy: number, release = true): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 20; step += 1) await page.mouse.move(from.x + (dx * step) / 20, from.y + (dy * step) / 20);
  if (release) await page.mouse.up();
}

test.describe("admin canvas interaction contract", () => {
  let errors: string[] = [];

  test.beforeEach(async ({ page }) => {
    errors = [];
    await open(page, errors);
  });

  test.afterEach(() => {
    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("admin selection attaches the transformer to the clicked object", async ({ page }) => {
    await select(page, "fx_shape");
    expect(await selectedCount(page)).toBe(1);
  });

  test("admin drag is transient and commits once", async ({ page }) => {
    await select(page, "fx_shape");
    const before = await documentX(page, "fx_shape");
    await reset(page);
    await drag(page, await bodyPoint(page, "fx_shape"), 90, 50, false);
    await page.waitForTimeout(250);
    const during = await read(page);
    expect(during.documentCommits).toBe(0);
    expect(count(during.renders, "preview"), "the admin preview re-rendered during a drag").toBe(0);
    await page.mouse.up();
    await page.waitForTimeout(450);
    expect((await documentX(page, "fx_shape")) - before).toBeGreaterThan(20);
    expect((await read(page)).documentCommits).toBe(1);
  });

  test("admin resize re-renders only the resized layer and commits once", async ({ page }) => {
    await select(page, "fx_shape");
    const handle = await anchorPoint(page, "bottom-right");
    await reset(page);
    await drag(page, handle, 60, 40, false);
    await page.waitForTimeout(250);
    const during = await read(page);
    expect(during.documentCommits).toBe(0);
    expect(count(during.renders, "preview")).toBe(0);
    expect(count(during.renders, "layer:fx_title"), "an unrelated admin layer re-rendered").toBe(0);
    expect(count(during.renders, "layer:fx_shape")).toBeGreaterThan(0);
    await page.mouse.up();
    await page.waitForTimeout(450);
    expect((await read(page)).documentCommits).toBe(1);
  });

  test("admin rotation renders nothing until release and commits once", async ({ page }) => {
    await select(page, "fx_shape");
    const rotater = await anchorPoint(page, "rotater");
    const centre = await bodyPoint(page, "fx_shape");
    const radius = Math.hypot(rotater.x - centre.x, rotater.y - centre.y);
    const start = Math.atan2(rotater.y - centre.y, rotater.x - centre.x);
    await reset(page);
    await page.mouse.move(rotater.x, rotater.y);
    await page.mouse.down();
    for (let step = 1; step <= 20; step += 1) {
      const angle = start + (step / 20) * (Math.PI / 3);
      await page.mouse.move(centre.x + Math.cos(angle) * radius, centre.y + Math.sin(angle) * radius);
    }
    await page.waitForTimeout(250);
    const during = await read(page);
    expect(during.documentCommits).toBe(0);
    expect(count(during.events, "transformSession")).toBe(1);
    expect(Object.values(during.renders).reduce((sum, n) => sum + n, 0), "React rendered during admin rotation").toBe(0);
    await page.mouse.up();
    await page.waitForTimeout(450);
    expect((await read(page)).documentCommits).toBe(1);
  });

  test("an admin multi-object drag is one atomic commit", async ({ page }) => {
    await select(page, "fx_shape");
    await select(page, "fx_frame", true);
    await select(page, "fx_photo_no_crop", true);
    expect(await selectedCount(page), "shift-click did not build a multi-selection").toBe(3);
    const shapeBefore = await documentX(page, "fx_shape");
    const frameBefore = await documentX(page, "fx_frame");
    await reset(page);

    await drag(page, await bodyPoint(page, "fx_shape"), 70, 30);
    await page.waitForTimeout(500);
    const shapeDx = (await documentX(page, "fx_shape")) - shapeBefore;
    expect(Math.abs(shapeDx)).toBeGreaterThan(20);
    expect((await documentX(page, "fx_frame")) - frameBefore).toBeCloseTo(shapeDx, 0);
    const metrics = await read(page);
    expect(metrics.documentCommits, "three objects produced more than one admin commit").toBe(1);
    expect(count(metrics.events, "batchTransformCommit")).toBe(1);
  });

  test("admin zoom: the same screen drag moves the document half as far at 2x", async ({ page }) => {
    const measure = async () => {
      await select(page, "fx_photo_no_crop");
      const before = await documentX(page, "fx_photo_no_crop");
      await drag(page, await bodyPoint(page, "fx_photo_no_crop"), 120, 0);
      await page.waitForTimeout(450);
      return (await documentX(page, "fx_photo_no_crop")) - before;
    };
    const atOne = await measure();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(page.getByTestId("admin-zoom")).toHaveText("200%");
    await page.waitForTimeout(600);
    const atTwo = await measure();
    expect(atOne).toBeGreaterThan(50);
    expect(atTwo / atOne, `100% moved ${atOne}, 200% moved ${atTwo}`).toBeGreaterThan(0.4);
    expect(atTwo / atOne).toBeLessThan(0.6);
  });

  test("an admin-locked layer cannot be dragged", async ({ page }) => {
    const before = await documentX(page, "fx_locked_caption");
    const from = await page.evaluate(() => {
      const stage = (window as any).Konva.stages[0];
      const rect = stage.findOne((n: any) => n.name?.() === "fx_locked_caption").getClientRect();
      const box = stage.container().getBoundingClientRect();
      return { x: box.left + rect.x + rect.width / 2, y: box.top + rect.y + rect.height / 2 };
    });
    await reset(page);
    await drag(page, from, 100, 60);
    await page.waitForTimeout(450);
    expect(await documentX(page, "fx_locked_caption")).toBe(before);
    expect((await read(page)).documentCommits).toBe(0);
  });
});
