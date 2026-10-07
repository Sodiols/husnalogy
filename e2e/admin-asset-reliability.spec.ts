/**
 * P0 image reliability in the Design Studio: a library photo must survive its
 * signed URL expiring (long sessions), a refused or missing editor variant, a
 * corrupt or thumbnail-sized editor variant, a stale recovery copy, and a
 * dropped connection — without disappearing, blurring, or changing the design.
 *
 * Storage is simulated by e2e/asset-reliability-stub.ts: URLs carry an expiring
 * token that is enforced, and every URL issued lives 8–60 seconds, so a session
 * longer than the signing period takes seconds.
 */
import { expect, test, type Page } from "@playwright/test";
import { bodyPoint, selectedIds } from "./customizer-fixture";
import { AssetStub, assetUrl, urlExpiry } from "./asset-reliability-stub";
import { openSidePanel } from "./admin-studio-tools";

const TITLE = "Minimal Thank You Card";
const ASSET = "6f1c1c5e-3b2a-4f7e-9a10-0c4a2b7d9e11";
const ASSET_BACK = "7a2d2d6f-4c3b-4a8f-8b21-1d5b3c8e0f22";

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const header = (page: Page) => studio(page).locator("header");
const unsavedChip = (page: Page) => header(page).getByText("Unsaved", { exact: true });

/** The photo exactly as designed: identity, geometry, crop, mask. */
const DESIGN = {
  id: "i_photo",
  page: "front",
  type: "image",
  assetId: ASSET,
  bucket: "customizer-elements",
  path: `assets/${ASSET}/original/photo.png`,
  originalPath: `assets/${ASSET}/original/photo.png`,
  editorPath: `assets/${ASSET}/editor/editor.webp`,
  thumbnailPath: `assets/${ASSET}/thumbnail/thumb.webp`,
  sourceWidth: 3000,
  sourceHeight: 2250,
  x: 520,
  y: 640,
  width: 640,
  height: 480,
  rotation: 15,
  zIndex: 1,
  imageTransform: { zoom: 1.4, offsetX: 20, offsetY: -10, flipX: true },
  mask: { kind: "rounded", radius: 40 },
};
const DESIGN_KEYS = Object.keys(DESIGN).filter((key) => key !== "imageTransform");

function template(expiresAtMs: number) {
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
      { ...DESIGN, src: assetUrl(ASSET, "editor", expiresAtMs), originalUrl: assetUrl(ASSET, "original", expiresAtMs), thumbnailUrl: assetUrl(ASSET, "thumbnail", expiresAtMs) },
      { id: "s_rect", page: "front", type: "shape", shape: "rectangle", x: 1100, y: 1600, width: 300, height: 200, zIndex: 2, fill: "#8d6e63" },
      { ...DESIGN, id: "p_back", page: "back", assetId: ASSET_BACK, editorPath: `assets/${ASSET_BACK}/editor/e.webp`, originalPath: `assets/${ASSET_BACK}/original/o.png`, path: `assets/${ASSET_BACK}/original/o.png`, src: assetUrl(ASSET_BACK, "editor", expiresAtMs) },
    ],
  };
}

async function openStudio(page: Page, seed: Record<string, unknown> | null) {
  await page.setViewportSize({ width: 1440, height: 900 });
  if (seed) {
    await page.goto("/__e2e/admin-dashboard?section=Products");
    await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
    await page.evaluate(({ name, value }) => {
      const products = (window as any).__adminFixture.store.products.map((entry: any) => (entry.title === name ? { ...entry, customizerTemplate: value } : entry));
      window.sessionStorage.setItem("__adminFixtureDurable", JSON.stringify({ products, versions: {} }));
    }, { name: TITLE, value: seed });
    await page.reload();
    await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  }
  await page.getByRole("button", { name: `Edit ${TITLE}` }).first().click();
  const enable = page.getByRole("switch", { name: /Enable product customizer/ });
  await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
  if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
  await page.getByRole("button", { name: "Open Design Studio" }).click();
  await expect(header(page)).toBeVisible();
}

