import { expect, test, type Page } from "@playwright/test";

/**
 * The Next.js image optimizer serves this project's public catalogue images
 * and refuses everything else (private buckets, signed URLs, query strings,
 * other hosts). Read-only: it fetches public product images only.
 *
 * The refusals need no data and always run. Serving a real catalogue image
 * needs a real catalogue (staging): the default local run serves none
 * (playwright.config.ts, stub mode), and the optimizer by design never fetches
 * from a local address. The configuration itself is unit-tested in
 * lib/security/__tests__/image-config.test.ts.
 */

const CATALOGUE_IMAGE = "img[src*='/_next/image?url='][src*='%2Fstorage%2Fv1%2Fobject%2Fpublic%2F']";

/** An optimized, storage-hosted catalogue image on /products, if the catalogue has one. */
async function catalogueImage(page: Page): Promise<string | null> {
  await page.goto("/products");
  await page.waitForLoadState("networkidle");
  // Local /images files are optimized too; this spec is about storage-hosted ones.
  const image = page.locator(CATALOGUE_IMAGE).first();
  return (await image.count()) ? image.getAttribute("src") : null;
}

/** The configured Supabase origin as the optimizer would see a storage URL on it. */
function storageOrigin(src: string | null): string {
  if (src) return new URL(decodeURIComponent(new URL(src, "http://x").searchParams.get("url") || "")).origin;
  return `https://${new URL(String(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://project.supabase.co")).host}`;
}

test("private buckets, signed URLs, query strings and foreign hosts are refused by the optimizer", async ({ page, request }) => {
  const host = storageOrigin(await catalogueImage(page));
  for (const refused of [
    `${host}/storage/v1/object/public/customer-uploads/x/original.jpg`,
    `${host}/storage/v1/object/sign/order-production/orders/x/assets/y?token=abc`,
    `${host}/storage/v1/object/public/product-images/x.png?v=1`,
    "https://example.com/storage/v1/object/public/product-images/x.png",
    "http://127.0.0.1/storage/v1/object/public/product-images/x.png",
  ]) {
    const response = await request.get(`/_next/image?url=${encodeURIComponent(refused)}&w=640&q=75`);
    expect(response.status(), refused).toBe(400);
  }
});

test("public catalogue images are optimized", async ({ page, request }) => {
  const src = await catalogueImage(page);
  test.skip(!src, "Needs a real catalogue with a storage-hosted product image (run against staging: npm run test:e2e:staging).");
  const optimized = await request.get(src!);
  expect(optimized.status()).toBe(200);
  expect(optimized.headers()["content-type"]).toMatch(/^image\/(avif|webp|png|jpeg)/);
  expect(optimized.headers()["content-disposition"] || "").toMatch(/^attachment/);
  const original = new URL(decodeURIComponent(new URL(src!, "http://x").searchParams.get("url") || ""));
  expect(original.pathname).toMatch(/^\/storage\/v1\/object\/public\/(product-images|product-mockups|site-assets)\//);
});
