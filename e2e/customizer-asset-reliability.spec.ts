/**
 * P0 image reliability in the CUSTOMER editor: a published template's library
 * photo goes through the same runtime resolver as the Design Studio — renewed
 * before expiry, re-signed when stale — with the product named so the server
 * can authorize it, and never at the cost of the customer's design.
 */
import { expect, test, type Page } from "@playwright/test";
import { openFixture, readDraft } from "./customizer-fixture";
import { AssetStub, urlExpiry } from "./asset-reliability-stub";

const ASSET = "8b3e3e70-5d4c-4b9a-9c32-2e6c4d9f1a33";

const drawn = (page: Page) =>
  page.evaluate(() => {
    const image = document.querySelector('[data-customizer-canvas="main"] [data-layer-id="fx_photo_crop"] image');
    return { href: image?.getAttribute("href") || "", status: image?.getAttribute("data-image-status") || "" };
  });

/** The customer's design, without volatile bookkeeping. */
const design = async (page: Page) => {
  const draft = await readDraft(page, "e2e-fixture-template-library-asset");
  return draft ? JSON.stringify({ values: draft.values, editorState: draft.renderData?.editorState }) : "";
};

let stub: AssetStub;
test.beforeEach(async ({ context, page }) => {
  stub = new AssetStub();
  await stub.install(context);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test.describe("customer editor image reliability", () => {
  test("an expired template photo URL is re-signed for this product", async ({ page }) => {
    await openFixture(page, "?snap=0&libraryAsset=-60000");
    await expect.poll(async () => (await drawn(page)).status).toBe("ready");
    expect(urlExpiry((await drawn(page)).href)).toBeGreaterThan(Date.now());
    const request = stub.signRequests.find((entry) => entry.assets.some((asset) => asset.assetId === ASSET));
    expect(request?.productId).toBe("e2e-fixture-product");
    // Customers are only ever asked to receive the editor variant.
    expect(stub.signRequests.every((entry) => entry.assets.every((asset) => asset.variant === "editor"))).toBe(true);
  });

  test("a long customer session renews the photo in the background without touching the design", async ({ page }) => {
    stub.ttlMs = 8_000;
    await openFixture(page, "?snap=0&libraryAsset=8000");
    await expect.poll(async () => (await drawn(page)).status).toBe("ready");
    const before = await design(page);
    const hrefs = new Set<string>();
    const end = Date.now() + 20_000;
    while (Date.now() < end) {
      const state = await drawn(page);
      expect(state.href).not.toBe("");
      expect(urlExpiry(state.href)).toBeGreaterThan(Date.now() - 1500);
      hrefs.add(state.href);
      await page.waitForTimeout(400);
    }
    expect(hrefs.size).toBeGreaterThanOrEqual(3);
    expect(await design(page)).toBe(before);
    expect(stub.imageRequests.filter((path) => path.endsWith("/thumbnail.png"))).toEqual([]);
  });

  test("a thumbnail-sized editor variant is reported for repair; the customer never receives the original", async ({ page }) => {
    stub.editorMode = "tiny";
    await openFixture(page, "?snap=0&libraryAsset=60000");
    await expect.poll(() => stub.signRequests.some((entry) => entry.reason === "editor-low-res")).toBe(true);
    // The best picture this customer may have stays on screen.
    await expect.poll(async () => (await drawn(page)).status).toBe("ready");
    expect((await drawn(page)).href).toContain("/editor.png");
    expect(stub.signRequests.every((entry) => entry.assets.every((asset) => asset.variant === "editor"))).toBe(true);
  });
});
