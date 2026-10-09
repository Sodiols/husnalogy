import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCustomerContextMenu } from "../context-menu";

// Spec §24: the admin design studio should give the canvas maximum useful
// space, avoid excessively wide permanent panels, collapse panels where useful,
// and make active tools unmistakable — without mixing product configuration
// into object editing.
//
// The audit found the SHELL already correct: both sidebars are clamped with
// sensible minimum/maximum widths and the inspector becomes a bottom sheet on
// narrow screens. What was missing was keyboard focus: six components rendering
// 37 buttons between them had no focus-visible treatment at all, a larger gap
// than the customer editor had.

const BUILDER_DIR = path.join(process.cwd(), "app/admin/dashboard/design-builder");
const files = readdirSync(BUILDER_DIR).filter((name) => name.endsWith(".tsx"));
const read = (name: string) => readFileSync(path.join(BUILDER_DIR, name), "utf8");
const sources = new Map(files.map((name) => [name, read(name)]));
const shell = sources.get("AdminDesignBuilder.tsx")!;

describe("the studio shell keeps the canvas the hero", () => {
  it("clamps the side panel rather than fixing it wide", () => {
    // Wide enough for a layer row's name and controls, narrow enough that
    // the canvas stays the largest thing on screen.
    expect(shell).toContain("xl:w-[clamp(280px,22vw,340px)]");
    expect(shell).toContain("sm:w-[clamp(260px,32vw,320px)]");
  });

  it("keeps the side panel slot one width from xl, so switching panels never moves the artboard", () => {
    const slot = shell.slice(shell.indexOf("{/* The panel slot."), shell.indexOf("data-admin-side-panel-slot"));
    expect(slot).toContain("xl:ml-3 xl:w-[clamp(280px,22vw,340px)]");
  });

  it("below xl, reserves the panel slot only while a panel is open", () => {
    const slot = shell.slice(shell.indexOf("{/* The panel slot."), shell.indexOf("data-admin-side-panel-slot"));
    expect(slot).toContain("w-0");
    expect(slot).toContain('${sidePanel ? "sm:ml-3 sm:w-[clamp(260px,32vw,320px)]" : ""}');
  });

  it("floats an open side panel over the canvas on phones instead of squeezing it", () => {
    expect(shell).toContain("max-sm:absolute max-sm:bottom-3 max-sm:left-full max-sm:top-3 max-sm:z-40");
    expect(shell).toContain("max-sm:w-[min(340px,calc(100vw-112px))]");
  });

  it("publishes in one step, with no minor / major choice", () => {
    expect(shell).not.toContain("Minor Update");
    expect(shell).not.toContain("Major Update");
  });

  it("clamps the inspector and caps it well under half the viewport", () => {
    expect(shell).toContain("xl:w-[clamp(300px,21vw,360px)]");
    expect(shell).toContain("lg:w-[clamp(280px,25vw,300px)]");
  });

  it("gives the canvas the remaining space with no minimum that could push the inspector off-screen", () => {
    expect(shell).toContain('<main className="relative min-h-0 min-w-0 flex-1');
    expect(shell).not.toContain("min-w-[420px]");
  });

  it("turns the inspector into a sheet under the canvas on narrow, tall screens, shown only with a selection", () => {
    // Rather than shrinking a desktop sidebar until it is unusable, or
    // covering the canvas with an empty "Nothing selected" sheet.
    expect(shell).toContain("studio-sheet:grid studio-sheet:grid-cols-[auto_minmax(0,1fr)] studio-sheet:grid-rows-[minmax(0,1fr)_auto]");
    expect(shell).toContain("studio-sheet:col-span-2");
    expect(shell).toContain("studio-sheet:w-full");
    expect(shell).toContain('selectedLayerIds.length > 0 ? "" : "max-lg:hidden"');
    expect(shell).not.toContain("max-lg:absolute");
    // A short landscape screen keeps the inspector as a narrow column, so the
    // canvas keeps its height.
    const globals = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    expect(globals).toContain("@custom-variant studio-sheet (@media (max-width: 1023.98px) and (min-height: 640px));");
    expect(shell).toContain("w-[clamp(240px,32vw,300px)]");
  });
});

describe("every admin component shows keyboard focus", () => {
  it.each(files)("%s", (name) => {
    const source = sources.get(name)!;
    const hasFocusable = /<(button|input|select|textarea)\b/.test(source);
    if (!hasFocusable) return;
    expect(source).toMatch(/focus-visible:|focus-within:|focus:/);
  });
});

describe("side-panel controls use an offset focus ring", () => {
  // The layers and pages panels sit on the white side panel, so their focus
  // ring is lifted off a white surface.
  const PANELS = ["AdminLayersPanel.tsx", "AdminPagesPanel.tsx"];

  it.each(PANELS)("%s", (name) => {
    const source = sources.get(name)!;
    expect(source).toContain("focus-visible:ring-offset-white");
    expect(source).not.toContain("ring-offset-[#2A3132]");
  });
});

describe("admin row controls meet the AA target size", () => {
  // These are dense desktop list controls, so the applicable bar is WCAG 2.5.8
  // AA (24x24) rather than the 44px the customer editor standardises on.
  it("has no sub-24px interactive control left in the layers panel", () => {
    const source = sources.get("AdminLayersPanel.tsx")!;
    expect(source).not.toMatch(/\bh-6 w-5\b/);
    expect(source).not.toMatch(/\bh-5 w-4\b/);
  });
});

describe("destructive admin actions are not signalled by colour alone", () => {
  it("gives Delete an accessible name so it is not signalled by colour alone", () => {
    // Delete is on the selection toolbar (as an icon) and in the object menu.
    // Either way the destructive action must be identifiable without seeing
    // that it is red: the toolbar button carries the accessible name "Delete".
    const toolbar = sources.get("AdminContextToolbar.tsx")!;
    expect(toolbar).toContain('label="Delete" path={ICONS.trash}');
    const destructive = buildCustomerContextMenu({ selectionCount: 1, canDelete: true }).flat().find((item) => item.id === "delete");
    expect(destructive).toMatchObject({ label: "Delete", danger: true });
    const menu = readFileSync(path.join(process.cwd(), "app/components/customizer/CustomerCanvasContextMenu.tsx"), "utf8");
    // The red treatment is an ADDITION to the visible label, never the only signal.
    expect(menu).toContain("{item.label}");
    expect(menu).toContain("item.danger");
  });
});

describe("side-panel controls use an offset focus ring", () => {
  // The layers and pages panels sit on the white side panel, so their focus
  // ring is lifted off a white surface.
  const PANELS = ["AdminLayersPanel.tsx", "AdminPagesPanel.tsx"];

  it.each(PANELS)("%s", (name) => {
    const source = sources.get(name)!;
    expect(source).toContain("focus-visible:ring-offset-white");
    expect(source).not.toContain("ring-offset-[#2A3132]");
  });
});

describe("admin row controls meet the AA target size", () => {
  // These are dense desktop list controls, so the applicable bar is WCAG 2.5.8
  // AA (24x24) rather than the 44px the customer editor standardises on.
  it("has no sub-24px interactive control left in the layers panel", () => {
    const source = sources.get("AdminLayersPanel.tsx")!;
    expect(source).not.toMatch(/\bh-6 w-5\b/);
    expect(source).not.toMatch(/\bh-5 w-4\b/);
  });
});

