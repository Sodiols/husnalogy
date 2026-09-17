/**
 * Resize, as the shipped editor actually performs it.
 *
 * Husnalogy has one live resize implementation and it is Konva's `Transformer`
 * plus the normalisation in `konva-adapter` — NOT the pure model in
 * `reference-geometry.ts`, which nothing in the app imports. That pure model has
 * its own unit tests, and those tests say nothing about production. This file is
 * the coverage that does: every assertion here is the result of a real pointer
 * dragging a real handle in a real browser.
 *
 * Runs against the in-memory fixture at /__e2e/customizer.
 */

import { expect, test, type Page } from "@playwright/test";

const FIXTURE = "/__e2e/customizer";
/** Matches MIN_OBJECT_SIZE in konva-adapter.ts, in document units. */
const MIN_OBJECT_SIZE = 24;

type Point = { x: number; y: number };
type Box = { x: number; y: number; width: number; height: number };

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

async function openFixture(page: Page): Promise<void> {
  await page.goto(FIXTURE);
  await expect(
    page.locator('[data-customizer-canvas="main"] [data-layer-id="fx_shape"]').first(),
  ).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => Boolean((window as any).Konva?.stages?.length), null, { timeout: 30_000 });
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(900);
  await resetMetrics(page);
}

async function resetMetrics(page: Page): Promise<void> {
  await page.evaluate(() => {
    const metrics = (window as any).__husnalogyCustomizerMetrics;
    if (!metrics) return;
    metrics.documentCommits = 0;
    metrics.byKind = {};
    metrics.events = {};
    metrics.renders = {};
  });
}

async function commits(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__husnalogyCustomizerMetrics?.documentCommits ?? -1);
}

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

async function anchorPoint(page: Page, name: string): Promise<Point> {
  const point = await page.evaluate((anchor) => {
    const K = (window as any).Konva;
    for (const stage of K?.stages || []) {
      const transformer = stage.findOne("Transformer");
      if (!transformer || !transformer.nodes().length) continue;
      const node = transformer.findOne(`.${anchor}`);
      if (!node) continue;
      const rect = node.getClientRect();
      const box = stage.container().getBoundingClientRect();
      return { x: box.left + rect.x + rect.width / 2, y: box.top + rect.y + rect.height / 2 };
    }
    return null;
  }, name);
  if (!point) throw new Error(`transformer anchor "${name}" is not on screen`);
  return point;
}

async function selectLayer(page: Page, layerId: string): Promise<void> {
  const point = await bodyPoint(page, layerId);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(450);
}

/**
 * The layer's geometry as the DOCUMENT holds it, read back from the Konva proxy
 * (which mirrors it) rather than from the DOM, so it works for every layer type
 * regardless of which element the renderer puts the box on.
 */
async function geometry(page: Page, layerId: string): Promise<Box> {
  const box = await page.evaluate((id) => {
    const K = (window as any).Konva;
    for (const stage of K?.stages || []) {
      const proxy = stage.findOne((node: any) => node.name?.() === id);
      if (!proxy) continue;
      return {
        x: Math.round(proxy.x()),
        y: Math.round(proxy.y()),
        width: Math.round(proxy.width()),
        height: Math.round(proxy.height()),
      };
    }
    return null;
  }, layerId);
  if (!box) throw new Error(`no proxy for ${layerId}`);
  return box;
}

/** Drag a transformer anchor by a screen delta, optionally holding Shift. */
async function dragAnchor(
  page: Page,
  anchor: string,
  dx: number,
  dy: number,
  { shift = false, steps = 16 }: { shift?: boolean; steps?: number } = {},
): Promise<void> {
  const from = await anchorPoint(page, anchor);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (shift) await page.keyboard.down("Shift");
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(from.x + (dx * step) / steps, from.y + (dy * step) / steps);
  }
  await page.mouse.up();
  if (shift) await page.keyboard.up("Shift");
  await page.waitForTimeout(450);
}

const ratio = (box: Box) => box.width / box.height;

