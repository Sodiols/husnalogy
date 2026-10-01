import { expect, test, type Page } from "@playwright/test";

/**
 * Paper Style (and every other option) is persisted and restored by the REAL
 * product page component (ProductInfo) in a real browser. Uses the
 * /__e2e/product-options fixture, so it needs no seeded data or account.
 */
const FIXTURE = "/__e2e/product-options";
const STORAGE_KEY = "husnalogy-product-options-e2e-product-options-fixture";

// Option buttons with an icon start their accessible name with an icon-font
// glyph, so the (unique) label is matched anywhere in the name.
const option = (page: Page, label: string) => page.getByRole("button", { name: label });

async function fresh(page: Page) {
  await page.goto(FIXTURE);
  await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
  await page.reload();
  await expect(option(page, "Flat Card")).toHaveAttribute("aria-pressed", "true");
}

async function stored(page: Page) {
  return page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || "null"), STORAGE_KEY);
}

test.describe("product option persistence (Paper Style)", () => {
  test("changing ONLY Paper Style, leaving and returning restores it", async ({ page }) => {
    await fresh(page);
    await option(page, "Folded Card").click();
    await expect(option(page, "Folded Card")).toHaveAttribute("aria-pressed", "true");
    // Leave immediately — no waiting for the debounce: the pending save is flushed.
    await page.goto("/terms");
    await page.goto(FIXTURE);
    await expect(option(page, "Folded Card")).toHaveAttribute("aria-pressed", "true");
    await expect(option(page, "Flat Card")).toHaveAttribute("aria-pressed", "false");
    expect((await stored(page)).paperStyle).toMatch(/folded/i);
  });

  test("Paper Style then another option: both are restored", async ({ page }) => {
    await fresh(page);
    await option(page, "Tri-fold Card").click();
    await option(page, "Blank White Envelopes").click();
    await expect.poll(async () => (await stored(page))?.envelope || "").toMatch(/blank/i);
    await page.goto("/terms");
    await page.goto(FIXTURE);
    await expect(option(page, "Tri-fold Card")).toHaveAttribute("aria-pressed", "true");
    await expect(option(page, "Blank White Envelopes")).toHaveAttribute("aria-pressed", "true");
  });

  test("rapid Paper Style changes restore the FINAL choice after a browser reload", async ({ page }) => {
    await fresh(page);
    for (const label of ["Folded Card", "Tri-fold Card", "Flat Card", "Folded Card", "Tri-fold Card"]) await option(page, label).click();
    await expect.poll(async () => (await stored(page))?.paperStyle || "").toMatch(/tri-fold/i);
    await page.reload();
    await expect(option(page, "Tri-fold Card")).toHaveAttribute("aria-pressed", "true");
  });

  test("an OLD saved object without Paper Style falls back safely and keeps the other options", async ({ page }) => {
    await page.goto(FIXTURE);
    const current = await stored(page);
    const legacy = { ...(current || {}), envelope: current?.envelope || "", paperStyle: undefined };
    await page.evaluate(({ key, value }) => {
      const { paperStyle: _drop, ...rest } = value;
      window.localStorage.setItem(key, JSON.stringify({ ...rest, envelope: "blank-white-envelopes" }));
    }, { key: STORAGE_KEY, value: legacy });
    await page.reload();
    await expect(option(page, "Flat Card")).toHaveAttribute("aria-pressed", "true"); // default
    // The page keeps working and persists Paper Style again from now on.
    await option(page, "Folded Card").click();
    await expect.poll(async () => (await stored(page))?.paperStyle || "").toMatch(/folded/i);
  });
});
