/**
 * Selection engine test matrix (Customizer Point 2).
 *
 * The selection is read from where the customer sees it — the Konva
 * Transformer's attached proxies — so every assertion is about real behaviour
 * on the real editor, not about internal state.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  bodyPoint,
  canvasLayer,
  clickDoc,
  docToScreen,
  drag,
  editorTextarea,
  hitAt,
  openFixture,
  rectAttrs,
  selectLayer,
  selectedIds,
  switchToAdvancedCustomize,
} from "./customizer-fixture";

/**
 * A document point known to be empty canvas — asserted where it matters, and
 * clear of the floating zoom control that covers the page's bottom corner.
 */
const EMPTY_TOP_LEFT = { x: 90, y: 90 };

async function expectEmpty(page: Page, point: { x: number; y: number }) {
  expect(await hitAt(page, point.x, point.y), `(${point.x},${point.y}) should be empty canvas`).toBeNull();
}

async function expectSelection(page: Page, ids: string[]) {
  await expect.poll(async () => (await selectedIds(page)).slice().sort(), { timeout: 5000 }).toEqual(ids.slice().sort());
}

async function marquee(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await drag(page, await docToScreen(page, from.x, from.y), await docToScreen(page, to.x, to.y), 12);
  await page.waitForTimeout(250);
}