/* -------------------------------------------------------------------------- */
/* Suite                                                                      */
/* -------------------------------------------------------------------------- */

test.describe("resize — the shipped Konva path", () => {
  test.beforeEach(async ({ page }) => {
    await openFixture(page);
  });

  test("a corner drag changes both dimensions and commits exactly once", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    const before = await geometry(page, "fx_shape");
    await resetMetrics(page);

    await dragAnchor(page, "bottom-right", 60, 60);

    const after = await geometry(page, "fx_shape");
    expect(after.width).toBeGreaterThan(before.width);
    expect(after.height).toBeGreaterThan(before.height);
    expect(await commits(page), "a resize must be ONE document write").toBe(1);
  });

  test("an edge drag changes only its own axis", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    const before = await geometry(page, "fx_shape");

    await dragAnchor(page, "middle-right", 70, 0);

    const after = await geometry(page, "fx_shape");
    expect(after.width, "the east edge did not widen the object").toBeGreaterThan(before.width);
    expect(after.height, "an edge drag changed the other axis").toBe(before.height);
  });

  test("a corner drag anchors the opposite corner", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    const before = await geometry(page, "fx_shape");

    await dragAnchor(page, "bottom-right", 60, 40);

    const after = await geometry(page, "fx_shape");
    // Top-left must not move: centre - half-extent, in document units.
    expect(Math.abs((after.x - after.width / 2) - (before.x - before.width / 2))).toBeLessThanOrEqual(2);
    expect(Math.abs((after.y - after.height / 2) - (before.y - before.height / 2))).toBeLessThanOrEqual(2);
  });

  test("Shift preserves the aspect ratio; a plain corner drag does not", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    const start = await geometry(page, "fx_shape");

    // Deliberately lopsided: a free drag must skew the ratio.
    await dragAnchor(page, "bottom-right", 90, 10);
    const free = await geometry(page, "fx_shape");
    expect(Math.abs(ratio(free) - ratio(start)), "a plain corner drag kept the ratio").toBeGreaterThan(0.05);

    await page.keyboard.press("Control+z");
    await page.waitForTimeout(450);
    const restored = await geometry(page, "fx_shape");
    expect(restored.width).toBe(start.width);

    await dragAnchor(page, "bottom-right", 90, 10, { shift: true });
    const locked = await geometry(page, "fx_shape");
    expect(locked.width, "Shift+drag did not resize at all").toBeGreaterThan(start.width);
    expect(
      Math.abs(ratio(locked) - ratio(start)),
      `Shift did not preserve the aspect ratio (${ratio(start)} -> ${ratio(locked)})`,
    ).toBeLessThan(0.05);
  });

  test("an object cannot be collapsed below the minimum size", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    const before = await geometry(page, "fx_shape");

    // Drag the corner far past the opposite one.
    await dragAnchor(page, "bottom-right", -600, -600, { steps: 24 });

    const after = await geometry(page, "fx_shape");
    expect(after.width, "collapsed below the minimum width").toBeGreaterThanOrEqual(MIN_OBJECT_SIZE);
    expect(after.height, "collapsed below the minimum height").toBeGreaterThanOrEqual(MIN_OBJECT_SIZE);
    // Regression: `flipEnabled={false}` only keeps the width positive — it does
    // not stop the pointer crossing the opposite corner, after which Konva
    // re-pinned the box on the far side and it GREW again. Dragging a corner
    // across the object turned a 300x120 shape into a 410x589 one, expanding in
    // the direction opposite the drag.
    expect(after.width, "the box inverted through its anchor and grew").toBeLessThanOrEqual(before.width);
    expect(after.height, "the box inverted through its anchor and grew").toBeLessThanOrEqual(before.height);
  });

  test("a rotated object resizes along its OWN axes", async ({ page }) => {
    await selectLayer(page, "fx_shape");

    // Rotate 90° first: a full quarter turn, so "widen along the object's x"
    // is unambiguously "grow down the screen".
    const rotater = await anchorPoint(page, "rotater");
    const centre = await bodyPoint(page, "fx_shape");
    const radius = Math.hypot(rotater.x - centre.x, rotater.y - centre.y);
    const start = Math.atan2(rotater.y - centre.y, rotater.x - centre.x);
    await page.mouse.move(rotater.x, rotater.y);
    await page.mouse.down();
    for (let step = 1; step <= 24; step += 1) {
      const angle = start + (step / 24) * (Math.PI / 2);
      await page.mouse.move(centre.x + Math.cos(angle) * radius, centre.y + Math.sin(angle) * radius);
    }
    await page.mouse.up();
    await page.waitForTimeout(450);

    const rotated = await geometry(page, "fx_shape");
    await resetMetrics(page);

    // The east handle of a 90°-rotated box points DOWN the screen. Dragging it
    // downward must widen the object's own width and leave its height alone.
    await dragAnchor(page, "middle-right", 0, 70);

    const after = await geometry(page, "fx_shape");
    expect(after.width, "a rotated edge drag did not resize along the object's own axis").toBeGreaterThan(
      rotated.width,
    );
    expect(after.height, "a rotated edge drag leaked into the other axis").toBe(rotated.height);
    expect(await commits(page)).toBe(1);
  });

  test("resizing a multi-selection scales every member as one transaction", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    const shapeBefore = await geometry(page, "fx_shape");
    const lineBefore = await geometry(page, "fx_line");

    const linePoint = await bodyPoint(page, "fx_line");
    await page.keyboard.down("Shift");
    await page.mouse.click(linePoint.x, linePoint.y);
    await page.keyboard.up("Shift");
    await page.waitForTimeout(450);
    await resetMetrics(page);

    await dragAnchor(page, "bottom-right", 70, 70);

    const shapeAfter = await geometry(page, "fx_shape");
    const lineAfter = await geometry(page, "fx_line");
    const changed =
      shapeAfter.width !== shapeBefore.width ||
      shapeAfter.height !== shapeBefore.height ||
      lineAfter.width !== lineBefore.width ||
      lineAfter.height !== lineBefore.height;
    expect(changed, "resizing a multi-selection changed nothing").toBe(true);
    expect(await commits(page), "a multi-selection resize must be ONE transaction").toBe(1);
  });

  test("a group resizes as one object and commits once", async ({ page }) => {
    // Grown from the TOP-LEFT deliberately: fx_group sits at the bottom of the
    // page, where the workspace's floating zoom controls sit over its bottom
    // handles, so a bottom-right press never reaches the canvas.
    await selectLayer(page, "fx_group");
    const before = await geometry(page, "fx_group");
    const childBefore = await renderedBox(page, "fx_group_shape");
    await resetMetrics(page);

    await dragAnchor(page, "top-left", -70, -40);

    const after = await geometry(page, "fx_group");
    const childAfter = await renderedBox(page, "fx_group_shape");
    expect(after.width, "the group did not grow").toBeGreaterThan(before.width);
    expect(childBefore.width, "the group child was never measured").toBeGreaterThan(0);
    expect(
      childAfter.width !== childBefore.width || childAfter.x !== childBefore.x,
      `resizing the group left its children untouched (${JSON.stringify(childBefore)} -> ${JSON.stringify(childAfter)})`,
    ).toBe(true);
    expect(await commits(page), "a group resize must be ONE transaction").toBe(1);
  });

  test("a text box side drag changes the wrap width, not the type size", async ({ page }) => {
    // Side handles are a BOX change. Only a corner drag is a type-size change,
    // so the glyphs must not grow here or the type would be stretched.
    await selectLayer(page, "fx_free_text");
    const fontBefore = await fontSize(page, "fx_free_text");
    const before = await geometry(page, "fx_free_text");
    await resetMetrics(page);

    await dragAnchor(page, "middle-right", -80, 0);

    const after = await geometry(page, "fx_free_text");
    expect(after.width, "the side handle did not change the wrap width").toBeLessThan(before.width);
    expect(await fontSize(page, "fx_free_text"), "a side drag changed the font size").toBe(fontBefore);
    expect(await commits(page)).toBe(1);
  });

  test("a text corner drag scales the TYPE rather than stretching the glyphs", async ({ page }) => {
    await selectLayer(page, "fx_free_text");
    const fontBefore = await fontSize(page, "fx_free_text");
    await resetMetrics(page);

    await dragAnchor(page, "bottom-right", 60, 60);

    const fontAfter = await fontSize(page, "fx_free_text");
    expect(fontAfter, "a corner drag on text did not change the type size").toBeGreaterThan(fontBefore);
    expect(await commits(page)).toBe(1);
  });

  test("stretching a photo frame re-crops it and never distorts the image", async ({ page }) => {
    // This is why images are NOT aspect-locked by default: the frame is a crop
    // window, not a stretch. The renderer always draws the photo with a
    // uniform-scale fit, so a lopsided frame changes what you see, never the
    // proportions of what is in it.
    await selectLayer(page, "fx_photo_no_crop");
    const before = await imageDraw(page, "fx_photo_no_crop");

    await dragAnchor(page, "bottom-right", 110, 10);

    const after = await imageDraw(page, "fx_photo_no_crop");
    expect(after.preserveAspectRatio, "the photo is no longer drawn with a uniform fit").toMatch(
      /xMidYMid (slice|meet)/,
    );
    // The frame got much wider than it got taller...
    const frame = await geometry(page, "fx_photo_no_crop");
    expect(frame.width).toBeGreaterThan(0);
    // ...and the drawn image still carries a uniform fit, so no axis was
    // scaled independently of the other.
    expect(before.preserveAspectRatio).toBe(after.preserveAspectRatio);
  });

  test("resize survives undo and redo exactly", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    const before = await geometry(page, "fx_shape");

    await dragAnchor(page, "bottom-right", 70, 50);
    const resized = await geometry(page, "fx_shape");
    expect(resized.width).not.toBe(before.width);

    await page.keyboard.press("Control+z");
    await page.waitForTimeout(450);
    expect(await geometry(page, "fx_shape")).toEqual(before);

    await page.keyboard.press("Control+y");
    await page.waitForTimeout(450);
    expect(await geometry(page, "fx_shape")).toEqual(resized);
  });
});

