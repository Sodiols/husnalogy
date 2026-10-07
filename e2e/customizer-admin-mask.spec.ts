/**
 * A Design Studio clipping mask, in the real customer editor (mask matrix
 * tests 26–28): the published template's clip renders the same outline, a
 * customer-editable clipped photo can be replaced and cropped without losing
 * its mask, and a locked clip is shown but not editable.
 *
 * `?adminClip=1` builds both clips with the studio's own `applyClippingMask`.
 * Uploading needs a signed-in customer, so this runs against the stubbed
 * Supabase server (see e2e/customer-stub.ts):
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 E2E_FRESH_SERVER=1 E2E_PORT=3105
 */
import { expect, test, type Page } from "@playwright/test";
import { getMaskPath } from "../lib/customizer/v2/masks";
import { bodyPoint, canvasLayer, cropDrawBox, enterCrop, openFixture, panCrop, readDraft, selectLayer } from "./customizer-fixture";
import { STUB_PHOTO_URL, StubCustomizationServer, signInStubCustomer, supabaseIsStubbed } from "./customer-stub";

const QUERY = "?adminClip=1&snap=0";

const CIRCLE = { x: 480, y: 760, width: 480, height: 480 };
const ROUNDED = { x: 1030, y: 760, width: 400, height: 500 };
const maskD = (mask: any, box: typeof CIRCLE) =>
  getMaskPath(mask, { x: box.x - box.width / 2, y: box.y - box.height / 2, width: box.width, height: box.height }).d;

/** What the customer canvas draws for a photo: its clip, rotation and picture. */
const drawn = (page: Page, id: string) =>
  page.evaluate((layerId) => {
    const group = document.querySelector(`[data-customizer-canvas="main"] [data-layer-id="${layerId}"]`);
    return {
      clip: group?.querySelector("clipPath path")?.getAttribute("d") || "",
      rotate: group?.querySelector("g[transform^='rotate']")?.getAttribute("transform") || "",
      href: group?.querySelector("image")?.getAttribute("href") || "",
    };
  }, id);

test.describe("Design Studio clips in the customer editor", () => {
  test.skip(!supabaseIsStubbed, "Needs the stubbed Supabase server: NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 E2E_FRESH_SERVER=1 E2E_PORT=3105");

  test.beforeEach(async ({ page, context, baseURL }) => {
    const server = new StubCustomizationServer();
    await server.install(context);
    await signInStubCustomer(context, baseURL || "http://127.0.0.1:3000");
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFixture(page, QUERY);
  });

  test("the published clips render with the studio's outline and rotation", async ({ page }) => {
    // The shapes were consumed by the mask; only the clipped photos remain.
    await expect(canvasLayer(page, "fx_clip_circle")).toHaveCount(0);
    await expect(canvasLayer(page, "fx_clip_rounded")).toHaveCount(0);
    expect((await drawn(page, "fx_photo_crop")).clip).toBe(maskD({ kind: "oval" }, CIRCLE));
    const rounded = await drawn(page, "fx_photo_no_crop");
    expect(rounded.clip).toBe(maskD({ kind: "rounded", radius: 60 }, ROUNDED));
    expect(rounded.rotate).toContain("rotate(8 ");
  });

  test("replacing the customer-editable clipped photo keeps the mask", async ({ page }) => {
    const before = await drawn(page, "fx_photo_crop");
    await page.locator("[data-customizer-root]").getByRole("button", { name: /Photos|Uploads/ }).first().click();
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
    await page.locator("[data-customizer-root] input[type='file']").first().setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
    await expect.poll(async () => (await drawn(page, "fx_photo_crop")).href, { timeout: 15_000 }).toBe(STUB_PHOTO_URL);
    expect((await drawn(page, "fx_photo_crop")).clip).toBe(before.clip);
  });

  test("cropping the customer-editable clipped photo moves the picture, never the mask", async ({ page }) => {
    const clip = (await drawn(page, "fx_photo_crop")).clip;
    const box = await cropDrawBox(page, "fx_photo_crop");
    const surface = await enterCrop(page, "fx_photo_crop");
    await panCrop(page, surface, 70, 0);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(surface).toHaveCount(0);
    await expect.poll(() => cropDrawBox(page, "fx_photo_crop")).not.toEqual(box);
    expect((await drawn(page, "fx_photo_crop")).clip).toBe(clip);

    // A refresh restores the crop inside the same mask.
    const cropped = await cropDrawBox(page, "fx_photo_crop");
    await expect.poll(() => readDraft(page, "e2e-fixture-template-admin-clip").then(Boolean)).toBe(true);
    await page.reload();
    await expect(canvasLayer(page, "fx_photo_crop")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => cropDrawBox(page, "fx_photo_crop"), { timeout: 15_000 }).toEqual(cropped);
    expect((await drawn(page, "fx_photo_crop")).clip).toBe(clip);
  });

  test("the locked clip is shown but cannot be cropped", async ({ page }) => {
    await selectLayer(page, "fx_photo_no_crop").catch(() => undefined);
    const point = await bodyPoint(page, "fx_photo_no_crop").catch(() => null);
    if (point) await page.mouse.dblclick(point.x, point.y);
    await page.waitForTimeout(600);
    await expect(page.getByRole("application", { name: /crop photo/i })).toHaveCount(0);
    expect((await drawn(page, "fx_photo_no_crop")).clip).toBe(maskD({ kind: "rounded", radius: 60 }, ROUNDED));
  });
});
