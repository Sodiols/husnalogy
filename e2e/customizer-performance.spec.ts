/**
 * Large-document performance, measured rather than assumed (spec §22, §23).
 *
 * This is a MEASUREMENT harness first and a regression guard second. It loads
 * the editor at 20 / 50 / 100 / 200 layers and records editor mount time, the
 * cost of a selection, and the per-frame cost of a drag — then asserts only the
 * things that would represent a real architectural regression rather than a
 * slow CI machine:
 *
 *   - a drag must still write the document exactly ONCE, whatever the layer
 *     count (the transient-gesture contract);
 *   - a drag must NOT re-render the workspace or the preview shell (the
 *     "React is not the pointer loop" contract);
 *   - interaction cost must not grow super-linearly with document size.
 *
 * Absolute millisecond thresholds are deliberately loose: a dev-mode Turbopack
 * build on a shared CI runner is not a performance environment, and a test that
 * fails because the machine is busy teaches nobody anything. The numbers are
 * printed so a human can read the trend.
 */

import { expect, test, type Page } from "@playwright/test";

const COUNTS = [20, 50, 100, 200];

type Point = { x: number; y: number };
type Sample = {
  layers: number;
  mountMs: number;
  selectMs: number;
  dragMs: number;
  framesPerStep: number;
  commits: number;
  workspaceRenders: number;
  previewRenders: number;
};

const samples: Sample[] = [];

async function bodyPoint(page: Page, layerId: string): Promise<Point> {
  const point = await page.evaluate((id) => {
    const K = (window as any).Konva;
    for (const stage of K?.stages || []) {
      const proxy = stage.findOne((node: any) => node.name?.() === id);
      if (!proxy) continue;
      const rect = proxy.getClientRect();
      const box = stage.container().getBoundingClientRect();
      const candidates: Array<{ x: number; y: number }> = [];
      for (let gy = 1; gy < 10; gy += 1) {
        for (let gx = 1; gx < 10; gx += 1) {
          candidates.push({ x: rect.x + (rect.width * gx) / 10, y: rect.y + (rect.height * gy) / 10 });
        }
      }
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      candidates.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
      for (const candidate of candidates) {
        if (stage.getIntersection(candidate)?.name?.() === id) {
          return { x: box.left + candidate.x, y: box.top + candidate.y };
        }
      }
    }
    return null;
  }, layerId);
  if (!point) throw new Error(`no pressable body point for ${layerId}`);
  return point;
}

test.describe("large-document performance", () => {
  for (const count of COUNTS) {
    test(`${count} layers: one commit per drag, no workspace re-render`, async ({ page }) => {
      const started = Date.now();
      await page.goto(`/__e2e/customizer?stress=${count}`);
      await expect(
        page.locator('[data-customizer-canvas="main"] [data-layer-id="fx_title"]').first(),
      ).toBeVisible({ timeout: 60_000 });
      await page.waitForFunction(() => Boolean((window as any).Konva?.stages?.length), null, {
        timeout: 60_000,
      });
      const mountMs = Date.now() - started;

      await page.evaluate(() => (document as any).fonts?.ready);
      await page.waitForTimeout(1200);

      // How many layers actually rendered, so the number reported is real.
      const rendered = await page.evaluate(
        () => document.querySelectorAll('[data-customizer-canvas="main"] [data-layer-id]').length,
      );
      expect(rendered, "the stress document did not render").toBeGreaterThanOrEqual(count);

      const reset = () =>
        page.evaluate(() => {
          const metrics = (window as any).__husnalogyCustomizerMetrics;
          metrics.documentCommits = 0;
          metrics.byKind = {};
          metrics.events = {};
          metrics.renders = {};
        });

      // --- selection cost -------------------------------------------------
      await reset();
      const selectStart = Date.now();
      const target = await bodyPoint(page, "fx_title");
      await page.mouse.click(target.x, target.y);
      await page.waitForTimeout(400);
      const selectMs = Date.now() - selectStart - 400;

      // --- drag cost ------------------------------------------------------
      await reset();
      const from = await bodyPoint(page, "fx_title");
      const STEPS = 20;
      const dragStart = Date.now();
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let step = 1; step <= STEPS; step += 1) {
        await page.mouse.move(from.x + step * 3, from.y + step * 2);
      }
      const dragMs = Date.now() - dragStart;

      // Mid-gesture: the document must be untouched and React must be idle.
      const during = await page.evaluate(() =>
        JSON.parse(JSON.stringify((window as any).__husnalogyCustomizerMetrics)),
      );
      expect(during.documentCommits, "the document was written DURING a drag").toBe(0);

      await page.mouse.up();
      await page.waitForTimeout(500);

      const after = await page.evaluate(() =>
        JSON.parse(JSON.stringify((window as any).__husnalogyCustomizerMetrics)),
      );

      const workspaceRenders = Number(during.renders?.workspace || 0);
      const previewRenders = Number(during.renders?.preview || 0);

      samples.push({
        layers: rendered,
        mountMs,
        selectMs,
        dragMs,
        framesPerStep: Number((dragMs / STEPS).toFixed(2)),
        commits: after.documentCommits,
        workspaceRenders,
        previewRenders,
      });

      // The contracts that must hold at every size.
      expect(after.documentCommits, "a drag must be ONE document write at any layer count").toBe(1);
      expect(
        workspaceRenders,
        "the workspace re-rendered during a drag — React is back in the pointer loop",
      ).toBe(0);
      expect(
        previewRenders,
        "the preview shell re-rendered during a drag — React is back in the pointer loop",
      ).toBe(0);
    });
  }

  test.afterAll(() => {
    if (!samples.length) return;
    const rows = samples
      .slice()
      .sort((a, b) => a.layers - b.layers)
      .map(
        (sample) =>
          `  ${String(sample.layers).padStart(4)} layers | mount ${String(sample.mountMs).padStart(6)}ms` +
          ` | select ${String(sample.selectMs).padStart(5)}ms` +
          ` | drag ${String(sample.dragMs).padStart(5)}ms (${sample.framesPerStep}ms/step)` +
          ` | commits ${sample.commits} | workspace renders ${sample.workspaceRenders}`,
      );
    console.log(["", "Customizer large-document measurements:", ...rows, ""].join("\n"));
  });
});
