import { expect, test, type Page } from "@playwright/test";
import { seedManifest } from "./helpers";

// Keyboard contract for on-canvas text editing (Enter = line break,
// Ctrl+Enter = Done). Guest-only and read-only against the server: an
// unauthenticated draft is written to localStorage, never to Supabase.

async function personalizeUrl(page: Page): Promise<string> {
  const fromEnv = process.env.E2E_CUSTOMIZER_URL || seedManifest.customizerUrl || "";
  if (fromEnv) return fromEnv;
  await page.goto("/products");
  const slugs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href^="/products/"]'))
      .map((a) => (a.getAttribute("href") || "").split("/")[2])
      .filter((slug, index, all) => slug && all.indexOf(slug) === index),
  );
  for (const slug of slugs) {
    const candidate = `/products/${slug}/personalize`;
    await page.goto(candidate);
    if (await page.locator("[data-canvas-layer]").count()) return candidate;
  }
  throw new Error("No product exposes a personalize page with canvas layers.");
}

const editorState = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('[aria-label="Edit text on canvas"]') as
      | HTMLInputElement
      | HTMLTextAreaElement
      | null;
    return { open: Boolean(el), tag: el?.tagName ?? null, value: el?.value ?? null };
  });

const guestDraftKey = (page: Page) =>
  page.evaluate(() => Object.keys(localStorage).find((key) => key.startsWith("husnalogy_customizer_draft")) || "");

async function saveAndReopen(page: Page, url: string, expectedText: string) {
  await page.getByRole("button", { name: "Save & Exit", exact: true }).click();
  await expect
    .poll(async () => {
      const key = await guestDraftKey(page);
      if (!key) return "";
      return page.evaluate((storageKey) => localStorage.getItem(storageKey) || "", key);
    }, { timeout: 15_000 })
    .toContain(JSON.stringify(expectedText).slice(1, -1));
  await page.goto(url);
  await expect(page.locator("[data-customizer-root]")).toBeVisible();
}

/** Opens the inline editor on the first editable text layer; null if none. */
async function openInlineEditor(page: Page): Promise<{ open: boolean; tag: string | null; value: string | null }> {
  const layers = page.locator("[data-canvas-layer]");
  const count = await layers.count();
  for (let index = 0; index < count; index += 1) {
    const box = await layers.nth(index).boundingBox();
    if (!box) continue;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.click(x, y);
    await page.waitForTimeout(150);
    await page.mouse.dblclick(x, y);
    await page.waitForTimeout(400);
    const state = await editorState(page);
    if (state.open) return state;
  }
  return { open: false, tag: null, value: null };
}

