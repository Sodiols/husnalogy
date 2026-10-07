/**
 * Design Studio: the Background and Uploads side panels, driven through real
 * interaction and checked against the canvas and the saved design.
 *
 * Images come from the asset stub (same-origin signed URLs, nothing reaches
 * real Storage) and uploads are answered by a route standing in for the asset
 * API, so no file ever leaves the test.
 *
 * Set SHOT_DIR to also save screenshots of both panels.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { openSidePanel, sidePanel } from "./admin-studio-tools";
import { AssetStub, assetUrl } from "./asset-reliability-stub";
import { bodyPoint, selectedIds } from "./customizer-fixture";

const TITLE = "Minimal Thank You Card";
const TEMPLATE = {
  enabled: true,
  cardWidthIn: 5,
  cardHeightIn: 7,
  dpi: 300,
  canvasWidthPx: 1500,
  canvasHeightPx: 2100,
  pages: [
    { id: "front", label: "Front", enabled: true, backgroundColor: "#ffffff" },
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

let stub: AssetStub;
let serial = 0;
test.beforeEach(async ({ context }) => {
  stub = new AssetStub();
  stub.ttlMs = 600_000;
  await stub.install(context);
});

/** A library asset as the asset API returns it, with stub-signed URLs. */
function libraryAsset(title: string, assetType = "image") {
  serial += 1;
  const id = `5a5a5a5a-0000-4000-8000-${String(Date.now() % 1e8).padStart(8, "0")}${String(serial).padStart(4, "0")}`;
  const expires = Date.now() + 600_000;
  return {
    id,
    title,
    displayName: title,
    originalFilename: `${title.toLowerCase().replace(/\s+/g, "-")}.png`,
    assetType,
    bucket: "customizer-elements",
    originalPath: `assets/${id}/original/a.png`,
    editorPath: `assets/${id}/editor/a.webp`,
    thumbnailPath: `assets/${id}/thumbnail/a.webp`,
    url: assetUrl(id, "editor", expires),
    editorUrl: assetUrl(id, "editor", expires),
    originalUrl: assetUrl(id, "original", expires),
    thumbnailUrl: assetUrl(id, "thumbnail", expires),
    mimeType: "image/png",
    width: 2000,
    height: 1500,
    status: "ready",
    adminAvailable: true,
    archived: false,
    createdAt: new Date().toISOString(),
  };
}

/** The asset API's upload (XHR POST), answered here: the uploaded file becomes a library asset. */
async function answerUploads(page: Page, uploads: any[]) {
  await page.route("**/api/admin/customizer/assets", async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const isBackground = /name="assetType"\r\n\r\nbackground/.test(route.request().postData() || "");
    const asset = libraryAsset(isBackground ? "Uploaded background" : `Uploaded ${uploads.length + 1}`, isBackground ? "background" : "image");
    uploads.push(asset);
    await page.evaluate((entry) => (window as any).__adminFixture.assets.unshift(entry), asset);
    await route.fulfill({ json: { ok: true, asset } });
  });
}

const PNG = { name: "photo.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex") };

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const header = (page: Page) => studio(page).locator("header");
/** The canvas page's own background colour, as drawn. */
const canvasBackground = (page: Page) =>
  studio(page).locator("[data-canvas-surface] svg").first().evaluate((svg) => svg.querySelector(":scope > rect")?.getAttribute("fill") || svg.querySelector("rect")?.getAttribute("fill"));

async function shot(page: Page, name: string) {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
}

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
  await expect(header(page).getByText("Unsaved", { exact: true })).toHaveCount(0, { timeout: 15_000 });
  return page.evaluate(() => {
    const saves = (window as any).__adminFixture.requests.filter((entry: any) => /^\/api\/admin\/products(\/[^/]+)?$/.test(entry.path));
    return saves[saves.length - 1].body.customizerTemplate;
  });
}
const pageIn = (template: any, id: string) => template.pages.find((entry: any) => entry.id === id);

async function goToPage(page: Page, label: string) {
  const pages = await openSidePanel(page, "Pages");
  await pages.getByRole("button", { name: label, exact: true }).click();
  await expect(pages.locator("[data-page-card][data-active] [data-page-label]")).toHaveText(label);
}

