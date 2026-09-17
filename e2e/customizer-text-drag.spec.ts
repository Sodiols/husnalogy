/**
 * Text must translate exactly when dragged — proven in a real browser.
 *
 * The editor interacts in RESOLVED geometry: `resolveTextBox` measures the
 * glyphs and re-anchors that box inside the authored box, so for auto-sized
 * text the resolved centre is NOT the centre the document stores. The drag used
 * to commit that resolved centre straight into the document, which moved the
 * layer by the difference between the two. Measured here before the fix: a drag
 * meant to move 161.5 document pixels moved 119 — a 42.5px error on a single
 * gesture, in the direction of the resolved/stored gap.
 *
 * Measurement rules, learned the hard way:
 *  - Snapping is OFF (`?snap=0`). With it on, the delta the gesture applies is
 *    the SNAPPED delta, which is the very number these assertions are about.
 *  - The document->screen scale is read from the artwork SVG's own viewBox,
 *    IMMEDIATELY before each drag: selecting a layer opens a properties panel,
 *    which re-fits the workspace and changes the scale.
 *  - Movement is measured on the RENDERED glyph box (`getBBox`, document
 *    units), because what the customer is promised is that the type they can
 *    see moves where they put it.
 */

import { expect, test, type Page } from "@playwright/test";

const FIXTURE = "/__e2e/customizer?snap=0";

/** Whole-document-pixel rounding is the only slack the commit is allowed. */
const TOLERANCE = 1.5;

type Point = { x: number; y: number };

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

async function openFixture(page: Page, query = ""): Promise<void> {
  await page.goto(`${FIXTURE}${query}`);
  await expect(
    page.locator('[data-customizer-canvas="main"] [data-layer-id="fx_auto_text"]').first(),
  ).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => Boolean((window as any).Konva?.stages?.length), null, { timeout: 30_000 });
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(1200);
}

async function bodyPoint(page: Page, layerId: string): Promise<Point> {
  const point = await page.evaluate((id) => {
      // The editor's own stage: page thumbnails mount Konva stages too, so
      // index 0 is not reliably the canvas being tested.
      const K = (window as any).Konva;
      const main = document.querySelector('[data-customizer-canvas="main"]');
      const stage = K.stages.find((s: any) => main && main.contains(s.container())) || K.stages[0];
      const proxy = stage.findOne((node: any) => node.name?.() === id);
      if (!proxy) return null;
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
      return null;
  }, layerId);
  if (!point) throw new Error(`no pressable body point for ${layerId}`);
  return point;
}

async function anchorPoint(page: Page, name: string): Promise<Point> {
  const point = await page.evaluate((anchor) => {
      const K = (window as any).Konva;
      const main = document.querySelector('[data-customizer-canvas="main"]');
      const stage = K.stages.find((s: any) => main && main.contains(s.container())) || K.stages[0];
      const transformer = stage.findOne("Transformer");
      if (!transformer || !transformer.nodes().length) return null;
      const node = transformer.findOne(`.${anchor}`);
      if (!node) return null;
      const rect = node.getClientRect();
      const box = stage.container().getBoundingClientRect();
      return { x: box.left + rect.x + rect.width / 2, y: box.top + rect.y + rect.height / 2 };
  }, name);
  if (!point) throw new Error(`transformer anchor "${name}" is not on screen`);
  return point;
}

/**
 * The document->screen scale, from the artwork's own viewBox. Must be sampled
 * immediately before a gesture: opening a panel re-fits the workspace.
 */
async function liveScale(page: Page): Promise<number> {
  return page.evaluate(() => {
    const svg = document.querySelector('[data-customizer-canvas="main"] svg') as SVGSVGElement;
    return svg.getBoundingClientRect().height / svg.viewBox.baseVal.height;
  });
}

