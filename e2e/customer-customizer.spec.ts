import { join } from "path";
import { expect, test } from "@playwright/test";
import { customerCredentials, login, requireSeededAcceptance, seedManifest } from "./helpers";

const customizerUrl = process.env.E2E_CUSTOMIZER_URL || seedManifest.customizerUrl || "";
requireSeededAcceptance([["E2E_CUSTOMIZER_URL", customizerUrl], ["customer email", customerCredentials.email], ["customer password", customerCredentials.password]]);

test.describe("seeded customer Customizer V2 journey", () => {
  test("desktop edit, upload, grid crop, history, restore, review and cart", async ({ page }) => {
    await login(page, customerCredentials.email, customerCredentials.password, customizerUrl);
    await page.goto(customizerUrl);
    const root = page.locator("[data-customizer-root]");
    await expect(root).toBeVisible();

    const editableText = root.locator('input[type="text"]:visible, textarea:visible').first();
    await expect(editableText).toBeVisible();
    const restoredText = `Playwright ${Date.now()}`;
    await editableText.fill(restoredText);

    const textLayer = root.locator('[data-canvas-layer]').filter({ has: page.locator("text") }).first();
    if (await textLayer.count()) await textLayer.click();
    const fontControl = root.getByRole("button", { name: /font family/i }).first();
    if (await fontControl.count()) {
      await fontControl.click();
      await page.getByRole("option").first().click();
    }

    await root.getByRole("button", { name: "Uploads", exact: true }).first().click();
    const upload = root.locator('input[type="file"]').first();
    await upload.setInputFiles(join(process.cwd(), "public", "images", "weddings", "invitations", "collection1.png"));
    await expect(root.getByText(/Uploading|Great quality|Good quality|Replace photo/i).first()).toBeVisible({ timeout: 30_000 });

    const firstGridSlot = root.getByRole("button", { name: /Select photo grid slot 1/i }).first();
    await expect(firstGridSlot, "The E2E product must contain a customer-editable grid").toBeVisible();
    await firstGridSlot.click();
    await expect(root.getByRole("button", { name: "Replace", exact: true })).toBeVisible();
    await root.locator('input[type="file"]').last().setInputFiles(join(process.cwd(), "public", "images", "weddings", "invitations", "collection1.png"));
    await root.getByRole("button", { name: "Crop", exact: true }).click();
    await root.getByRole("button", { name: "Zoom in" }).click();
    await root.getByRole("button", { name: "Rotate", exact: true }).click();
    await root.getByRole("button", { name: "Done", exact: true }).click();

    await root.getByRole("button", { name: "Undo" }).first().click();
    await root.getByRole("button", { name: "Redo" }).first().click();
    await root.getByRole("button", { name: /Save & Exit/i }).first().click();
    await page.goto(customizerUrl);
    await expect(page.locator("[data-customizer-root]")).toBeVisible();
    await expect(page.locator("[data-customizer-root]").locator('input[type="text"]:visible, textarea:visible').first()).toHaveValue(restoredText);

    await page.getByRole("button", { name: /Next: Review/i }).click();
    await expect(page.getByRole("heading", { name: /review/i })).toBeVisible();
    const approval = page.locator('input[type="checkbox"]').last();
    if (await approval.count()) await approval.check();
    await page.getByRole("button", { name: /Add to cart|Update cart/i }).click();
    await expect(page).toHaveURL(/\/cart/);
  });

  test("mobile bottom navigation and touch-compatible crop controls", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, customerCredentials.email, customerCredentials.password, customizerUrl);
    await page.goto(customizerUrl);
    const root = page.locator("[data-customizer-root]");
    await expect(root.getByRole("toolbar", { name: "Customizer tools" })).toBeVisible();
    await root.getByRole("button", { name: "Edit", exact: true }).click();
    await root.getByRole("button", { name: "Uploads", exact: true }).click();
    const gridSlot = root.getByRole("button", { name: /Select photo grid slot/i }).first();
    if (await gridSlot.count()) {
      await gridSlot.tap();
      const crop = root.getByRole("button", { name: "Crop", exact: true });
      if (await crop.isEnabled()) {
        await crop.tap();
        await root.getByRole("button", { name: "Zoom in" }).tap();
        await root.getByRole("button", { name: "Done", exact: true }).tap();
      }
    }
    await root.getByRole("button", { name: /Next: Review/i }).tap();
    await expect(root.getByRole("button", { name: "Design", exact: true })).toBeVisible();
  });
});