test.describe("selection matrix", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFixture(page, "?snap=0");
  });

  test("single click selects exactly one object; clicking it again keeps it", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    await expectSelection(page, ["fx_shape"]);
    await selectLayer(page, "fx_shape");
    await expectSelection(page, ["fx_shape"]);
  });

  test("clicking empty canvas clears the selection", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    await expectEmpty(page, EMPTY_TOP_LEFT);
    await clickDoc(page, EMPTY_TOP_LEFT.x, EMPTY_TOP_LEFT.y);
    await expectSelection(page, []);
  });

  test("overlapping objects: the one drawn on top is selected", async ({ page }) => {
    // fx_free_text (z 20) is drawn over fx_title (z 10) where they overlap.
    expect(await hitAt(page, 750, 300)).toBe("fx_free_text");
    await clickDoc(page, 750, 300);
    await expectSelection(page, ["fx_free_text"]);
  });

  test("Shift click adds, Shift click again removes", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    await selectLayer(page, "fx_frame", ["Shift"]);
    await expectSelection(page, ["fx_shape", "fx_frame"]);
    await selectLayer(page, "fx_shape", ["Shift"]);
    await expectSelection(page, ["fx_frame"]);
  });

  test("a plain click inside a multi-selection collapses it to that object", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    await selectLayer(page, "fx_frame", ["Shift"]);
    await selectLayer(page, "fx_frame");
    await expectSelection(page, ["fx_frame"]);
  });

  for (const [name, from, to] of [
    ["top-left to bottom-right", { x: 200, y: 1080 }, { x: 600, y: 1240 }],
    ["bottom-right to top-left", { x: 600, y: 1240 }, { x: 200, y: 1080 }],
    ["top-right to bottom-left", { x: 600, y: 1080 }, { x: 200, y: 1240 }],
    ["bottom-left to top-right", { x: 200, y: 1240 }, { x: 600, y: 1080 }],
  ] as const) {
    test(`marquee ${name} selects what it touches`, async ({ page }) => {
      await expectEmpty(page, from);
      await marquee(page, from, to);
      await expectSelection(page, ["fx_shape"]);
    });
  }

  test("a marquee released OUTSIDE the canvas still completes, and does not keep following the mouse", async ({ page }) => {
    const start = { x: 120, y: 1080 };
    await expectEmpty(page, start);
    const from = await docToScreen(page, start.x, start.y);
    // Released well past the page's right edge, beyond the stage entirely.
    const outside = await docToScreen(page, 1500 + 700, 1240);
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, outside)).not.toBe("CANVAS");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(outside.x, outside.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const afterRelease = await selectedIds(page);
    expect(afterRelease).toEqual(expect.arrayContaining(["fx_shape", "fx_frame"]));
    // Moving back over the canvas with no button held must not change anything.
    const far = await docToScreen(page, 700, 300);
    await page.mouse.move(far.x, far.y, { steps: 6 });
    await page.waitForTimeout(300);
    expect(await selectedIds(page)).toEqual(afterRelease);
  });

  test("a marquee never sweeps up hidden objects", async ({ page }) => {
    // fx_hidden sits under fx_qr / fx_line around (750, 1300).
    await marquee(page, { x: 400, y: 1120 }, { x: 1100, y: 1480 });
    expect(await selectedIds(page)).not.toContain("fx_hidden");
  });

  test("press-and-drag an UNSELECTED object moves it in one motion", async ({ page }) => {
    const before = await rectAttrs(page, "fx_shape");
    const from = await bodyPoint(page, "fx_shape");
    await drag(page, from, { x: from.x + 60, y: from.y + 20 });
    await expectSelection(page, ["fx_shape"]);
    expect((await rectAttrs(page, "fx_shape")).x).not.toBe(before.x);
  });

  test("clicking a group member selects the group; double click enters it and selects the member", async ({ page }) => {
    await selectLayer(page, "fx_group");
    await expectSelection(page, ["fx_group"]);
    const point = await bodyPoint(page, "fx_group");
    await page.mouse.dblclick(point.x, point.y);
    await page.waitForTimeout(400);
    const inside = await selectedIds(page);
    expect(inside.length).toBe(1);
    expect(["fx_group_text", "fx_group_shape"]).toContain(inside[0]);
    // Selecting the other member stays inside the group.
    const other = inside[0] === "fx_group_text" ? "fx_group_shape" : "fx_group_text";
    await selectLayer(page, other);
    await expectSelection(page, [other]);
  });

  test("Escape inside a group exits it and selects the group", async ({ page }) => {
    const point = await bodyPoint(page, "fx_group");
    await page.mouse.dblclick(point.x, point.y);
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");
    await expectSelection(page, ["fx_group"]);
  });

  test("clicking OUTSIDE an entered group exits it: its members are no longer separately clickable", async ({ page }) => {
    const point = await bodyPoint(page, "fx_group");
    await page.mouse.dblclick(point.x, point.y);
    await page.waitForTimeout(400);
    await selectLayer(page, "fx_shape");
    await expectSelection(page, ["fx_shape"]);
    // A member clicked now must resolve to the GROUP again.
    await clickDoc(page, 900, 2000);
    await expectSelection(page, ["fx_group"]);
  });

  test("clicking empty canvas inside an entered group exits it", async ({ page }) => {
    const point = await bodyPoint(page, "fx_group");
    await page.mouse.dblclick(point.x, point.y);
    await page.waitForTimeout(400);
    await expectEmpty(page, EMPTY_TOP_LEFT);
    await clickDoc(page, EMPTY_TOP_LEFT.x, EMPTY_TOP_LEFT.y);
    await expectSelection(page, []);
    await clickDoc(page, 900, 2000);
    await expectSelection(page, ["fx_group"]);
  });

  test("an object the customer LOCKED can still be selected, but not dragged", async ({ page }) => {
    await switchToAdvancedCustomize(page);
    const root = page.locator("[data-customizer-root]");
    await root.getByRole("button", { name: "Elements", exact: true }).click();
    await root.getByRole("button", { name: "Add Square", exact: true }).click();
    const [square] = await selectedIds(page);
    expect(square).toBeTruthy();
    const point = await bodyPoint(page, square);
    await page.mouse.click(point.x, point.y, { button: "right" });
    await page.getByRole("menuitem", { name: /^Lock/ }).click();
    await clickDoc(page, EMPTY_TOP_LEFT.x, EMPTY_TOP_LEFT.y);
    await expectSelection(page, []);
    await selectLayer(page, square);
    await expectSelection(page, [square]);
    const before = await page.locator(`[data-customizer-canvas="main"] [data-layer-id="${square}"]`).first().innerHTML();
    const from = await bodyPoint(page, square);
    await drag(page, from, { x: from.x + 80, y: from.y + 30 });
    expect(await page.locator(`[data-customizer-canvas="main"] [data-layer-id="${square}"]`).first().innerHTML()).toBe(before);
  });

  test("a template object the customer may not edit is not a target at all", async ({ page }) => {
    // fx_locked_caption peeks out below fx_free_text at y ~ 425.
    expect(await hitAt(page, 750, 425)).toBeNull();
  });

  test("hidden objects cannot be clicked", async ({ page }) => {
    expect(await hitAt(page, 750, 1300)).not.toBe("fx_hidden");
  });

  test("Delete acts on the selection; Ctrl+D selects the copy", async ({ page }) => {
    await switchToAdvancedCustomize(page);
    await selectLayer(page, "fx_shape");
    await page.keyboard.press("Control+d");
    await page.waitForTimeout(300);
    const copy = await selectedIds(page);
    expect(copy).toHaveLength(1);
    expect(copy[0]).not.toBe("fx_shape");
    await page.keyboard.press("Delete");
    await page.waitForTimeout(300);
    await expectSelection(page, []);
    await expect(canvasLayer(page, copy[0])).toHaveCount(0);
    await expect(canvasLayer(page, "fx_shape")).toHaveCount(1);
  });

  test("undo and redo restore the selection with the document", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    await page.keyboard.press("Delete");
    await expectSelection(page, []);
    await page.keyboard.press("Control+z");
    await expect(canvasLayer(page, "fx_shape")).toHaveCount(1);
    await expectSelection(page, ["fx_shape"]);
    // The restored selection is fully usable: Delete works on it again.
    await page.keyboard.press("Delete");
    await expect(canvasLayer(page, "fx_shape")).toHaveCount(0);
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+y");
    await expect(canvasLayer(page, "fx_shape")).toHaveCount(0);
    await expectSelection(page, []);
  });

  test("undo of a creation never leaves a selection pointing at nothing", async ({ page }) => {
    await switchToAdvancedCustomize(page);
    await selectLayer(page, "fx_shape");
    await page.keyboard.press("Control+d");
    await page.waitForTimeout(300);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(300);
    const after = await selectedIds(page);
    for (const id of after) await expect(canvasLayer(page, id)).toHaveCount(1);
    // Keyboard commands still work on whatever is selected.
    await selectLayer(page, "fx_shape");
    await page.keyboard.press("Delete");
    await expect(canvasLayer(page, "fx_shape")).toHaveCount(0);
  });

  for (const zoom of ["50%", "200%"]) {
    test(`clicks select the right object at ${zoom} zoom`, async ({ page }) => {
      const input = page.getByRole("textbox", { name: /zoom/i }).or(page.getByLabel(/zoom level/i)).first();
      if (await input.count()) {
        await input.fill(zoom.replace("%", ""));
        await input.press("Enter");
      } else {
        const button = page.getByRole("button", { name: zoom === "50%" ? /zoom out/i : /zoom in/i }).first();
        for (let index = 0; index < 4; index += 1) await button.click();
      }
      await page.waitForTimeout(500);
      await canvasLayer(page, "fx_frame").scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const point = await bodyPoint(page, "fx_frame");
      await page.mouse.click(point.x, point.y);
      await expectSelection(page, ["fx_frame"]);
      // ...and a drag at this zoom moves the object by the pointer delta in DOCUMENT units.
      const before = await rectAttrs(page, "fx_shape");
      await canvasLayer(page, "fx_shape").scrollIntoViewIfNeeded();
      const from = await bodyPoint(page, "fx_shape");
      const scale = await page.evaluate(() => (window as any).Konva.stages.find((stage: any) => stage.findOne("Transformer")).scaleX());
      await drag(page, from, { x: from.x + 40, y: from.y });
      await expect.poll(async () => Math.round((await rectAttrs(page, "fx_shape")).x - before.x)).toBe(Math.round(40 / scale));
    });
  }

  test("dragging right after selecting a DIFFERENT kind of object moves it exactly by the pointer delta (fit zoom)", async ({ page }) => {
    // Text selected first: its toolbar used to reserve layout the shape's did
    // not, so the press re-fitted the canvas under the pointer.
    await selectLayer(page, "fx_free_text");
    const before = await rectAttrs(page, "fx_shape");
    const stageTop = () => page.evaluate(() => (window as any).Konva.stages.find((stage: any) => stage.findOne("Transformer")).container().getBoundingClientRect().top);
    const topBefore = await stageTop();
    const from = await bodyPoint(page, "fx_shape");
    const scale = await page.evaluate(() => (window as any).Konva.stages.find((stage: any) => stage.findOne("Transformer")).scaleX());
    await drag(page, from, { x: from.x + 50, y: from.y + 20 });
    expect(await stageTop(), "the canvas moved during the press").toBe(topBefore);
    const after = await rectAttrs(page, "fx_shape");
    expect(Math.abs(after.x - before.x - 50 / scale)).toBeLessThanOrEqual(2);
    expect(Math.abs(after.y - before.y - 20 / scale)).toBeLessThanOrEqual(2);
  });

  test("rapid clicking settles on the last object clicked", async ({ page }) => {
    const shape = await bodyPoint(page, "fx_shape");
    const frame = await bodyPoint(page, "fx_frame");
    for (let index = 0; index < 4; index += 1) {
      await page.mouse.click(shape.x, shape.y);
      await page.mouse.click(frame.x, frame.y);
    }
    await expectSelection(page, ["fx_frame"]);
  });

  test("switching page clears the selection and objects on the new page select normally", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    await page.getByRole("button", { name: "Edit Back", exact: true }).first().click();
    await expect(canvasLayer(page, "fx_back_text")).toBeVisible();
    await expectSelection(page, []);
    await page.getByRole("button", { name: "Edit Front", exact: true }).first().click();
    await expect(canvasLayer(page, "fx_shape")).toBeVisible();
    await page.waitForTimeout(400);
    await selectLayer(page, "fx_frame");
    await expectSelection(page, ["fx_frame"]);
  });

  test("while editing text, clicking another object finishes the edit and selects that object", async ({ page }) => {
    await selectLayer(page, "fx_free_text");
    await page.getByRole("button", { name: "Edit Text", exact: true }).click();
    await expect(editorTextarea(page)).toBeVisible();
    const shape = await docToScreen(page, 380, 1160);
    await page.mouse.click(shape.x, shape.y);
    await expect(editorTextarea(page)).toHaveCount(0);
    await expectSelection(page, ["fx_shape"]);
  });

  test("right click on an unselected object selects it (and only it)", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    await selectLayer(page, "fx_frame", ["Shift"]);
    const qr = await bodyPoint(page, "fx_grid");
    await page.mouse.click(qr.x, qr.y, { button: "right" });
    await expectSelection(page, ["fx_grid"]);
  });

  test("Ungroup selects the former members, and each is then independently selectable", async ({ page }) => {
    await selectLayer(page, "fx_free_text");
    await selectLayer(page, "fx_shape", ["Shift"]);
    await page.keyboard.press("Control+g");
    await page.waitForTimeout(300);
    const [group] = await selectedIds(page);
    expect(group).toMatch(/group/);
    await page.keyboard.press("Control+Shift+g");
    await expectSelection(page, ["fx_free_text", "fx_shape"]);
    await selectLayer(page, "fx_shape");
    await expectSelection(page, ["fx_shape"]);
  });

  test("keyboard shortcuts work straight after a toolbar button, without clicking the canvas first", async ({ page }) => {
    await switchToAdvancedCustomize(page);
    const root = page.locator("[data-customizer-root]");
    await root.getByRole("button", { name: "Elements", exact: true }).click();
    await root.getByRole("button", { name: "Add Square", exact: true }).click();
    const [square] = await selectedIds(page);
    expect(square).toBeTruthy();
    // Focus is still on the "Add Square" button.
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BUTTON");
    await page.keyboard.press("Control+d");
    await expect.poll(async () => (await selectedIds(page))[0]).not.toBe(square);
    const [copy] = await selectedIds(page);
    await page.keyboard.press("Delete");
    await expect(canvasLayer(page, copy)).toHaveCount(0);
    await expect(canvasLayer(page, square)).toHaveCount(1);
  });

  test("Escape clears the selection", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    await page.keyboard.press("Escape");
    await expectSelection(page, []);
  });
});

test.describe("selection on touch", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test("a tap selects, a tap on empty canvas clears", async ({ page }) => {
    await openFixture(page, "?snap=0");
    const point = await bodyPoint(page, "fx_shape");
    await page.touchscreen.tap(point.x, point.y);
    await expectSelection(page, ["fx_shape"]);
    const empty = await docToScreen(page, EMPTY_TOP_LEFT.x, EMPTY_TOP_LEFT.y);
    await page.touchscreen.tap(empty.x, empty.y);
    await expectSelection(page, []);
  });
});
