import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
  it("clamps the left workspace sidebar rather than fixing it wide", () => {
    // The lower bound leaves room for the drag grip, the layer name and the
    // three row controls, so a narrow panel truncates the name instead of
    // overflowing and growing a horizontal scrollbar.
    expect(shell).toContain("w-[clamp(200px,16vw,280px)]");
  });

  it("clamps the inspector and caps it well under half the viewport", () => {
    expect(shell).toContain("w-[clamp(300px,21vw,360px)]");
  });

  it("gives the canvas the remaining space with a workable minimum", () => {
    expect(shell).toContain('min-h-0 min-w-[420px] flex-1');
  });

  it("collapses the inspector into a bottom sheet on narrow screens", () => {
    // Rather than shrinking a desktop sidebar until it is unusable.
    expect(shell).toContain("max-lg:absolute");
    expect(shell).toContain("max-lg:bottom-0");
    expect(shell).toContain("max-lg:w-full");
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

describe("dark-sidebar controls use an offset focus ring", () => {
  // A plain gold ring on the charcoal sidebar has far less separation than one
  // lifted off the surface, so the sidebar panels use the offset variant.
  const DARK_PANELS = ["AdminLayersPanel.tsx", "AdminPagesPanel.tsx"];

  it.each(DARK_PANELS)("%s", (name) => {
    const source = sources.get(name)!;
    expect(source).toContain("focus-visible:ring-offset-[#2A3132]");
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
    // Delete moved off the layer row and onto the context toolbar. The rule it
    // has to satisfy is unchanged: the destructive action must be identifiable
    // without seeing that it is red.
    const source = sources.get("AdminContextToolbar.tsx")!;
    expect(source).toContain('props.selectionCount === 1 ? "Delete the selected object"');
    expect(source).toContain("label={deleteLabel}");
    expect(source).toContain("hint={deleteLabel}");
    // The red treatment is an ADDITION to the name, never the only signal.
    expect(source).toContain("if (options.danger) return");
  });
});

describe("dark-sidebar controls use an offset focus ring", () => {
  // A plain gold ring on the charcoal sidebar has far less separation than one
  // lifted off the surface, so the sidebar panels use the offset variant.
  const DARK_PANELS = ["AdminLayersPanel.tsx", "AdminPagesPanel.tsx"];

  it.each(DARK_PANELS)("%s", (name) => {
    const source = sources.get(name)!;
    expect(source).toContain("focus-visible:ring-offset-[#2A3132]");
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