test.describe("Background panel", () => {
  test("swatches, palette, custom hex and Remove change this page's real background, one undo step each", async ({ page }) => {
    await openStudio(page);
    const panel = await openSidePanel(page, "Background");
    await expect(panel.getByRole("heading", { name: "Background", exact: true })).toBeVisible();
    await expect(panel.getByRole("searchbox", { name: "Search for backgrounds" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Background Image", exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect(panel.getByRole("button", { name: "Upload Image" })).toBeVisible();
    // White is the page's no-colour default: nothing to remove yet.
    await expect(panel.getByRole("button", { name: "Remove", exact: true })).toBeDisabled();
    // The original palette is the design's own colours.
    await expect(panel.getByRole("button", { name: "Original colour #ffffff", exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Original colour #000000", exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Original colour #999999", exact: true })).toBeVisible();
    await shot(page, "background-panel");

    // Swatch → the canvas, as one undo step.
    await panel.getByRole("button", { name: "Colour #ec008c", exact: true }).click();
    await expect.poll(() => canvasBackground(page)).toBe("#ec008c");
    await expect(panel.getByRole("button", { name: "Colour #ec008c", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByRole("button", { name: "Recent colour #ec008c", exact: true })).toBeVisible();
    await page.keyboard.press("Control+z");
    await expect.poll(() => canvasBackground(page)).toBe("#ffffff");
    await page.keyboard.press("Control+y");
    await expect.poll(() => canvasBackground(page)).toBe("#ec008c");

    // Custom hex: validated, applied on Enter, mirrored in the tile.
    const hex = panel.getByRole("textbox", { name: "Custom background colour (hex)" });
    await expect(hex).toHaveValue("#EC008C");
    await hex.fill("#12");
    await hex.press("Enter");
    await expect.poll(() => canvasBackground(page)).toBe("#ec008c");
    await hex.fill("#1A2B3C");
    await hex.press("Enter");
    await expect.poll(() => canvasBackground(page)).toBe("#1a2b3c");
    await expect(panel.locator("[data-background-color-tile]")).toHaveCSS("background-color", "rgb(26, 43, 60)");
    // Out of the text field, so Ctrl+Z is the studio's undo rather than the field's own.
    await hex.blur();
    await page.keyboard.press("Control+z");
    await expect.poll(() => canvasBackground(page)).toBe("#ec008c");
    await page.keyboard.press("Control+y");
    await expect.poll(() => canvasBackground(page)).toBe("#1a2b3c");

    // Original palette and recent colours apply too.
    await panel.getByRole("button", { name: "Original colour #000000", exact: true }).click();
    await expect.poll(() => canvasBackground(page)).toBe("#000000");
    await panel.getByRole("button", { name: "Recent colour #ec008c", exact: true }).click();
    await expect.poll(() => canvasBackground(page)).toBe("#ec008c");

    // Remove: back to no colour (the paper white); Undo restores the colour.
    await panel.getByRole("button", { name: "Remove", exact: true }).click();
    await expect.poll(() => canvasBackground(page)).toBe("#ffffff");
    await expect(panel.getByRole("button", { name: "No colour" })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Control+z");
    await expect.poll(() => canvasBackground(page)).toBe("#ec008c");

    // The no-colour swatch is the same real state.
    await panel.getByRole("button", { name: "No colour" }).click();
    await expect.poll(() => canvasBackground(page)).toBe("#ffffff");
    await page.keyboard.press("Control+z");
    await expect.poll(() => canvasBackground(page)).toBe("#ec008c");

    // Close.
    await panel.getByRole("button", { name: "Close panel" }).click();
    await expect(sidePanel(page, "background")).toHaveCount(0);
  });

  test("each page keeps its own background; save and reload keep both exactly", async ({ page }) => {
    await openStudio(page);
    let panel = await openSidePanel(page, "Background");
    await panel.getByRole("textbox", { name: "Custom background colour (hex)" }).fill("#1A2B3C");
    await panel.getByRole("textbox", { name: "Custom background colour (hex)" }).press("Enter");
    await expect.poll(() => canvasBackground(page)).toBe("#1a2b3c");

    await goToPage(page, "Back");
    panel = await openSidePanel(page, "Background");
    await expect(panel).toContainText("Background of Back");
    await expect.poll(() => canvasBackground(page)).toBe("#000000");
    await panel.getByRole("button", { name: "Colour #2e3192", exact: true }).click();
    await expect.poll(() => canvasBackground(page)).toBe("#2e3192");

    const saved = await savedTemplate(page);
    expect(pageIn(saved, "front").backgroundColor).toBe("#1a2b3c");
    expect(pageIn(saved, "back").backgroundColor).toBe("#2e3192");
    await page.reload();
    await openStudio(page, [], false);
    await expect.poll(() => canvasBackground(page)).toBe("#1a2b3c");
    await goToPage(page, "Back");
    await expect.poll(() => canvasBackground(page)).toBe("#2e3192");
  });

  test("Upload Image and search set the page's background image through the asset library; Undo, save and reload", async ({ page }) => {
    const confetti = libraryAsset("Gold confetti", "background");
    const family = libraryAsset("Family photo", "image");
    const uploads: any[] = [];
    await openStudio(page, [confetti, family]);
    await answerUploads(page, uploads);
    const panel = await openSidePanel(page, "Background");

    // Search: background images only, by name.
    await panel.getByRole("searchbox", { name: "Search for backgrounds" }).fill("family");
    await expect(panel.locator("[data-background-results]")).toContainText("No background images match");
    await panel.getByRole("searchbox", { name: "Search for backgrounds" }).fill("gold");
    await panel.getByRole("button", { name: "Use Gold confetti as the background" }).click();
    let saved = await savedTemplate(page);
    expect(pageIn(saved, "front").backgroundAssetId).toBe(confetti.id);
    await expect(panel.getByRole("button", { name: "Replace Image" })).toBeVisible();

    // Upload: the real flow, as a "background" asset; one undo step.
    await panel.getByLabel("Background image file").setInputFiles(PNG);
    await expect.poll(() => uploads.length).toBe(1);
    saved = await savedTemplate(page);
    expect(pageIn(saved, "front").backgroundAssetId).toBe(uploads[0].id);
    expect(uploads[0].assetType).toBe("background");
    await page.keyboard.press("Control+z");
    saved = await savedTemplate(page);
    expect(pageIn(saved, "front").backgroundAssetId).toBe(confetti.id);
    await page.keyboard.press("Control+y");
    saved = await savedTemplate(page);
    expect(pageIn(saved, "front").backgroundAssetId).toBe(uploads[0].id);
    expect(pageIn(saved, "back").backgroundAssetId || "").toBe("");
    // The canvas draws it, by its asset identity.
    await expect(studio(page).locator("[data-canvas-surface] svg image").first()).toBeAttached();
    await shot(page, "background-image");

    await page.reload();
    await openStudio(page, [confetti, family, ...uploads], false);
    const reopened = await openSidePanel(page, "Background");
    await expect(reopened.getByRole("button", { name: "Replace Image" })).toBeVisible();
    await reopened.getByRole("button", { name: "Remove background image" }).click();
    saved = await savedTemplate(page);
    expect(pageIn(saved, "front").backgroundAssetId || "").toBe("");
  });
});

test.describe("Uploads panel", () => {
  test("the library's real images; a click adds the asset to the current page, selected, with the image toolbar; Undo, Redo", async ({ page }) => {
    const assets = [libraryAsset("Beach"), libraryAsset("Portrait"), libraryAsset("Monogram")];
    await openStudio(page, assets);
    const panel = await openSidePanel(page, "Uploads");
    await expect(panel.getByRole("heading", { name: "Uploads" })).toBeVisible();
    await expect(panel).toContainText("Click an image below to add it to your design, or use the media manager to browse your image library.");
    await expect(panel.getByRole("button", { name: "Upload from computer" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Upload from your phone" })).toBeVisible();
    await expect(panel.locator("[data-upload-tile]")).toHaveCount(3);
    await expect.poll(() => panel.locator("[data-upload-tile] img").first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await shot(page, "uploads-panel");

    await panel.getByRole("button", { name: "Add Portrait to the current page" }).click();
    await expect.poll(async () => (await selectedIds(page)).length).toBe(1);
    await expect(page.locator("[data-admin-toolbar]").getByRole("button", { name: "Crop photo" })).toBeEnabled();
    let saved = await savedTemplate(page);
    const inserted = saved.layers.find((layer: any) => layer.assetId === assets[1].id);
    // The asset, by its identity and full-quality paths — never the thumbnail.
    expect(inserted).toMatchObject({ page: "front", type: "image", originalPath: assets[1].originalPath, editorPath: assets[1].editorPath });
    expect(JSON.stringify(inserted)).not.toContain("/thumbnail.png");

    await page.keyboard.press("Control+z");
    saved = await savedTemplate(page);
    expect(saved.layers.some((layer: any) => layer.assetId === assets[1].id)).toBe(false);
    await page.keyboard.press("Control+y");
    saved = await savedTemplate(page);
    expect(saved.layers.some((layer: any) => layer.assetId === assets[1].id)).toBe(true);

    // Crop opens on the inserted picture.
    await page.locator("[data-admin-toolbar]").getByRole("button", { name: "Crop photo" }).click();
    await expect(studio(page).getByRole("button", { name: /^(Done|Apply)/ }).first()).toBeVisible();
  });

  test("Upload from computer goes through the shared pipeline, lands in the grid and on the page; save and reload keep it", async ({ page }) => {
    const uploads: any[] = [];
    await openStudio(page, [libraryAsset("Beach")]);
    await answerUploads(page, uploads);
    const panel = await openSidePanel(page, "Uploads");
    await panel.getByLabel("Images to upload").setInputFiles(PNG);
    await expect.poll(() => uploads.length).toBe(1);
    await expect(panel.locator("[data-upload-tile]")).toHaveCount(2);
    await expect(panel.locator("[data-upload-tile]").first()).toHaveAccessibleName(`Add ${uploads[0].title} to the current page`);
    await expect.poll(async () => (await selectedIds(page)).length).toBe(1);
    const saved = await savedTemplate(page);
    expect(saved.layers.find((layer: any) => layer.assetId === uploads[0].id)).toMatchObject({ page: "front" });
    await page.reload();
    await openStudio(page, [uploads[0], libraryAsset("Beach")], false);
    const again = await savedTemplate(page);
    expect(again.layers.some((layer: any) => layer.assetId === uploads[0].id)).toBe(true);
  });

  test("the media manager browses the same library and inserts from it; Back-page insertion stays on Back", async ({ page }) => {
    const assets = [libraryAsset("Beach"), libraryAsset("Portrait")];
    await openStudio(page, assets);
    await goToPage(page, "Back");
    const panel = await openSidePanel(page, "Uploads");
    await panel.getByRole("button", { name: "media manager" }).click();
    const manager = page.getByRole("dialog", { name: "Media manager" });
    await expect(manager).toBeVisible();
    await expect(manager.getByRole("searchbox")).toBeVisible();
    await shot(page, "media-manager");
    await manager.getByRole("button", { name: "Add Beach to the current page" }).click();
    await expect(manager).toHaveCount(0);
    const saved = await savedTemplate(page);
    expect(saved.layers.find((layer: any) => layer.assetId === assets[0].id)).toMatchObject({ page: "back" });
  });

  test("Upload from your phone: a QR handoff to the admin phone page; photos sent arrive and insert", async ({ page }) => {
    await openStudio(page, [libraryAsset("Beach")]);
    const panel = await openSidePanel(page, "Uploads");
    await panel.getByRole("button", { name: "Upload from your phone" }).click();
    const dialog = page.getByRole("dialog", { name: "Upload from your phone" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-phone-upload-qr]")).toHaveAttribute("data-phone-upload-qr", /\/upload-from-phone$/);
    await expect(dialog).toContainText("Waiting for photos from your phone");
    await shot(page, "phone-upload");
    // The phone's upload lands in the library (what the phone page does).
    const fromPhone = libraryAsset("Phone photo");
    await page.waitForTimeout(500);
    await page.evaluate((entry) => (window as any).__adminFixture.assets.unshift(entry), fromPhone);
    await expect(dialog.getByRole("button", { name: "Add Phone photo to the current page" })).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole("button", { name: "Add Phone photo to the current page" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(panel.locator("[data-upload-tile]").first()).toHaveAccessibleName("Add Phone photo to the current page");
    const saved = await savedTemplate(page);
    expect(saved.layers.some((layer: any) => layer.assetId === fromPhone.id)).toBe(true);
  });

  test("the phone page: a signed-out phone is sent to sign in and back", async ({ page }) => {
    const response = await page.goto("/upload-from-phone");
    expect(page.url()).toContain("/login?next=%2Fupload-from-phone");
    expect(response?.ok()).toBe(true);
  });
});
