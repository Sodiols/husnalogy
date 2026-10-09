/**
 * Design Studio page backgrounds (stabilization tasks 01 and 05).
 *
 *  - Removing a background picture clears every reference to it — URL,
 *    library identity, storage paths — through one undoable command, from
 *    both the Background panel and each page card's menu, independently on
 *    Front and Back, and it stays removed after save, reload and in the
 *    customer preview.
 *  - A failed background upload is visible (with a reason and Retry), leaves
 *    the current background exactly as it was, and adds no undo step.
 *
 * Uploads are answered in the test and images come from the asset stub, so
 * nothing reaches real Storage.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { openSidePanel } from "./admin-studio-tools";
import { AssetStub, assetUrl } from "./asset-reliability-stub";
import { bodyPoint } from "./customizer-fixture";

const TITLE = "Minimal Thank You Card";
const TEMPLATE = {
  enabled: true,
  cardWidthIn: 5,
  cardHeightIn: 7,
  dpi: 300,
  canvasWidthPx: 1500,
  canvasHeightPx: 2100,
  pages: [
    { id: "front", label: "Front", enabled: true, backgroundColor: "#f3e9dc" },
    { id: "back", label: "Back", enabled: true, backgroundColor: "#000000" },
  ],
  defaultPage: "front",
  fields: [],
  guides: [],
  layers: [
    { id: "t_front", page: "front", type: "text", name: "Text", text: "wedding", x: 750, y: 700, width: 420, height: 90, zIndex: 1, textStyle: { fontFamily: "Inter", fontSize: 70.83, color: "#999999", autoSizeMode: "width" } },
    { id: "t_back", page: "back", type: "text", name: "Text", text: "thank you", x: 750, y: 1050, width: 420, height: 90, zIndex: 1, textStyle: { fontFamily: "Inter", fontSize: 70.83, color: "#ffffff", autoSizeMode: "width" } },
  ],
};

/** Every page field that belongs to a background picture. */
const PICTURE_KEYS = ["backgroundImage", "backgroundAssetId", "bucket", "path", "originalPath", "editorPath", "thumbnailPath", "thumbnail", "assetId", "src", "url"];

let stub: AssetStub;
let serial = 0;
test.beforeEach(async ({ context }) => {
  stub = new AssetStub();
  stub.ttlMs = 600_000;
  await stub.install(context);
});

function libraryAsset(title: string) {
  serial += 1;
  const id = `6b6b6b6b-0000-4000-8000-${String(Date.now() % 1e8).padStart(8, "0")}${String(serial).padStart(4, "0")}`;
  const expires = Date.now() + 600_000;
  return {
    id,
    title,
    displayName: title,
    originalFilename: `${title.toLowerCase().replace(/\s+/g, "-")}.png`,
    assetType: "background",
    bucket: "customizer-elements",
    originalPath: `assets/${id}/original/a.png`,
    editorPath: `assets/${id}/editor/a.webp`,
    thumbnailPath: `assets/${id}/thumbnail/a.webp`,
    url: assetUrl(id, "editor", expires),
    editorUrl: assetUrl(id, "editor", expires),
    originalUrl: assetUrl(id, "original", expires),
    thumbnailUrl: assetUrl(id, "thumbnail", expires),
    mimeType: "image/png",
    width: 1500,
    height: 2100,
    status: "ready",
    adminAvailable: true,
    archived: false,
    createdAt: new Date().toISOString(),
  };
}

type UploadMode = "ok" | "server-error" | "network" | "auth" | "slow-ok";
/** The asset API's upload, answered here; `mode.current` decides the outcome of the next upload. */
async function answerUploads(page: Page, uploads: any[], mode: { current: UploadMode }) {
  await page.route("**/api/admin/customizer/assets", async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    if (mode.current === "network") return route.abort("internetdisconnected");
    if (mode.current === "server-error") return route.fulfill({ status: 500, json: { ok: false, error: "Upload failed: storage is unavailable" } });
    if (mode.current === "auth") return route.fulfill({ status: 401, json: { ok: false, error: "Unauthorized" } });
    if (mode.current === "slow-ok") await new Promise((resolve) => setTimeout(resolve, 1500));
    const asset = libraryAsset(`Uploaded background ${uploads.length + 1}`);
    uploads.push(asset);
    await page.evaluate((entry) => (window as any).__adminFixture.assets.unshift(entry), asset);
    await route.fulfill({ json: { ok: true, asset } });
  });
}

