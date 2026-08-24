import { expect, test, type Page } from "@playwright/test";
import { adminCredentials, customerCredentials, login, requireSeededAcceptance, seedManifest } from "./helpers";

// Google Fonts end-to-end coverage for BOTH customizers (spec §33).
//
// The catalog endpoint check runs anywhere; the admin/customer journeys need
// the seeded environment, like the rest of the authenticated suite.

const customizerUrl = process.env.E2E_CUSTOMIZER_URL || seedManifest.customizerUrl || "";
const adminProductUrl = process.env.E2E_ADMIN_PRODUCT_URL || seedManifest.adminProductUrl || "";
requireSeededAcceptance([
  ["E2E_CUSTOMIZER_URL", customizerUrl],
  ["customer email", customerCredentials.email],
  ["customer password", customerCredentials.password],
  ["E2E_ADMIN_PRODUCT_URL", adminProductUrl],
  ["admin email", adminCredentials.email],
  ["admin password", adminCredentials.password],
]);

/** Open the shared font selector and search for a family. */
async function searchFont(page: Page, scope: Page | any, family: string) {
  const trigger = scope.getByRole("button", { name: /^Font( family)?$/ }).first();
  await trigger.click();
  const search = page.getByRole("textbox", { name: "Search Google Fonts" });
  await expect(search).toBeVisible();
  await search.fill(family);
  return search;
}

async function expectRenderedGoogleFont(page: Page, family: string) {
  await expect.poll(async () => page.locator("svg g[data-layer-id] text").evaluateAll((nodes, wantedFamily) => {
    return nodes.some((node) => {
      const computed = window.getComputedStyle(node);
      if (!computed.fontFamily.toLowerCase().includes(String(wantedFamily).toLowerCase())) return false;
      const descriptor = `${computed.fontStyle || "normal"} ${computed.fontWeight || "400"} 16px "${wantedFamily}"`;
      return document.fonts.check(descriptor, node.textContent || "Husnalogy");
    });
  }, family), { message: `${family} should be the confirmed rendered SVG face` }).toBe(true);
}

test("the catalog endpoint serves fonts without ever exposing the API key", async ({ request }) => {
  const response = await request.get("/api/customizer/fonts?q=montserrat&limit=20");

  // 503 is the honest answer when GOOGLE_FONTS_API_KEY is not configured on
  // this environment — but it must never be a crash or a key leak.
  if (!response.ok()) {
    expect(response.status()).toBe(503);
    const failure = await response.json();
    expect(failure.ok).toBe(false);
    expect(JSON.stringify(failure)).not.toMatch(/AIza/);
    test.skip(true, "GOOGLE_FONTS_API_KEY is not configured in this environment.");
    return;
  }

  const payload = await response.json();
  expect(payload.ok).toBe(true);
  expect(Array.isArray(payload.families)).toBe(true);
  expect(payload.families.length).toBeGreaterThan(0);
  expect(payload.total).toBeGreaterThan(payload.families.length - 1);

  const serialized = JSON.stringify(payload);
  // No API key, and no font file URLs, may reach the browser.
  expect(serialized).not.toMatch(/AIza/);
  expect(serialized).not.toContain("fonts.gstatic.com");
  expect(serialized).not.toContain("googleapis.com");

  // Search actually filters, case-insensitively.
  expect(payload.families.some((entry: any) => /montserrat/i.test(entry.family))).toBe(true);

  // Each family carries the metadata the toolbar needs.
  const first = payload.families[0];
  expect(first).toHaveProperty("family");
  expect(Array.isArray(first.weights)).toBe(true);
  expect(typeof first.hasItalic).toBe("boolean");
});

