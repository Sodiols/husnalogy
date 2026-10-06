/**
 * Design Studio: smooth multi-selection drag (Admin Problem 3).
 *
 * A real pointer drag, sampled every animation frame. During the drag every
 * selected object's artwork, hit proxy and selection outline — and the
 * Transformer box — move by ONE delta in the same frame; the document is not
 * written until release, and then exactly once; the release never shows a
 * frame of the old positions; the drop lands under the pointer; and one Undo
 * and one Redo move the whole set.
 *
 * Root causes this guards (see CustomizerInteractionStage):
 *  - Konva's Transformer drags every attached node natively, so followers
 *    fired their own drag events and the selection jumped between positions
 *    computed from different objects (and could drop far from the pointer);
 *  - member outlines never moved during the drag;
 *  - the preview was cleared before the committed geometry had rendered.
 */
import { expect, test, type Page } from "@playwright/test";
import { bodyPoint, selectedIds } from "./customizer-fixture";

const PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#ff0000"/></svg>')}`;
const TITLE = "Minimal Thank You Card";
const text = (id: string, label: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
  id, page: "front", type: "text", text: label, x, y, width: 360, height: 90, rotation: 0, textStyle: { fontFamily: "Inter", fontSize: 54, autoSizeMode: "fixed" }, ...extra,
});
const TEMPLATE = {
  enabled: true, cardWidthIn: 5, cardHeightIn: 7, dpi: 300, canvasWidthPx: 1500, canvasHeightPx: 2100,
  pages: [{ id: "front", label: "Front", enabled: true }], defaultPage: "front", fields: [], guides: [],
  layers: [
    text("t_a", "Alpha", 350, 300, { zIndex: 1 }),
    text("t_b", "Beta", 950, 300, { zIndex: 2 }),
    text("t_c", "Gamma", 650, 520, { zIndex: 3, rotation: -12 }),
    { id: "i_a", page: "front", type: "image", src: PHOTO, x: 350, y: 850, width: 300, height: 300, zIndex: 4 },
    { id: "i_b", page: "front", type: "image", src: PHOTO, x: 950, y: 850, width: 320, height: 240, zIndex: 5, rotation: 20, imageTransform: { zoom: 1.3, offsetX: 20 } },
    { id: "s_a", page: "front", type: "shape", shape: "rectangle", x: 350, y: 1350, width: 260, height: 160, zIndex: 6, fill: "#d4af37" },
    { id: "g_grp", page: "front", type: "group", x: 950, y: 1350, width: 400, height: 160, zIndex: 7, childIds: ["t_g", "s_g"] },
    text("t_g", "Group", 880, 1350, { groupId: "g_grp", zIndex: 8, width: 240 }),
    { id: "s_g", page: "front", type: "shape", shape: "oval", groupId: "g_grp", x: 1110, y: 1350, width: 80, height: 80, zIndex: 9, fill: "#303839" },
    // Not selected: something to snap to.
    { id: "s_anchor", page: "front", type: "shape", shape: "rectangle", x: 750, y: 1800, width: 200, height: 120, zIndex: 10, fill: "#cccccc" },
  ],
};

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
  await page.getByRole("button", { name: "Open Design Studio" }).click();
  await expect(page.locator('[data-admin-customizer] [data-canvas-surface] [data-layer-id="i_a"] image').first()).toBeAttached();
}

async function selectAll(page: Page, ids: string[]) {
  const first = await bodyPoint(page, ids[0]);
  await page.mouse.click(first.x, first.y);
  await page.waitForTimeout(450);
  await page.keyboard.down("Shift");
  for (const id of ids.slice(1)) {
    const point = await bodyPoint(page, id);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(450);
  }
  await page.keyboard.up("Shift");
  await expect.poll(async () => (await selectedIds(page)).sort()).toEqual(ids.slice().sort());
}

type Frame = {
  art: Record<string, [number, number]>;
  proxy: Record<string, [number, number] | null>;
  outline: Record<string, [number, number] | null>;
  committed: Record<string, string>;
  transformer: [number, number];
};

