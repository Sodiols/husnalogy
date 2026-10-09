/**
 * The Customer Customizer warns, in plain language, when a photo would print
 * blurry at its size — and only then (docs/PRINT_QUALITY_AUDIT.md D5).
 *
 * Real customizer on /__e2e/customizer with the stub upload: the fixture's
 * photo frame is 560 × 560 px at 300 DPI. A 400 × 300 photo cover-fitted into
 * it prints at about 161 PPI (below the 200 PPI default); a 4000 × 3000 photo
 * at about 1607 PPI.
 */
import { expect, test, type Page } from "@playwright/test";
import { openFixture } from "./customizer-fixture";
import { StubCustomizationServer, signInStubCustomer, STUB_USER_ID } from "./customer-stub";

const MESSAGE = "Your photo may look blurry when printed at this size";
const warning = (page: Page) => page.locator("[data-photo-quality-warning]");

async function uploadPhoto(page: Page) {
  await page.locator("[data-customizer-root]").getByRole("button", { name: /Photos|Uploads/ }).first().click();
  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
  await page.locator("[data-customizer-root] input[type='file']").first().setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
}

test.describe("photo print-quality warning", () => {
  let server: StubCustomizationServer;
  test.beforeEach(async ({ context, page, baseURL }) => {
    server = new StubCustomizationServer();
    await server.install(context);
    await signInStubCustomer(context, baseURL || "http://127.0.0.1:3000");
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("a small photo shows the warning; nothing is shown before", async ({ page }) => {
    await openFixture(page, "?autosave=1&snap=0");
    await expect(warning(page)).toHaveCount(0);
    await uploadPhoto(page);
    await expect(warning(page)).toBeVisible({ timeout: 15_000 });
    await expect(warning(page)).toContainText(MESSAGE);
  });

  test("a large enough photo shows no warning", async ({ context, page }) => {
    // Registered after the stub, so it answers the upload (latest route wins).
    await context.route("**/api/customizer/upload", (route) =>
      route.fulfill({
        json: {
          ok: true,
          file: {
            assetId: "asset-big", ownerId: STUB_USER_ID, bucket: "customer-uploads",
            path: `${STUB_USER_ID}/customizer/editor-big.png`, originalPath: `${STUB_USER_ID}/customizer/original-big.png`,
            name: "big.png", type: "image/png", size: 1024, width: 4000, height: 3000,
            url: "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'/%3E",
            signedUrl: "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'/%3E",
            assetReference: {
              version: 1, assetId: "asset-big", ownerId: STUB_USER_ID, bucket: "customer-uploads",
              storagePath: `${STUB_USER_ID}/customizer/original-big.png`, editorStoragePath: `${STUB_USER_ID}/customizer/editor-big.png`,
              originalFileName: "big.png", mimeType: "image/png", fileSize: 1024, width: 4000, height: 3000, createdAt: "2026-10-09T00:00:00.000Z",
            },
          },
        },
      }),
    );
    await openFixture(page, "?autosave=1&snap=0");
    await uploadPhoto(page);
    await expect.poll(() => JSON.stringify([...server.rows.values()].map((row) => row.values || {})), { timeout: 15_000 }).toContain("asset-big");
    await page.waitForTimeout(500);
    await expect(warning(page)).toHaveCount(0);
  });
});
