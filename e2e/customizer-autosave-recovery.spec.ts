/**
 * Crash-safe autosave and refresh restoration (Customizer Point 1).
 *
 * Every committed edit must survive a refresh — even one made a moment before
 * the refresh, while text is still being typed, or while the server is down —
 * and the refresh must reopen the SAME design.
 *
 * Guest tests run against the fixture as-is: a guest's design lives in this
 * browser. Signed-in tests need the dev server started with
 * NEXT_PUBLIC_SUPABASE_URL pointing at a dead local address; the customer and
 * the customization API are then answered inside the browser context (see
 * customer-stub.ts), so no request can reach a real Supabase project.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 E2E_FRESH_SERVER=1 E2E_PORT=3105 \
 *     npx playwright test e2e/customizer-autosave-recovery.spec.ts --workers=1
 */
import { expect, test, type Page } from "@playwright/test";
import {
  anchorPoint,
  canvasLayer,
  cropDrawBox,
  drag,
  editorTextarea,
  enterCrop,
  layerText,
  openFixture,
  panCrop,
  readDraft,
  rectAttrs,
  selectLayer,
  switchToAdvancedCustomize,
  waitForEditor,
} from "./customizer-fixture";
import { STUB_PHOTO_URL, StubCustomizationServer, signInStubCustomer, supabaseIsStubbed } from "./customer-stub";

const QUERY = "?autosave=1&snap=0";

async function refresh(page: Page) {
  await page.reload();
  await waitForEditor(page);
}

async function shapeX(page: Page) {
  return (await rectAttrs(page, "fx_shape")).x;
}

async function nudgeShape(page: Page, presses: number) {
  for (let index = 0; index < presses; index += 1) await page.keyboard.press("ArrowRight");
}

const allCanvasText = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-customizer-canvas="main"] text')].map((node) => node.textContent || "").join("\n"),
  );

test.describe("guest: every committed edit survives a refresh", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFixture(page, QUERY);
  });

  test("move, then refresh IMMEDIATELY", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    const before = await shapeX(page);
    await nudgeShape(page, 1);
    await expect.poll(() => shapeX(page)).toBe(before + 8);
    await refresh(page);
    expect(await shapeX(page)).toBe(before + 8);
  });

  test("a rapid burst of edits, then refresh immediately — the LAST state wins", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    const before = await shapeX(page);
    await nudgeShape(page, 12);
    await refresh(page);
    expect(await shapeX(page)).toBe(before + 96);
  });

  test("resize and rotate, then refresh", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    const before = await rectAttrs(page, "fx_shape");
    const corner = await anchorPoint(page, "bottom-right");
    await drag(page, corner, { x: corner.x + 50, y: corner.y + 25 });
    const resized = await rectAttrs(page, "fx_shape");
    expect(resized.width).toBeGreaterThan(before.width);
    const rotater = await anchorPoint(page, "rotater");
    await drag(page, rotater, { x: rotater.x + 90, y: rotater.y + 60 });
    const rotated = await rectAttrs(page, "fx_shape");
    expect(rotated.transform).toMatch(/rotate\(/);
    await refresh(page);
    expect(await rectAttrs(page, "fx_shape")).toEqual(rotated);
  });

  test("typing on the canvas, then refresh WHILE the text editor is still open", async ({ page }) => {
    await selectLayer(page, "fx_free_text");
    await page.getByRole("button", { name: "Edit Text", exact: true }).click();
    await expect(editorTextarea(page)).toBeVisible();
    await page.keyboard.press("End");
    await page.keyboard.type(" forever");
    await refresh(page);
    expect(await layerText(page, "fx_free_text")).toContain("Edit me forever");
  });

  test("a new customer text object, refreshed before it was ever closed", async ({ page }) => {
    await switchToAdvancedCustomize(page);
    await page.locator("[data-customizer-root]").getByRole("button", { name: "Text", exact: true }).click();
    await expect(editorTextarea(page)).toBeVisible();
    await page.keyboard.type("Mehndi Night");
    await refresh(page);
    expect(await allCanvasText(page)).toContain("Mehndi Night");
  });

  test("delete, then refresh", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    await page.keyboard.press("Delete");
    await expect(canvasLayer(page, "fx_shape")).toHaveCount(0);
    await refresh(page);
    await expect(canvasLayer(page, "fx_shape")).toHaveCount(0);
  });

  test("undo, then refresh — and redo, then refresh", async ({ page }) => {
    await selectLayer(page, "fx_shape");
    const before = await shapeX(page);
    await nudgeShape(page, 1);
    await expect.poll(() => shapeX(page)).toBe(before + 8);
    await page.keyboard.press("Control+z");
    await expect.poll(() => shapeX(page)).toBe(before);
    await refresh(page);
    expect(await shapeX(page)).toBe(before);

    await selectLayer(page, "fx_shape");
    await nudgeShape(page, 1);
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+y");
    await expect.poll(() => shapeX(page)).toBe(before + 8);
    await refresh(page);
    expect(await shapeX(page)).toBe(before + 8);
  });

  test("the open page is restored", async ({ page }) => {
    await page.getByRole("button", { name: /Next: Design Back/ }).click();
    await expect(canvasLayer(page, "fx_back_text")).toBeVisible();
    await page.reload();
    await expect(canvasLayer(page, "fx_back_text")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-customizer-restore-overlay]")).toHaveCount(0);
  });

  test("crop Done, then refresh — the exact crop comes back", async ({ page }) => {
    const before = await cropDrawBox(page, "fx_photo_crop");
    const surface = await enterCrop(page, "fx_photo_crop");
    await panCrop(page, surface, 80, 40);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("application", { name: /crop photo/i })).toHaveCount(0);
    const cropped = await cropDrawBox(page, "fx_photo_crop");
    expect(cropped).not.toEqual(before);
    await refresh(page);
    expect(await cropDrawBox(page, "fx_photo_crop")).toEqual(cropped);
  });

  test("a group survives a refresh", async ({ page }) => {
    await selectLayer(page, "fx_free_text");
    await selectLayer(page, "fx_shape", ["Shift"]);
    await page.keyboard.press("Control+g");
    await expect.poll(async () => ((await readDraft(page))?.renderData?.editorState?.userLayers || []).some((layer: any) => layer.type === "group"), { timeout: 5000 }).toBe(true);
    await refresh(page);
    const draft = await readDraft(page);
    const group = draft.renderData.editorState.userLayers.find((layer: any) => layer.type === "group");
    expect(group).toBeTruthy();
    expect(draft.renderData.editorState.layerOverrides.fx_shape.groupId).toBe(group.id);
    // Members of a group are hit as the group itself.
    await selectLayer(page, group.id);
    await expect(page.getByRole("button", { name: /^Ungroup/ }).first()).toBeVisible();
  });
});