/** Sample every animation frame: what is drawn, where the hit proxies and outlines are, and the committed geometry. */
async function startRecording(page: Page, ids: string[]) {
  await page.evaluate((layerIds) => {
    const w = window as any;
    w.__frames = [];
    const stage = w.Konva.stages.find((candidate: any) => candidate.findOne("Transformer"));
    const centre = (rect: { x: number; y: number; width: number; height: number }) => [rect.x + rect.width / 2, rect.y + rect.height / 2];
    const tick = () => {
      const frame: any = { art: {}, proxy: {}, outline: {}, committed: {} };
      for (const id of layerIds) {
        const group = document.querySelector(`[data-admin-customizer] [data-canvas-surface] [data-layer-id="${id}"]`)!;
        const box = group.getBoundingClientRect();
        frame.art[id] = centre({ x: box.left, y: box.top, width: box.width, height: box.height });
        // Geometry as the DOCUMENT has it: the drawn element's own attributes,
        // which a transient transform (set on the group) never changes.
        const element = group.querySelector("image, rect, ellipse, tspan, text");
        frame.committed[id] = element ? `${element.getAttribute("x") ?? element.getAttribute("cx")},${element.getAttribute("y") ?? element.getAttribute("cy")}` : "";
        const proxy = stage.findOne((node: any) => node.name?.() === id);
        frame.proxy[id] = proxy ? centre(proxy.getClientRect()) : null;
        const outline = stage.findOne((node: any) => node.name?.() === `member-outline:${id}`);
        frame.outline[id] = outline?.isVisible() ? centre(outline.getClientRect()) : null;
      }
      frame.transformer = centre(stage.findOne("Transformer").getClientRect());
      w.__frames.push(frame);
      if (w.__recording) requestAnimationFrame(tick);
    };
    w.__recording = true;
    requestAnimationFrame(tick);
  }, ids);
}

const stopRecording = (page: Page): Promise<Frame[]> =>
  page.evaluate(() => {
    (window as any).__recording = false;
    return (window as any).__frames;
  });

async function dragSelection(page: Page, fromId: string, dx: number, dy: number, steps = 24) {
  const start = await bodyPoint(page, fromId);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(start.x + (dx * step) / steps, start.y + (dy * step) / steps);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  // Let a few frames render after the release.
  await page.waitForTimeout(300);
}

const sub = (a: [number, number], b: [number, number]) => [a[0] - b[0], a[1] - b[1]] as [number, number];
const apart = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * `ids` are the objects whose ARTWORK is checked (a group's artwork is its
 * children); `selected` are the selection members, whose hit proxies and
 * outlines are checked too.
 */
function expectSmoothDrag(frames: Frame[], ids: string[], pointer: [number, number], selected: string[] = ids) {
  expect(frames.length).toBeGreaterThan(20);
  const base = frames[0];
  const lead = ids[0];
  let seenMove = false;
  for (const [index, frame] of frames.entries()) {
    const delta = sub(frame.art[lead], base.art[lead]);
    for (const id of ids) {
      const art = sub(frame.art[id], base.art[id]);
      // ONE delta for every member, every frame.
      expect(apart(art, delta), `frame ${index}: ${id} artwork vs ${lead}`).toBeLessThanOrEqual(1);
      if (selected.includes(id) && frame.proxy[id] && base.proxy[id]) {
        expect(apart(sub(frame.proxy[id]!, base.proxy[id]!), art), `frame ${index}: ${id} proxy`).toBeLessThanOrEqual(1);
      }
      if (selected.includes(id) && frame.outline[id] && base.outline[id]) {
        expect(apart(sub(frame.outline[id]!, base.outline[id]!), art), `frame ${index}: ${id} outline`).toBeLessThanOrEqual(1);
      }
    }
    expect(apart(sub(frame.transformer, base.transformer), delta), `frame ${index}: transformer`).toBeLessThanOrEqual(1.5);
    // Once the selection has visibly moved, no frame may show it back home.
    if (Math.hypot(...delta) > 20) seenMove = true;
    if (seenMove) expect(Math.hypot(...delta), `frame ${index}: snapped back`).toBeGreaterThan(10);
  }
  // The drop is under the pointer (within snapping tolerance) and every member moved alike.
  const final = sub(frames[frames.length - 1].art[lead], base.art[lead]);
  expect(Math.abs(final[0] - pointer[0])).toBeLessThanOrEqual(8);
  expect(Math.abs(final[1] - pointer[1])).toBeLessThanOrEqual(8);
  // The document was written exactly once: each member's committed geometry
  // took exactly two values over the whole recording — before and after.
  for (const id of ids) {
    const values = [...new Set(frames.map((frame) => frame.committed[id]))];
    expect(values, `${id} committed geometry`).toHaveLength(2);
  }
}