/** Rendered glyph-ink centre, in DOCUMENT units — zoom independent. */
async function renderedCentre(page: Page, layerId: string): Promise<Point> {
  const box = await page.evaluate((id) => {
    const node = document.querySelector(
      `[data-customizer-canvas="main"] [data-layer-id="${id}"]`,
    ) as SVGGraphicsElement | null;
    if (!node) return null;
    const b = node.getBBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, layerId);
  if (!box) throw new Error(`no rendered node for ${layerId}`);
  return box;
}

/**
 * Bring a layer into the viewport. Above ~100% zoom the page is taller than the
 * workspace, so a layer low on the design is simply not on screen and a press
 * computed from its box would land somewhere else entirely.
 */
async function scrollLayerIntoView(page: Page, layerId: string): Promise<void> {
  await page.evaluate((id) => {
    const node = document.querySelector(`[data-customizer-canvas="main"] [data-layer-id="${id}"]`);
    node?.scrollIntoView({ block: "center", inline: "center" });
  }, layerId);
  await page.waitForTimeout(350);
}

async function selectLayer(page: Page, layerId: string): Promise<void> {
  await scrollLayerIntoView(page, layerId);
  const point = await bodyPoint(page, layerId);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(500);
}

/**
 * Drag `layerId` by a screen delta and report how far the RENDERED type moved
 * versus how far the gesture asked for, both in document units.
 */
async function dragAndMeasure(
  page: Page,
  layerId: string,
  screenDx: number,
  screenDy: number,
): Promise<{ intendedDx: number; intendedDy: number; actualDx: number; actualDy: number }> {
  await scrollLayerIntoView(page, layerId);
  const scale = await liveScale(page);
  const before = await renderedCentre(page, layerId);
  const from = await bodyPoint(page, layerId);

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 20; step += 1) {
    await page.mouse.move(from.x + (screenDx * step) / 20, from.y + (screenDy * step) / 20);
  }
  await page.mouse.up();
  await page.waitForTimeout(500);

  const after = await renderedCentre(page, layerId);
  return {
    intendedDx: screenDx / scale,
    intendedDy: screenDy / scale,
    actualDx: after.x - before.x,
    actualDy: after.y - before.y,
  };
}

function expectExact(
  result: { intendedDx: number; intendedDy: number; actualDx: number; actualDy: number },
  label: string,
): void {
  expect(
    Math.abs(result.actualDy - result.intendedDy),
    `${label}: vertical drift — asked ${result.intendedDy.toFixed(2)}, moved ${result.actualDy.toFixed(2)}`,
  ).toBeLessThanOrEqual(TOLERANCE);
  expect(
    Math.abs(result.actualDx - result.intendedDx),
    `${label}: horizontal drift — asked ${result.intendedDx.toFixed(2)}, moved ${result.actualDx.toFixed(2)}`,
  ).toBeLessThanOrEqual(TOLERANCE);
}

/** A corner resize by a screen delta. Positive grows, negative shrinks. */
async function cornerResize(page: Page, delta: number): Promise<void> {
  const anchor = await anchorPoint(page, "bottom-right");
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.down();
  for (let step = 1; step <= 16; step += 1) {
    await page.mouse.move(anchor.x + (delta * step) / 16, anchor.y + (delta * step) / 16);
  }
  await page.mouse.up();
  await page.waitForTimeout(600);
}

/* -------------------------------------------------------------------------- */
/* Suite                                                                      */
/* -------------------------------------------------------------------------- */

const TEXT_LAYERS = [
  ["fx_auto_text", "auto-width, left/top aligned"],
  ["fx_auto_height_text", "auto-height multiline"],
  ["fx_free_text", "fixed size"],
] as const;