test.describe("signed-in customer: server persistence", () => {
  test.skip(
    !supabaseIsStubbed,
    "Needs NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:<dead port> on the dev server — refusing to run against a real Supabase project.",
  );

  let server: StubCustomizationServer;

  test.beforeEach(async ({ context, page, baseURL }) => {
    server = new StubCustomizationServer();
    await server.install(context);
    await signInStubCustomer(context, baseURL || "http://127.0.0.1:3000");
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  /** Make one edit and wait for the server to hold it, so the design has an id. */
  async function createSavedDesign(page: Page) {
    await openFixture(page, QUERY);
    await selectLayer(page, "fx_shape");
    const start = await shapeX(page);
    await nudgeShape(page, 1);
    await expect.poll(() => server.rows.size, { timeout: 10_000 }).toBe(1);
    await expect(page).toHaveURL(/customizationId=c0ffee00-/);
    await expect(page.getByText(/^Saved/).first()).toBeVisible({ timeout: 10_000 });
    return start;
  }

  const storedShapeX = () => server.only().renderData?.editorState?.layerOverrides?.fx_shape?.transform?.x;

  test("the first save creates ONE design, the address bar gains its id without navigating, and a refresh reopens it", async ({ page }) => {
    await openFixture(page, QUERY);
    await page.evaluate(() => {
      (window as any).__sameDocument = true;
    });
    await selectLayer(page, "fx_shape");
    const before = await shapeX(page);
    await nudgeShape(page, 2);
    await expect.poll(() => server.rows.size, { timeout: 10_000 }).toBe(1);
    await expect(page).toHaveURL(/customizationId=c0ffee00-/);
    expect(await page.evaluate(() => (window as any).__sameDocument), "the URL update navigated").toBe(true);
    const id = server.only().id;

    await refresh(page);
    expect(page.url()).toContain(`customizationId=${id}`);
    expect(await shapeX(page)).toBe(before + 16);
    expect(server.log.some((entry) => entry.method === "GET" && entry.id === id)).toBe(true);
    expect(server.rows.size, "a refresh created a duplicate design").toBe(1);
    expect(server.designWrites().filter((entry) => entry.method === "POST")).toHaveLength(1);
  });

  test("edits made right before a refresh are not lost, and reach the server", async ({ page }) => {
    const start = await createSavedDesign(page);
    await nudgeShape(page, 3);
    await refresh(page);
    expect(await shapeX(page)).toBe(start + 32);
    // Whether the unload keepalive or the post-restore sync carried it, the
    // server ends up holding exactly what the screen shows — in one design.
    const onScreen = (await readDraft(page))?.renderData?.editorState?.layerOverrides?.fx_shape?.transform?.x;
    expect(onScreen).toBeDefined();
    await expect.poll(storedShapeX, { timeout: 15_000 }).toBe(onScreen);
    expect(server.rows.size).toBe(1);
  });

  test("a server outage keeps edits on the device, a refresh restores them, and they reach the server once it recovers", async ({ page }) => {
    const start = await createSavedDesign(page);
    const savedX = storedShapeX();
    server.failWrites = { status: 503, remaining: 10_000 };
    await nudgeShape(page, 2);
    await expect(page.getByText(/Save failed|Saving…/).first()).toBeVisible({ timeout: 10_000 });
    expect(storedShapeX()).toBe(savedX);

    await refresh(page);
    // The server still holds the older state; the device's newer copy wins.
    expect(await shapeX(page)).toBe(start + 24);

    server.failWrites = null;
    await expect.poll(storedShapeX, { timeout: 30_000 }).not.toBe(savedX);
    await expect(page.getByText(/^Saved/).first()).toBeVisible({ timeout: 30_000 });
    await refresh(page);
    expect(await shapeX(page)).toBe(start + 24);
  });

  test("offline edits are queued and sent when the connection returns", async ({ page, context }) => {
    await createSavedDesign(page);
    const savedX = storedShapeX();
    await context.setOffline(true);
    await nudgeShape(page, 1);
    await expect(page.getByText("Offline — changes are queued", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    expect(storedShapeX()).toBe(savedX);
    await context.setOffline(false);
    await expect.poll(storedShapeX, { timeout: 15_000 }).toBe(Number(savedX) + 8);
  });

  test("an existing design reopens exactly: values, page, overrides and customer layers", async ({ page }) => {
    const seeded = server.seed({
      values: { guest_name: "Sara & Omar" },
      renderData: {
        activePage: "back",
        clientRevision: 7,
        editorState: {
          layerOverrides: { fx_shape: { transform: { x: 640 } } },
          userLayers: [
            {
              id: "user_text_seed",
              type: "text",
              page: "back",
              name: "Body text",
              text: "Reception at eight",
              x: 750,
              y: 900,
              width: 900,
              height: 120,
              zIndex: 1001,
              textStyle: { fontFamily: "Inter", fontSize: 60, color: "#303839", textAlign: "center", lineHeight: 1.2 },
            },
          ],
        },
      },
    });
    await page.goto(`/__e2e/customizer${QUERY}&customizationId=${seeded.id}`);
    await expect(canvasLayer(page, "fx_back_text")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-customizer-restore-overlay]")).toHaveCount(0);
    expect(await allCanvasText(page)).toContain("Reception at eight");

    await page.getByRole("button", { name: "Edit Front", exact: true }).first().click();
    await expect(canvasLayer(page, "fx_title")).toBeVisible();
    expect(await layerText(page, "fx_title")).toContain("Sara & Omar");
    // A later save continues ABOVE the stored revision, so it is never refused as stale.
    await selectLayer(page, "fx_shape");
    await nudgeShape(page, 1);
    await expect.poll(() => Number(server.rows.get(seeded.id)?.renderData?.clientRevision) || 0, { timeout: 10_000 }).toBeGreaterThan(7);
    expect(server.rows.size).toBe(1);
  });

  test("a design that cannot be loaded is never overwritten, and opens once the server answers", async ({ page }) => {
    const seeded = server.seed({ values: { guest_name: "Never Overwrite Me" }, renderData: { clientRevision: 3, editorState: {} } });
    server.failReads = { status: 500, remaining: 2 };
    await page.goto(`/__e2e/customizer${QUERY}&customizationId=${seeded.id}`);
    await expect(page.getByText(/couldn't load your saved design/)).toBeVisible({ timeout: 30_000 });
    expect(server.designWrites(), "the editor wrote while the design was unreadable").toHaveLength(0);
    // The automatic retries reach a healthy server.
    await expect(page.locator("[data-customizer-restore-overlay]")).toHaveCount(0, { timeout: 30_000 });
    expect(await layerText(page, "fx_title")).toContain("Never Overwrite Me");
    expect(server.designWrites()).toHaveLength(0);
    expect(server.rows.get(seeded.id)?.values).toEqual({ guest_name: "Never Overwrite Me" });
  });

  test("an uploaded photo survives a refresh", async ({ page }) => {
    await openFixture(page, QUERY);
    await page.locator("[data-customizer-root]").getByRole("button", { name: /Photos|Uploads/ }).first().click();
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
    await page.locator("[data-customizer-root] input[type='file']").first().setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
    await expect.poll(() => server.rows.size, { timeout: 15_000 }).toBe(1);
    await expect
      .poll(() => JSON.stringify(server.only().values || {}), { timeout: 15_000 })
      .toContain("customizer/editor-");
    await refresh(page);
    const photoHref = await page.evaluate(() =>
      [...document.querySelectorAll('[data-customizer-canvas="main"] image')].map((node) => node.getAttribute("href") || "").find((href) => href.includes("UP")) || "",
    );
    expect(photoHref).toBe(STUB_PHOTO_URL);
  });
});
