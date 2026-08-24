import { expect, test, type Page } from "@playwright/test";
import { customerCredentials, login, requireSeededAcceptance, seedManifest } from "./helpers";

// Unified Elements end-to-end coverage (spec §42, §43, §44).
//
// ONE Elements tool now contains Dynamic Shapes, Graphics, Text, Borders/Lines,
// Shapes, Frames and QR Code. These tests prove the consolidation is real: the
// separate primary tools are gone, every object type is still insertable, and
// each one arrives as its own NATIVE type — proven by the contextual control
// only that type has (a line has caps, a QR has error correction, and so on),
// which a flattened image could never produce.

const customizerUrl = process.env.E2E_CUSTOMIZER_URL || seedManifest.customizerUrl || "";
requireSeededAcceptance([
  ["E2E_CUSTOMIZER_URL", customizerUrl],
  ["customer email", customerCredentials.email],
  ["customer password", customerCredentials.password],
]);

const root = (page: Page) => page.locator("[data-customizer-root]");
const rail = (page: Page) => root(page).getByRole("toolbar", { name: "Customizer tools" });
const search = (page: Page) => root(page).getByRole("searchbox", { name: "Search for elements" });

async function openCustomizer(page: Page) {
  await login(page, customerCredentials.email, customerCredentials.password, customizerUrl);
  await page.goto(customizerUrl);
  await expect(root(page)).toBeVisible();
}

/** Opens the one Elements tool. Returns false when the template permits none. */
async function openElements(page: Page) {
  const tool = rail(page).getByRole("button", { name: "Elements", exact: true });
  if (!(await tool.count())) return false;
  await tool.click();
  await expect(search(page)).toBeVisible();
  return true;
}

test.describe("the primary rail holds one Elements entry", () => {
  test("shows Elements and no separate Shapes, Frames or QR tool", async ({ page }) => {
    await openCustomizer(page);
    await expect(rail(page)).toBeVisible();

    const labels = await rail(page)
      .getByRole("button")
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label") || ""));

    // The consolidation: exactly one Elements entry, and none of the old ones.
    expect(labels.filter((label) => label === "Elements")).toHaveLength(1);
    for (const removed of ["Shapes", "Frames", "QR Code", "QR", "Lines", "Borders"]) {
      expect(labels, `${removed} must no longer be a primary tool`).not.toContain(removed);
    }
  });

  test("opens the library with the reference section order", async ({ page }) => {
    await openCustomizer(page);
    test.skip(!(await openElements(page)), "This template enables no Elements sections.");

    const headings = await root(page)
      .getByRole("heading", { level: 3 })
      .evaluateAll((nodes) => nodes.map((node) => (node.textContent || "").trim()));

    // Only permitted sections render, so the required order is checked as a
    // subsequence of whatever this template actually shows.
    const reference = ["Dynamic Shapes", "Graphics", "Text", "Borders / Lines", "Shapes", "Frames", "QR Code"];
    const shown = headings.filter((heading) => reference.includes(heading));
    expect(shown.length, "at least one Elements section must render").toBeGreaterThan(0);
    expect(shown).toEqual(reference.filter((section) => shown.includes(section)));
  });

  test("navigates into a See more subview and back again", async ({ page }) => {
    await openCustomizer(page);
    test.skip(!(await openElements(page)), "This template enables no Elements sections.");

    const seeMore = root(page).getByRole("button", { name: /^See more / }).first();
    test.skip(!(await seeMore.count()), "No browsable section is permitted on this template.");

    const before = await root(page).getByRole("heading", { level: 3 }).count();
    await seeMore.click();

    // A focused subview: the Back control appears and the landing list collapses.
    const back = root(page).getByRole("button", { name: "Back to Elements" });
    await expect(back).toBeVisible();
    await expect(search(page)).toBeVisible();

    await back.click();
    await expect(back).toHaveCount(0);
    await expect.poll(() => root(page).getByRole("heading", { level: 3 }).count()).toBe(before);
  });

  test("closes from its own header without leaving the tool stuck open", async ({ page }) => {
    await openCustomizer(page);
    test.skip(!(await openElements(page)), "This template enables no Elements sections.");

    await root(page).getByRole("button", { name: "Close Elements" }).click();
    await expect(search(page)).toHaveCount(0);
  });
});

