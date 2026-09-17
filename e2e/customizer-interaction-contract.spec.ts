/**
 * The customizer's interaction contract (hardening brief §38).
 *
 * These tests exist because the editor's central guarantees are invisible in a
 * screenshot: a continuous gesture writes the canonical document exactly ONCE;
 * a multi-object gesture is ONE transaction; Cancel is a real rollback of the
 * document, of history and of persistence; and no stale timer, frame or save
 * response can overwrite a newer state.
 *
 * They run against the in-memory fixture at /__e2e/customizer — no seeded
 * Supabase product, no logged-in customer, no remote asset. A failure here is a
 * real editor regression, never an unseeded database.
 *
 * Measurement rules learned the hard way, applied throughout:
 *  - Locators are scoped to [data-customizer-canvas="main"]; page thumbnails
 *    render the same layer ids at 0x0.
 *  - Geometry is read from SVG attributes (document units), never from
 *    getBoundingClientRect: selecting opens a panel and re-fits the canvas.
 *  - Press points are chosen by asking Konva's own hit graph what is under the
 *    pointer, so a gesture meant for an object's body never grabs a handle.
 *  - Nothing here skips dynamically. A broken contract fails.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

const FIXTURE = "/__e2e/customizer";
/** Must exceed CROP_SETTLE_MS (260) in CustomizerWorkspace. */
const SETTLE_WAIT = 700;
/** Must exceed the save queue debounce (900) plus a local write. */
const AUTOSAVE_WAIT = 2200;
const DRAFT_KEY = "husnalogy_customizer_draft:e2e-fixture-product:e2e-fixture-template:1";

type Metrics = {
  documentCommits: number;
  byKind: Record<string, number>;
  events: Record<string, number>;
  renders: Record<string, number>;
};
type Point = { x: number; y: number };

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

async function resetMetrics(page: Page): Promise<void> {
  await page.evaluate(() => {
    const metrics = (window as any).__husnalogyCustomizerMetrics;
    metrics.documentCommits = 0;
    metrics.byKind = {};
    metrics.events = {};
    metrics.renders = {};
  });
}

async function readMetrics(page: Page): Promise<Metrics> {
  return page.evaluate(() => JSON.parse(JSON.stringify((window as any).__husnalogyCustomizerMetrics)));
}

const count = (record: Record<string, number>, key: string) => record[key] || 0;

function canvasLayer(page: Page, layerId: string): Locator {
  return page.locator(`[data-customizer-canvas="main"] [data-layer-id="${layerId}"]`).first();
}

async function openFixture(page: Page, query = ""): Promise<void> {
  await page.goto(`${FIXTURE}${query}`);
  await expect(canvasLayer(page, "fx_title")).toBeVisible({ timeout: 30_000 });
  // The artwork renders BEFORE the interaction layer exists — Konva ships in
  // its own `next/dynamic` chunk, so on a cold dev start the shapes are on
  // screen while that chunk is still compiling. Every helper below asks Konva's
  // hit graph where to press, so the STAGE is the precondition, not the canvas
  // element (which mounts first).
  await page.waitForFunction(() => Boolean((window as any).Konva?.stages?.length), null, { timeout: 30_000 });
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(900);
  const instrumented = await page.evaluate(
    () => typeof (window as any).__husnalogyCustomizerMetrics === "object",
  );
  // A hard failure, not a skip: without metrics none of these contracts can be
  // proven, and a silently skipped suite would read as a passing one.
  expect(instrumented, "run against a DEVELOPMENT build — editor metrics are compiled out of production").toBe(true);
  await resetMetrics(page);
}

async function centreOf(locator: Locator): Promise<Point> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no rendered box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * A viewport point that Konva's hit graph resolves to `layerId`'s proxy — the
 * object's body, never a transformer handle drawn over it. Searches outward
 * from the centre.
 */
async function bodyPoint(page: Page, layerId: string): Promise<Point> {
  const point = await page.evaluate((id) => {
    const K = (window as any).Konva;
    for (const stage of K?.stages || []) {
      const proxy = stage.findOne((node: any) => node.name?.() === id);
      if (!proxy) continue;
      const rect = proxy.getClientRect();
      const box = stage.container().getBoundingClientRect();
      const candidates: Point[] = [];
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

/** Viewport centre of a transformer anchor ("rotater", "bottom-right", ...). */
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

/** Click a layer's body, then wait for the selection panel to re-fit the canvas. */
async function selectLayer(page: Page, layerId: string): Promise<void> {
  const point = await bodyPoint(page, layerId);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(450);
}

/** Press, move through `steps` positions, and optionally stay pressed. */
async function pressAndMove(page: Page, from: Point, to: (step: number) => Point, steps: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    const point = to(step);
    await page.mouse.move(point.x, point.y);
  }
}

async function rectAttrs(page: Page, layerId: string) {
  return page.evaluate((id) => {
    const rect = document.querySelector(`[data-customizer-canvas="main"] [data-layer-id="${id}"] rect`);
    const read = (name: string) => Number(rect?.getAttribute(name));
    return { x: read("x"), y: read("y"), width: read("width"), height: read("height"), transform: rect?.getAttribute("transform") || "" };
  }, layerId);
}

async function cropDrawBox(page: Page, layerId: string) {
  return page.evaluate((id) => {
    const image = document.querySelector(`[data-customizer-canvas="main"] [data-layer-id="${id}"] image`);
    const read = (name: string) => Number(image?.getAttribute(name));
    return { x: read("x"), y: read("y"), width: read("width") };
  }, layerId);
}

async function gridImageBoxes(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-customizer-canvas="main"] [data-layer-id="fx_grid"] image')].map((image) => ({
      x: Number(image.getAttribute("x")),
      y: Number(image.getAttribute("y")),
      width: Number(image.getAttribute("width")),
    })),
  );
}

