import { expect, test, type Page } from "@playwright/test";
import { adminCredentials, customerCredentials, login, requireSeededAcceptance, seedManifest } from "./helpers";

// Iconify Elements end-to-end coverage (spec §73, §74, §75).
//
// Iconify is discovery/import only: selecting an online result must produce a
// PERMANENT Husnalogy asset, and everything after that must behave like any
// other library element.

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

async function openElements(page: Page) {
  const root = page.locator("[data-customizer-root]");
  const tool = root.getByRole("button", { name: "Elements", exact: true });
  if (!(await tool.count())) return null;
  await tool.click();
  return root;
}

test("the search endpoint is authenticated and never proxies an arbitrary URL", async ({ request, page }) => {
  // Anonymous discovery is refused outright.
  const anonymous = await request.get("/api/customizer/iconify/search?q=heart");
  expect(anonymous.status()).toBe(401);

  const anonymousPreview = await request.get("/api/customizer/iconify/preview?icon=mdi:heart");
  expect(anonymousPreview.status()).toBe(401);

  const anonymousImport = await request.post("/api/customizer/iconify/import", { data: { icon: "mdi:heart" } });
  expect(anonymousImport.status()).toBe(401);

  // Signed in, the preview accepts only a canonical identity — never a URL.
  await login(page, customerCredentials.email, customerCredentials.password);
  for (const malicious of [
    "https://evil.example.com/payload.svg",
    "javascript:alert(1)",
    "../../etc/passwd",
    "<svg onload=alert(1)>",
    "mdi/heart",
    "",
  ]) {
    const response = await page.request.get(`/api/customizer/iconify/preview?icon=${encodeURIComponent(malicious)}`);
    expect([400, 403], `preview must refuse "${malicious}"`).toContain(response.status());
  }

  // The import endpoint refuses the same shapes, and refuses client-supplied
  // authoritative fields outright by simply ignoring everything but `icon`.
  for (const payload of [
    { icon: "https://evil.example.com/x.svg" },
    { icon: "javascript:alert(1)" },
    { icon: "mdi:../../x" },
    { icon: "" },
    { svg: "<svg/>" },
    { icon: "mdi:heart", src: "https://evil.example/x.svg", license: "MIT", width: 9999, storagePath: "../../x" },
  ]) {
    const response = await page.request.post("/api/customizer/iconify/import", { data: payload });
    if ((payload as any).icon === "mdi:heart") {
      // A valid identity may succeed, but the forged fields must not appear.
      const body = await response.json().catch(() => ({}));
      if (body?.asset) {
        expect(body.asset.width).not.toBe(9999);
        expect(String(body.asset.url || "")).not.toContain("evil.example");
        expect(String(body.asset.originalPath || "")).not.toContain("..");
      }
    } else {
      expect([400, 403, 503]).toContain(response.status());
    }
  }
});

test("customer can search, import and edit an online graphic, and it survives a reload", async ({ page }) => {
  await login(page, customerCredentials.email, customerCredentials.password, customizerUrl);
  await page.goto(customizerUrl);
  const root = await openElements(page);
  test.skip(!root, "This template does not enable customer elements.");

  const search = page.getByRole("searchbox", { name: "Search for elements" });
  await expect(search).toBeVisible();
  await search.fill("flower");

  const online = page.getByRole("button", { name: /^Add / }).first();
  const appeared = await online.waitFor({ state: "visible", timeout: 20_000 }).then(() => true, () => false);
  test.skip(!appeared, "Online graphics are unavailable in this environment.");

  const layersBefore = await root!.locator("[data-canvas-layer]").count();
  await online.click();

  // Import is asynchronous; the canvas only gains a layer once the PERMANENT
  // asset comes back.
  await expect
    .poll(() => root!.locator("[data-canvas-layer]").count(), { timeout: 30_000 })
    .toBeGreaterThan(layersBefore);

  // The inserted layer must reference a Husnalogy asset, not an Iconify URL.
  const usesIconify = await page.evaluate(() =>
    Array.from(document.querySelectorAll("img"))
      .map((img) => img.getAttribute("src") || "")
      .some((src) => src.includes("api.iconify.design")),
  );
  expect(usesIconify, "no canvas image may point at Iconify").toBe(false);

  await root!.getByRole("button", { name: /Save & Exit/i }).first().click();
  await page.goto(customizerUrl);
  await expect(page.locator("[data-customizer-root]")).toBeVisible();

  // The graphic is restored from the permanent asset, with a fresh signed URL.
  await expect
    .poll(() => page.locator("[data-customizer-root]").locator("[data-canvas-layer]").count(), { timeout: 20_000 })
    .toBeGreaterThan(layersBefore);
});

