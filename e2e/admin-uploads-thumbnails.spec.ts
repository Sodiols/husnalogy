/**
 * Uploads panel thumbnails recover (stabilization task 06).
 *
 * A tile whose preview failed used to stay failed for good — its error flag
 * survived the library handing it a fresh signed URL. Now a tile's failure
 * belongs to the URLs it had: expired, 403, 404 and undecodable previews fall
 * back, ask the panel to re-sign, offer Retry, and a re-signed row draws
 * again. Links about to lapse are re-signed before they do. Inserting always
 * places the asset itself (identity + editor/original paths), never a preview.
 */
import { expect, test, type Page } from "@playwright/test";
import { openSidePanel } from "./admin-studio-tools";
import { AssetStub, assetUrl } from "./asset-reliability-stub";
import { bodyPoint, selectedIds } from "./customizer-fixture";

const TITLE = "Minimal Thank You Card";
const TEMPLATE = {
  enabled: true, cardWidthIn: 5, cardHeightIn: 7, dpi: 300, canvasWidthPx: 1500, canvasHeightPx: 2100,
  pages: [{ id: "front", label: "Front", enabled: true }], defaultPage: "front", fields: [], guides: [],
  layers: [{ id: "t_front", page: "front", type: "text", name: "Text", text: "wedding", x: 750, y: 700, width: 420, height: 90, zIndex: 1, textStyle: { fontFamily: "Inter", fontSize: 70.83 } }],
};

let stub: AssetStub;
test.beforeEach(async ({ context }) => {
  stub = new AssetStub();
  stub.ttlMs = 600_000;
  await stub.install(context);
});

