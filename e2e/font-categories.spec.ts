/**
 * Font categories and Favourite Fonts (Customizer Point 4).
 *
 * The font catalog and the favourites store are answered in the page, so the
 * categories are asserted against a known catalog rather than the live Google
 * Fonts API. The selector, its filtering, and the admin star are the real ones.
 */
import { expect, test, type Page } from "@playwright/test";
import { openFixture, selectLayer } from "./customizer-fixture";

const CATALOG = [
  { family: "Cormorant Garamond", category: "serif" },
  { family: "Playfair Display", category: "serif" },
  { family: "Inter", category: "sans-serif" },
  { family: "Great Vibes", category: "handwriting" },
  { family: "Caveat", category: "handwriting" },
  { family: "Yellowtail", category: "handwriting" },
  { family: "Lobster", category: "display" },
  { family: "Roboto Mono", category: "monospace" },
].map((entry) => ({ ...entry, weights: ["400", "700"], hasItalic: false }));

type FontServer = { favourites: Set<string>; canManage: boolean; writes: Array<{ family: string; favourite: boolean }> };

async function serveFonts(page: Page, server: FontServer) {
  await page.route(/\/api\/customizer\/fonts(\?.*)?$/, (route) =>
    route.fulfill({ json: { ok: true, total: CATALOG.length, defaultFamily: "Inter", families: CATALOG } }),
  );
  await page.route(/\/api\/customizer\/fonts\/favourites/, (route) =>
    route.fulfill({ json: { ok: true, favourites: [...server.favourites].sort(), canManage: server.canManage } }),
  );
  await page.route(/\/api\/admin\/customizer\/fonts\/favourites/, (route) => {
    const body = route.request().postDataJSON();
    server.writes.push(body);
    if (body.favourite) server.favourites.add(body.family);
    else server.favourites.delete(body.family);
    return route.fulfill({ json: { ok: true, favourites: [...server.favourites].sort() } });
  });
  // Preview faces come from Google's stylesheet service; keep the test offline.
  await page.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ body: "", contentType: "text/css" }));
}

// Scoped to the font dropdown: the studio also renders native <select> options.
const optionNames = async (page: Page) =>
  (await page.locator('div[role="listbox"] [role="option"]').allTextContents()).map((text) => text.trim()).filter(Boolean);

async function openCustomerFontSelector(page: Page) {
  await selectLayer(page, "fx_free_text");
  await page.getByRole("button", { name: "Font family" }).first().click();
  await expect(page.getByRole("tablist", { name: "Font categories" })).toBeVisible();
}

async function chooseTab(page: Page, name: string) {
  await page.getByRole("tab", { name, exact: true }).click();
}

test.use({ viewport: { width: 1440, height: 900 } });

test.describe("customer font selector", () => {
  test("shows the seven categories, each filtered correctly, with search inside a category", async ({ page }) => {
    const server: FontServer = { favourites: new Set(["Inter", "Great Vibes"]), canManage: false, writes: [] };
    await serveFonts(page, server);
    await openFixture(page, "?snap=0");
    await openCustomerFontSelector(page);

    await expect(page.getByRole("tab")).toHaveText([
      "All Fonts", "Favourite Fonts", "Serif", "Sans Serif", "Script", "Retro", "Hand Written",
    ]);
    await chooseTab(page, "Serif");
    expect(await optionNames(page)).toEqual(["Cormorant Garamond", "Playfair Display"]);
    await chooseTab(page, "Sans Serif");
    expect(await optionNames(page)).toEqual(["Inter"]);
    await chooseTab(page, "Script");
    expect(await optionNames(page)).toEqual(["Great Vibes", "Yellowtail"]);
    await chooseTab(page, "Retro");
    // Results keep catalog order.
    expect(await optionNames(page)).toEqual(["Yellowtail", "Lobster"]);
    await chooseTab(page, "Hand Written");
    expect(await optionNames(page)).toEqual(["Caveat"]);
    await chooseTab(page, "Favourite Fonts");
    expect((await optionNames(page)).sort()).toEqual(["Great Vibes", "Inter"]);

    // Search works inside the chosen category.
    await chooseTab(page, "Script");
    await page.getByLabel("Search Google Fonts").fill("yell");
    expect(await optionNames(page)).toEqual(["Yellowtail"]);

    // A customer never sees the favourite star.
    await expect(page.getByRole("button", { name: /Favourite Fonts$/ })).toHaveCount(0);

    // Picking from a category applies the font.
    await page.getByRole("option", { name: "Yellowtail" }).click();
    await expect(page.getByRole("button", { name: "Font family" }).first()).toHaveText(/Yellowtail/);
  });

  test("categories — Favourite Fonts included — never offer a font the template does not allow", async ({ page }) => {
    const server: FontServer = { favourites: new Set(["Great Vibes", "Inter"]), canManage: false, writes: [] };
    await serveFonts(page, server);
    await openFixture(page, "?snap=0&fonts=Inter,Playfair Display,Cormorant Garamond");
    await openCustomerFontSelector(page);

    await chooseTab(page, "Favourite Fonts");
    expect(await optionNames(page)).toEqual(["Inter"]);
    await chooseTab(page, "Script");
    expect(await optionNames(page)).toEqual([]);
    await expect(page.getByText("No fonts in this category are available for this design.")).toBeVisible();
    await chooseTab(page, "All Fonts");
    expect((await optionNames(page)).sort()).toEqual(["Cormorant Garamond", "Inter", "Playfair Display"]);
  });
});