const PNG = { name: "photo.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex") };

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const header = (page: Page) => studio(page).locator("header");
/** Background pictures the canvas draws for the active page (the page-level <image>, before any layer). */
const canvasBackgroundImages = (page: Page) =>
  studio(page).locator("[data-canvas-surface] svg").first().evaluate((svg) => svg.querySelectorAll(":scope > image").length);
const unsavedBadge = (page: Page) => header(page).getByText("Unsaved", { exact: true });

async function openStudio(page: Page, assets: any[] = [], seed = true) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/__e2e/admin-dashboard?section=Products");
  await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  if (seed) {
    await page.evaluate(({ name, value }) => {
      const products = (window as any).__adminFixture.store.products.map((entry: any) => (entry.title === name ? { ...entry, customizerTemplate: value } : entry));
      window.sessionStorage.setItem("__adminFixtureDurable", JSON.stringify({ products, versions: {} }));
    }, { name: TITLE, value: TEMPLATE });
    await page.reload();
    await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
  }
  await page.evaluate((entries) => ((window as any).__adminFixture.assets = entries), assets);
  await page.getByRole("button", { name: `Edit ${TITLE}` }).first().click();
  const enable = page.getByRole("switch", { name: /Enable product customizer/ });
  await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
  if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
  await page.getByRole("button", { name: "Open Design Studio" }).click();
  await expect(header(page)).toBeVisible();
  await expect.poll(() => bodyPoint(page, "t_front").then(() => true, () => false)).toBe(true);
}

async function savedTemplate(page: Page) {
  const before = await page.evaluate(() => (window as any).__adminFixture.requests.length);
  await header(page).getByRole("button", { name: /Save Draft/ }).click();
  await expect.poll(() => page.evaluate((count) => (window as any).__adminFixture.requests.length > count, before)).toBe(true);
  await expect(unsavedBadge(page)).toHaveCount(0, { timeout: 15_000 });
  return page.evaluate(() => {
    const saves = (window as any).__adminFixture.requests.filter((entry: any) => /^\/api\/admin\/products(\/[^/]+)?$/.test(entry.path));
    return saves[saves.length - 1].body.customizerTemplate;
  });
}
const pageIn = (template: any, id: string) => template.pages.find((entry: any) => entry.id === id);
const pictureKeysOf = (pageEntry: any) => PICTURE_KEYS.filter((key) => pageEntry?.[key] !== undefined && pageEntry?.[key] !== "");

async function goToPage(page: Page, label: string) {
  const pages = await openSidePanel(page, "Pages");
  await pages.getByRole("button", { name: label, exact: true }).click();
  await expect(pages.locator("[data-page-card][data-active] [data-page-label]")).toHaveText(label);
}

/** A page card's ⋯ menu. */
async function pageMenu(page: Page, label: string) {
  const pages = await openSidePanel(page, "Pages");
  await pages.getByRole("button", { name: `Page actions for ${label}` }).click();
  return pages;
}

