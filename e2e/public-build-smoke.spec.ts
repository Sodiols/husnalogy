import { expect, test } from "@playwright/test";

test("local-font login shell is responsive and makes no Google Font request", async ({ page }) => {
  const remoteFontRequests: string[] = [];
  page.on("request", (request) => {
    if (/fonts\.(googleapis|gstatic)\.com/i.test(request.url())) remoteFontRequests.push(request.url());
  });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /Login with your email/i })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe("loaded");
  expect(remoteFontRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("button", { name: "Login", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});