test.describe("every object type stays insertable and native", () => {
  // Each entry: what to click inside Elements, and the contextual control that
  // ONLY that native object type produces once it is selected on the canvas.
  const insertions: Array<{ label: string; button: RegExp; proof: RegExp }> = [
    { label: "a dynamic shape", button: /^Add (Square|Rounded square|Circle|Triangle)$/, proof: /^Corner radius|^Fill colour|^Fill color/ },
    { label: "a border line", button: /^Add (Solid|Dashed|Dotted) line$/, proof: /^Line start cap$/ },
    { label: "a text preset", button: /^Add text: /, proof: /^Font family|^Font size/ },
    { label: "a frame", button: /^Add (Square|Rounded|Circle|Arch|Oval|Full arch) frame$/, proof: /^Frame|^Fit mode/ },
  ];

  for (const { label, button, proof } of insertions) {
    test(`inserts ${label} as its own native object`, async ({ page }) => {
      await openCustomizer(page);
      test.skip(!(await openElements(page)), "This template enables no Elements sections.");

      const insert = root(page).getByRole("button", { name: button }).first();
      test.skip(!(await insert.count()), `${label} is not permitted on this template.`);
      await insert.click();

      // Insertion selects the new object, so its own toolbar must appear...
      await expect(root(page).getByRole("toolbar", { name: /1 selected objects/ })).toBeVisible();
      // ...carrying the control unique to this native type.
      await expect(root(page).getByLabel(proof).first()).toBeVisible();
    });
  }

  test("adds a QR code from the full-width Elements control", async ({ page }) => {
    await openCustomizer(page);
    test.skip(!(await openElements(page)), "This template enables no Elements sections.");

    const open = root(page).getByRole("button", { name: "Add QR Code", exact: true });
    test.skip(!(await open.count()), "QR codes are not permitted on this template.");
    await open.click();

    await root(page).getByLabel("QR code destination URL").fill("https://husnalogy.com/playwright");
    await root(page).getByRole("button", { name: "Add QR code", exact: true }).click();

    // A native QRCodeLayer: live readability status and its own error correction.
    await expect(root(page).getByRole("status")).toContainText("Readable");
    await expect(root(page).getByLabel("QR error correction")).toBeVisible();
  });

  test("rejects an invalid QR destination instead of inserting one", async ({ page }) => {
    await openCustomizer(page);
    test.skip(!(await openElements(page)), "This template enables no Elements sections.");

    const open = root(page).getByRole("button", { name: "Add QR Code", exact: true });
    test.skip(!(await open.count()), "QR codes are not permitted on this template.");
    await open.click();

    await root(page).getByLabel("QR code destination URL").fill("javascript:alert(1)");
    await expect(root(page).getByRole("alert")).toContainText(/valid http/i);
  });
});

test("an inserted object survives undo, redo and a reload", async ({ page }) => {
  await openCustomizer(page);
  test.skip(!(await openElements(page)), "This template enables no Elements sections.");

  const line = root(page).getByRole("button", { name: /^Add (Solid|Dashed|Dotted) line$/ }).first();
  test.skip(!(await line.count()), "Lines are not permitted on this template.");
  await line.click();

  const startCap = root(page).getByLabel("Line start cap");
  await expect(startCap).toBeVisible();

  const undo = root(page).getByRole("button", { name: /^Undo/i }).first();
  const redo = root(page).getByRole("button", { name: /^Redo/i }).first();
  test.skip(!(await undo.count()) || !(await redo.count()), "History controls are not exposed here.");

  await undo.click();
  await expect(startCap).toHaveCount(0);
  await redo.click();
  await expect(root(page).getByLabel("Line start cap")).toBeVisible();

  const save = root(page).getByRole("button", { name: /Save/i }).first();
  test.skip(!(await save.count()), "Saving is not offered on this template.");
  await save.click();

  // The line must PERSIST as an editable LineLayer, not a rasterised preview.
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/customizations?limit=1");
        if (!response.ok()) return [];
        const body = await response.json();
        const layers = body?.customizations?.[0]?.editorState?.userLayers || [];
        return layers.map((layer: { type?: string }) => layer.type);
      },
      { timeout: 20_000 },
    )
    .toContain("line");

  // ...and it must still be listed as a customer line after a full reload.
  await page.reload();
  await expect(root(page)).toBeVisible();

  const layersTool = rail(page).getByRole("button", { name: "Layers", exact: true });
  test.skip(!(await layersTool.count()), "The Layers panel is not enabled on this template.");
  await layersTool.click();
  await expect(root(page).getByText("Customer line", { exact: true }).first()).toBeVisible();
});

test("Elements is reachable and self-contained on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCustomizer(page);

  const tool = rail(page).getByRole("button", { name: "Elements", exact: true });
  test.skip(!(await tool.count()), "This template enables no Elements sections.");
  await tool.click();
  await expect(search(page)).toBeVisible();

  // The panel must fit the viewport rather than pushing the page sideways.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  await root(page).getByRole("button", { name: "Close Elements" }).click();
  await expect(search(page)).toHaveCount(0);
});
