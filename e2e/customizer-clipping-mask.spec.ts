/**
 * Shape + photo clipping mask (Customizer Point 10), in the real customer editor.
 *
 * The design is seeded through the local recovery draft (the same path a
 * refresh restores from) with one customer shape and one customer photo frame,
 * so every case starts from an identical document.
 */
import { expect, test, type Page } from "@playwright/test";
import { getMaskPath } from "../lib/customizer/v2/masks";
import {
  DRAFT_KEY,
  anchorPoint,
  bodyPoint,
  canvasLayer,
  drag,
  enterCrop,
  openFixture,
  panCrop,
  readDraft,
  selectLayer,
  selectedIds,
  switchToAdvancedCustomize,
  waitForEditor,
} from "./customizer-fixture";

/** Left half red, right half blue: which half shows tells where the photo sits. */
const PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100" height="200" fill="#ff0000"/><rect x="100" width="100" height="200" fill="#0000ff"/></svg>',
)}`;

// Customer objects always stack above the template, so these seats need not be
// empty artboard; they sit in the fixture's least crowded band.
const SHAPE_BOX = { x: 420, y: 1200, width: 320, height: 220 };
const PHOTO_BOX = { x: 1100, y: 1200, width: 300, height: 300 };

function seedLayers(shape: Record<string, unknown>) {
  return [
    { id: "u_shape", type: "shape", page: "front", name: "Customer shape", ...SHAPE_BOX, rotation: 0, zIndex: 1001, opacity: 1, fill: "#F8F6F1", stroke: "#303839", strokeWidth: 2, borderRadius: 0, points: [], ...shape },
    { id: "u_photo", type: "frame", page: "front", name: "Customer photo frame", ...PHOTO_BOX, rotation: 0, zIndex: 1002, opacity: 1, src: PHOTO, maskShape: "rectangle", fitMode: "cover", borderWidth: 0, backgroundColor: "#F8F6F1" },
  ];
}

/** Open the fixture with exactly these customer layers restored from the local draft. */
async function openWith(page: Page, shape: Record<string, unknown> = {}) {
  await openFixture(page, "?snap=0");
  await switchToAdvancedCustomize(page);
  const root = page.locator("[data-customizer-root]");
  await root.getByRole("button", { name: "Elements", exact: true }).click();
  await root.getByRole("button", { name: "Add Square", exact: true }).click();
  await expect.poll(() => readDraft(page).then((draft) => draft?.renderData?.editorState?.userLayers?.length || 0)).toBeGreaterThan(0);
  // Leaving the page saves the live design over the draft (crash-safe autosave),
  // so the seeded draft is written by an init script on the NEXT document —
  // after that save — and only once, so a later refresh restores real edits.
  const draft = await readDraft(page);
  draft.renderData.editorState.userLayers = seedLayers(shape);
  draft.clientRevision = Number(draft.clientRevision || 0) + 10;
  await page.addInitScript(({ key, value }) => {
    if (window.sessionStorage.getItem("clip-seeded")) return;
    window.sessionStorage.setItem("clip-seeded", "1");
    window.localStorage.setItem(key, value);
  }, { key: DRAFT_KEY, value: JSON.stringify(draft) });
  await page.reload();
  await waitForEditor(page);
  await expect(canvasLayer(page, "u_shape")).toHaveCount(1);
  await expect(canvasLayer(page, "u_photo")).toHaveCount(1);
}

const menu = (page: Page) => page.getByRole("menu", { name: "Object actions" });

async function clip(page: Page) {
  await selectLayer(page, "u_shape");
  await selectLayer(page, "u_photo", ["Shift"]);
  const point = await bodyPoint(page, "u_photo");
  await page.mouse.click(point.x, point.y, { button: "right" });
  await menu(page).getByRole("menuitem", { name: "Clipping mask", exact: true }).click();
  await expect(menu(page)).toHaveCount(0);
}

/** The clip path the canvas draws for a layer, and the transform of its group. */
const clipOf = (page: Page, id: string) =>
  page.evaluate((layerId) => {
    const group = document.querySelector(`[data-customizer-canvas="main"] [data-layer-id="${layerId}"]`);
    return {
      d: group?.querySelector("clipPath path")?.getAttribute("d") || "",
      rotate: group?.querySelector(":scope > g")?.getAttribute("transform") || "",
      image: group?.querySelector("image")?.getAttribute("href")?.slice(0, 30) || "",
    };
  }, id);

/** The stored customer layer, as autosave/recovery holds it. */
const stored = async (page: Page, id: string) =>
  (await readDraft(page))?.renderData?.editorState?.userLayers?.find((layer: any) => layer.id === id);

const maskD = (kind: any, box: { x: number; y: number; width: number; height: number }) =>
  getMaskPath(kind, { x: box.x - box.width / 2, y: box.y - box.height / 2, width: box.width, height: box.height }).d;

test.use({ viewport: { width: 1440, height: 900 } });

test.describe("clipping mask", () => {
  const shapes: Array<[string, Record<string, unknown>, unknown]> = [
    ["rectangle", { shape: "rectangle" }, { kind: "rectangle" }],
    ["ellipse", { shape: "ellipse" }, { kind: "oval" }],
    ["rounded rectangle", { shape: "rounded-rectangle", borderRadius: 36 }, { kind: "rounded", radius: 36 }],
    ["rotated circle", { shape: "circle", rotation: 25 }, { kind: "oval" }],
    ["scaled triangle", { shape: "triangle", width: 480, height: 160 }, { kind: "polygon", points: [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }],
  ];

  for (const [name, shape, mask] of shapes) {
    test(`${name}: the photo shows inside the shape, in one step that Undo and Redo replay exactly`, async ({ page }) => {
      await openWith(page, shape);
      await clip(page);
      const box = { ...SHAPE_BOX, ...(shape as any) };

      // The shape is gone, the photo took its place, geometry and outline.
      await expect(canvasLayer(page, "u_shape")).toHaveCount(0);
      expect(await selectedIds(page)).toEqual(["u_photo"]);
      const drawn = await clipOf(page, "u_photo");
      expect(drawn.d).toBe(maskD(mask, box));
      expect(drawn.image).toBe(PHOTO.slice(0, 30));
      if (box.rotation) expect(drawn.rotate).toBe(`rotate(${box.rotation} ${box.x} ${box.y})`);
      await expect.poll(() => stored(page, "u_photo")).toMatchObject({ x: box.x, y: box.y, width: box.width, height: box.height, mask, src: PHOTO });
      expect(await stored(page, "u_shape")).toBeUndefined();

      // ONE undo restores both objects exactly; ONE redo re-creates the clip.
      await page.keyboard.press("Control+z");
      await expect(canvasLayer(page, "u_shape")).toHaveCount(1);
      await expect.poll(() => stored(page, "u_photo")).toMatchObject({ ...PHOTO_BOX, maskShape: "rectangle" });
      expect((await stored(page, "u_photo")).mask).toBeUndefined();
      expect((await clipOf(page, "u_photo")).d).toBe(maskD({ kind: "rectangle" }, PHOTO_BOX));
      await page.keyboard.press("Control+y");
      await expect(canvasLayer(page, "u_shape")).toHaveCount(0);
      expect((await clipOf(page, "u_photo")).d).toBe(maskD(mask, box));
    });
  }

  test("move, resize and rotate the clip: the mask follows the box", async ({ page }) => {
    await openWith(page, { shape: "ellipse" });
    await clip(page);
    const from = await bodyPoint(page, "u_photo");
    await drag(page, from, { x: from.x + 60, y: from.y - 40 });
    await expect.poll(async () => (await stored(page, "u_photo"))?.x).not.toBe(SHAPE_BOX.x);
    const moved = await stored(page, "u_photo");
    expect((await clipOf(page, "u_photo")).d).toBe(maskD({ kind: "oval" }, moved));

    const corner = await anchorPoint(page, "bottom-right");
    await drag(page, corner, { x: corner.x + 50, y: corner.y + 30 });
    await expect.poll(async () => (await stored(page, "u_photo"))?.width).toBeGreaterThan(SHAPE_BOX.width);
    const resized = await stored(page, "u_photo");
    expect((await clipOf(page, "u_photo")).d).toBe(maskD({ kind: "oval" }, resized));

    const rotater = await anchorPoint(page, "rotater");
    const centre = await bodyPoint(page, "u_photo");
    await drag(page, rotater, { x: centre.x + 200, y: centre.y });
    await expect.poll(async () => Math.abs((await stored(page, "u_photo"))?.rotation || 0)).toBeGreaterThan(10);
    const rotated = await stored(page, "u_photo");
    const drawn = await clipOf(page, "u_photo");
    expect(drawn.rotate).toBe(`rotate(${rotated.rotation} ${rotated.x} ${rotated.y})`);
    expect(drawn.d).toBe(maskD({ kind: "oval" }, rotated));
  });

  test("crop inside the mask: Done keeps the new framing inside the same outline; refresh restores it", async ({ page }) => {
    await openWith(page, { shape: "ellipse" });
    await clip(page);
    const surface = await enterCrop(page, "u_photo");
    await panCrop(page, surface, 80, 0);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(surface).toHaveCount(0);
    await expect.poll(async () => Number((await stored(page, "u_photo"))?.imageTransform?.offsetX) || 0).not.toBe(0);
    const cropped = await stored(page, "u_photo");
    expect(cropped.mask).toEqual({ kind: "oval" });

    await page.reload();
    await waitForEditor(page);
    await expect(canvasLayer(page, "u_shape")).toHaveCount(0);
    const restored = await stored(page, "u_photo");
    expect(restored).toMatchObject({ mask: { kind: "oval" }, imageTransform: cropped.imageTransform, width: SHAPE_BOX.width });
    expect((await clipOf(page, "u_photo")).d).toBe(maskD({ kind: "oval" }, restored));
  });

  test("duplicate and copy/paste carry the mask; preview draws it", async ({ page }) => {
    await openWith(page, { shape: "rounded-rectangle", borderRadius: 36 });
    await clip(page);
    const point = await bodyPoint(page, "u_photo");
    await page.mouse.click(point.x, point.y, { button: "right" });
    await menu(page).getByRole("menuitem", { name: "Duplicate", exact: true }).click();
    const [copy] = await selectedIds(page);
    expect(copy).not.toBe("u_photo");
    await expect.poll(async () => (await stored(page, copy))?.mask).toEqual({ kind: "rounded", radius: 36 });

    await selectLayer(page, "u_photo");
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    const [pasted] = await selectedIds(page);
    expect([copy, "u_photo"]).not.toContain(pasted);
    await expect.poll(async () => (await stored(page, pasted))?.mask).toEqual({ kind: "rounded", radius: 36 });

    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const drawn = await clipOf(page, "u_photo");
    expect(drawn.d).toBe(maskD({ kind: "rounded", radius: 36 }, SHAPE_BOX));
  });

  test("not offered for a single object, or for a line and a photo", async ({ page }) => {
    await openWith(page, { shape: "line", height: 8 });
    await selectLayer(page, "u_photo");
    const point = await bodyPoint(page, "u_photo");
    await page.mouse.click(point.x, point.y, { button: "right" });
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).getByRole("menuitem", { name: "Clipping mask" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await selectLayer(page, "u_shape", ["Shift"]);
    expect((await selectedIds(page)).sort()).toEqual(["u_photo", "u_shape"]);
    await page.mouse.click(point.x, point.y, { button: "right" });
    await expect(menu(page)).toBeVisible();
    expect(await menu(page).getByRole("menuitem").count()).toBeGreaterThan(0);
    await expect(menu(page).getByRole("menuitem", { name: "Clipping mask" })).toHaveCount(0);
  });

  test("not offered while either object is locked", async ({ page }) => {
    await openWith(page);
    await selectLayer(page, "u_photo");
    const point = await bodyPoint(page, "u_photo");
    await page.mouse.click(point.x, point.y, { button: "right" });
    await menu(page).getByRole("menuitem", { name: "Lock", exact: true }).click();
    await selectLayer(page, "u_shape");
    await selectLayer(page, "u_photo", ["Shift"]);
    expect((await selectedIds(page)).sort()).toEqual(["u_photo", "u_shape"]);
    await page.mouse.click(point.x, point.y, { button: "right" });
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).getByRole("menuitem", { name: "Clipping mask" })).toHaveCount(0);
  });
});
