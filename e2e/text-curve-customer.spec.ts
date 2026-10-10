/**
 * Text curve in the customer customizer: a designer's curve stays a curve while
 * the customer personalises the wording, is selected by its drawn arc, and is
 * what the Review step shows. Runs the real PersonalizeClient on
 * /__e2e/customizer, whose ?curve= bends the editable title.
 */
import { expect, test } from "@playwright/test";
import { openFixture, selectLayer } from "./customizer-fixture";

test.use({ viewport: { width: 1440, height: 900 } });

const curved = (page: import("@playwright/test").Page) => page.locator('[data-layer-id="fx_title"] [data-text-curve]').first();

test("the customer's wording follows the designer's curve, live and in Review", async ({ page }) => {
  await openFixture(page, "?curve=55&snap=0");
  await expect(curved(page)).toHaveAttribute("data-text-curve", "55");
  await expect(curved(page).locator("textPath")).toHaveText("Alex & Jordan");

  await page.getByLabel("Guest name").fill("Amira & Yusuf Rahman");
  await expect(curved(page).locator("textPath")).toHaveText("Amira & Yusuf Rahman");
  await expect(curved(page)).toHaveAttribute("data-text-curve", "55");
  expect(await curved(page).innerHTML()).not.toMatch(/NaN|Infinity/);

  // Selected by its arc: no straight-box overflow warning, and the text toolbar opens.
  await selectLayer(page, "fx_title");
  await expect(page.locator("[data-customer-text-toolbar]")).toBeVisible();
  await expect(page.getByText("This text is too long for the available space.")).toHaveCount(0);

  // Review draws the same curve.
  await page.getByRole("button", { name: "Review", exact: true }).first().click();
  await expect(page.locator("[data-text-curve] textPath").filter({ hasText: "Amira & Yusuf Rahman" }).first()).toBeVisible();
});