async function enterCrop(page: Page, layerId: string): Promise<Locator> {
  await selectLayer(page, layerId);
  const point = await bodyPoint(page, layerId);
  await page.mouse.dblclick(point.x, point.y);
  const surface = page.getByRole("application", { name: /crop photo/i });
  await expect(surface, "crop mode did not open").toBeVisible({ timeout: 10_000 });
  return surface;
}

async function enterGridCrop(page: Page): Promise<Locator> {
  await selectLayer(page, "fx_grid");
  const point = await bodyPoint(page, "fx_grid");
  // Double-click enters the grid; the slot toolbar then offers Crop.
  await page.mouse.dblclick(point.x, point.y);
  await page.getByRole("button", { name: "Crop", exact: true }).first().click();
  const surface = page.getByRole("application", { name: /crop grid photo/i });
  await expect(surface, "grid crop mode did not open").toBeVisible({ timeout: 10_000 });
  return surface;
}

async function wheelBurst(page: Page, surface: Locator, ticks: number, deltaY = -40): Promise<void> {
  const at = await centreOf(surface);
  await page.mouse.move(at.x, at.y);
  for (let tick = 0; tick < ticks; tick += 1) await page.mouse.wheel(0, deltaY);
}

async function panCrop(page: Page, surface: Locator, dx: number, dy: number): Promise<void> {
  const from = await centreOf(surface);
  await pressAndMove(page, from, (step) => ({ x: from.x + (dx * step) / 20, y: from.y + (dy * step) / 20 }), 20);
  await page.mouse.up();
  await page.waitForTimeout(450);
}

const undo = (page: Page) => page.keyboard.press("Control+z");
const redo = (page: Page) => page.keyboard.press("Control+y");

/**
 * The crop as PERSISTED. The saved payload carries editor state under
 * `renderData.editorState` — the same structure the server receives — so this
 * reads what a reload would load, not what the screen shows.
 */
function draftCropOffsets(draft: any) {
  const transform = draft?.renderData?.editorState?.layerOverrides?.fx_photo_crop?.imageTransform || {};
  return { offsetX: Number(transform.offsetX) || 0, offsetY: Number(transform.offsetY) || 0 };
}

async function readDraft(page: Page): Promise<any> {
  return page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || "null"), DRAFT_KEY);
}

/* -------------------------------------------------------------------------- */
/* Suite                                                                      */
/* -------------------------------------------------------------------------- */