test("the catalog endpoint returns the complete catalog by default and validates limits", async ({ request }) => {
  const complete = await request.get("/api/customizer/fonts");
  if (!complete.ok()) {
    test.skip(true, "GOOGLE_FONTS_API_KEY is not configured in this environment.");
    return;
  }
  const payload = await complete.json();
  expect(payload.families.length).toBe(payload.total);
  expect(payload.families.length).toBeGreaterThan(500);

  for (const family of [
    "Playfair Display",
    "Montserrat",
    "Poppins",
    "Great Vibes",
    "Bebas Neue",
    "Oswald",
    "DM Serif Display",
    "Cormorant Garamond",
    "Pacifico",
    "Lora",
  ]) {
    expect(payload.families.some((entry: any) => entry.family === family)).toBe(true);
  }

  const limited = await request.get("/api/customizer/fonts?limit=10");
  expect(limited.ok()).toBe(true);
  expect((await limited.json()).families).toHaveLength(10);

  const nonsense = await request.get("/api/customizer/fonts?limit=abc&q=" + "x".repeat(500));
  expect(nonsense.status()).toBe(400);
  expect(await nonsense.json()).toMatchObject({ ok: false, code: "INVALID_LIMIT" });
});

test("admin can search the full catalog, apply a font, and it persists", async ({ page }) => {
  const fontRequests: string[] = [];
  page.on("request", (request) => {
    if (/fonts\.(?:googleapis|gstatic)\.com/.test(request.url())) fontRequests.push(request.url());
  });
  await login(page, adminCredentials.email, adminCredentials.password, adminProductUrl);
  await page.goto(adminProductUrl);

  const open = page.getByRole("button", { name: /Open Design Studio/i });
  if (await open.count()) await open.click();

  // Select a text layer so the text toolbar appears.
  await page.getByRole("button", { name: "Text", exact: true }).first().click();

  const search = await searchFont(page, page, "Playfair Display");
  const option = page.getByRole("option", { name: /Playfair Display/i }).first();
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();
  await expectRenderedGoogleFont(page, "Playfair Display");
  await expect.poll(() => fontRequests.some((url) => /fonts\.googleapis\.com/.test(url) && /Playfair(?:\+|%20)Display/i.test(url))).toBe(true);
  await expect.poll(() => fontRequests.some((url) => /fonts\.gstatic\.com/.test(url))).toBe(true);

  // The trigger reflects the new family.
  await expect(page.getByRole("button", { name: /^Font$/ }).first()).toContainText("Playfair Display");
  expect(await search.isVisible().catch(() => false)).toBe(false);

  // Persist, reload, and confirm the family survived.
  await page.getByRole("button", { name: /Publish|Update Published|Save/ }).first().click();
  const dialog = page.getByRole("dialog");
  if (await dialog.count()) {
    const confirm = dialog.getByRole("button", { name: /Publish anyway|Publish|Update Published|Save/ }).last();
    if (await confirm.count()) await confirm.click();
  }

  await page.goto(adminProductUrl);
  if (await open.count()) await open.click();
  await page.getByRole("button", { name: "Text", exact: true }).first().click();
  await expect(page.getByRole("button", { name: /^Font$/ }).first()).toContainText("Playfair Display");
  await expectRenderedGoogleFont(page, "Playfair Display");
});

