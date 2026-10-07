/**
 * TEMPLATE VERSION INTEGRITY in the customer editor (Phase 3).
 *
 * A design saved on Version 1 opens on Version 1. When the page can only offer
 * another version (Version 1 temporarily unavailable), the editor is BLOCKED
 * with a recoverable message: the design is not shown on Version 2, nothing is
 * editable, and nothing is autosaved over it.
 *
 * The server side (which version the page loads) is covered against the real
 * schema in lib/customizer/__tests__/template-version-pinning-database.test.ts;
 * here `?templateVersion=2` makes the fixture serve Version 2.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 E2E_FRESH_SERVER=1 E2E_PORT=3105 \
 *     npx playwright test e2e/customizer-version-pinning.spec.ts --workers=1
 */
import { expect, test } from "@playwright/test";
import { canvasLayer, layerText, selectLayer } from "./customizer-fixture";
import { StubCustomizationServer, signInStubCustomer, supabaseIsStubbed } from "./customer-stub";

const MESSAGE = "We could not load the exact version of your saved design. Your design has not been changed. Please retry.";

test.describe("a saved design stays on its exact template version", () => {
  test.skip(!supabaseIsStubbed, "Needs NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:<dead port> on the dev server.");

  let server: StubCustomizationServer;
  let designId = "";

  test.beforeEach(async ({ context, page, baseURL }) => {
    server = new StubCustomizationServer();
    await server.install(context);
    await signInStubCustomer(context, baseURL || "http://127.0.0.1:3000");
    await page.setViewportSize({ width: 1440, height: 900 });
    designId = server.seed({
      templateId: "e2e-fixture-template",
      templateVersion: 1,
      values: { guest_name: "Pinned Version One" },
      renderData: { clientRevision: 3, templateVersion: 1, editorState: { layerOverrides: { fx_shape: { transform: { x: 640 } } } } },
    }).id;
  });

  test("the Version 1 design opens on Version 1", async ({ page }) => {
    await page.goto(`/__e2e/customizer?autosave=1&snap=0&customizationId=${designId}`);
    await expect(canvasLayer(page, "fx_title")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-customizer-restore-overlay]")).toHaveCount(0, { timeout: 30_000 });
    expect(await layerText(page, "fx_title")).toContain("Pinned Version One");
    // It is editable and saves onto the SAME design, still Version 1.
    await selectLayer(page, "fx_shape");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => server.designWrites().filter((entry) => entry.status === 200).length, { timeout: 15_000 }).toBeGreaterThan(0);
    for (const entry of server.designWrites()) {
      expect(entry.id).toBe(designId);
      if (entry.body.templateVersion !== undefined) expect(entry.body.templateVersion).toBe(1);
    }
  });

  test("offered only Version 2: blocked with a safe message, never shown on Version 2, never autosaved", async ({ page }) => {
    const before = JSON.stringify(server.rows.get(designId));
    await page.goto(`/__e2e/customizer?autosave=1&snap=0&templateVersion=2&customizationId=${designId}`);
    await expect(page.getByText(MESSAGE)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-customizer-restore-overlay]")).toHaveCount(1);
    // The Version 1 values were not poured into the Version 2 template.
    expect(await layerText(page, "fx_title")).not.toContain("Pinned Version One");

    // The canvas is covered: an attempted edit cannot land, and nothing is written.
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(3000);
    expect(server.designWrites(), "the editor wrote while the exact version was unavailable").toHaveLength(0);
    expect(JSON.stringify(server.rows.get(designId))).toBe(before);
    // No local recovery copy of a Version 2 rendering of this design either.
    const drafts = await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.includes(":version:2")));
    expect(drafts).toEqual([]);

    // Retry reloads the page; while Version 1 is still unavailable it stays blocked.
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText(MESSAGE)).toBeVisible({ timeout: 30_000 });
    expect(server.designWrites()).toHaveLength(0);
    expect(server.log.filter((entry) => entry.method === "GET" && entry.id === designId).length).toBeGreaterThanOrEqual(2);
  });
});