test.describe("Removing a page background", () => {
  test("Pages-menu removal clears every reference on Front only; Undo, Redo, save and reload agree", async ({ page }) => {
    const frontBg = libraryAsset("Front confetti");
    const backBg = libraryAsset("Back marble");
    await openStudio(page, [frontBg, backBg]);

    // Front and Back get their own backgrounds through the Background panel's search.
    let panel = await openSidePanel(page, "Background");
    await panel.getByRole("searchbox", { name: "Search for backgrounds" }).fill("Front");
    await panel.getByRole("button", { name: "Use Front confetti as the background" }).click();
    await expect.poll(() => canvasBackgroundImages(page)).toBe(1);
    await goToPage(page, "Back");
    panel = await openSidePanel(page, "Background");
    await panel.getByRole("searchbox", { name: "Search for backgrounds" }).fill("Back");
    await panel.getByRole("button", { name: "Use Back marble as the background" }).click();
    await expect.poll(() => canvasBackgroundImages(page)).toBe(1);
    let saved = await savedTemplate(page);
    expect(pageIn(saved, "front").backgroundAssetId).toBe(frontBg.id);
    expect(pageIn(saved, "back").backgroundAssetId).toBe(backBg.id);

    // Remove Front's from its card menu (while Back is the page being edited).
    await goToPage(page, "Front");
    const pages = await pageMenu(page, "Front");
    await pages.getByRole("button", { name: "Remove background image" }).click();
    await expect.poll(() => canvasBackgroundImages(page)).toBe(0);
    saved = await savedTemplate(page);
    expect(pictureKeysOf(pageIn(saved, "front"))).toEqual([]);
    expect(pageIn(saved, "front").backgroundColor).toBe("#f3e9dc");
    expect(pageIn(saved, "back").backgroundAssetId).toBe(backBg.id);

    // Undo restores the exact original background; Redo removes it again.
    await page.keyboard.press("Control+z");
    await expect.poll(() => canvasBackgroundImages(page)).toBe(1);
    saved = await savedTemplate(page);
    expect(pageIn(saved, "front")).toMatchObject({ backgroundAssetId: frontBg.id, editorPath: frontBg.editorPath, originalPath: frontBg.originalPath });
    await page.keyboard.press("Control+y");
    await expect.poll(() => canvasBackgroundImages(page)).toBe(0);
    saved = await savedTemplate(page);
    expect(pictureKeysOf(pageIn(saved, "front"))).toEqual([]);

    // Reload: the server re-signs identities — nothing is left to bring Front's back.
    await page.reload();
    await openStudio(page, [frontBg, backBg], false);
    await expect.poll(() => canvasBackgroundImages(page)).toBe(0);
    panel = await openSidePanel(page, "Background");
    await expect(panel.getByRole("button", { name: "Upload Image" })).toBeVisible();
    await goToPage(page, "Back");
    await expect.poll(() => canvasBackgroundImages(page)).toBe(1);

    // The customer preview of the same design opens on Front: no picture there either.
    await header(page).getByRole("button", { name: "Customer Preview" }).click();
    const previewSvg = studio(page).locator('svg[aria-label="Design preview"]').first();
    await expect(previewSvg).toBeVisible();
    await expect.poll(() => previewSvg.evaluate((svg) => svg.querySelectorAll(":scope > image").length)).toBe(0);
  });

  test("Background-panel removal on Back keeps Front's picture; the menu offers removal for an id-only (recovered) background", async ({ page }) => {
    const frontBg = libraryAsset("Front gold");
    const backBg = libraryAsset("Back gold");
    const seeded = {
      ...TEMPLATE,
      pages: [
        // As a saved design stores them: identities and paths, no signed URLs.
        { ...TEMPLATE.pages[0], backgroundAssetId: frontBg.id, bucket: frontBg.bucket, originalPath: frontBg.originalPath, editorPath: frontBg.editorPath, thumbnailPath: frontBg.thumbnailPath },
        { ...TEMPLATE.pages[1], backgroundAssetId: backBg.id, bucket: backBg.bucket, originalPath: backBg.originalPath, editorPath: backBg.editorPath, thumbnailPath: backBg.thumbnailPath },
      ],
    };
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/__e2e/admin-dashboard?section=Products");
    await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
    await page.evaluate(({ name, value }) => {
      const products = (window as any).__adminFixture.store.products.map((entry: any) => (entry.title === name ? { ...entry, customizerTemplate: value } : entry));
      window.sessionStorage.setItem("__adminFixtureDurable", JSON.stringify({ products, versions: {} }));
    }, { name: TITLE, value: seeded });
    await page.reload();
    await openStudio(page, [frontBg, backBg], false);

    // An id-only background still offers Replace / Remove on its card.
    const pages = await pageMenu(page, "Back");
    await expect(pages.getByRole("button", { name: "Replace background image" })).toBeVisible();
    await expect(pages.getByRole("button", { name: "Remove background image" })).toBeVisible();
    await page.keyboard.press("Escape");
    await pages.getByRole("button", { name: "Page actions for Back" }).click();

    await goToPage(page, "Back");
    const panel = await openSidePanel(page, "Background");
    await panel.getByRole("button", { name: "Remove background image" }).click();
    await expect.poll(() => canvasBackgroundImages(page)).toBe(0);
    const saved = await savedTemplate(page);
    expect(pictureKeysOf(pageIn(saved, "back"))).toEqual([]);
    expect(pageIn(saved, "front").backgroundAssetId).toBe(frontBg.id);
  });
});