/** What the canvas draws for the photo: the URL and the resolver's verdict. */
const drawn = (page: Page, id = "i_photo") =>
  page.evaluate((layerId) => {
    const group = document.querySelector(`[data-admin-customizer] [data-canvas-surface] [data-layer-id="${layerId}"]`);
    const image = group?.querySelector("image");
    return {
      href: image?.getAttribute("href") || "",
      status: image?.getAttribute("data-image-status") || "",
      unavailable: Boolean(group?.querySelector("[data-image-unavailable]")),
      clip: group?.querySelector("clipPath path")?.getAttribute("d") || "",
    };
  }, id);

async function savedTemplate(page: Page) {
  const before = await page.evaluate(() => (window as any).__adminFixture.requests.length);
  await header(page).getByRole("button", { name: /Save Draft/ }).click();
  await expect.poll(() => page.evaluate((count) => (window as any).__adminFixture.requests.length > count, before)).toBe(true);
  await expect(unsavedChip(page)).toHaveCount(0, { timeout: 15_000 });
  return page.evaluate(() => {
    const saves = (window as any).__adminFixture.requests.filter((entry: any) => /^\/api\/admin\/products(\/[^/]+)?$/.test(entry.path));
    return saves[saves.length - 1].body.customizerTemplate;
  });
}
const productSaves = (page: Page) =>
  page.evaluate(() => (window as any).__adminFixture.requests.filter((entry: any) => /^\/api\/admin\/products(\/[^/]+)?$/.test(entry.path)).length);

const expectDesignUnchanged = (layer: any) => {
  for (const key of DESIGN_KEYS) expect(layer[key], key).toEqual((DESIGN as any)[key]);
  expect(layer.imageTransform).toMatchObject(DESIGN.imageTransform);
};

async function nudgeShape(page: Page) {
  const point = await bodyPoint(page, "s_rect");
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => selectedIds(page)).toEqual(["s_rect"]);
  await page.keyboard.press("ArrowRight");
}

/** Sample the drawn photo for `ms`: it must always be a live, unexpired picture. */
async function watchFor(page: Page, ms: number) {
  const hrefs = new Set<string>();
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const state = await drawn(page);
    expect(state.href, "the photo disappeared").not.toBe("");
    expect(state.unavailable, "the photo became unavailable").toBe(false);
    expect(urlExpiry(state.href), "the canvas is drawing an expired URL").toBeGreaterThan(Date.now() - 1500);
    hrefs.add(state.href);
    await page.waitForTimeout(400);
  }
  return hrefs;
}

let stub: AssetStub;
test.beforeEach(async ({ context }) => {
  stub = new AssetStub();
  await stub.install(context);
});