test.describe("text drags translate exactly", () => {
  test.beforeEach(async ({ page }) => {
    await openFixture(page);
  });

  for (const [layerId, description] of TEXT_LAYERS) {
    test(`${description}: a plain drag moves the type by the gesture delta`, async ({ page }) => {
      // The case the old code got WRONG by 42.5 document pixels: the resolved
      // box and the stored box differ, and the drag committed the resolved one.
      await selectLayer(page, layerId);
      expectExact(await dragAndMeasure(page, layerId, 0, 40), `${description} first drag`);
    });

    test(`${description}: enlarge, then drag`, async ({ page }) => {
      await selectLayer(page, layerId);
      await cornerResize(page, 35);
      expectExact(await dragAndMeasure(page, layerId, 25, 35), `${description} after enlarging`);
    });

    test(`${description}: shrink, then drag`, async ({ page }) => {
      // Modest resizes on purpose. Growing a customer object past the page
      // bounds parks it against `applyCustomerObjectLimits`, which then refuses
      // further resizes AND moves — a separate clamp, and not what this test is
      // about.
      await selectLayer(page, layerId);
      await cornerResize(page, 30);
      await cornerResize(page, -25);
      expectExact(await dragAndMeasure(page, layerId, -20, -30), `${description} after shrinking`);
    });
  }

  test("repeated enlarge/drag/shrink/drag cycles never accumulate drift", async ({ page }) => {
    // The exact sequence from the report.
    await selectLayer(page, "fx_auto_text");
    for (const [index, resize] of [30, 22, -25, -18].entries()) {
      await cornerResize(page, resize);
      expectExact(await dragAndMeasure(page, "fx_auto_text", 12, 18), `cycle ${index + 1} (resize ${resize})`);
    }
  });

  test("undo and redo around a resize leave the next drag exact", async ({ page }) => {
    await selectLayer(page, "fx_auto_text");
    await cornerResize(page, 30);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(500);
    await page.keyboard.press("Control+y");
    await page.waitForTimeout(500);
    await selectLayer(page, "fx_auto_text");
    expectExact(await dragAndMeasure(page, "fx_auto_text", 15, 25), "after undo/redo");
  });

  test("a rotated text layer still translates along the document axes", async ({ page }) => {
    // Rotation must not leak into the translation: a drag is a document-space
    // move, not a move in the object's local frame.
    await selectLayer(page, "fx_auto_text");
    const rotater = await anchorPoint(page, "rotater");
    const centre = await bodyPoint(page, "fx_auto_text");
    const radius = Math.hypot(rotater.x - centre.x, rotater.y - centre.y);
    const start = Math.atan2(rotater.y - centre.y, rotater.x - centre.x);
    await page.mouse.move(rotater.x, rotater.y);
    await page.mouse.down();
    for (let step = 1; step <= 20; step += 1) {
      const angle = start + (step / 20) * (Math.PI / 4);
      await page.mouse.move(centre.x + Math.cos(angle) * radius, centre.y + Math.sin(angle) * radius);
    }
    await page.mouse.up();
    await page.waitForTimeout(600);

    expectExact(await dragAndMeasure(page, "fx_auto_text", 30, 30), "rotated text");
  });

  for (const percent of [50, 100, 150, 200]) {
    test(`stays exact at ${percent}% zoom`, async ({ page }) => {
      // The committed delta lives in DOCUMENT coordinates, so the same gesture
      // must land the same way whatever the canvas is scaled to. `liveScale`
      // converts the screen delta, so the assertion is genuinely about the
      // document and not about the zoom cancelling itself out.
      const zoom = page.locator('input[aria-label="Canvas zoom"]').first();
      await zoom.click();
      await zoom.fill(String(percent));
      await zoom.press("Enter");
      await page.waitForTimeout(700);

      // No resize here: above 100% the page overflows the workspace and the
      // bottom-right handle scrolls off screen. The assertion under test is the
      // DRAG delta, and the resize-then-drag cases are covered above at fit.
      await selectLayer(page, "fx_auto_text");
      expectExact(await dragAndMeasure(page, "fx_auto_text", 18, 24), `at ${percent}% zoom`);
    });
  }

  test("a multi-selection of text and a shape keeps their spacing exactly", async ({ page }) => {
    await selectLayer(page, "fx_auto_text");
    await cornerResize(page, 30);

    const shapePoint = await bodyPoint(page, "fx_shape");
    await page.keyboard.down("Shift");
    await page.mouse.click(shapePoint.x, shapePoint.y);
    await page.keyboard.up("Shift");
    await page.waitForTimeout(500);

    const textBefore = await renderedCentre(page, "fx_auto_text");
    const shapeBefore = await renderedCentre(page, "fx_shape");

    const from = await bodyPoint(page, "fx_shape");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 20; step += 1) await page.mouse.move(from.x + step * 1.5, from.y + step * 1.5);
    await page.mouse.up();
    await page.waitForTimeout(600);

    const textAfter = await renderedCentre(page, "fx_auto_text");
    const shapeAfter = await renderedCentre(page, "fx_shape");

    // Both must have moved, by the SAME amount.
    expect(Math.abs(shapeAfter.y - shapeBefore.y), "the selection did not move").toBeGreaterThan(2);
    expect(
      Math.abs((textAfter.x - textBefore.x) - (shapeAfter.x - shapeBefore.x)),
      "text and shape drifted apart horizontally",
    ).toBeLessThanOrEqual(TOLERANCE);
    expect(
      Math.abs((textAfter.y - textBefore.y) - (shapeAfter.y - shapeBefore.y)),
      "text and shape drifted apart vertically",
    ).toBeLessThanOrEqual(TOLERANCE);
  });
});