test.describe("Background upload failures", () => {
  for (const [mode, text, retryable] of [
    ["server-error", "storage is unavailable", true],
    ["network", "no connection to the server", true],
    ["auth", "session has expired", false],
  ] as const) {
    test(`${mode}: visible reason, previous background kept, no undo step${retryable ? ", Retry succeeds" : ""}`, async ({ page }) => {
      const existing = libraryAsset("Existing");
      const uploads: any[] = [];
      const outcome = { current: mode as UploadMode };
      await openStudio(page, [existing]);
      await answerUploads(page, uploads, outcome);
      const panel = await openSidePanel(page, "Background");
      await panel.getByRole("searchbox", { name: "Search for backgrounds" }).fill("Existing");
      await panel.getByRole("button", { name: "Use Existing as the background" }).click();
      let saved = await savedTemplate(page);
      expect(pageIn(saved, "front").backgroundAssetId).toBe(existing.id);

      await panel.getByLabel("Background image file").setInputFiles(PNG);
      const alert = panel.locator('[data-background-upload="failed"]');
      await expect(alert).toBeVisible();
      await expect(alert).toContainText(text);
      await expect(alert).toContainText("The current background was not changed.");
      // Nothing changed: no unsaved edit, the same background.
      await expect(unsavedBadge(page)).toHaveCount(0);
      await expect.poll(() => canvasBackgroundImages(page)).toBe(1);
      // No undo step was added: Undo goes back past the search pick, to no picture.
      await page.keyboard.press("Control+z");
      await expect.poll(() => canvasBackgroundImages(page)).toBe(0);
      await page.keyboard.press("Control+y");
      await expect.poll(() => canvasBackgroundImages(page)).toBe(1);

      if (retryable) {
        outcome.current = "ok";
        await alert.getByRole("button", { name: "Retry" }).click();
        await expect(alert).toHaveCount(0);
        await expect.poll(() => uploads.length).toBe(1);
        saved = await savedTemplate(page);
        expect(pageIn(saved, "front").backgroundAssetId).toBe(uploads[0].id);
      } else {
        await expect(alert.getByRole("button", { name: "Retry" })).toHaveCount(0);
        await alert.getByRole("button", { name: "Dismiss" }).click();
        await expect(alert).toHaveCount(0);
        saved = await savedTemplate(page);
        expect(pageIn(saved, "front").backgroundAssetId).toBe(existing.id);
      }
    });
  }

  test("an unsupported file is refused before upload; progress shows while uploading from a page card", async ({ page }) => {
    const uploads: any[] = [];
    const outcome = { current: "slow-ok" as UploadMode };
    await openStudio(page);
    await answerUploads(page, uploads, outcome);
    let requests = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/api/admin/customizer/assets")) requests += 1;
    });

    const panel = await openSidePanel(page, "Background");
    await panel.getByLabel("Background image file").setInputFiles({ name: "notes.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
    await expect(panel.locator('[data-background-upload="failed"]')).toContainText("Use a JPG, PNG or WebP image");
    expect(requests).toBe(0);
    await panel.locator('[data-background-upload="failed"]').getByRole("button", { name: "Dismiss" }).click();

    // From the Back card's menu: progress on that card, then applied to Back only.
    const pages = await pageMenu(page, "Back");
    const chooser = page.waitForEvent("filechooser");
    await pages.getByRole("button", { name: "Set background image" }).click();
    await (await chooser).setFiles(PNG);
    const card = pages.locator('[data-page-card="back"]');
    await expect(card.locator("[data-background-upload]")).toBeVisible();
    await expect(card.locator("[data-background-upload]")).toHaveCount(0, { timeout: 15_000 });
    const saved = await savedTemplate(page);
    expect(pageIn(saved, "back").backgroundAssetId).toBe(uploads[0].id);
    expect(pageIn(saved, "front").backgroundAssetId || "").toBe("");
  });
});