test.describe("Design Studio image reliability", () => {
  test("a session longer than the signing period: renewed in the background, never blank, never dirty", async ({ page }) => {
    stub.ttlMs = 8_000;
    await openStudio(page, template(Date.now() + 8_000));
    await expect.poll(async () => (await drawn(page)).status).toBe("ready");
    const clip = (await drawn(page)).clip;
    const undo = header(page).getByRole("button", { name: "Undo (Ctrl+Z)" });
    await expect(undo).toBeDisabled();

    // Three signing periods with no edits: renewed, but nothing in the design changed.
    const renewed = await watchFor(page, 22_000);
    expect(renewed.size).toBeGreaterThanOrEqual(3);
    await expect(undo).toBeDisabled();
    await expect(unsavedChip(page)).toHaveCount(0);
    expect(await productSaves(page)).toBe(0);
    expect((await drawn(page)).clip).toBe(clip);

    // Normal editing continues across further renewals.
    await nudgeShape(page);
    await expect(unsavedChip(page)).toBeVisible();
    await watchFor(page, 10_000);
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+y");
    const saved = await savedTemplate(page);
    expectDesignUnchanged(saved.layers.find((layer: any) => layer.id === "i_photo"));
    // The thumbnail was never fetched for the canvas.
    expect(stub.imageRequests.filter((path) => path.endsWith("/thumbnail.png"))).toEqual([]);
  });

  test("a URL that already expired is replaced from the asset's identity", async ({ page }) => {
    await openStudio(page, template(Date.now() - 60_000));
    await expect.poll(async () => (await drawn(page)).status).toBe("ready");
    expect(urlExpiry((await drawn(page)).href)).toBeGreaterThan(Date.now());
    expect(stub.signRequests.length).toBeGreaterThan(0);
    await expect(unsavedChip(page)).toHaveCount(0);
  });

  for (const [mode, reason] of [["404", "editor-load-failed"], ["corrupt", "editor-load-failed"], ["tiny", "editor-low-res"]] as const) {
    test(`an editor variant that is ${mode === "tiny" ? "thumbnail-sized" : mode} falls back to the sharp original and is reported`, async ({ page }) => {
      stub.editorMode = mode;
      await openStudio(page, template(Date.now() + 60_000));
      await expect.poll(async () => (await drawn(page)).status, { timeout: 20_000 }).toBe("original");
      expect((await drawn(page)).href).toContain("/original.png");
      expect(stub.signRequests.some((request) => request.reason === reason && request.assets.some((asset) => asset.variant === "original"))).toBe(true);
      // Falling back changed nothing in the document.
      await expect(unsavedChip(page)).toHaveCount(0);
      expect(stub.imageRequests.filter((path) => path.endsWith("/thumbnail.png"))).toEqual([]);
    });
  }

  test("recovery never restores a stale URL: the copy holds identities, the restore gets fresh credentials", async ({ page }) => {
    stub.ttlMs = 60_000;
    await openStudio(page, template(Date.now() + 60_000));
    await expect.poll(async () => (await drawn(page)).status).toBe("ready");
    await nudgeShape(page);
    await expect(unsavedChip(page)).toBeVisible();
    await expect.poll(() => page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith("husnalogy_studio_draft")).length)).toBe(1);
    const snapshot = await page.evaluate(() => {
      const key = Object.keys(window.localStorage).find((name) => name.startsWith("husnalogy_studio_draft"))!;
      return window.localStorage.getItem(key) || "";
    });
    expect(snapshot).not.toContain("token=");
    expect(snapshot).toContain(ASSET);

    const signedBefore = stub.signRequests.length;
    await page.reload();
    await openStudio(page, null);
    await page.locator("[data-studio-recovery]").getByRole("button", { name: "Restore unsaved changes" }).click();
    await expect.poll(async () => (await drawn(page)).status).toBe("ready");
    expect(urlExpiry((await drawn(page)).href)).toBeGreaterThan(Date.now());
    expect(stub.signRequests.length).toBeGreaterThan(signedBefore);
    const saved = await savedTemplate(page);
    expectDesignUnchanged(saved.layers.find((layer: any) => layer.id === "i_photo"));
    // The restored edit (the nudged shape) came back too.
    expect(saved.layers.find((layer: any) => layer.id === "s_rect").x).toBeGreaterThan(1100);
  });

  test("a dropped connection never removes the picture; it renews as soon as the network returns", async ({ page }) => {
    stub.ttlMs = 8_000;
    await openStudio(page, template(Date.now() + 8_000));
    await expect.poll(async () => (await drawn(page)).status).toBe("ready");
    stub.offline = true;
    await nudgeShape(page);
    await page.waitForTimeout(12_000);
    // Renewals failed and the last URL has lapsed, yet the decoded picture stays.
    const offline = await drawn(page);
    expect(offline.href).not.toBe("");
    expect(offline.unavailable).toBe(false);

    stub.offline = false;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(async () => urlExpiry((await drawn(page)).href), { timeout: 15_000 }).toBeGreaterThan(Date.now());
    const saved = await savedTemplate(page);
    expectDesignUnchanged(saved.layers.find((layer: any) => layer.id === "i_photo"));
  });

  test("every page's photos resolve, including pages opened later", async ({ page }) => {
    await openStudio(page, template(Date.now() - 60_000));
    await openSidePanel(page, "Pages");
    await page.locator("#admin-pages-section button[aria-pressed]").nth(1).click();
    await expect.poll(async () => (await drawn(page, "p_back")).status).toBe("ready");
    expect(urlExpiry((await drawn(page, "p_back")).href)).toBeGreaterThan(Date.now());
  });
});
