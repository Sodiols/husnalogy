import { expect, test } from "@playwright/test";

/**
 * The Next.js image optimizer serves this project's public catalogue images
 * and refuses everything else (private buckets, signed URLs, query strings,
 * other hosts). Read-only: it fetches public product images only.
 */
test("public catalogue images are optimized; private, signed and foreign sources are refused", async ({ page, request }) => {
  await page.goto("/products");
  const src = await page.locator("img[src*='/_next/image?url=']").first().getAttribute("src", { timeout: 30_000 });
  test.skip(!src, "No optimized product image on /products (empty catalogue).");
  const optimized = await request.get(src!);
  expect(optimized.status()).toBe(200);
  expect(optimized.headers()["content-type"]).toMatch(/^image\/(avif|webp|png|jpeg)/);
  expect(optimized.headers()["content-disposition"] || "").toMatch(/^attachment/);

  const original = new URL(decodeURIComponent(new URL(src!, "http://x").searchParams.get("url") || ""));
  expect(original.pathname).toMatch(/^\/storage\/v1\/object\/public\/(product-images|product-mockups|site-assets)\//);
  const host = original.origin;
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