test.describe("category row scrolling", () => {
  test("a right arrow and scrollbar reach the last categories", async ({ page }) => {
    const server: FontServer = { favourites: new Set(), canManage: false, writes: [] };
    await serveFonts(page, server);
    await openFixture(page, "?snap=0");
    await openCustomerFontSelector(page);
    const row = page.getByRole("tablist", { name: "Font categories" });
    const overflowing = await row.evaluate((node) => node.scrollWidth > node.clientWidth);
    test.skip(!overflowing, "Every category fits on one line at this width.");
    const right = page.getByRole("button", { name: "Scroll font categories right" });
    await expect(right).toBeVisible();
    await right.click();
    await expect.poll(() => row.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "Scroll font categories left" })).toBeVisible();
    await chooseTab(page, "Hand Written");
    expect(await optionNames(page)).toEqual(["Caveat"]);
  });
});

test.describe("Design Studio favourites", () => {
  test("an administrator stars a font; it appears under Favourite Fonts", async ({ page }) => {
    const server: FontServer = { favourites: new Set(), canManage: true, writes: [] };
    await serveFonts(page, server);
    await page.goto("/__e2e/admin-dashboard?section=Products");
    await expect(page.getByRole("button", { name: "Add product" }).first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Add product" }).first().click();
    const enable = page.getByRole("switch", { name: /Enable product customizer/ });
    // The form renders after the click that opened it: wait for the switch (or a
    // studio that is already enabled) instead of checking visibility once.
    await expect(enable.or(page.getByRole("button", { name: "Open Design Studio" })).first()).toBeVisible({ timeout: 30_000 });
    if ((await enable.isVisible()) && (await enable.getAttribute("aria-checked")) !== "true") await enable.click();
    await page.getByRole("button", { name: "Open Design Studio" }).click();
    const studio = page.locator("[data-admin-customizer]");
    await expect(studio.locator("header")).toBeVisible();

    await studio.getByRole("button", { name: "Text", exact: true }).first().click();
    // Commit the new text (an empty new text object is discarded) so its toolbar shows.
    await page.keyboard.type("Welcome");
    await page.keyboard.press("Control+Enter");
    await studio.getByRole("button", { name: "Font", exact: true }).first().click();
    await expect(page.getByRole("tablist", { name: "Font categories" })).toBeVisible();

    await chooseTab(page, "Favourite Fonts");
    await expect(page.getByText("No Favourite Fonts yet.")).toBeVisible();
    await chooseTab(page, "Hand Written");
    await page.getByRole("button", { name: "Add Caveat to Favourite Fonts" }).click();
    // The studio fixture answers /api/admin in the page and logs every write.
    await expect
      .poll(() => page.evaluate(() => (window as any).__adminFixture.requests.filter((entry: any) => entry.path.endsWith("/fonts/favourites")).map((entry: any) => entry.body)))
      .toEqual([{ family: "Caveat", favourite: true }]);
    await expect(page.getByRole("button", { name: "Remove Caveat from Favourite Fonts" })).toHaveAttribute("aria-pressed", "true");

    await chooseTab(page, "Favourite Fonts");
    expect(await optionNames(page)).toEqual(["Caveat"]);
  });
});
