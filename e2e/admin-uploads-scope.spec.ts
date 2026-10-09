/**
 * Uploads lists only what an admin or designer uploaded (designer report,
 * 2026-10-09): an icon or element placed on a design must not appear there.
 *
 * Runs the real studio on /__e2e/admin-dashboard. The library holds an
 * uploaded photo, an uploaded SVG, an Iconify icon imported when it was placed
 * on a design, an uploaded element and a background. The fixture's asset list
 * applies the same `scope` rule as GET /api/admin/customizer/assets
 * (lib/customizer/asset-scopes.ts).
 */
import { expect, test, type Page } from "@playwright/test";
import { openSidePanel } from "./admin-studio-tools";
import { AssetStub, assetUrl } from "./asset-reliability-stub";
import { bodyPoint } from "./customizer-fixture";

const TITLE = "Minimal Thank You Card";
const TEMPLATE = {
  enabled: true, cardWidthIn: 5, cardHeightIn: 7, dpi: 300, canvasWidthPx: 1500, canvasHeightPx: 2100,
  pages: [{ id: "front", label: "Front", enabled: true }], defaultPage: "front", fields: [], guides: [],
  layers: [{ id: "t_front", page: "front", type: "text", name: "Text", text: "wedding", x: 750, y: 700, width: 420, height: 90, zIndex: 1, textStyle: { fontFamily: "Inter", fontSize: 70.83 } }],
};

test.beforeEach(async ({ context }) => {
  const stub = new AssetStub();
  stub.ttlMs = 600_000;
  await stub.install(context);
});

let serial = 0;
function asset(title: string, assetType: string, extra: Record<string, unknown> = {}) {
  serial += 1;
  const expiresAt = Date.now() + 600_000;
  const id = `7d7d7d7d-0000-4000-8000-${String(Date.now() % 1e8).padStart(8, "0")}${String(serial).padStart(4, "0")}`;
  return {
    id, title, displayName: title, originalFilename: `${title}.png`, assetType, bucket: "customizer-elements",
    originalPath: `assets/${id}/original/a.png`, editorPath: `assets/${id}/editor/a.webp`, thumbnailPath: `assets/${id}/thumbnail/a.webp`,
    url: assetUrl(id, "editor", expiresAt, serial), editorUrl: assetUrl(id, "editor", expiresAt, serial),
    originalUrl: assetUrl(id, "original", expiresAt, serial), thumbnailUrl: assetUrl(id, "thumbnail", expiresAt, serial),
    expiresAt: new Date(expiresAt).toISOString(),
    mimeType: "image/png", width: 2000, height: 1500, status: "ready", adminAvailable: true, archived: false, createdAt: new Date().toISOString(),
    ...extra,
  };
}

const LIBRARY = [
  asset("Couple photo", "image"),
  asset("THE WEDDING OF", "image", { mimeType: "image/svg+xml" }),
  asset("Heart", "svg", { sourceProvider: "iconify", sourceKey: "mdi:heart", mimeType: "image/svg+xml", width: 12, height: 12 }),
  asset("Floral sprig element", "element"),
  asset("Linen background", "background"),
];

const studio = (page: Page) => page.locator("[data-admin-customizer]");
const uploadTile = (page: Page, title: string) => page.getByRole("button", { name: `Add ${title} to the current page` });
const elementTile = (page: Page, title: string) => studio(page).getByRole("button", { name: `Insert ${title}`, exact: true });

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
  await page.evaluate((entries) => ((window as any).__adminFixture.assets = entries), LIBRARY);
  await page.getByRole("button", { name: `Edit ${TITLE}` }).first().click();
  const enable = page.getByRole("switch", { name: /Enable product customizer/ });
  await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
  if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
  await page.getByRole("button", { name: "Open Design Studio" }).click();
  await expect(studio(page).locator("header")).toBeVisible();
  await expect.poll(() => bodyPoint(page, "t_front").then(() => true, () => false)).toBe(true);
}

test.describe("Uploads lists only uploaded pictures", () => {
  test("icons and elements stay out of Uploads and appear in Elements instead", async ({ page }) => {
    await openStudio(page);

    await openSidePanel(page, "Uploads");
    await expect(uploadTile(page, "Couple photo")).toBeVisible({ timeout: 15_000 });
    await expect(uploadTile(page, "THE WEDDING OF")).toBeVisible();
    await expect(uploadTile(page, "Heart")).toHaveCount(0);
    await expect(uploadTile(page, "Floral sprig element")).toHaveCount(0);
    await expect(uploadTile(page, "Linen background")).toHaveCount(0);

    await openSidePanel(page, "Elements");
    await expect(elementTile(page, "Heart")).toBeVisible({ timeout: 15_000 });
    await expect(elementTile(page, "Floral sprig element")).toBeVisible();
    await expect(elementTile(page, "Couple photo")).toHaveCount(0);
    await expect(elementTile(page, "Linen background")).toHaveCount(0);
  });
});