test.describe("customizer interaction contract", () => {
  test.beforeEach(async ({ page }) => {
    await openFixture(page);
  });

  /* ---------------------------- fixture ---------------------------------- */

  test("the fixture mounts the real editor with no seeded database", async ({ page }) => {
    for (const id of [
      "fx_title",
      "fx_free_text",
      "fx_locked_caption",
      "fx_photo_crop",
      "fx_photo_no_crop",
      "fx_shape",
      "fx_frame",
      "fx_grid",
      "fx_group_text",
      "fx_group_shape",
    ]) {
      await expect(canvasLayer(page, id), `${id} is missing from the canvas`).toBeVisible();
    }
    await expect(canvasLayer(page, "fx_group")).toBeAttached();
    // A horizontal <line> has a zero-height box (stroke is excluded), which
    // Playwright reports as hidden, so it is asserted by presence below.
    await expect(canvasLayer(page, "fx_line")).toBeAttached();
    await expect(page.locator('[data-layer-id="fx_hidden"]')).toHaveCount(0);
    // The line is a real production line: a shape rendered as an SVG <line>.
    await expect(page.locator('[data-customizer-canvas="main"] [data-layer-id="fx_line"] line')).toHaveCount(1);
  });

  /* ------------------------------ drag ----------------------------------- */

  test("a 20-step drag writes nothing and renders nothing until release, then commits once", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    const before = await rectAttrs(page, "fx_shape");
    const from = await bodyPoint(page, "fx_shape");
    await resetMetrics(page);

    await pressAndMove(page, from, (step) => ({ x: from.x + step * 4, y: from.y + step * 3 }), 20);
    await page.waitForTimeout(250);
    const during = await readMetrics(page);
    expect(during.documentCommits, "document written during the drag").toBe(0);
    expect(count(during.renders, "workspace"), "the workspace re-rendered during a drag").toBe(0);
    expect(count(during.renders, "preview"), "the preview re-rendered during a drag").toBe(0);

    await page.mouse.up();
    await page.waitForTimeout(450);
    const after = await rectAttrs(page, "fx_shape");
    expect(Math.hypot(after.x - before.x, after.y - before.y), "the drag did not move the object").toBeGreaterThan(40);

    const settled = await readMetrics(page);
    expect(settled.documentCommits).toBe(1);
    expect(count(settled.events, "historyTransaction")).toBe(1);
  });

  test("drag undo and redo restore exact document geometry", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    const before = await rectAttrs(page, "fx_shape");
    const from = await bodyPoint(page, "fx_shape");
    await pressAndMove(page, from, (step) => ({ x: from.x + step * 4, y: from.y + step * 3 }), 20);
    await page.mouse.up();
    await page.waitForTimeout(450);
    const moved = await rectAttrs(page, "fx_shape");
    expect(moved.x).not.toBe(before.x);

    await undo(page);
    await page.waitForTimeout(400);
    expect(await rectAttrs(page, "fx_shape")).toMatchObject({ x: before.x, y: before.y });

    await redo(page);
    await page.waitForTimeout(400);
    expect(await rectAttrs(page, "fx_shape")).toMatchObject({ x: moved.x, y: moved.y });
  });

  /* ----------------------------- resize ---------------------------------- */

  test("a 20-step resize re-renders only the resized layer and commits once", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    const before = await rectAttrs(page, "fx_shape");
    const handle = await anchorPoint(page, "bottom-right");
    await resetMetrics(page);

    await pressAndMove(page, handle, (step) => ({ x: handle.x + step * 3, y: handle.y + step * 2 }), 20);
    await page.waitForTimeout(250);
    const during = await readMetrics(page);
    expect(during.documentCommits, "document written during the resize").toBe(0);
    expect(count(during.renders, "workspace"), "the workspace re-rendered during a resize").toBe(0);
    expect(count(during.renders, "preview"), "the preview shell re-rendered during a resize").toBe(0);
    expect(count(during.renders, "layer:fx_title"), "an unrelated layer re-rendered during a resize").toBe(0);
    expect(count(during.renders, "layer:fx_shape"), "the resized layer never previewed").toBeGreaterThan(0);

    await page.mouse.up();
    await page.waitForTimeout(450);
    const after = await rectAttrs(page, "fx_shape");
    expect(after.width - before.width, "the resize did not change the width").toBeGreaterThan(20);
    // Nothing transient may survive the commit into the rendered artwork.
    expect(await canvasLayer(page, "fx_shape").getAttribute("transform")).toBeNull();

    const settled = await readMetrics(page);
    expect(settled.documentCommits).toBe(1);
    expect(count(settled.events, "historyTransaction")).toBe(1);
  });

  test("resize undo and redo restore exact size", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    const before = await rectAttrs(page, "fx_shape");
    const handle = await anchorPoint(page, "bottom-right");
    await pressAndMove(page, handle, (step) => ({ x: handle.x + step * 3, y: handle.y + step * 2 }), 20);
    await page.mouse.up();
    await page.waitForTimeout(450);
    const resized = await rectAttrs(page, "fx_shape");
    expect(resized.width).toBeGreaterThan(before.width);

    await undo(page);
    await page.waitForTimeout(400);
    expect(await rectAttrs(page, "fx_shape")).toMatchObject({ width: before.width, height: before.height });
    await redo(page);
    await page.waitForTimeout(400);
    expect(await rectAttrs(page, "fx_shape")).toMatchObject({ width: resized.width, height: resized.height });
  });

  /* ---------------------------- rotation --------------------------------- */

  async function rotateShape(page: Page, finish = true): Promise<void> {
    await selectLayer(page, "fx_shape");
    const rotater = await anchorPoint(page, "rotater");
    const centre = await bodyPoint(page, "fx_shape");
    const radius = Math.hypot(rotater.x - centre.x, rotater.y - centre.y);
    const start = Math.atan2(rotater.y - centre.y, rotater.x - centre.x);
    await pressAndMove(
      page,
      rotater,
      (step) => {
        const angle = start + (step / 20) * (Math.PI / 3);
        return { x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius };
      },
      20,
    );
    if (finish) {
      await page.mouse.up();
      await page.waitForTimeout(450);
    }
  }

  test("a 20-step rotation renders nothing until release, then commits once", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    await resetMetrics(page);
    await rotateShape(page, false);
    await page.waitForTimeout(250);

    const during = await readMetrics(page);
    expect(during.documentCommits, "document written during the rotation").toBe(0);
    expect(count(during.events, "transformSession"), "the rotater was not grabbed").toBe(1);
    // Rotation cannot change layout, so it previews as a DOM transform: no React at all.
    expect(Object.values(during.renders).reduce((sum, n) => sum + n, 0), "React rendered during a rotation").toBe(0);

    await page.mouse.up();
    await page.waitForTimeout(450);
    const settled = await readMetrics(page);
    expect(settled.documentCommits).toBe(1);
    expect(count(settled.events, "historyTransaction")).toBe(1);
    expect((await rectAttrs(page, "fx_shape")).transform, "the committed rotation did not render").toMatch(/rotate\(/);
    // The transient attribute on the layer group is gone once committed.
    expect(await canvasLayer(page, "fx_shape").getAttribute("transform")).toBeNull();
  });

  test("rotation undo and redo", async ({ page }) => {
    const before = await rectAttrs(page, "fx_shape");
    await rotateShape(page);
    const rotated = await rectAttrs(page, "fx_shape");
    expect(rotated.transform).toMatch(/rotate\(/);

    await undo(page);
    await page.waitForTimeout(400);
    expect((await rectAttrs(page, "fx_shape")).transform).toBe(before.transform);
    await redo(page);
    await page.waitForTimeout(400);
    expect((await rectAttrs(page, "fx_shape")).transform).toBe(rotated.transform);
  });

  /* ------------------------- multi selection ----------------------------- */

  test("a multi-object drag is ONE atomic transaction however many objects move", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    await page.keyboard.press("Control+a");
    await page.waitForTimeout(500);
    const selected = await page.evaluate(() => {
      const K = (window as any).Konva;
      for (const stage of K?.stages || []) {
        const transformer = stage.findOne("Transformer");
        if (transformer?.nodes().length) return transformer.nodes().length;
      }
      return 0;
    });
    expect(selected, "Select All did not produce a multi-selection of at least five objects").toBeGreaterThanOrEqual(5);

    const shapeBefore = await rectAttrs(page, "fx_shape");
    const lineBefore = await page.evaluate(() =>
      Number(document.querySelector('[data-customizer-canvas="main"] [data-layer-id="fx_line"] line')?.getAttribute("x1")),
    );
    const from = await bodyPoint(page, "fx_shape");
    await resetMetrics(page);

    await pressAndMove(page, from, (step) => ({ x: from.x + step * 3, y: from.y + step * 2 }), 20);
    await page.waitForTimeout(250);
    expect((await readMetrics(page)).documentCommits, "document written during the multi drag").toBe(0);
    await page.mouse.up();
    await page.waitForTimeout(600);

    const shapeAfter = await rectAttrs(page, "fx_shape");
    const lineAfter = await page.evaluate(() =>
      Number(document.querySelector('[data-customizer-canvas="main"] [data-layer-id="fx_line"] line')?.getAttribute("x1")),
    );
    const shapeDx = shapeAfter.x - shapeBefore.x;
    expect(Math.abs(shapeDx), "the selection did not move").toBeGreaterThan(20);
    // Rigid: every member moved by the same document delta.
    expect(lineAfter - lineBefore, "members moved by different amounts").toBeCloseTo(shapeDx, 0);

    const settled = await readMetrics(page);
    expect(settled.documentCommits, `${selected} objects produced ${settled.documentCommits} document writes`).toBe(1);
    expect(count(settled.events, "batchTransformCommit"), "the gesture was not committed as a batch").toBe(1);
    expect(count(settled.events, "historyTransaction")).toBe(1);

    await undo(page);
    await page.waitForTimeout(400);
    expect((await rectAttrs(page, "fx_shape")).x).toBe(shapeBefore.x);
    await redo(page);
    await page.waitForTimeout(400);
    expect((await rectAttrs(page, "fx_shape")).x).toBe(shapeAfter.x);
  });

  /* ------------------------------ group ---------------------------------- */

  test("moving a group moves every member rigidly as one transaction", async ({ page }) => {
    const readGroup = () =>
      page.evaluate(() => {
        const q = (id: string, sel: string) =>
          document.querySelector(`[data-customizer-canvas="main"] [data-layer-id="${id}"] ${sel}`);
        return {
          textX: Number(q("fx_group_text", "tspan")?.getAttribute("x")),
          textY: Number(q("fx_group_text", "tspan")?.getAttribute("y")),
          shapeCx: Number(q("fx_group_shape", "ellipse")?.getAttribute("cx")),
          shapeCy: Number(q("fx_group_shape", "ellipse")?.getAttribute("cy")),
        };
      });

    // Clicking a member selects the outermost group.
    await selectLayer(page, "fx_group");
    const before = await readGroup();
    const from = await bodyPoint(page, "fx_group");
    await resetMetrics(page);

    await pressAndMove(page, from, (step) => ({ x: from.x + step * 3, y: from.y - step * 2 }), 20);
    await page.waitForTimeout(250);
    const during = await readMetrics(page);
    expect(during.documentCommits, "document written during the group drag").toBe(0);
    expect(count(during.events, "dragSession"), "the group body was not dragged").toBe(1);
    await page.mouse.up();
    await page.waitForTimeout(600);

    const after = await readGroup();
    const dx = after.shapeCx - before.shapeCx;
    const dy = after.shapeCy - before.shapeCy;
    expect(Math.abs(dx), "the group did not move").toBeGreaterThan(20);
    expect(after.textX - before.textX, "members moved by different amounts").toBeCloseTo(dx, 0);
    expect(after.textY - before.textY).toBeCloseTo(dy, 0);

    const settled = await readMetrics(page);
    expect(settled.documentCommits).toBe(1);
    expect(count(settled.events, "historyTransaction")).toBe(1);

    await undo(page);
    await page.waitForTimeout(400);
    expect(await readGroup()).toEqual(before);
    await redo(page);
    await page.waitForTimeout(400);
    expect(await readGroup()).toEqual(after);
  });

  /* --------------------------- permissions ------------------------------- */

  test("a locked layer cannot be dragged and writes nothing", async ({ page }) => {
    const anchorOf = () =>
      page.evaluate(() => {
        const tspan = document.querySelector('[data-customizer-canvas="main"] [data-layer-id="fx_locked_caption"] tspan');
        return { x: Number(tspan?.getAttribute("x")), y: Number(tspan?.getAttribute("y")) };
      });
    const before = await anchorOf();
    const from = await centreOf(canvasLayer(page, "fx_locked_caption"));
    await resetMetrics(page);
    await pressAndMove(page, from, (step) => ({ x: from.x + step * 8, y: from.y + step * 5 }), 12);
    await page.mouse.up();
    await page.waitForTimeout(450);

    expect(await anchorOf()).toEqual(before);
    expect((await readMetrics(page)).documentCommits, "a locked layer produced a document write").toBe(0);
  });

  test("a hidden layer neither renders nor intercepts selection", async ({ page }) => {
    await expect(page.locator('[data-layer-id="fx_hidden"]')).toHaveCount(0);
    await page.getByRole("button", { name: /next: design back/i }).click();
    await expect(canvasLayer(page, "fx_qr")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-layer-id="fx_hidden"]')).toHaveCount(0);
    // fx_hidden sits on top of the QR code; a click must still reach the QR.
    const qr = await bodyPoint(page, "fx_qr");
    expect(qr).toBeTruthy();
  });

  test("front and back pages carry their own layers", async ({ page }) => {
    await expect(canvasLayer(page, "fx_title")).toBeVisible();
    await page.getByRole("button", { name: /next: design back/i }).click();
    await expect(canvasLayer(page, "fx_qr")).toBeVisible({ timeout: 15_000 });
    await expect(canvasLayer(page, "fx_back_text")).toBeVisible();
    await expect(page.locator('[data-customizer-canvas="main"] [data-layer-id="fx_title"]')).toHaveCount(0);
  });

  /* ------------------------------ crop ----------------------------------- */

  test("entering crop mode creates no history and writes nothing", async ({ page }) => {
    await enterCrop(page, "fx_photo_crop");
    const metrics = await readMetrics(page);
    expect(count(metrics.events, "historyTransaction")).toBe(0);
    expect(metrics.documentCommits).toBe(0);
  });

  test("a 20-step crop pan writes nothing until release, then commits once", async ({ page }) => {
    const surface = await enterCrop(page, "fx_photo_crop");
    const original = await cropDrawBox(page, "fx_photo_crop");
    await resetMetrics(page);

    const from = await centreOf(surface);
    await pressAndMove(page, from, (step) => ({ x: from.x + step * 4, y: from.y + step * 2 }), 20);
    await page.waitForTimeout(250);
    const during = await readMetrics(page);
    expect(count(during.byKind, "crop"), "crop pan wrote the document while the pointer was down").toBe(0);
    expect(count(during.renders, "workspace"), "the workspace re-rendered during a crop pan").toBe(0);

    await page.mouse.up();
    await page.waitForTimeout(450);
    const moved = await cropDrawBox(page, "fx_photo_crop");
    expect(Math.abs(moved.x - original.x), "the crop pan did not move the photo").toBeGreaterThan(5);

    const after = await readMetrics(page);
    expect(count(after.byKind, "crop")).toBe(1);
    expect(count(after.events, "historyTransaction")).toBe(1);
  });

  test("a wheel-zoom burst is ONE grouped crop commit", async ({ page }) => {
    const surface = await enterCrop(page, "fx_photo_crop");
    const original = await cropDrawBox(page, "fx_photo_crop");
    await resetMetrics(page);

    await wheelBurst(page, surface, 8);
    const during = await readMetrics(page);
    expect(count(during.byKind, "crop"), "a wheel event wrote the document before settling").toBe(0);

    await page.waitForTimeout(SETTLE_WAIT);
    const after = await readMetrics(page);
    expect(count(after.byKind, "crop"), "8 wheel events were not grouped").toBe(1);
    expect(count(after.events, "cropSessionStarted")).toBe(1);
    expect((await cropDrawBox(page, "fx_photo_crop")).width).toBeGreaterThan(original.width);
  });

  test("crop Done commits a still-pending gesture exactly once", async ({ page }) => {
    const surface = await enterCrop(page, "fx_photo_crop");
    await resetMetrics(page);
    await wheelBurst(page, surface, 5);

    // Done inside the settle window: Done must commit it, and the timer must not commit again.
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.waitForTimeout(SETTLE_WAIT);

    await expect(page.getByRole("application", { name: /crop photo/i })).toHaveCount(0);
    const after = await readMetrics(page);
    expect(count(after.byKind, "crop")).toBe(1);
    expect(count(after.events, "cropCommit")).toBe(1);
  });

  test("crop Done with no change writes nothing", async ({ page }) => {
    await enterCrop(page, "fx_photo_crop");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.waitForTimeout(400);
    const after = await readMetrics(page);
    expect(after.documentCommits).toBe(0);
    expect(count(after.events, "historyTransaction")).toBe(0);
  });

  test("crop pan undo and redo restore the exact crop", async ({ page }) => {
    const surface = await enterCrop(page, "fx_photo_crop");
    const original = await cropDrawBox(page, "fx_photo_crop");
    await panCrop(page, surface, 70, 40);
    const committed = await cropDrawBox(page, "fx_photo_crop");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.waitForTimeout(400);

    await undo(page);
    await page.waitForTimeout(400);
    expect(await cropDrawBox(page, "fx_photo_crop")).toEqual(original);
    await redo(page);
    await page.waitForTimeout(400);
    expect(await cropDrawBox(page, "fx_photo_crop")).toEqual(committed);
  });

  test("crop zoom undo and redo restore the exact zoom", async ({ page }) => {
    const surface = await enterCrop(page, "fx_photo_crop");
    const original = await cropDrawBox(page, "fx_photo_crop");
    await wheelBurst(page, surface, 6);
    await page.waitForTimeout(SETTLE_WAIT);
    const zoomed = await cropDrawBox(page, "fx_photo_crop");
    expect(zoomed.width).toBeGreaterThan(original.width);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.waitForTimeout(400);

    await undo(page);
    await page.waitForTimeout(400);
    expect(await cropDrawBox(page, "fx_photo_crop")).toEqual(original);
    await redo(page);
    await page.waitForTimeout(400);
    expect(await cropDrawBox(page, "fx_photo_crop")).toEqual(zoomed);
  });

  test("Cancel after several committed crop gestures rolls back document AND history", async ({ page }) => {
    // One real edit BEFORE crop, so there is pre-session history to protect.
    await selectLayer(page, "fx_shape");
    const shapeOriginal = await rectAttrs(page, "fx_shape");
    const from = await bodyPoint(page, "fx_shape");
    await pressAndMove(page, from, (step) => ({ x: from.x + step * 3, y: from.y }), 15);
    await page.mouse.up();
    await page.waitForTimeout(450);
    const shapeMoved = await rectAttrs(page, "fx_shape");

    const surface = await enterCrop(page, "fx_photo_crop");
    const cropOriginal = await cropDrawBox(page, "fx_photo_crop");
    await resetMetrics(page);

    await panCrop(page, surface, 60, 30);
    await panCrop(page, surface, -30, 50);
    await wheelBurst(page, surface, 6);
    await page.waitForTimeout(SETTLE_WAIT);
    expect(count((await readMetrics(page)).byKind, "crop"), "three gestures should be three commits").toBe(3);

    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.waitForTimeout(500);
    expect(await cropDrawBox(page, "fx_photo_crop"), "Cancel did not restore the session's starting crop").toEqual(cropOriginal);
    expect(count((await readMetrics(page)).events, "cropRollback")).toBe(1);

    // Undo must skip every canceled crop state and undo the pre-crop drag.
    await undo(page);
    await page.waitForTimeout(450);
    expect(await cropDrawBox(page, "fx_photo_crop"), "Undo revealed a canceled crop state").toEqual(cropOriginal);
    expect((await rectAttrs(page, "fx_shape")).x, "Undo did not reach the pre-crop edit").toBe(shapeOriginal.x);

    // Redo re-applies that edit, and still no canceled crop state appears.
    await redo(page);
    await page.waitForTimeout(450);
    expect((await rectAttrs(page, "fx_shape")).x).toBe(shapeMoved.x);
    expect(await cropDrawBox(page, "fx_photo_crop")).toEqual(cropOriginal);
  });

  test("Cancel during the wheel settle delay never commits afterwards", async ({ page }) => {
    const surface = await enterCrop(page, "fx_photo_crop");
    const original = await cropDrawBox(page, "fx_photo_crop");
    await resetMetrics(page);

    await wheelBurst(page, surface, 5, -60);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.waitForTimeout(SETTLE_WAIT + 600);

    const after = await readMetrics(page);
    expect(count(after.byKind, "crop"), "a delayed wheel timer committed after Cancel").toBe(0);
    expect(count(after.events, "historyTransaction")).toBe(0);
    expect(await cropDrawBox(page, "fx_photo_crop")).toEqual(original);
  });

  test("pinch crop stays transient, commits once on lift, and Cancel rolls it back", async ({ page, context }) => {
    const surface = await enterCrop(page, "fx_photo_crop");
    const original = await cropDrawBox(page, "fx_photo_crop");
    const centre = await centreOf(surface);
    const cdp = await context.newCDPSession(page);
    await resetMetrics(page);

    const touch = (type: "touchStart" | "touchMove" | "touchEnd", spread: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints:
          type === "touchEnd"
            ? []
            : [
                { x: centre.x - spread, y: centre.y, id: 1 },
                { x: centre.x + spread, y: centre.y, id: 2 },
              ],
      });
    await touch("touchStart", 20);
    for (let step = 1; step <= 15; step += 1) await touch("touchMove", 20 + step * 4);
    await page.waitForTimeout(200);
    const during = await readMetrics(page);
    expect(count(during.byKind, "crop"), "pinch wrote the document while fingers were down").toBe(0);
    expect(count(during.events, "cropSessionStarted"), "the pinch did not reach the crop engine").toBe(1);

    await touch("touchEnd", 0);
    await page.waitForTimeout(SETTLE_WAIT);
    const lifted = await readMetrics(page);
    expect(count(lifted.byKind, "crop"), "pinch did not commit exactly once on lift").toBe(1);
    expect((await cropDrawBox(page, "fx_photo_crop")).width).toBeGreaterThan(original.width);

    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.waitForTimeout(SETTLE_WAIT);
    expect(await cropDrawBox(page, "fx_photo_crop")).toEqual(original);
  });

  test("changing page during crop finalizes it once and no old-page timer fires", async ({ page }) => {
    const surface = await enterCrop(page, "fx_photo_crop");
    await resetMetrics(page);
    await wheelBurst(page, surface, 5);

    // Page change is DONE: the pending burst commits now, exactly once.
    await page.getByRole("button", { name: /next: design back/i }).click();
    await expect(canvasLayer(page, "fx_qr")).toBeVisible({ timeout: 15_000 });
    const atSwitch = count((await readMetrics(page)).byKind, "crop");

    await page.waitForTimeout(SETTLE_WAIT + 400);
    const later = await readMetrics(page);
    expect(atSwitch, "the pending crop was not finalized by the page change").toBe(1);
    expect(count(later.byKind, "crop"), "a front-page crop timer fired on the back page").toBe(1);
    await expect(page.getByRole("application", { name: /crop photo/i })).toHaveCount(0);
  });

  test("selecting another object during crop is Done for the crop", async ({ page }) => {
    const surface = await enterCrop(page, "fx_photo_crop");
    await panCrop(page, surface, 60, 30);
    const committed = await cropDrawBox(page, "fx_photo_crop");
    await resetMetrics(page);

    // The canvas is locked in crop mode; Select All is a real selection change.
    await page.keyboard.press("Control+a");
    await page.waitForTimeout(600);

    await expect(page.getByRole("application", { name: /crop photo/i })).toHaveCount(0);
    const after = await readMetrics(page);
    expect(count(after.events, "cropRollback"), "a selection change rolled the crop back").toBe(0);
    expect(await cropDrawBox(page, "fx_photo_crop"), "the committed crop did not stand").toEqual(committed);
  });

  /* ---------------------------- grid crop -------------------------------- */

  test("grid crop pan is transient until release, then commits once", async ({ page }) => {
    const surface = await enterGridCrop(page);
    const original = await gridImageBoxes(page);
    await resetMetrics(page);

    const from = await centreOf(surface);
    await pressAndMove(page, from, (step) => ({ x: from.x + step * 3, y: from.y + step * 2 }), 20);
    await page.waitForTimeout(250);
    expect(count((await readMetrics(page)).byKind, "grid-crop"), "grid crop wrote during the pan").toBe(0);

    await page.mouse.up();
    await page.waitForTimeout(450);
    expect(count((await readMetrics(page)).byKind, "grid-crop")).toBe(1);
    expect(await gridImageBoxes(page), "the grid pan did not move a slot photo").not.toEqual(original);

    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.waitForTimeout(400);
    await expect(page.getByRole("application", { name: /crop grid photo/i })).toHaveCount(0);
  });

  test("grid crop Cancel after a commit restores the slot and its history", async ({ page }) => {
    const surface = await enterGridCrop(page);
    const original = await gridImageBoxes(page);
    await resetMetrics(page);

    const from = await centreOf(surface);
    await pressAndMove(page, from, (step) => ({ x: from.x + step * 3, y: from.y + step * 2 }), 20);
    await page.mouse.up();
    await page.waitForTimeout(450);
    expect(await gridImageBoxes(page)).not.toEqual(original);

    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.waitForTimeout(500);
    expect(await gridImageBoxes(page)).toEqual(original);

    await undo(page);
    await page.waitForTimeout(400);
    expect(await gridImageBoxes(page), "Undo revealed a canceled grid crop").toEqual(original);
  });

  test("grid crop Cancel during the wheel settle delay never commits afterwards", async ({ page }) => {
    const surface = await enterGridCrop(page);
    const original = await gridImageBoxes(page);
    await resetMetrics(page);

    await wheelBurst(page, surface, 5, -60);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.waitForTimeout(SETTLE_WAIT + 600);
    expect(count((await readMetrics(page)).byKind, "grid-crop")).toBe(0);
    expect(await gridImageBoxes(page)).toEqual(original);
  });

  test("grid crop undo and redo", async ({ page }) => {
    const surface = await enterGridCrop(page);
    const original = await gridImageBoxes(page);
    const from = await centreOf(surface);
    await pressAndMove(page, from, (step) => ({ x: from.x + step * 3, y: from.y + step * 2 }), 20);
    await page.mouse.up();
    await page.waitForTimeout(450);
    const committed = await gridImageBoxes(page);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.waitForTimeout(400);

    await undo(page);
    await page.waitForTimeout(400);
    expect(await gridImageBoxes(page)).toEqual(original);
    await redo(page);
    await page.waitForTimeout(400);
    expect(await gridImageBoxes(page)).toEqual(committed);
  });

  /* --------------------------- text editing ------------------------------ */

  test("editing text commits the new value without creating a second layer", async ({ page }) => {
    const layerCount = () => page.locator('[data-customizer-canvas="main"] [data-layer-id^="fx_"]').count();
    const before = await layerCount();

    await selectLayer(page, "fx_free_text");
    const point = await bodyPoint(page, "fx_free_text");
    await page.mouse.dblclick(point.x, point.y);
    const editor = page.locator("#customizer-inline-text-editor");
    await expect(editor, "double click did not open the on-canvas text editor").toBeVisible({ timeout: 10_000 });

    await editor.fill("Robin & Sam");
    // Ctrl+Enter commits; Escape deliberately discards the draft.
    await page.keyboard.press("Control+Enter");
    await expect(canvasLayer(page, "fx_free_text")).toContainText("Robin & Sam", { timeout: 10_000 });
    expect(await layerCount(), "text editing created an extra layer").toBe(before);
  });

  test("selecting existing text layers never creates a new one", async ({ page }) => {
    const layerCount = () => page.locator('[data-customizer-canvas="main"] [data-layer-id^="fx_"]').count();
    const before = await layerCount();
    for (const id of ["fx_free_text", "fx_title"]) await selectLayer(page, id);
    expect(await layerCount()).toBe(before);
  });
});

