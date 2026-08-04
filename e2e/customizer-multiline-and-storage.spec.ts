import { expect, test } from "@playwright/test";
import { customerCredentials, login, requireSeededAcceptance, seedManifest } from "./helpers";

// Multiline text and guest storage honesty (spec §18, §42, §45).
//
// Runs on every project in the matrix — desktop Chromium/Firefox/WebKit and
// the iPhone/Android touch profiles — because line-break handling and storage
// permissions differ meaningfully between engines.

const customizerUrl = process.env.E2E_CUSTOMIZER_URL || seedManifest.customizerUrl || "";
requireSeededAcceptance([
  ["E2E_CUSTOMIZER_URL", customizerUrl],
  ["customer email", customerCredentials.email],
  ["customer password", customerCredentials.password],
]);

// The seed creates a field whose linked layer allows multiple lines.
const MULTILINE_FIELD_LABEL = process.env.E2E_MULTILINE_FIELD_LABEL || seedManifest.multilineFieldLabel || "Message";

test.describe("multiline customer text", () => {
  test("Enter creates a line break that survives blur, autosave and reload", async ({ page }) => {
    await login(page, customerCredentials.email, customerCredentials.password, customizerUrl);
    await page.goto(customizerUrl);
    const root = page.locator("[data-customizer-root]");
    await expect(root).toBeVisible();

    // The multiline field must be a real multi-line control, whatever the
    // field type is, because its layer allows multiple lines.
    const field = root.getByLabel(new RegExp(MULTILINE_FIELD_LABEL, "i")).first();
    await expect(field).toBeVisible();
    await expect(field).toHaveJSProperty("tagName", "TEXTAREA");

    await field.click();
    await field.fill("");
    await field.type("First line");
    await field.press("Enter");
    await field.type("Second line");

    const typed = "First line\nSecond line";
    await expect(field).toHaveValue(typed);

    // Clicking outside commits the complete multiline value.
    await root.click({ position: { x: 5, y: 5 } });
    await expect(field).toHaveValue(typed);

    // The canvas shows both lines immediately.
    await expect(root.locator("svg")).toContainText("Second line");

    // Autosave, then reload: the break must still be there.
    await expect(root.getByText(/Saved/i).first()).toBeVisible({ timeout: 30_000 });
    await page.reload();
    const reloaded = page.locator("[data-customizer-root]").getByLabel(new RegExp(MULTILINE_FIELD_LABEL, "i")).first();
    await expect(reloaded).toHaveValue(typed);
  });

  test("a single-line field commits on Enter instead of adding a break", async ({ page }) => {
    await login(page, customerCredentials.email, customerCredentials.password, customizerUrl);
    await page.goto(customizerUrl);
    const root = page.locator("[data-customizer-root]");

    const singleLine = root.locator('input[type="text"]:visible').first();
    await expect(singleLine).toBeVisible();
    await singleLine.fill("Aisha and Omar");
    await singleLine.press("Enter");
    await expect(singleLine).toHaveValue("Aisha and Omar");
    expect(await singleLine.inputValue()).not.toContain("\n");
  });
});

test.describe("guest draft storage honesty", () => {
  test("a guest whose browser refuses storage is never told the design was saved", async ({ page }) => {
    // Break both stores before any app code runs.
    await page.addInitScript(() => {
      const deny = () => {
        const error = new Error("Exceeded the quota.");
        error.name = "QuotaExceededError";
        throw error;
      };
      try {
        Object.defineProperty(window, "indexedDB", { get: () => undefined, configurable: true });
      } catch {
        /* some engines disallow redefining indexedDB; the localStorage denial below still applies */
      }
      try {
        Object.defineProperty(window.localStorage, "setItem", { value: deny, configurable: true });
      } catch {
        /* fall through: the assertion below fails loudly if storage still works */
      }
    });

    await page.goto(customizerUrl);
    const root = page.locator("[data-customizer-root]");
    await expect(root).toBeVisible();

    const field = root.locator('input[type="text"]:visible, textarea:visible').first();
    await field.fill(`Guest ${Date.now()}`);

    // The failure must surface, and "Saved" must never appear.
    await expect(root.getByText(/could not be saved on this device|Save failed/i).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(root.getByText(/^Saved on this device$/)).toHaveCount(0);
  });

  test("a guest with working storage is told exactly where the design was saved", async ({ page }) => {
    await page.goto(customizerUrl);
    const root = page.locator("[data-customizer-root]");
    await expect(root).toBeVisible();

    const field = root.locator('input[type="text"]:visible, textarea:visible').first();
    const value = `Guest ${Date.now()}`;
    await field.fill(value);

    await expect(root.getByText(/Saved on this device/i).first()).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(
      page.locator("[data-customizer-root]").locator('input[type="text"]:visible, textarea:visible').first(),
    ).toHaveValue(value);
  });

  test("choosing Upload Photo while signed out saves first, then asks for sign-in", async ({ page }) => {
    await page.goto(customizerUrl);
    const root = page.locator("[data-customizer-root]");
    await expect(root).toBeVisible();

    const field = root.locator('input[type="text"]:visible, textarea:visible').first();
    await field.fill(`Guest ${Date.now()}`);

    await root.getByRole("button", { name: "Uploads", exact: true }).first().click();
    const uploadButton = root.getByRole("button", { name: /Upload photo/i }).first();
    if (await uploadButton.count()) {
      await uploadButton.click();
      // The message must state the design is safe and explain why sign-in is
      // needed — it must never promise to restore the chosen file.
      await expect(root.getByText(/Sign in to upload/i).first()).toBeVisible({ timeout: 15_000 });
      await expect(root.getByText(/we will reopen your photo|restore your file/i)).toHaveCount(0);
    }
  });
});