let serial = 0;
function asset(title: string, expiresAt = Date.now() + 600_000) {
  serial += 1;
  const id = `7c7c7c7c-0000-4000-8000-${String(Date.now() % 1e8).padStart(8, "0")}${String(serial).padStart(4, "0")}`;
  return {
    id, title, displayName: title, originalFilename: `${title}.png`, assetType: "image", bucket: "customizer-elements",
    originalPath: `assets/${id}/original/a.png`, editorPath: `assets/${id}/editor/a.webp`, thumbnailPath: `assets/${id}/thumbnail/a.webp`,
    url: assetUrl(id, "editor", expiresAt, serial), editorUrl: assetUrl(id, "editor", expiresAt, serial),
    originalUrl: assetUrl(id, "original", expiresAt, serial), thumbnailUrl: assetUrl(id, "thumbnail", expiresAt, serial),
    expiresAt: new Date(expiresAt).toISOString(),
    mimeType: "image/png", width: 2000, height: 1500, status: "ready", adminAvailable: true, archived: false, createdAt: new Date().toISOString(),
  };
}
/** The same asset, freshly signed (what the library returns after a re-sign). */
function resigned(entry: ReturnType<typeof asset>, expiresAt = Date.now() + 600_000) {
  serial += 1;
  return {
    ...entry,
    url: assetUrl(entry.id, "editor", expiresAt, serial), editorUrl: assetUrl(entry.id, "editor", expiresAt, serial),
    originalUrl: assetUrl(entry.id, "original", expiresAt, serial), thumbnailUrl: assetUrl(entry.id, "thumbnail", expiresAt, serial),
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const header = (page: Page) => studio(page).locator("header");
const tile = (page: Page, title: string) => page.getByRole("button", { name: `Add ${title} to the current page` });
const tileState = (page: Page, title: string) => tile(page, title).locator("[data-thumb-state]").getAttribute("data-thumb-state");
const tileSrc = (page: Page, title: string) => tile(page, title).locator("img").getAttribute("src");

async function openStudio(page: Page, assets: any[]) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__e2e/admin-dashboard?section=Products");
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  await page.evaluate(({ name, value }) => {
    const products = (window as any).__adminFixture.store.products.map((entry: any) => (entry.title === name ? { ...entry, customizerTemplate: value } : entry));
    window.sessionStorage.setItem("__adminFixtureDurable", JSON.stringify({ products, versions: {} }));
  }, { name: TITLE, value: TEMPLATE });
  await page.reload();
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  await page.evaluate((entries) => ((window as any).__adminFixture.assets = entries), assets);
  await page.getByRole("button", { name: `Edit ${TITLE}` }).first().click();
  const enable = page.getByRole("switch", { name: /Enable product customizer/ });
  await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
  if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
  await page.getByRole("button", { name: "Open Design Studio" }).click();
  await expect(header(page)).toBeVisible();
  await expect.poll(() => bodyPoint(page, "t_front").then(() => true, () => false)).toBe(true);
}

const setLibrary = (page: Page, entries: any[]) => page.evaluate((list) => ((window as any).__adminFixture.assets = list), entries);

async function savedLayers(page: Page) {
  const before = await page.evaluate(() => (window as any).__adminFixture.requests.length);
  await header(page).getByRole("button", { name: /Save Draft/ }).click();
  await expect.poll(() => page.evaluate((count) => (window as any).__adminFixture.requests.length > count, before)).toBe(true);
  await expect(header(page).getByText("Unsaved", { exact: true })).toHaveCount(0, { timeout: 15_000 });
  return page.evaluate(() => {
    const saves = (window as any).__adminFixture.requests.filter((entry: any) => /^\/api\/admin\/products(\/[^/]+)?$/.test(entry.path));
    return saves[saves.length - 1].body.customizerTemplate.layers as any[];
  });
}

test("expired, 403, 404 and undecodable previews fail cleanly, and a re-signed row draws again", async ({ page }) => {
  const good = asset("Good");
  const expired = asset("Expired", Date.now() - 60_000);
  const missing = asset("Missing");
  const corrupt = asset("Corrupt");
  // 404 for every preview of "Missing"; garbage bytes for every preview of "Corrupt".
  await page.context().route(`**/__e2e-assets/${missing.id}/**`, (route) => route.fulfill({ status: 404, json: { statusCode: "404", error: "not_found" } }));
  await page.context().route(`**/__e2e-assets/${corrupt.id}/**`, (route) => route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("not an image") }));
  await openStudio(page, [good, expired, missing, corrupt]);
  await openSidePanel(page, "Uploads");

  await expect.poll(() => tileState(page, "Good")).toBe("ready");
  for (const title of ["Expired", "Missing", "Corrupt"]) await expect.poll(() => tileState(page, title)).toBe("failed");
  // Each failed tile offers Retry; the good one does not.
  await expect(page.getByRole("button", { name: "Retry loading Expired" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry loading Good" })).toHaveCount(0);

  // The library now signs fresh links (the URL was the only problem for "Expired").
  const fresh = resigned(expired);
  await setLibrary(page, [good, fresh, missing, corrupt]);
  await page.getByRole("button", { name: "Retry loading Expired" }).click();
  await expect.poll(() => tileState(page, "Expired")).toBe("ready");
  expect(await tileSrc(page, "Expired")).toBe(fresh.thumbnailUrl);
  // A genuinely missing file stays a placeholder after a retry — no loop, no crash.
  await page.getByRole("button", { name: "Retry loading Missing" }).click();
  await expect.poll(() => tileState(page, "Missing")).toBe("failed");

  // A failed tile still inserts the ASSET: identity and full-quality paths, never a preview URL.
  await tile(page, "Missing").click();
  await expect.poll(async () => (await selectedIds(page)).length).toBe(1);
  const layers = await savedLayers(page);
  const inserted = layers.find((layer) => layer.assetId === missing.id);
  expect(inserted).toMatchObject({ type: "image", editorPath: missing.editorPath, originalPath: missing.originalPath });
  expect(JSON.stringify(inserted)).not.toContain("thumbnail.png");
});

test("a preview is re-signed before its link lapses, and the tile swaps to the new link without failing", async ({ page }) => {
  const soon = asset("Soon", Date.now() + 70_000);
  await openStudio(page, [soon]);
  await openSidePanel(page, "Uploads");
  await expect.poll(() => tileState(page, "Soon")).toBe("ready");
  const fresh = resigned(soon);
  await setLibrary(page, [fresh]);
  // Scheduled 60 s before expiry, but never sooner than 15 s: within ~15 s here.
  await expect.poll(() => tileSrc(page, "Soon"), { timeout: 30_000 }).toBe(fresh.thumbnailUrl);
  await expect.poll(() => tileState(page, "Soon")).toBe("ready");
});

test("several assets inserted one after another each keep their own identity", async ({ page }) => {
  const entries = [asset("One"), asset("Two"), asset("Three")];
  await openStudio(page, entries);
  await openSidePanel(page, "Uploads");
  for (const entry of entries) {
    await tile(page, entry.title).click();
    await expect.poll(async () => (await selectedIds(page)).length).toBe(1);
  }
  const layers = await savedLayers(page);
  for (const entry of entries) {
    expect(layers.filter((layer) => layer.assetId === entry.id)).toHaveLength(1);
    expect(layers.find((layer) => layer.assetId === entry.id)).toMatchObject({ editorPath: entry.editorPath, originalPath: entry.originalPath });
  }
});