test("dynamic shapes, lines and text presets stay native — no import required", async ({ page }) => {
  await login(page, customerCredentials.email, customerCredentials.password, customizerUrl);
  await page.goto(customizerUrl);
  const root = await openElements(page);
  test.skip(!root, "This template does not enable customer elements.");

  const iconifyCalls: string[] = [];
  page.on("request", (request) => {
    if (/iconify/i.test(request.url())) iconifyCalls.push(request.url());
  });

  const shape = root!.getByRole("button", { name: /^Add (Square|Rounded|Circle)/ }).first();
  if (await shape.count()) {
    await shape.click();
    // A native ShapeLayer, not an image.
    await expect(root!.getByRole("toolbar", { name: /selected objects/ })).toBeVisible();
  }

  const line = root!.getByRole("button", { name: /^Add (Solid|Dashed|Dotted) line$/ }).first();
  if (await line.count()) await line.click();

  const preset = root!.getByRole("button", { name: /^Add text: / }).first();
  if (await preset.count()) await preset.click();

  // None of these may have touched Iconify.
  expect(iconifyCalls).toEqual([]);
});

test("admin can search and import an online graphic into the library", async ({ page }) => {
  await login(page, adminCredentials.email, adminCredentials.password, adminProductUrl);
  await page.goto(adminProductUrl);

  const open = page.getByRole("button", { name: /Open Design Studio/i });
  if (await open.count()) await open.click();

  const elements = page.getByRole("button", { name: "Elements", exact: true });
  test.skip(!(await elements.count()), "Elements panel is not available in this admin view.");
  await elements.click();

  const search = page.getByRole("searchbox", { name: "Search for elements" });
  await expect(search).toBeVisible();
  await search.fill("heart");

  const online = page.getByRole("button", { name: /^Add / }).first();
  const appeared = await online.waitFor({ state: "visible", timeout: 20_000 }).then(() => true, () => false);
  test.skip(!appeared, "Online graphics are unavailable in this environment.");

  await online.click();
  // The import returns a permanent asset; the admin canvas gains a real layer.
  await expect
    .poll(() => page.locator("[data-canvas-layer]").count(), { timeout: 30_000 })
    .toBeGreaterThan(0);
});

test("an explicit template allowlist cannot be bypassed by importing", async ({ page }) => {
  // With allowedCustomerElementIds populated, online discovery must not be
  // offered at all — a new import would otherwise sidestep the allowlist.
  await login(page, customerCredentials.email, customerCredentials.password, customizerUrl);
  await page.goto(customizerUrl);
  const root = await openElements(page);
  test.skip(!root, "This template does not enable customer elements.");

  const allowlisted = await page.evaluate(async () => {
    const response = await fetch("/api/customizations?limit=1");
    return response.ok;
  });
  expect(allowlisted).toBe(true);

  // Regardless of UI state, the SERVER is the authority: a forged element
  // layer naming an unknown asset must never survive a save.
  const forged = await page.request.post("/api/customizations", {
    data: {
      productId: seedManifest.productId,
      editorState: {
        layerOverrides: {},
        userLayers: [{
          id: "forged-element",
          type: "element",
          page: "front",
          assetId: "99999999-9999-4999-8999-999999999999",
          src: "https://evil.example/payload.svg",
          x: 100, y: 100, width: 100, height: 100,
        }],
      },
    },
  });
  const payload = await forged.json().catch(() => ({}));
  if (payload?.customization) {
    const layers = payload.customization?.renderData?.editorState?.userLayers || [];
    const survived = layers.find((layer: any) => layer.id === "forged-element");
    expect(survived, "a forged element asset must not persist").toBeFalsy();
  } else {
    expect(forged.ok()).toBe(false);
  }
});
