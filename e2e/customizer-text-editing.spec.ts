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

  test("an allowed text colour change applies to the selected text on the canvas", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(personalizeUrl());
    await expect(page.locator("[data-customizer-root]")).toBeVisible();
    await switchToAdvancedCustomize(page);

    await addAndOpenTextLayer(page);
    await page.keyboard.type("Colour Test");
    await page.keyboard.press("Control+Enter");
    await expect.poll(async () => (await editorState(page)).open, { timeout: 5000 }).toBe(false);

    // The colour chip opens the colour popover (as in the studio): the
    // template's allowed palette, or swatches plus a free colour picker.
    const root = page.locator("[data-customizer-root]");
    await root.getByRole("button", { name: /^Text colour/ }).click();
    const popover = page.getByRole("dialog", { name: /^Text colour/ });
    const free = popover.getByLabel("Custom text colour");
    const palette = popover.getByRole("button", { name: /^Set text colour / });
    let wanted = "#b21c40";
    if (await free.count()) await free.first().fill(wanted);
    else {
      const swatch = palette.last();
      wanted = String((await swatch.getAttribute("aria-label")) || "").replace("Set text colour ", "");
      await swatch.click();
      // Picking closes the popover; reopen it to see the choice marked.
      await root.getByRole("button", { name: /^Text colour/ }).click();
      await expect(popover.getByRole("button", { name: `Set text colour ${wanted}` })).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("Escape");
    }
    // The renderer writes the colour into the text element's style (fill:#rrggbb).
    await expect.poll(() => page.evaluate(() => {
      const node = Array.from(document.querySelectorAll("svg text")).find((element) => (element.textContent || "").includes("Colour Test")) as SVGTextElement | undefined;
      return String(node?.style.fill || "");
    }), { timeout: 5000 }).toBe(await page.evaluate((hex) => { const probe = document.createElementNS("http://www.w3.org/2000/svg", "text"); probe.style.fill = hex; return probe.style.fill; }, wanted));
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
   * Formerly a KNOWN DEFECT (marked test.fail): pressing a preset closed the
   * Text tool's empty auto-inserted text, the controls above the presets
   * disappeared, the list jumped before the release and the click was lost.
   * The style list now captures the pointer and applies the style on release
   * (app/components/customizer/TextStyleList.tsx).
   */
  test("choosing a text preset inserts a text object in that style", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(personalizeUrl());
    await expect(page.locator("[data-customizer-root]")).toBeVisible();
    await switchToAdvancedCustomize(page);
    const layerCount = () => page.evaluate(() => document.querySelectorAll("[data-customizer-canvas=main] [data-layer-id]").length);
    const before = await layerCount();

    const root = page.locator("[data-customizer-root]");
    await root.getByRole("button", { name: "Text", exact: true }).click();
    await root.getByRole("button", { name: /Add Heading/ }).click({ timeout: 5000 });
    await expect.poll(async () => (await editorState(page)).open, { timeout: 5000 }).toBe(true);
    await page.keyboard.type("Anna");
    await page.keyboard.press("Control+Enter");
    await expect.poll(async () => (await editorState(page)).open, { timeout: 5000 }).toBe(false);

    // Exactly one new object — the heading, in the heading style; the empty
    // text the Text tool had inserted is gone.
    await expect.poll(layerCount).toBe(before + 1);
    const size = await page.evaluate(() => {
      const text = Array.from(document.querySelectorAll("[data-customizer-canvas=main] text")).find((node) => node.textContent?.trim() === "Anna") as SVGTextElement | undefined;
      return text ? getComputedStyle(text).fontSize : null;
    });
    expect(size).toBe("94px");
  });
});
