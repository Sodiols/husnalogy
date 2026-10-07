/**
 * Design Studio crash recovery, change by change (admin).
 *
 * Every kind of edit an admin makes — text, image, crop, shape, mask, pages,
 * orientation and a multi-selection move — must survive losing the tab before
 * the server confirmed it, on an existing design and on a new one:
 *
 *   edit → (the server save is held in flight, so nothing reaches the server)
 *        → reload → reopen → "Restore unsaved changes" → the document is
 *          exactly the one that was lost, and Save Draft sends it.
 *
 * Why the save is held: an existing design autosaves ~4 s after editing
 * pauses. If that save lands before the reload, the server already has the
 * work and the studio correctly offers nothing — a test that merely reloads
 * "quickly" races that save. Holding the save makes the scenario the one being
 * tested (work lost with the tab), every run.
 *
 * Also proved: the browser copy never holds a signed URL (only the image's
 * durable identity), and Admin A's copy is never offered to Designer B on the
 * same browser — for an existing design as well as a new one.
 */
import { expect, test, type Page } from "@playwright/test";
import { addStudioShape, addStudioText, openSidePanel, orientationChoices } from "./admin-studio-tools";
import { AssetStub, assetUrl } from "./asset-reliability-stub";
import { bodyPoint, selectedIds } from "./customizer-fixture";

const TITLE = "Minimal Thank You Card";
const ASSET = "6f1c1c5e-3b2a-4f7e-9a10-0c4a2b7d9e11";
const ADMIN_A = "e2e00000-0000-4000-8000-0000000000a1";
const DESIGNER_B = "e2e00000-0000-4000-8000-0000000000b2";

const IDENTITY = {
  assetId: ASSET,
  bucket: "customizer-elements",
  path: `assets/${ASSET}/original/photo.png`,
  originalPath: `assets/${ASSET}/original/photo.png`,
  editorPath: `assets/${ASSET}/editor/editor.webp`,
  thumbnailPath: `assets/${ASSET}/thumbnail/thumb.webp`,
};

function template() {
  const expires = Date.now() + 10 * 60_000;
  return {
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
      {
        id: "i_photo", page: "front", type: "image", ...IDENTITY, sourceWidth: 3000, sourceHeight: 2250,
        x: 420, y: 420, width: 480, height: 360, zIndex: 1,
        src: assetUrl(ASSET, "editor", expires), originalUrl: assetUrl(ASSET, "original", expires), thumbnailUrl: assetUrl(ASSET, "thumbnail", expires),
      },
      { id: "t_text", page: "front", type: "text", text: "Hello", x: 1100, y: 420, width: 500, height: 100, zIndex: 2, textStyle: { fontFamily: "Inter", fontSize: 60, color: "#303839", autoSizeMode: "fixed" } },
      { id: "s_circle", page: "front", type: "shape", shape: "circle", x: 420, y: 1150, width: 300, height: 300, zIndex: 3, fill: "#d4af37" },
      { id: "s_rect", page: "front", type: "shape", shape: "rectangle", x: 1100, y: 1150, width: 300, height: 200, zIndex: 4, fill: "#8d6e63" },
    ],
  };
}

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const header = (page: Page) => studio(page).locator("header");
const banner = (page: Page) => page.locator("[data-studio-recovery]");
const toolbar = (page: Page) => page.locator("[data-admin-toolbar]");

/** Hold every product save in flight: the tab is lost before the server confirms anything. */
const holdServerSaves = (page: Page) => page.evaluate(() => ((window as any).__adminFixture.productSaveDelayMs = 10 * 60_000));
const productSaves = (page: Page) =>
  page.evaluate(() => (window as any).__adminFixture.requests.filter((entry: any) => /^\/api\/admin\/products(\/[^/]+)?$/.test(entry.path)).map((entry: any) => ({ method: entry.method, body: entry.body })));

