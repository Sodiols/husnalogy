/**
 * The Design Studio's tool rail and side panels, for specs that need to add
 * objects. One place, so every spec drives the same UI the admin uses.
 */
import { expect, type Page } from "@playwright/test";

const studio = (page: Page) => page.locator("[data-admin-customizer]");
export const rail = (page: Page) => studio(page).getByRole("navigation", { name: "Design tools" });
export const sidePanel = (page: Page, id?: string) => studio(page).locator(id ? `[data-admin-side-panel="${id}"]` : "[data-admin-side-panel]");

const PANEL_IDS = {
  "Add Text": "text",
  Uploads: "uploads",
  Background: "background",
  Elements: "elements",
  Icons: "icons",
  Options: "options",
  Moment: "moment",
  Layers: "layers",
  Pages: "pages",
} as const;

/** Open a rail item's side panel (left as it is when it is already open). */
export async function openSidePanel(page: Page, label: keyof typeof PANEL_IDS) {
  const id = PANEL_IDS[label];
  if (await sidePanel(page, id).count()) return sidePanel(page, id);
  await rail(page).getByRole("button", { name: label, exact: true }).click();
  await expect(sidePanel(page, id)).toBeVisible();
  return sidePanel(page, id);
}

/** The four Dynamic Shapes at the top of Elements; anything else comes from the Shapes library. */
const DYNAMIC_SHAPES: Record<string, string> = {
  rectangle: "Add Square",
  "rounded-rectangle": "Add Rounded square",
  circle: "Add Circle",
  triangle: "Add Triangle",
};

/** Add a shape through Elements: a Dynamic Shape, or a Shapes-library shape by its name ("oval", "heart"). */
export async function addStudioShape(page: Page, kind: string) {
  const panel = await openSidePanel(page, "Elements");
  if (await panel.getByRole("button", { name: "Back to Elements" }).count()) await panel.getByRole("button", { name: "Back to Elements" }).click();
  if (DYNAMIC_SHAPES[kind]) {
    await panel.getByRole("button", { name: DYNAMIC_SHAPES[kind], exact: true }).click();
    return;
  }
  await panel.getByRole("button", { name: "See more shapes" }).click();
  await panel.getByRole("button", { name: `Add ${kind.replace(/-/g, " ")} shape`, exact: true }).click();
  await panel.getByRole("button", { name: "Back to Elements" }).click();
}

/** Add a customer photo frame (square) through Elements → Frames. */
export async function addStudioFrame(page: Page) {
  const panel = await openSidePanel(page, "Elements");
  if (await panel.getByRole("button", { name: "Back to Elements" }).count()) await panel.getByRole("button", { name: "Back to Elements" }).click();
  await panel.getByRole("button", { name: "Add Square frame", exact: true }).click();
}

/** Add Text: a new text object, ready to type into (the panel is closed first so the rail adds rather than toggles). */
export async function addStudioText(page: Page) {
  if (await sidePanel(page, "text").count()) await sidePanel(page, "text").getByRole("button", { name: "Close panel" }).click();
  await rail(page).getByRole("button", { name: "Add Text", exact: true }).click();
}

/** Back to the plain Edit (select) tool, side panel closed. */
export async function selectEditTool(page: Page) {
  await rail(page).getByRole("button", { name: "Edit", exact: true }).click();
}