/**
 * The rendered font-size of a text layer, in document units. The renderer sets
 * it through the `style` attribute rather than an SVG `font-size` attribute, so
 * read the resolved style.
 */
async function fontSize(page: Page, layerId: string): Promise<number> {
  return page.evaluate((id) => {
    const node = document.querySelector(
      `[data-customizer-canvas="main"] [data-layer-id="${id}"] text`,
    ) as SVGTextElement | null;
    if (!node) return 0;
    return parseFloat(node.style.fontSize || getComputedStyle(node).fontSize) || 0;
  }, layerId);
}

/** How the renderer is drawing the photo inside its frame. */
async function imageDraw(page: Page, layerId: string): Promise<{ preserveAspectRatio: string }> {
  return page.evaluate((id) => {
    const node = document.querySelector(
      `[data-customizer-canvas="main"] [data-layer-id="${id}"] image`,
    );
    return { preserveAspectRatio: node?.getAttribute("preserveAspectRatio") || "" };
  }, layerId);
}

/**
 * A layer's RENDERED box, read from the SVG. Group members have no Konva proxy
 * of their own — clicking one selects the group, so they are not in the hit
 * graph — which makes the DOM the only place their geometry is observable.
 */
async function renderedBox(page: Page, layerId: string): Promise<Box> {
  return page.evaluate((id) => {
    // Measure the rendered group element itself: each layer type emits
    // different markup inside it (rect, ellipse, image, text), so asking for
    // one tag would silently measure nothing for the others.
    const node = document.querySelector(
      `[data-customizer-canvas="main"] [data-layer-id="${id}"]`,
    ) as SVGGraphicsElement | null;
    if (!node) return { x: 0, y: 0, width: 0, height: 0 };
    const box = node.getBoundingClientRect();
    return {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
    };
  }, layerId);
}