async function openExisting(page: Page, options: { seed?: boolean; actor?: string } = {}) {
  await page.setViewportSize({ width: 1440, height: 900 });
  if (options.seed !== false) {
    await page.goto(`/__e2e/admin-dashboard?section=Products${options.actor ? `&actor=${options.actor}` : ""}`);
    await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
    await page.evaluate(({ name, value }) => {
      const products = (window as any).__adminFixture.store.products.map((entry: any) => (entry.title === name ? { ...entry, customizerTemplate: value } : entry));
      window.sessionStorage.setItem("__adminFixtureDurable", JSON.stringify({ products, versions: {} }));
    }, { name: TITLE, value: template() });
    await page.reload();
  } else if (options.actor !== undefined) {
    await page.goto(`/__e2e/admin-dashboard?section=Products${options.actor ? `&actor=${options.actor}` : ""}`);
  }
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: `Edit ${TITLE}` }).first().click();
  await openStudioFromForm(page);
}

async function openNew(page: Page, actor = "") {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/__e2e/admin-dashboard?section=Products${actor ? `&actor=${actor}` : ""}`);
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Add product" }).first().click();
  await openStudioFromForm(page);
}

async function openStudioFromForm(page: Page) {
  const enable = page.getByRole("switch", { name: /Enable product customizer/ });
  await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
  if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
  await page.getByRole("button", { name: "Open Design Studio" }).click();
  await expect(header(page)).toBeVisible();
}

async function select(page: Page, ...ids: string[]) {
  for (const [index, id] of ids.entries()) {
    const point = await bodyPoint(page, id);
    if (index > 0) await page.keyboard.down("Shift");
    await page.mouse.click(point.x, point.y);
    if (index > 0) await page.keyboard.up("Shift");
  }
  await expect.poll(async () => (await selectedIds(page)).slice().sort()).toEqual(ids.slice().sort());
}

/** The browser's recovery copies: key → raw JSON. */
const recoveryCopies = (page: Page): Promise<Record<string, string>> =>
  page.evaluate(() => Object.fromEntries(Object.keys(window.localStorage).filter((key) => key.startsWith("husnalogy_studio_draft")).map((key) => [key, window.localStorage.getItem(key) || ""])));

/** The single recovery copy once it has settled (written ~0.4 s after the last change). */
async function settledCopy(page: Page) {
  let previous = "";
  let raw = "";
  await expect.poll(async () => {
    const copies = Object.values(await recoveryCopies(page));
    raw = copies.length === 1 ? copies[0] : "";
    const stable = raw !== "" && raw === previous;
    previous = raw;
    return stable;
  }, { intervals: [500] }).toBe(true);
  return JSON.parse(raw);
}

/** A document without its short-lived runtime URLs: what must survive. */
function durable(value: any): any {
  if (Array.isArray(value)) return value.map(durable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => !(typeof entry === "string" && /[?&]token=/.test(entry)))
      .map(([key, entry]) => [key, durable(entry)]),
  );
}

const layer = (doc: any, id: string) => (doc.layers || []).find((entry: any) => entry.id === id);

type Change = {
  name: string;
  /** Make the change; returns anything the check needs (an inserted layer's id). */
  run: (page: Page) => Promise<string | void>;
  /** The change, as it must appear in the restored document. */
  check: (doc: any, made: string | void) => void;
};

const nudge = async (page: Page, key: string, times: number) => {
  for (let index = 0; index < times; index += 1) await page.keyboard.press(key);
};

async function inserted(page: Page, before: string[]) {
  let id = "";
  await expect.poll(async () => {
    const [current] = await selectedIds(page);
    id = current && !before.includes(current) ? current : "";
    return id;
  }).not.toBe("");
  return id;
}

const EXISTING_CHANGES: Change[] = [
  {
    name: "text: a new text object with typed words",
    run: async (page) => {
      const before = await selectedIds(page);
      await addStudioText(page);
      await expect(page.locator('[aria-label="Edit text on canvas"]')).toBeVisible();
      await page.keyboard.type("Recovered words");
      await page.keyboard.press("Control+Enter");
      return inserted(page, before);
    },
    check: (doc, id) => expect(layer(doc, id as string).text).toBe("Recovered words"),
  },
  {
    name: "image: the photo moved",
    run: async (page) => {
      await select(page, "i_photo");
      await nudge(page, "ArrowRight", 3);
    },
    check: (doc) => expect(layer(doc, "i_photo").x).toBeGreaterThan(420),
  },
  {
    name: "crop: the photo flipped inside its crop",
    run: async (page) => {
      await select(page, "i_photo");
      await toolbar(page).getByRole("button", { name: "Crop photo" }).click();
      const bar = page.locator("[data-admin-crop-bar]");
      await bar.getByRole("button", { name: "Flip vertically" }).click();
      await bar.getByRole("button", { name: "Done" }).click();
      await expect(bar).toHaveCount(0);
    },
    check: (doc) => expect(layer(doc, "i_photo").imageTransform).toMatchObject({ flipY: true }),
  },
  {
    name: "shape: a new shape",
    run: async (page) => {
      const before = await selectedIds(page);
      await addStudioShape(page, "oval");
      return inserted(page, before);
    },
    check: (doc, id) => expect(layer(doc, id as string)).toMatchObject({ type: "shape" }),
  },
  {
    name: "mask: the photo clipped to the circle",
    run: async (page) => {
      await select(page, "i_photo", "s_circle");
      await expect(toolbar(page)).toHaveAttribute("data-admin-toolbar", "mask");
      await toolbar(page).getByRole("button", { name: "Mask", exact: true }).click();
      await expect(studio(page).locator('[data-canvas-surface] [data-layer-id="s_circle"]')).toHaveCount(0);
    },
    check: (doc) => {
      expect(layer(doc, "s_circle")).toBeUndefined();
      expect(layer(doc, "i_photo").mask).toBeTruthy();
    },
  },
  {
    name: "pages: a page added",
    run: async (page) => {
      const panel = await openSidePanel(page, "Pages");
      await panel.getByRole("button", { name: "Add page" }).click();
    },
    check: (doc) => expect(doc.pages).toHaveLength(3),
  },
  {
    name: "orientation: the card turned horizontal",
    run: async (page) => {
      await (await orientationChoices(page)).getByRole("radio", { name: "Horizontal" }).click();
      await expect((await orientationChoices(page)).getByRole("radio", { name: "Horizontal" })).toHaveAttribute("aria-checked", "true");
    },
    check: (doc) => expect([doc.canvasWidthPx, doc.canvasHeightPx]).toEqual([2100, 1500]),
  },
  {
    name: "multi-selection: two objects moved together",
    run: async (page) => {
      await select(page, "s_rect", "t_text");
      await nudge(page, "ArrowDown", 4);
    },
    check: (doc) => {
      expect(layer(doc, "s_rect").y).toBeGreaterThan(1150);
      expect(layer(doc, "t_text").y).toBeGreaterThan(420);
    },
  },
];

let assets: AssetStub;
test.beforeEach(async ({ context }) => {
  assets = new AssetStub();
  assets.ttlMs = 10 * 60_000;
  await assets.install(context);
});

test.describe("Design Studio recovery: an existing design, change by change", () => {
  for (const change of EXISTING_CHANGES) {
    test(change.name, async ({ page }) => {
      await openExisting(page);
      await expect(studio(page).locator('[data-canvas-surface] [data-layer-id="i_photo"] image').first()).toBeAttached();
      await holdServerSaves(page);

      const made = await change.run(page);
      await expect(header(page).getByText("Unsaved", { exact: true })).toBeVisible();
      const copy = await settledCopy(page);
      change.check(copy.template, made);

      // The copy holds the photo's identity, never a signed URL.
      const raw = Object.values(await recoveryCopies(page))[0];
      expect(raw).not.toMatch(/token=|[?&](X-Amz-|Expires=|Signature=)/);
      if (layer(copy.template, "i_photo")) expect(layer(copy.template, "i_photo")).toMatchObject(IDENTITY);
      // Nothing reached the server: the held autosave never completed.
      expect((await productSaves(page)).length).toBeLessThanOrEqual(1);

      // The tab is lost; the studio reopens on the saved design and offers the copy.
      await page.reload();
      await openExisting(page, { seed: false });
      await expect(banner(page)).toBeVisible();
      await banner(page).getByRole("button", { name: "Restore unsaved changes" }).click();
      await expect(banner(page)).toHaveCount(0);

      // The restored document is exactly the lost one; Save Draft sends it.
      const after = await settledCopy(page);
      expect(durable(after.template)).toEqual(durable(copy.template));
      await header(page).getByRole("button", { name: /Save Draft/ }).click();
      await expect(header(page).getByText("Unsaved", { exact: true })).toHaveCount(0, { timeout: 15_000 });
      const [saved] = (await productSaves(page)).slice(-1);
      expect(saved.method).toBe("PUT");
      // The save sends the normalised template (defaults filled in, runtime
      // URLs blanked), so it is checked for the change rather than byte-equality.
      change.check(saved.body.customizerTemplate, made);
      expect(JSON.stringify(saved.body.customizerTemplate)).not.toContain("token=");
      if (layer(saved.body.customizerTemplate, "i_photo")) expect(layer(saved.body.customizerTemplate, "i_photo")).toMatchObject(IDENTITY);
      expect(await recoveryCopies(page)).toEqual({});
    });
  }
});

test.describe("Design Studio recovery: a new design", () => {
  test("text, shape, page and orientation changes come back together", async ({ page }) => {
    await openNew(page);
    const textBefore = await selectedIds(page);
    await addStudioText(page);
    await expect(page.locator('[aria-label="Edit text on canvas"]')).toBeVisible();
    await page.keyboard.type("New card words");
    await page.keyboard.press("Control+Enter");
    const text = await inserted(page, textBefore);
    await addStudioShape(page, "oval");
    const shape = await inserted(page, [text]);
    await (await openSidePanel(page, "Pages")).getByRole("button", { name: "Add page" }).click();
    await (await orientationChoices(page)).getByRole("radio", { name: "Horizontal" }).click();

    const copy = await settledCopy(page);
    expect(Object.keys(await recoveryCopies(page))[0]).toMatch(/:new$/);
    expect(layer(copy.template, text).text).toBe("New card words");
    expect(layer(copy.template, shape)).toBeTruthy();
    expect(copy.template.canvasWidthPx).toBeGreaterThan(copy.template.canvasHeightPx);
    // A new design is never created by autosave.
    expect(await productSaves(page)).toEqual([]);

    await page.reload();
    await openNew(page);
    await expect(banner(page)).toBeVisible();
    await banner(page).getByRole("button", { name: "Restore unsaved changes" }).click();
    const after = await settledCopy(page);
    expect(durable(after.template)).toEqual(durable(copy.template));
    await expect(studio(page).locator(`[data-layer-id="${shape}"]`).first()).toBeAttached();
    await expect(studio(page).locator(`[data-layer-id="${text}"]`).first()).toBeAttached();
  });
});

test.describe("Design Studio recovery belongs to one studio account", () => {
  test("Admin A's unsaved edits to an EXISTING design are never offered to Designer B; A gets them back", async ({ page }) => {
    await openExisting(page, { actor: ADMIN_A });
    await expect(studio(page).locator('[data-canvas-surface] [data-layer-id="i_photo"] image').first()).toBeAttached();
    await holdServerSaves(page);
    await select(page, "s_rect");
    await nudge(page, "ArrowRight", 5);
    const copy = await settledCopy(page);
    const [keyA] = Object.keys(await recoveryCopies(page));
    expect(keyA).toContain(`:${ADMIN_A}:product:`);

    // B on the same browser opens the same product: the saved design, no offer.
    await openExisting(page, { seed: false, actor: DESIGNER_B });
    await page.waitForTimeout(1_000);
    await expect(banner(page)).toHaveCount(0);
    await expect(header(page).getByText("Unsaved", { exact: true })).toHaveCount(0);
    // B's studio wrote nothing, and A's copy is untouched.
    expect(Object.keys(await recoveryCopies(page))).toEqual([keyA]);
    expect(JSON.parse((await recoveryCopies(page))[keyA]).template).toEqual(copy.template);

    // A comes back to their own copy.
    await openExisting(page, { seed: false, actor: ADMIN_A });
    await expect(banner(page)).toBeVisible();
    await banner(page).getByRole("button", { name: "Restore unsaved changes" }).click();
    const after = await settledCopy(page);
    expect(layer(after.template, "s_rect").x).toBe(layer(copy.template, "s_rect").x);
    expect(layer(after.template, "s_rect").x).toBeGreaterThan(1100);
  });
});