const drawnCentres = (page: Page, ids: string[]) =>
  page.evaluate((layerIds) => layerIds.map((id) => {
    const box = document.querySelector(`[data-admin-customizer] [data-canvas-surface] [data-layer-id="${id}"]`)!.getBoundingClientRect();
    return [Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2)];
  }), ids);

test.describe("Design Studio multi-selection drag", () => {
  test.beforeEach(async ({ page }) => {
    await openStudio(page);
  });

  test("texts and images (one rotated) move as one, frame by frame, with one commit, Undo and Redo", async ({ page }) => {
    const ids = ["i_a", "t_a", "t_b", "t_c", "i_b"];
    await selectAll(page, ids);
    const before = await drawnCentres(page, ids);
    await startRecording(page, ids);
    await dragSelection(page, "i_a", 170, 90);
    expectSmoothDrag(await stopRecording(page), ids, [170, 90]);

    // Still the same selection, no extra click needed.
    expect((await selectedIds(page)).sort()).toEqual(ids.slice().sort());
    const after = await drawnCentres(page, ids);

    await page.keyboard.press("Control+z");
    await expect.poll(() => drawnCentres(page, ids)).toEqual(before);
    await page.keyboard.press("Control+y");
    await expect.poll(() => drawnCentres(page, ids)).toEqual(after);
  });

  test("a group with a shape, dragged diagonally upward and back", async ({ page }) => {
    const selected = ["s_a", "g_grp"];
    // The group draws nothing itself: what moves on screen is its contents.
    const artwork = ["s_a", "t_g", "s_g"];
    await selectAll(page, selected);
    await startRecording(page, artwork);
    await dragSelection(page, "s_a", 120, -140);
    expectSmoothDrag(await stopRecording(page), artwork, [120, -140], selected);
    await startRecording(page, artwork);
    await dragSelection(page, "s_a", -60, 50, 12);
    expectSmoothDrag(await stopRecording(page), artwork, [-60, 50], selected);
    // A group dragged on its own carries its contents too.
    await selectAll(page, ["g_grp"]);
    await startRecording(page, ["t_g", "s_g"]);
    await dragSelection(page, "g_grp", 80, 70, 10);
    expectSmoothDrag(await stopRecording(page), ["t_g", "s_g"], [80, 70], []);
  });

  for (const zoom of [150, 50]) {
    test(`at ${zoom}% zoom, a quick drag stays rigid and lands under the pointer`, async ({ page }) => {
      const field = page.locator("[data-admin-customizer]").getByRole("group", { name: "Canvas zoom" }).getByRole("textbox").or(page.locator("[data-admin-customizer]").getByRole("group", { name: "Canvas zoom" }).getByRole("spinbutton")).first();
      await field.fill(String(zoom));
      await field.press("Enter");
      await page.waitForTimeout(500);
      const ids = ["t_a", "i_a"];
      await selectAll(page, ids);
      await startRecording(page, ids);
      await dragSelection(page, "t_a", 90, 40, 8);
      expectSmoothDrag(await stopRecording(page), ids, [90, 40]);
    });
  }
});