/* -------------------------------------------------------------------------- */
/* Persistence: Cancel must win on the server, not just on screen             */
/* -------------------------------------------------------------------------- */

test.describe("crop Cancel and autosave", () => {
  test.beforeEach(async ({ page }) => {
    await openFixture(page, "?autosave=1");
  });

  test("holding a gesture past the autosave debounce never saves transient geometry", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    const from = await bodyPoint(page, "fx_shape");
    await resetMetrics(page);

    await pressAndMove(page, from, (step) => ({ x: from.x + step * 4, y: from.y + step * 2 }), 20);
    // Stay pressed well beyond the queue's debounce: nothing may be saved.
    await page.waitForTimeout(AUTOSAVE_WAIT);
    expect(count((await readMetrics(page)).events, "saveStarted"), "temporary geometry triggered autosave").toBe(0);

    await page.mouse.up();
    await expect.poll(async () => count((await readMetrics(page)).events, "saveStarted"), { timeout: 10_000 }).toBe(1);
    await page.waitForTimeout(AUTOSAVE_WAIT);
    expect(count((await readMetrics(page)).events, "saveStarted"), "one gesture produced more than one save").toBe(1);
  });

  test("Cancel after the modified crop already autosaved leaves the ORIGINAL crop saved", async ({ page }) => {
    const surface = await enterCrop(page, "fx_photo_crop");
    await panCrop(page, surface, 80, 40);

    // The canceled crop genuinely reaches persistence first.
    await expect.poll(async () => draftCropOffsets(await readDraft(page)).offsetX, { timeout: 10_000 }).not.toBe(0);

    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.waitForTimeout(AUTOSAVE_WAIT);

    expect(draftCropOffsets(await readDraft(page)), "the canceled crop is still the saved draft").toEqual({
      offsetX: 0,
      offsetY: 0,
    });
  });

  test("an in-flight save cannot mark the restored document saved after Cancel", async ({ page }) => {
    // Hold every save open between "payload built" and "write" — a request in flight.
    await page.evaluate(() => {
      const w = window as any;
      w.__heldSaves = [];
      w.__husnalogyCustomizerSaveGate = () => new Promise<void>((release) => w.__heldSaves.push(release));
    });

    const surface = await enterCrop(page, "fx_photo_crop");
    await resetMetrics(page);
    await panCrop(page, surface, 80, 40);

    // Wait until the autosave carrying the MODIFIED crop is in flight.
    await expect.poll(async () => count((await readMetrics(page)).events, "saveStarted"), { timeout: 10_000 }).toBe(1);

    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.waitForTimeout(300);

    // Let later saves through, then release the stale one.
    await page.evaluate(() => {
      const w = window as any;
      w.__husnalogyCustomizerSaveGate = undefined;
      w.__heldSaves.splice(0).forEach((release: () => void) => release());
    });

    await expect
      .poll(async () => count((await readMetrics(page)).events, "saveKeptDirty"), { timeout: 10_000 })
      .toBe(1);
    // `saveKeptDirty` is recorded by the stale save itself: it wrote a payload
    // built BEFORE Cancel, found the document version had moved, and refused to
    // clear dirty. That is the race, observed rather than assumed.
    // The stale response did not clear dirty; the queue then saved the restoration.
    await expect
      .poll(async () => draftCropOffsets(await readDraft(page)), { timeout: 10_000 })
      .toEqual({ offsetX: 0, offsetY: 0 });
    const events = (await readMetrics(page)).events;
    expect(count(events, "saveClearedDirty"), "the restored document was never confirmed saved").toBeGreaterThanOrEqual(1);
  });
});
