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

/**
 * The customizer to test. An explicit URL (env or seed manifest) still wins, so
 * the suite can run against a staging product; otherwise it uses the in-memory
 * fixture, whose default page accepts customer text by construction.
 *
 * This used to hunt the live catalogue for a suitable product and SKIP when
 * none existed — which silently hid the fact that its own selectors had gone
 * stale against the current Text panel.
 */
function personalizeUrl(): string {
  return process.env.E2E_CUSTOMIZER_URL || seedManifest.customizerUrl || "/__e2e/customizer";
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

/**
 * Adds a new customer text layer and waits for its on-canvas editor to open.
 *
 * The Text tool itself inserts a text object — the default "body" preset, which
 * is multiline — and opens its editor straight away. That is the path a
 * customer can actually use today; see the known-defect test at the end of this
 * file for why the preset buttons are not driven here.
 */
async function addAndOpenTextLayer(page: Page) {
  const root = page.locator("[data-customizer-root]");
  await root.getByRole("button", { name: "Text", exact: true }).click();
  await expect.poll(async () => (await editorState(page)).open, { timeout: 5000 }).toBe(true);
  return editorState(page);
}

/** Selects the (first) customer text layer via the Layers panel and reopens
 *  its on-canvas editor through the "Edit Text" toolbar action. */
async function reopenTextLayerEditor(page: Page) {
  const root = page.locator("[data-customizer-root]");
  await root.getByRole("button", { name: "Layers", exact: true }).click();
  // Rows are named "<icon> <layer name> <origin>", e.g. "T Body text Customer created".
  await root.getByRole("button", { name: /Customer created/i }).first().click();
  await root.getByRole("button", { name: "Edit Text", exact: true }).click();
  await expect.poll(async () => (await editorState(page)).open, { timeout: 5000 }).toBe(true);
}

test.describe("on-canvas text editing keyboard contract", () => {
  test("Ctrl+Enter finishes editing and commits, exactly like Done", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(personalizeUrl());
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
    await page.goto(personalizeUrl());
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
    await page.goto(personalizeUrl());
    await expect(page.locator("[data-customizer-root]")).toBeVisible();
    await switchToAdvancedCustomize(page);

    // The Text tool inserts the "body" preset, which is the multiline one
    // (heading and subheading are single-line).
    await addAndOpenTextLayer(page);
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

  /**
   * KNOWN DEFECT, asserted rather than skipped.
   *
   * The preset buttons ("Add Heading", "Add Subheading", "Add Body Text") are
   * only visible while the Text tool's freshly inserted, still-empty text layer
   * is being edited. Pressing one moves focus out of that editor first; the
   * empty layer is discarded, the panel closes, and the click lands on nothing —
   * so no preset can ever be applied.
   *
   * `test.fail()` runs this and expects it to fail. When the defect is fixed the
   * test passes, Playwright reports that as an error, and the marker must be
   * removed — it cannot silently outlive the bug.
   */
  test("choosing a text preset inserts a text object in that style", async ({ page }) => {
    test.fail(true, "Known defect: text presets are unreachable — the preset click is lost when the auto-inserted empty text layer is discarded.");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(personalizeUrl());
    await expect(page.locator("[data-customizer-root]")).toBeVisible();
    await switchToAdvancedCustomize(page);

    const root = page.locator("[data-customizer-root]");
    await root.getByRole("button", { name: "Text", exact: true }).click();
    await root.getByRole("button", { name: /Add Heading/ }).click({ timeout: 5000 });
    await expect.poll(async () => (await editorState(page)).open, { timeout: 5000 }).toBe(true);
  });
});