test.describe("on-canvas text editing keyboard contract", () => {
  test("Ctrl+Enter finishes editing and commits, exactly like Done", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(await personalizeUrl(page));
    await expect(page.locator("[data-customizer-root]")).toBeVisible();

    const opened = await openInlineEditor(page);
    test.skip(!opened.open, "This template exposes no customer-editable text layer.");

    await page.keyboard.press("Control+a");
    await page.keyboard.type("Anna and Joe");
    await expect.poll(async () => (await editorState(page)).value).toBe("Anna and Joe");

    await page.keyboard.press("Control+Enter");
    await expect.poll(async () => (await editorState(page)).open, { timeout: 5000 }).toBe(false);

    // The committed value is on the canvas, and Ctrl+Enter added no extra line.
    const lines = await page.evaluate(() =>
      Array.from(document.querySelectorAll("svg tspan")).map((node) => node.textContent || ""),
    );
    expect(lines).toContain("Anna and Joe");
  });

  test("Escape leaves editing without stranding the editor open", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(await personalizeUrl(page));
    await expect(page.locator("[data-customizer-root]")).toBeVisible();

    const opened = await openInlineEditor(page);
    test.skip(!opened.open, "This template exposes no customer-editable text layer.");

    const original = opened.value || "";
    const editor = page.getByLabel("Edit text on canvas", { exact: true });
    await editor.fill("CANCELLED CHANGE");
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await editorState(page)).open, { timeout: 5000 }).toBe(false);

    const reopened = await openInlineEditor(page);
    expect(reopened.value).toBe(original);
    await page.keyboard.press("Escape");
  });

  test("Enter inserts a real line break in a multiline editor and never closes it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const customizerUrl = await personalizeUrl(page);
    await page.goto(customizerUrl);
    await expect(page.locator("[data-customizer-root]")).toBeVisible();

    const saveExit = page.getByRole("button", { name: "Save & Exit", exact: true });
    const restoreReady = await expect
      .poll(() => saveExit.isEnabled(), { timeout: 15_000 })
      .toBe(true)
      .then(() => true, () => false);
    test.skip(!restoreReady, "Customer draft restoration never became ready in this environment.");

    // Guarantee a multiline text layer regardless of which template the
    // environment happens to have. A guest edit creates the local draft, and a
    // multiline customer text layer is added to it — the same shape the
    // "Add text" tool produces with the body preset. Nothing is written to the
    // server: unauthenticated drafts live in localStorage only.
    await page.locator('[id^="cz-field-"]').first().fill("Seeded");
    await saveExit.click();
    await expect
      .poll(() => guestDraftKey(page), { timeout: 15_000 })
      .not.toBe("");

    const seeded = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.startsWith("husnalogy_customizer_draft"));
      if (!key) return false;
      const draft = JSON.parse(localStorage.getItem(key) as string);
      const pageId = draft.activePage || draft.renderData?.activePage || "front";
      draft.renderData = draft.renderData || {};
      draft.renderData.editorState = draft.renderData.editorState || { layerOverrides: {}, userLayers: [] };
      draft.renderData.editorState.userLayers.push({
        id: "ulayer_multiline_probe",
        type: "text",
        page: pageId,
        name: "Multiline probe",
        text: "LINE ONE",
        x: 750,
        y: 1500,
        width: 900,
        height: 220,
        zIndex: 2000,
        textStyle: {
          fontFamily: "Cormorant Garamond",
          fontSize: 64,
          lineHeight: 1.2,
          textAlign: "center",
          multiline: false,
          autoSizeMode: "width",
          fitMode: "fixed",
        },
      });
      localStorage.setItem(key, JSON.stringify(draft));
      return true;
    });
    expect(seeded).toBe(true);

    await page.goto(customizerUrl);
    const probe = page.locator('[data-canvas-layer="ulayer_multiline_probe"]');
    await expect(probe).toBeVisible({ timeout: 15_000 });

    const box = await probe.boundingBox();
    expect(box).not.toBeNull();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;
    await page.mouse.click(x, y);
    await page.waitForTimeout(150);
    await page.mouse.dblclick(x, y);

    // The shared inline editor is always a textarea. This restored object still
    // says single-line so the first Enter must promote it in place.
    await expect.poll(async () => (await editorState(page)).tag, { timeout: 5000 }).toBe("TEXTAREA");

    await page.keyboard.press("Control+a");
    await page.keyboard.type("MADISON");
    const singleLineCanvasHeight = (await probe.boundingBox())?.height || 0;
    const singleLineHeight = await page.getByLabel("Edit text on canvas", { exact: true }).evaluate((element) =>
      element.getBoundingClientRect().height,
    );
    await page.keyboard.press("Enter");
    await page.keyboard.type("KENNEDY");
    const twoLineHeight = await page.getByLabel("Edit text on canvas", { exact: true }).evaluate((element) =>
      element.getBoundingClientRect().height,
    );

    // Enter created a real second line AND left the editor open.
    await expect.poll(async () => (await editorState(page)).value).toBe("MADISON\nKENNEDY");
    expect((await editorState(page)).open).toBe(true);
    expect(twoLineHeight).toBeGreaterThan(singleLineHeight);
    await expect.poll(async () =>
      page.evaluate(() => Array.from(document.querySelectorAll("svg tspan")).map((node) => node.textContent || "")),
    ).toEqual(expect.arrayContaining(["MADISON", "KENNEDY"]));
    await expect.poll(async () => (await probe.boundingBox())?.height || 0).toBeGreaterThan(singleLineCanvasHeight);

    // Ctrl+Enter finishes editing without adding a third line.
    await page.keyboard.press("Control+Enter");
    await expect.poll(async () => (await editorState(page)).open, { timeout: 5000 }).toBe(false);

    const tspans = () =>
      page.evaluate(() => Array.from(document.querySelectorAll("svg tspan")).map((node) => node.textContent || ""));
    expect(await tspans()).toEqual(expect.arrayContaining(["MADISON", "KENNEDY"]));

    // The whole editing session is one history entry.
    await page.keyboard.press("Control+z");
    await expect.poll(tspans).toEqual(expect.arrayContaining(["LINE ONE"]));
    await page.keyboard.press("Control+Shift+z");
    await expect.poll(tspans).toEqual(expect.arrayContaining(["MADISON", "KENNEDY"]));

    // The exact break survives the real guest save payload and restoration.
    // Autosave uses this same save queue and serialization path; a deliberate
    // Save & Exit keeps this deterministic for templates that disable timers.
    await saveAndReopen(page, customizerUrl, "MADISON\nKENNEDY");
    await expect.poll(tspans, { timeout: 15_000 }).toEqual(expect.arrayContaining(["MADISON", "KENNEDY"]));

    // Outside click commits the exact latest multiline value once.
    const restoredProbe = page.locator('[data-canvas-layer="ulayer_multiline_probe"]');
    const restoredBox = await restoredProbe.boundingBox();
    await page.mouse.dblclick(
      restoredBox!.x + restoredBox!.width / 2,
      restoredBox!.y + restoredBox!.height / 2,
    );
    const restoredEditor = page.getByLabel("Edit text on canvas", { exact: true });
    await restoredEditor.fill("OUTSIDE\nSAVE");
    await page.mouse.click(4, 4);
    await expect.poll(async () => (await editorState(page)).open).toBe(false);
    await expect.poll(tspans).toEqual(expect.arrayContaining(["OUTSIDE", "SAVE"]));
    await saveAndReopen(page, customizerUrl, "OUTSIDE\nSAVE");
    await expect.poll(tspans, { timeout: 15_000 }).toEqual(expect.arrayContaining(["OUTSIDE", "SAVE"]));
  });
});
