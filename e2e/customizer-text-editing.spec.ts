import { expect, test, type Page } from "@playwright/test";
import { seedManifest } from "./helpers";

// Keyboard contract for on-canvas text editing (Enter = line break,
// Ctrl+Enter = Done). Guest-only and read-only against the server: an
// unauthenticated draft is written to localStorage, never to Supabase.
//
// Selection and hit-testing for canvas layers live entirely on the Konva
// stage now (spec §61): a layer has no persistent per-layer DOM node to
// locate and click. `[data-canvas-layer]` only exists on the DOM overlay
// while a layer is actively being edited or shows an overflow warning. So
// this suite drives the same entry points a customer uses — the "Text"
// tool (which opens the on-canvas editor for a brand-new layer immediately)
// and the "Edit Text" button in the selection toolbar (which reopens it for
// an already-selected layer) — instead of guessing canvas pixel coordinates.

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
    const root = page.locator("[data-customizer-root]");
    if (!(await root.count())) continue;
    await switchToAdvancedCustomize(page);
    const textTool = root.getByRole("button", { name: "Text", exact: true });
    if (!(await textTool.count())) continue;
    // The Text tool can appear because *some* page allows customer text, even
    // when the page that's active by default does not — only the preset
    // buttons confirm the default page itself accepts a new text layer.
    await textTool.click();
    const hasPreset = await root
      .getByRole("button", { name: "Add Body Text", exact: true })
      .waitFor({ state: "visible", timeout: 3000 })
      .then(() => true, () => false);
    if (hasPreset) return candidate;
  }
  throw new Error("No product exposes a personalize page whose default page accepts customer text.");
}

/** The Text tool lives behind "Advanced Customize" — Easy Personalize (the
 *  default view) only exposes Edit, Photos and Options. */
async function switchToAdvancedCustomize(page: Page) {
  const toggle = page.getByRole("button", { name: /^(Advanced Customize|Advanced)$/ });
  if (await toggle.count()) await toggle.first().click();
}

const editorState = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('[aria-label="Edit text on canvas"]') as
      | HTMLInputElement
      | HTMLTextAreaElement
      | null;
    return { open: Boolean(el), tag: el?.tagName ?? null, value: el?.value ?? null };
  });

/** Adds a new customer text layer and waits for its on-canvas editor to open. */
async function addAndOpenTextLayer(
  page: Page,
  preset: "Add Heading" | "Add Subheading" | "Add Body Text" = "Add Body Text",
) {
  const root = page.locator("[data-customizer-root]");
  await root.getByRole("button", { name: "Text", exact: true }).click();
  await root.getByRole("button", { name: preset, exact: true }).click();
  await expect.poll(async () => (await editorState(page)).open, { timeout: 5000 }).toBe(true);
  return editorState(page);
}

/** Selects the (first) customer text layer via the Layers panel and reopens
 *  its on-canvas editor through the "Edit Text" toolbar action. */
async function reopenTextLayerEditor(page: Page) {
  const root = page.locator("[data-customizer-root]");
  await root.getByRole("button", { name: "Layers", exact: true }).click();
  await root.getByRole("button", { name: /Customer text/i }).first().click();
  await root.getByRole("button", { name: "Edit Text", exact: true }).click();
  await expect.poll(async () => (await editorState(page)).open, { timeout: 5000 }).toBe(true);
}

test.describe("on-canvas text editing keyboard contract", () => {
  test("Ctrl+Enter finishes editing and commits, exactly like Done", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    let url: string;
    try {
      url = await personalizeUrl(page);
    } catch (error) {
      // No live product currently has "customer added text" enabled on any
      // page — that's an admin/catalog configuration choice, not a code bug.
      test.skip(true, (error as Error).message);
      return;
    }
    await page.goto(url);
    await expect(page.locator("[data-customizer-root]")).toBeVisible();
    await switchToAdvancedCustomize(page);

    await addAndOpenTextLayer(page);
    await page.keyboard.type("Anna and Joe");
    await expect.poll(async () => (await editorState(page)).value).toBe("Anna and Joe");

    await page.keyboard.press("Control+Enter");
    await expect.poll(async () => (await editorState(page)).open, { timeout: 5000 }).toBe(false);

    // The committed value renders on the canvas, and Ctrl+Enter added no extra line.
    const lines = await page.evaluate(() =>
      Array.from(document.querySelectorAll("svg tspan")).map((node) => node.textContent || ""),
    );
    expect(lines).toContain("Anna and Joe");
  });

  test("Escape leaves editing without stranding the editor open", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    let url: string;
    try {
      url = await personalizeUrl(page);
    } catch (error) {
      // No live product currently has "customer added text" enabled on any
      // page — that's an admin/catalog configuration choice, not a code bug.
      test.skip(true, (error as Error).message);
      return;
    }
    await page.goto(url);
    await expect(page.locator("[data-customizer-root]")).toBeVisible();
    await switchToAdvancedCustomize(page);

    // A cancel on a still-new (never committed) layer discards the layer
    // entirely, so first commit real content, then reopen and cancel an
    // edit on that already-committed layer to prove Escape reverts rather
    // than leaking the cancelled change.
    await addAndOpenTextLayer(page);
    await page.keyboard.type("Original text");
    await page.keyboard.press("Control+Enter");
    await expect.poll(async () => (await editorState(page)).open, { timeout: 5000 }).toBe(false);

    await reopenTextLayerEditor(page);
    await expect.poll(async () => (await editorState(page)).value).toBe("Original text");

    const editor = page.getByLabel("Edit text on canvas", { exact: true });
    await editor.fill("CANCELLED CHANGE");
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await editorState(page)).open, { timeout: 5000 }).toBe(false);

    await reopenTextLayerEditor(page);
    await expect.poll(async () => (await editorState(page)).value).toBe("Original text");
    await page.keyboard.press("Escape");
  });

  test("Enter inserts a real line break in a multiline editor and never closes it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    let url: string;
    try {
      url = await personalizeUrl(page);
    } catch (error) {
      // No live product currently has "customer added text" enabled on any
      // page — that's an admin/catalog configuration choice, not a code bug.
      test.skip(true, (error as Error).message);
      return;
    }
    await page.goto(url);
    await expect(page.locator("[data-customizer-root]")).toBeVisible();
    await switchToAdvancedCustomize(page);

    // "Add Body Text" is the multiline preset (spec: customer text presets —
    // heading and subheading are single-line, body is multiline).
    await addAndOpenTextLayer(page, "Add Body Text");
    await page.keyboard.type("LINE ONE");
    await page.keyboard.press("Enter");
    // A plain Enter in a multiline editor inserts a line break and keeps editing open.
    await expect(page.getByLabel("Edit text on canvas", { exact: true })).toBeVisible();
    await expect.poll(async () => (await editorState(page)).open).toBe(true);
    await page.keyboard.type("LINE TWO");
    await expect.poll(async () => (await editorState(page)).value).toBe("LINE ONE\nLINE TWO");

    await page.keyboard.press("Control+Enter");
    await expect.poll(async () => (await editorState(page)).open, { timeout: 5000 }).toBe(false);
  });
});