test("customer can search the catalog, apply a font, and it survives a reload", async ({ page }) => {
  const fontRequests: string[] = [];
  page.on("request", (request) => {
    if (/fonts\.(?:googleapis|gstatic)\.com/.test(request.url())) fontRequests.push(request.url());
  });
  await login(page, customerCredentials.email, customerCredentials.password, customizerUrl);
  await page.goto(customizerUrl);
  const root = page.locator("[data-customizer-root]");
  await expect(root).toBeVisible();

  // Reach a text layer's toolbar via the Layers panel.
  const layersTool = root.getByRole("button", { name: "Layers", exact: true });
  if (await layersTool.count()) await layersTool.click();
  const textLayer = root.getByRole("button", { name: /text/i }).first();
  if (await textLayer.count()) await textLayer.click();

  const fontTrigger = root.getByRole("button", { name: /^Font family$/ }).first();
  test.skip(!(await fontTrigger.count()), "This template does not allow the customer to change fonts.");

  await fontTrigger.click();
  const search = page.getByRole("textbox", { name: "Search Google Fonts" });
  await expect(search).toBeVisible();

  // Case-insensitive partial search finds the family.
  await search.fill("montser");
  const option = page.getByRole("option", { name: /Montserrat/i }).first();
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();
  await expectRenderedGoogleFont(page, "Montserrat");
  await expect.poll(() => fontRequests.some((url) => /fonts\.googleapis\.com/.test(url) && /Montserrat/i.test(url))).toBe(true);
  await expect.poll(() => fontRequests.some((url) => /fonts\.gstatic\.com/.test(url))).toBe(true);

  await expect(root.getByRole("button", { name: /^Font family$/ }).first()).toContainText("Montserrat");

  // Save, reload, verify the family persisted into the saved customization.
  await root.getByRole("button", { name: /Save & Exit/i }).first().click();
  await page.goto(customizerUrl);
  await expect(page.locator("[data-customizer-root]")).toBeVisible();

  const layersAgain = page.locator("[data-customizer-root]").getByRole("button", { name: "Layers", exact: true });
  if (await layersAgain.count()) await layersAgain.click();
  const textAgain = page.locator("[data-customizer-root]").getByRole("button", { name: /text/i }).first();
  if (await textAgain.count()) await textAgain.click();
  await expect(page.locator("[data-customizer-root]").getByRole("button", { name: /^Font family$/ }).first()).toContainText("Montserrat");
  await expectRenderedGoogleFont(page, "Montserrat");

  // This family is outside the initial 60-row popular slice but must remain
  // searchable from the complete metadata catalog.
  const selector = page.locator("[data-customizer-root]").getByRole("button", { name: /^Font family$/ }).first();
  await selector.click();
  const allFontsSearch = page.getByRole("textbox", { name: "Search Google Fonts" });
  await allFontsSearch.fill("DM Serif Display");
  await page.getByRole("option", { name: /DM Serif Display/i }).first().click();
  await expectRenderedGoogleFont(page, "DM Serif Display");
});

test("the font selector supports keyboard navigation", async ({ page }) => {
  await login(page, adminCredentials.email, adminCredentials.password, adminProductUrl);
  await page.goto(adminProductUrl);
  const open = page.getByRole("button", { name: /Open Design Studio/i });
  if (await open.count()) await open.click();
  await page.getByRole("button", { name: "Text", exact: true }).first().click();

  await page.getByRole("button", { name: /^Font$/ }).first().click();
  const search = page.getByRole("textbox", { name: "Search Google Fonts" });
  await expect(search).toBeVisible();

  await search.fill("roboto");
  await expect(page.getByRole("option").first()).toBeVisible({ timeout: 15_000 });

  // Arrow + Enter selects without a mouse.
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(search).not.toBeVisible();

  // Escape closes without selecting.
  await page.getByRole("button", { name: /^Font$/ }).first().click();
  const reopened = page.getByRole("textbox", { name: "Search Google Fonts" });
  await expect(reopened).toBeVisible();
  await reopened.press("Escape");
  await expect(reopened).not.toBeVisible();
});

test("opening the customizer does not download the whole font library", async ({ page }) => {
  const fontFileRequests: string[] = [];
  page.on("request", (request) => {
    if (/fonts\.gstatic\.com/.test(request.url())) fontFileRequests.push(request.url());
  });

  await login(page, customerCredentials.email, customerCredentials.password, customizerUrl);
  await page.goto(customizerUrl);
  await expect(page.locator("[data-customizer-root]")).toBeVisible();
  await page.waitForTimeout(2500);

  // Only the faces this design uses — nowhere near a catalog-sized number.
  expect(fontFileRequests.length).toBeLessThan(25);
});
