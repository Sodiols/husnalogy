import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAPTION_HEIGHT,
  CONTROL_GAP,
  CONTROL_HEIGHT,
  CONTROL_WIDTH,
  FONT_SIZE_RULES,
  LETTER_SPACING_RULES,
  LINE_HEIGHT_RULES,
  REQUIRED_CONTROL_ORDER,
  STEPPER_BUTTON_WIDTH,
  STEPPER_VALUE_WIDTH,
  controlWidth,
  numericLabelWidth,
  numericValueFits,
  TEXT_TOOLBAR_DEFAULTS,
  boldWeightForFont,
  horizontalAlignAffectsCanvas,
  isBoldWeight,
  layoutActionAvailability,
  nearestSupportedWeight,
  planPopoverPlacement,
  planTextToolbar,
  regularWeightForFont,
  resolveWeightOptions,
  sharedTextStyleValue,
  verticalAlignAffectsCanvas,
  type ToolbarControlId,
  type ToolbarDensity,
} from "../text-toolbar";
import { defaultNumericFormat, parseNumericDraft, stepNumericValue } from "@/lib/customizer/numeric-stepper";
import {
  DEFAULT_LETTER_SPACING,
  DEFAULT_LINE_HEIGHT,
  getTextResizeConstraints,
  layoutText,
  type MeasureFn,
} from "../text-layout";
import { alignLayers, distributeLayers, updateLayerStyle } from "@/app/admin/dashboard/design-builder/builder-utils";

const read = (relative: string) => readFileSync(relative, "utf8");
const toolbarSource = read("app/admin/dashboard/design-builder/AdminContextToolbar.tsx");
const popoverSource = read("app/admin/dashboard/design-builder/ToolbarPopover.tsx");
const dropdownSource = read("app/components/customizer/ToolbarDropdown.tsx");
const stepperSource = read("app/components/customizer/EditableNumericStepper.tsx");
const builderSource = read("app/admin/dashboard/design-builder/AdminDesignBuilder.tsx");

/* Deterministic measurer: 10px per character plus letter spacing. */
const measure: MeasureFn = (text, style) =>
  Array.from(text).length * (style.fontSize / 2) +
  Math.max(0, Array.from(text).length - 1) * (style.letterSpacing || 0);

const textLayer = (id: string, style: Record<string, unknown> = {}) => ({
  id,
  type: "text",
  name: id,
  page: "front",
  x: 500,
  y: 400,
  width: 400,
  height: 120,
  text: "Husnalogy",
  textStyle: { fontFamily: "Cormorant Garamond", fontSize: 48, ...style },
});

/* --------------------------------------------------------------- values --- */

describe("admin text toolbar — value resolution", () => {
  it("keeps a stored zero instead of falling back to the default", () => {
    const layers = [textLayer("a", { letterSpacing: 0 })];
    expect(sharedTextStyleValue(layers, "letterSpacing", 0).value).toBe(0);
    expect(sharedTextStyleValue(layers, "letterSpacing", 5).value).toBe(0);
  });

  it("keeps decimal values intact and falls back only for absent values", () => {
    expect(sharedTextStyleValue([textLayer("a", { lineHeight: 1.15 })], "lineHeight", 1.15).value).toBe(1.15);
    expect(sharedTextStyleValue([textLayer("a", { letterSpacing: -1.4 })], "letterSpacing", 0).value).toBe(-1.4);
    expect(sharedTextStyleValue([textLayer("a")], "lineHeight", 1.15).value).toBe(1.15);
    expect(sharedTextStyleValue([textLayer("a", { lineHeight: "not a number" })], "lineHeight", 1.15).value).toBe(1.15);
  });

  it("reports Mixed only when the selected layers really differ", () => {
    const same = [textLayer("a", { fontSize: 48 }), textLayer("b", { fontSize: 48 })];
    const differ = [textLayer("a", { fontSize: 48 }), textLayer("b", { fontSize: 64 })];
    expect(sharedTextStyleValue(same, "fontSize", 48).mixed).toBe(false);
    expect(sharedTextStyleValue(differ, "fontSize", 48).mixed).toBe(true);
    expect(sharedTextStyleValue(differ, "fontSize", 48).value).toBe(48);
  });

  it("uses the same defaults the renderers use", () => {
    // New text starts at a line height and letter spacing of 1, and Reset
    // returns to exactly that.
    expect(TEXT_TOOLBAR_DEFAULTS.lineHeight).toBe(DEFAULT_LINE_HEIGHT);
    expect(TEXT_TOOLBAR_DEFAULTS.letterSpacing).toBe(DEFAULT_LETTER_SPACING);
    expect(DEFAULT_LINE_HEIGHT).toBe(1);
    expect(DEFAULT_LETTER_SPACING).toBe(1);
    expect(TEXT_TOOLBAR_DEFAULTS.textAlign).toBe("center");
    expect(TEXT_TOOLBAR_DEFAULTS.verticalAlign).toBe("middle");
  });
});

/* -------------------------------------------------------------- numbers --- */

describe("admin text toolbar — numeric fields", () => {
  it("formats values without dropping precision or integer digits", () => {
    // Regression: 10 with a 0.1 step used to render as "1".
    expect(defaultNumericFormat(10, 0.1)).toBe("10");
    expect(defaultNumericFormat(100, 0.1)).toBe("100");
    // Regression: 1.15 with a 0.1 step used to render as "1.1".
    expect(defaultNumericFormat(1.15, 0.1)).toBe("1.15");
    expect(defaultNumericFormat(1.15, 0.05)).toBe("1.15");
    expect(defaultNumericFormat(0, 0.1)).toBe("0");
    expect(defaultNumericFormat(-1.5, 0.1)).toBe("-1.5");
    expect(defaultNumericFormat(48, 1)).toBe("48");
  });

  it("steps font size by one and by a larger keyboard step", () => {
    expect(stepNumericValue(48, 1, FONT_SIZE_RULES)).toBe(49);
    expect(stepNumericValue(48, -1, FONT_SIZE_RULES)).toBe(47);
    expect(stepNumericValue(48, 1, FONT_SIZE_RULES, true)).toBe(58);
    expect(stepNumericValue(4, -1, FONT_SIZE_RULES)).toBe(4);
    expect(stepNumericValue(500, 1, FONT_SIZE_RULES)).toBe(500);
  });

  it("steps letter spacing by 0.1 and allows negative values", () => {
    expect(stepNumericValue(0, 1, LETTER_SPACING_RULES)).toBe(0.1);
    expect(stepNumericValue(0, -1, LETTER_SPACING_RULES)).toBe(-0.1);
    expect(stepNumericValue(-0.1, -1, LETTER_SPACING_RULES)).toBe(-0.2);
    expect(LETTER_SPACING_RULES.minimum).toBeLessThan(0);
  });

  it("steps line height by 0.05 as a unitless multiplier", () => {
    expect(stepNumericValue(1.15, 1, LINE_HEIGHT_RULES)).toBe(1.2);
    expect(stepNumericValue(1.15, -1, LINE_HEIGHT_RULES)).toBe(1.1);
    expect(stepNumericValue(0.5, -1, LINE_HEIGHT_RULES)).toBe(0.5);
    expect(stepNumericValue(4, 1, LINE_HEIGHT_RULES)).toBe(4);
  });

  it("accepts typed decimals and rejects invalid input safely", () => {
    expect(parseNumericDraft("-1.4", 0, LETTER_SPACING_RULES)).toBe(-1.4);
    expect(parseNumericDraft("1.35", 1.15, LINE_HEIGHT_RULES)).toBe(1.35);
    expect(parseNumericDraft("abc", 1.15, LINE_HEIGHT_RULES)).toBe(1.15);
    expect(parseNumericDraft("999", 1.15, LINE_HEIGHT_RULES)).toBe(4);
    expect(parseNumericDraft("", 2, LETTER_SPACING_RULES)).toBe(2);
  });

  it("shows every real font size in full, including three digits", () => {
    for (const density of ["comfortable", "condensed", "icon"] as ToolbarDensity[]) {
      for (const value of ["8", "10", "14", "48", "72", "100", "120"]) {
        expect(numericValueFits(value, "fontSize", density), `${value} at ${density}`).toBe(true);
      }
    }
  });

  it("shows every real letter spacing in full, including negatives and decimals", () => {
    for (const density of ["comfortable", "condensed", "icon"] as ToolbarDensity[]) {
      for (const value of ["0", "0.5", "1.0", "1.5", "2.1", "-0.5", "-1.5"]) {
        expect(numericValueFits(value, "decimal", density), `${value} at ${density}`).toBe(true);
      }
    }
  });

  it("shows every real line height in full, including 1.15", () => {
    for (const density of ["comfortable", "condensed", "icon"] as ToolbarDensity[]) {
      for (const value of ["1", "1.1", "1.15", "1.5", "2", "4", "0.5"]) {
        expect(numericValueFits(value, "decimal", density), `${value} at ${density}`).toBe(true);
      }
    }
  });

  it("never lets a value column fall below a readable width", () => {
    // The value area is what is left after both stepper arrows, so a digit can
    // never end up hidden under a button.
    expect(STEPPER_VALUE_WIDTH.fontSize.comfortable).toBeGreaterThanOrEqual(48);
    expect(STEPPER_VALUE_WIDTH.decimal.comfortable).toBeGreaterThanOrEqual(52);
    for (const density of ["comfortable", "condensed", "icon"] as ToolbarDensity[]) {
      expect(controlWidth("fontSize", density)).toBe(
        STEPPER_BUTTON_WIDTH[density] * 2 + STEPPER_VALUE_WIDTH.fontSize[density],
      );
      expect(controlWidth("letterSpacing", density)).toBe(
        STEPPER_BUTTON_WIDTH[density] * 2 + STEPPER_VALUE_WIDTH.decimal[density],
      );
      expect(controlWidth("lineHeight", density)).toBe(controlWidth("letterSpacing", density));
      // Arrows stay a comfortable click target.
      expect(STEPPER_BUTTON_WIDTH[density]).toBeGreaterThanOrEqual(22);
    }
    expect(numericLabelWidth("100")).toBeGreaterThan(numericLabelWidth("10"));
    expect(numericLabelWidth("1.15")).toBeGreaterThan(numericLabelWidth("1.1"));
  });

  it("previews while typing and commits only on Enter, blur or a step", () => {
    expect(stepperSource).toContain("onPreviewChange");
    expect(stepperSource).toContain("if (shouldCommit) onCommit(next)");
    expect(stepperSource).toContain('event.key === "Escape"');
    expect(stepperSource).toContain("onCancel?.(originalValue.current)");
    expect(toolbarSource).toContain("onPreview={(next) => preview({ letterSpacing: next })}");
    expect(toolbarSource).toContain("onPreview={(next) => preview({ lineHeight: next })}");
    expect(toolbarSource).toContain("onPreview={(next) => preview({ fontSize: next })}");
  });

  it("wires one history entry per interaction and Escape restores the baseline", () => {
    expect(builderSource).toContain("const onSelectedTextStylePreview");
    expect(builderSource).toContain("if (snapshotted) snapshot()");
    expect(builderSource).toContain("if (session) apply(next)");
    expect(builderSource).toContain("const onSelectedTextStyleCancel");
    expect(builderSource).toContain("apply(session.baseline)");
  });
});

/* -------------------------------------------------------------- weights --- */

describe("admin text toolbar — font weight", () => {
  it("offers the five named weights and disables cuts the font does not have", () => {
    const options = resolveWeightOptions("Cormorant Garamond");
    expect(options.map((option) => option.label)).toEqual(["Light", "Regular", "Medium", "Semibold", "Bold"]);
    // The registry has 400/500/600/700 for Cormorant Garamond — no 300 cut.
    expect(options.find((option) => option.value === "300")?.disabled).toBe(true);
    expect(options.find((option) => option.value === "600")?.disabled).toBe(false);
  });

  it("never shows a weight the renderer will not draw", () => {
    // Georgia only registers 400/700, so 500 resolves to the nearest cut.
    expect(nearestSupportedWeight("Georgia", "500")).toBe("400");
    expect(nearestSupportedWeight("Cormorant Garamond", "500")).toBe("500");
    expect(nearestSupportedWeight("Cormorant Garamond", "300")).toBe("400");
  });

  it("toggles bold to the heaviest available cut and back to regular", () => {
    expect(boldWeightForFont("Cormorant Garamond")).toBe("700");
    expect(regularWeightForFont("Cormorant Garamond")).toBe("400");
    expect(isBoldWeight("700")).toBe(true);
    expect(isBoldWeight("600")).toBe(true);
    expect(isBoldWeight("400")).toBe(false);
  });
});

/* ------------------------------------------------------------ alignment --- */

describe("admin text toolbar — alignment", () => {
  it("moves the glyphs when horizontal alignment changes on a wide box", () => {
    const base = {
      text: "one\ntwo",
      width: 400,
      height: 120,
      fontFamily: "Test",
      fontSize: 40,
      lineHeight: 1.15,
      multiline: true,
      fitMode: "fixed" as const,
    };
    const left = layoutText({ ...base, textAlign: "left" }, measure);
    const centre = layoutText({ ...base, textAlign: "center" }, measure);
    const right = layoutText({ ...base, textAlign: "right" }, measure);
    expect([left.lines[0].x, centre.lines[0].x, right.lines[0].x]).toEqual([0, 200, 400]);
    // Content and manual line breaks survive the change.
    expect(right.lines.map((line) => line.text)).toEqual(["one", "two"]);
  });

  it("moves the glyphs when vertical alignment changes on a fixed-height box", () => {
    const base = {
      text: "one\ntwo",
      width: 400,
      height: 400,
      fontFamily: "Test",
      fontSize: 40,
      lineHeight: 1.15,
      multiline: true,
      fitMode: "fixed" as const,
    };
    const top = layoutText({ ...base, verticalAlign: "top" }, measure);
    const middle = layoutText({ ...base, verticalAlign: "middle" }, measure);
    const bottom = layoutText({ ...base, verticalAlign: "bottom" }, measure);
    expect(top.lines[0].y).toBeLessThan(middle.lines[0].y);
    expect(middle.lines[0].y).toBeLessThan(bottom.lines[0].y);
  });

  it("only offers vertical alignment where the box has spare height", () => {
    // Auto-width single line and auto-height boxes hug their text exactly.
    expect(verticalAlignAffectsCanvas({ multiline: false, fitMode: "fixed" }, "Name")).toBe(false);
    expect(verticalAlignAffectsCanvas({ multiline: true, fitMode: "auto-height" }, "a\nb")).toBe(false);
    expect(verticalAlignAffectsCanvas({ multiline: true, fitMode: "fixed" }, "a\nb")).toBe(true);
    expect(verticalAlignAffectsCanvas({ multiline: false, fitMode: "shrink" }, "Name")).toBe(true);
  });

  it("knows when horizontal alignment cannot move an auto-width box", () => {
    expect(horizontalAlignAffectsCanvas({ multiline: false, fitMode: "fixed" }, "Name")).toBe(false);
    expect(horizontalAlignAffectsCanvas({ multiline: false, fitMode: "fixed" }, "one\ntwo")).toBe(true);
    expect(horizontalAlignAffectsCanvas({ multiline: true, fitMode: "fixed" }, "Name")).toBe(true);
  });

  it("separates text alignment from object layout in the markup", () => {
    expect(toolbarSource).toContain('role="radiogroup"');
    expect(toolbarSource).toContain('aria-label={mixed ? "Text alignment: Mixed" : "Text alignment"}');
    expect(toolbarSource).toContain('label: "Align text left"');
    expect(toolbarSource).toContain('label: "Align text centre"');
    expect(toolbarSource).toContain('label: "Align text right"');
    expect(toolbarSource).toContain("Vertical text alignment");
    // Object alignment lives only in the Layout menu.
    expect(toolbarSource).toContain("Centre on card");
    expect(toolbarSource).toContain("Layer order");
  });
});

/* ------------------------------------------------------ letter / line ------ */

describe("admin text toolbar — letter spacing and line height reach the canvas", () => {
  const style = {
    fontFamily: "Test",
    fontSize: 40,
    fontWeight: "400",
    fontStyle: "normal" as const,
    multiline: true,
    fitMode: "fixed" as const,
    width: 1000,
    height: 400,
    text: "one\ntwo",
  };

  it("treats letter spacing as pixels in layout and measurement", () => {
    const tight = layoutText({ ...style, letterSpacing: 0, lineHeight: 1.15 }, measure);
    const wide = layoutText({ ...style, letterSpacing: 4, lineHeight: 1.15 }, measure);
    // "one" is 3 chars -> 2 gaps -> +8px at 4px spacing.
    expect(wide.lines[0].width - tight.lines[0].width).toBeCloseTo(8, 5);
  });

  it("treats line height as a unitless multiplier of the font size", () => {
    const tight = layoutText({ ...style, letterSpacing: 0, lineHeight: 1 }, measure);
    const loose = layoutText({ ...style, letterSpacing: 0, lineHeight: 2 }, measure);
    expect(tight.lineHeightPx).toBe(40);
    expect(loose.lineHeightPx).toBe(80);
    // Multiline text visibly spreads apart.
    expect(loose.lines[1].y - loose.lines[0].y).toBe(80);
    expect(tight.lines[1].y - tight.lines[0].y).toBe(40);
    expect(loose.totalHeight).toBe(tight.totalHeight * 2);
  });

  it("recalculates the required box height so selection geometry follows", () => {
    const input = {
      text: "one\ntwo",
      width: 400,
      height: 100,
      fontFamily: "Test",
      fontSize: 40,
      fontWeight: "400",
      fontStyle: "normal" as const,
      letterSpacing: 0,
      multiline: true,
      fitMode: "auto-height" as const,
    };
    const tight = getTextResizeConstraints({ ...input, lineHeight: 1 }, measure);
    const loose = getTextResizeConstraints({ ...input, lineHeight: 2 }, measure);
    expect(loose.requiredHeight).toBeGreaterThan(tight.requiredHeight);
  });

  it("writes the value straight onto the canonical text style", () => {
    const template = { layers: [textLayer("a"), textLayer("b")] };
    const next = updateLayerStyle(updateLayerStyle(template, "a", { letterSpacing: -1.5 }), "b", { lineHeight: 1.4 });
    expect(next.layers[0].textStyle.letterSpacing).toBe(-1.5);
    expect(next.layers[0].textStyle.fontSize).toBe(48);
    expect(next.layers[1].textStyle.lineHeight).toBe(1.4);
  });

  it("uses one letter-spacing unit across every renderer", () => {
    // px in the browser canvas, px in the SVG used for preview, PNG and PDF.
    expect(read("app/components/customizer/CustomizerPreview.tsx")).toContain(
      "letterSpacing: `${Number(style.letterSpacing) || 0}px`",
    );
    expect(read("lib/customizer/v2/svg.ts")).toContain('letter-spacing="${Number(style.letterSpacing)}"');
    expect(read("lib/customizer/v2/selection-geometry.ts")).toContain("letterSpacing: Number(style.letterSpacing) || 0");
    // Multiplier everywhere for line height — never pixels.
    expect(read("lib/customizer/v2/text-layout.ts")).toContain("lineHeight?: number; // multiplier");
    for (const file of [
      "app/components/customizer/CustomizerPreview.tsx",
      "lib/customizer/v2/svg.ts",
      "lib/customizer/v2/selection-geometry.ts",
      "app/admin/dashboard/design-builder/AdminCanvas.tsx",
    ]) {
      // One shared constant rather than a literal repeated per module.
      expect(read(file)).toContain("lineHeight: Number(style.lineHeight) || DEFAULT_LINE_HEIGHT");
    }
  });
});

/* ---------------------------------------------------------- layout menu --- */

describe("admin text toolbar — layout actions", () => {
  const box = (id: string, x: number, y: number) => ({
    id,
    type: "shape",
    page: "front",
    x,
    y,
    width: 100,
    height: 100,
    rotation: 0,
  });

  it("enables card alignment and centring for a single selected object", () => {
    const can = layoutActionAvailability({ selectionCount: 1, canTransform: true });
    expect(can.alignLeft.enabled).toBe(true);
    expect(can.centerOnCard.enabled).toBe(true);
    expect(can.bringToFront.enabled).toBe(true);
    expect(can.matchWidth.enabled).toBe(false);
    expect(can.distributeHorizontal.enabled).toBe(false);
    expect(can.alignLeft.reason).toContain("card");
  });

  it("enables object alignment and match size for two selected objects", () => {
    const can = layoutActionAvailability({ selectionCount: 2, canTransform: true });
    expect(can.alignLeft.enabled).toBe(true);
    expect(can.alignLeft.reason).toContain("selection");
    expect(can.matchSize.enabled).toBe(true);
    expect(can.group.enabled).toBe(true);
    expect(can.distributeHorizontal.enabled).toBe(false);
    expect(can.distributeHorizontal.reason).toContain("three");
  });

  it("enables distribution only from three selected objects", () => {
    const can = layoutActionAvailability({ selectionCount: 3, canTransform: true });
    expect(can.distributeHorizontal.enabled).toBe(true);
    expect(can.distributeVertical.enabled).toBe(true);
  });

  it("explains a locked or empty selection instead of silently greying out", () => {
    expect(layoutActionAvailability({ selectionCount: 1, canTransform: false }).alignLeft.reason).toContain("locked");
    expect(layoutActionAvailability({ selectionCount: 0, canTransform: true }).alignLeft.reason).toContain("Select");
  });

  it("centres one selected object on the card", () => {
    const template = { canvasWidthPx: 1000, canvasHeightPx: 2000, layers: [box("a", 100, 100)] };
    const centred = alignLayers(template, ["a"], "centerOnCard");
    expect(centred.layers[0].x).toBe(500);
    expect(centred.layers[0].y).toBe(1000);
  });

  it("aligns a single object to the card edges", () => {
    const template = { canvasWidthPx: 1000, canvasHeightPx: 2000, layers: [box("a", 400, 400)] };
    expect(alignLayers(template, ["a"], "left").layers[0].x).toBe(50);
    expect(alignLayers(template, ["a"], "right").layers[0].x).toBe(950);
  });

  it("aligns two selected objects to each other", () => {
    const template = { canvasWidthPx: 1000, canvasHeightPx: 2000, layers: [box("a", 200, 300), box("b", 600, 800)] };
    const aligned = alignLayers(template, ["a", "b"], "left");
    expect(aligned.layers[0].x).toBe(200);
    expect(aligned.layers[1].x).toBe(200);
  });

  it("distributes three selected objects", () => {
    const template = {
      canvasWidthPx: 1000,
      canvasHeightPx: 2000,
      layers: [box("a", 100, 100), box("b", 300, 100), box("c", 900, 100)],
    };
    const spread = distributeLayers(template, ["a", "b", "c"], "horizontal", "centers");
    expect(spread.layers[1].x).toBe(500);
  });

  it("does not block single-object alignment in the builder", () => {
    expect(builderSource).toContain("if (!canTransformSelection() || selectedLayerIds.length < 1) return;");
  });
});

/* ------------------------------------------------------------ responsive -- */

type PanelState = { left: boolean; inspector: boolean };

/** Reproduces the admin shell's own CSS widths so the planner is exercised
 *  against the real workspace, not an invented number. */
function workspaceWidth(viewport: number, panels: PanelState, zoom = 1): number {
  const cssWidth = viewport / zoom;
  const rail = cssWidth >= 1536 ? 96 : 72;
  const left = panels.left ? Math.min(Math.max(168, 0.16 * cssWidth), 280) : 0;
  // Below the lg breakpoint the inspector docks to the bottom and takes no
  // horizontal space at all.
  const inspector = panels.inspector && cssWidth >= 1024 ? Math.min(Math.max(300, 0.21 * cssWidth), 360) : 0;
  return cssWidth - rail - left - inspector - 24;
}

const VIEWPORTS = [1024, 1280, 1366, 1440, 1536, 1920];
const PANEL_STATES: Array<{ name: string; panels: PanelState }> = [
  { name: "both panels open", panels: { left: true, inspector: true } },
  { name: "left panel collapsed", panels: { left: false, inspector: true } },
  { name: "inspector collapsed", panels: { left: true, inspector: false } },
  { name: "both panels collapsed", panels: { left: false, inspector: false } },
];
const ZOOMS = [0.9, 1, 1.25];

describe("admin text toolbar — responsive plan", () => {
  for (const viewport of VIEWPORTS) {
    for (const { name, panels } of PANEL_STATES) {
      for (const zoom of ZOOMS) {
        it(`keeps every required control reachable at ${viewport}px, ${name}, ${zoom * 100}% zoom`, () => {
          const availableWidth = workspaceWidth(viewport, panels, zoom);
          const plan = planTextToolbar({
            availableWidth,
            showTextControls: true,
            selectionCount: 1,
            canVerticalAlign: true,
          });

          // 1. Nothing important is hidden: required controls are always inline.
          for (const control of REQUIRED_CONTROL_ORDER) {
            expect(plan.inline).toContain(control);
          }
          // 2. Delete stays one click away and never moves into a menu.
          expect(plan.inline).toContain("delete");
          expect(plan.overflow).not.toContain("delete");
          // 3. Nothing is silently dropped — it is inline or in the More menu.
          const placed = new Set<ToolbarControlId>([...plan.inline, ...plan.overflow]);
          for (const control of ["fontWeight", "verticalAlign", "duplicate"] as ToolbarControlId[]) {
            expect(placed.has(control)).toBe(true);
          }
          expect(plan.showMore).toBe(plan.overflow.length > 0);
          // 4. A single-row plan always fits the measured workspace, so no
          //    horizontal scrolling is ever required.
          if (plan.rows === 1) expect(plan.estimatedWidth).toBeLessThanOrEqual(availableWidth);
        });
      }
    }
  }

  it("shows the full comfortable row on a wide desktop", () => {
    const plan = planTextToolbar({
      availableWidth: workspaceWidth(1920, { left: true, inspector: true }),
      showTextControls: true,
      selectionCount: 1,
      canVerticalAlign: true,
    });
    expect(plan.density).toBe("comfortable");
    expect(plan.rows).toBe(1);
    expect(plan.showMore).toBe(false);
    expect(plan.alignmentMode).toBe("segmented");
    expect(plan.showFieldLabels).toBe(true);
    for (const control of ["fontFamily", "fontSize", "fontWeight", "textColor", "bold", "italic", "textAlign", "letterSpacing", "lineHeight", "layout", "duplicate", "delete"] as ToolbarControlId[]) {
      expect(plan.inline).toContain(control);
    }
  });

  it("keeps the segmented alignment control on mid-size desktops", () => {
    for (const viewport of [1440, 1536]) {
      const plan = planTextToolbar({
        availableWidth: workspaceWidth(viewport, { left: true, inspector: true }),
        showTextControls: true,
        selectionCount: 1,
        canVerticalAlign: true,
      });
      expect(plan.alignmentMode).toBe("segmented");
      expect(plan.rows).toBe(1);
    }
  });

  it("trades the segmented control for a dropdown before it shrinks a value column", () => {
    // At 1366 with both panels open the workspace is ~750px. Rather than
    // squeezing the numeric fields, alignment collapses to one dropdown and the
    // low-priority controls move into More — the values stay fully readable.
    const plan = planTextToolbar({
      availableWidth: workspaceWidth(1366, { left: true, inspector: true }),
      showTextControls: true,
      selectionCount: 1,
      canVerticalAlign: true,
    });
    expect(plan.alignmentMode).toBe("dropdown");
    expect(plan.rows).toBe(1);
    for (const value of ["100", "-1.5", "1.15"]) {
      expect(numericValueFits(value, value.includes(".") || value.includes("-") ? "decimal" : "fontSize", plan.density)).toBe(true);
    }
  });

  it("falls back to an alignment dropdown and a More menu when the workspace is narrow", () => {
    const plan = planTextToolbar({
      availableWidth: workspaceWidth(1280, { left: true, inspector: true }),
      showTextControls: true,
      selectionCount: 1,
      canVerticalAlign: true,
    });
    expect(plan.density).toBe("icon");
    expect(plan.alignmentMode).toBe("dropdown");
    expect(plan.showMore).toBe(true);
    expect(plan.rows).toBe(1);
  });

  it("wraps to two rows rather than clipping when the workspace is tiny", () => {
    const plan = planTextToolbar({ availableWidth: 380, showTextControls: true, selectionCount: 1 });
    expect(plan.rows).toBe(2);
    for (const control of REQUIRED_CONTROL_ORDER) expect(plan.inline).toContain(control);
  });

  it("drops the vertical alignment control entirely when it cannot do anything", () => {
    const plan = planTextToolbar({
      availableWidth: 1200,
      showTextControls: true,
      selectionCount: 1,
      canVerticalAlign: false,
    });
    expect(plan.inline).not.toContain("verticalAlign");
    expect(plan.overflow).not.toContain("verticalAlign");
  });

  it("shows the editing badge without pushing a required control out", () => {
    const plan = planTextToolbar({
      availableWidth: workspaceWidth(1920, { left: true, inspector: true }),
      showTextControls: true,
      selectionCount: 1,
      editing: true,
      canVerticalAlign: true,
    });
    expect(plan.inline).toContain("editing");
    for (const control of REQUIRED_CONTROL_ORDER) expect(plan.inline).toContain(control);
  });

  it("plans an object-only toolbar when the selection is not all text", () => {
    const plan = planTextToolbar({ availableWidth: 900, showTextControls: false, selectionCount: 2 });
    expect(plan.inline).toContain("layout");
    expect(plan.inline).toContain("delete");
    expect(plan.inline).not.toContain("fontFamily");
  });
});

/* ------------------------------------------------------- popover placement - */

describe("admin text toolbar — popovers stay inside the viewport", () => {
  const viewport = { width: 1280, height: 800 };

  it("clamps a menu opened near the right edge", () => {
    const placement = planPopoverPlacement({
      anchor: { left: 1230, right: 1270, top: 100, bottom: 136 },
      menu: { width: 260, height: 300 },
      viewport,
    });
    expect(placement.left + 260).toBeLessThanOrEqual(viewport.width - 12);
    expect(placement.left).toBeGreaterThanOrEqual(12);
  });

  it("clamps a menu opened near the left edge", () => {
    const placement = planPopoverPlacement({
      anchor: { left: -30, right: 10, top: 100, bottom: 136 },
      menu: { width: 260, height: 300 },
      viewport,
    });
    expect(placement.left).toBeGreaterThanOrEqual(12);
  });

  it("flips above the trigger when there is no room below", () => {
    const placement = planPopoverPlacement({
      anchor: { left: 100, right: 200, top: 700, bottom: 760 },
      menu: { width: 240, height: 400 },
      viewport,
    });
    expect(placement.placement).toBe("above");
    expect(placement.top).toBeGreaterThanOrEqual(12);
    expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(760);
  });

  it("never returns a menu taller than the space it has", () => {
    const placement = planPopoverPlacement({
      anchor: { left: 100, right: 200, top: 40, bottom: 80 },
      menu: { width: 240, height: 2000 },
      viewport,
    });
    expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(viewport.height);
  });
});

/* ---------------------------------------------------------- markup rules -- */

describe("admin text toolbar — structure and accessibility", () => {
  it("never relies on a hidden horizontal scrollbar", () => {
    expect(toolbarSource).not.toContain("overflow-x-auto");
    expect(toolbarSource).not.toContain("[&::-webkit-scrollbar]:hidden");
    expect(toolbarSource).not.toContain("[scrollbar-width:none]");
  });

  it("measures the real workspace with a ResizeObserver instead of breakpoints", () => {
    expect(toolbarSource).toContain("new ResizeObserver(measure)");
    expect(toolbarSource).toContain("observer?.disconnect()");
    expect(toolbarSource).toContain('window.removeEventListener("resize", measure)');
    expect(toolbarSource).toContain("planTextToolbar");
  });

  it("renders every menu through a portal that cannot be clipped", () => {
    expect(popoverSource).toContain("createPortal");
    expect(popoverSource).toContain("planPopoverPlacement");
    expect(popoverSource).toContain("z-[240]");
    expect(dropdownSource).toContain("createPortal");
    expect(dropdownSource).toContain("planPopoverPlacement");
  });

  it("marks the toolbar and every portalled menu as safe for inline text editing", () => {
    expect(toolbarSource).toContain("data-customizer-text-interaction");
    expect(popoverSource).toContain("data-customizer-text-interaction");
    expect(dropdownSource).toContain("data-customizer-text-interaction");
    expect(read("lib/customizer/v2/text-editing.ts")).toContain('"[data-customizer-text-interaction]"');
  });

  it("closes menus on Escape, on an outside press, and returns focus", () => {
    expect(popoverSource).toContain('event.key === "Escape"');
    expect(popoverSource).toContain('document.addEventListener("pointerdown", onPointerDown, true)');
    expect(popoverSource).toContain("triggerRef.current?.focus()");
    expect(popoverSource).toContain("document.removeEventListener");
  });

  it("supports keyboard navigation inside menus", () => {
    expect(popoverSource).toContain('"ArrowDown", "ArrowUp", "Home", "End"');
    expect(popoverSource).toContain("data-toolbar-menu-item");
    expect(dropdownSource).toContain('"ArrowDown", "ArrowUp", "Home", "End"');
  });

  it("labels every icon-only control and keeps disabled controls legible", () => {
    expect(toolbarSource).toContain("aria-label={mixed ? `${label}: Mixed` : label}");
    expect(toolbarSource).toContain("aria-pressed={active}");
    expect(toolbarSource).toContain("aria-disabled={disabled}");
    expect(toolbarSource).toContain("ICON_BUTTON_DISABLED");
    expect(toolbarSource).toContain('title={disabled && hint ? `${label} — ${hint}` : hint || label}');
    // Disabled controls read as a filled, dimmed control — not the old 25%
    // opacity wash that made the icon unrecognisable.
    expect(toolbarSource).toContain('const ICON_BUTTON_DISABLED = "border-[#303839]/10 bg-[#F4ECEC]/50 text-[#303839]/35"');
    expect(toolbarSource).not.toContain("disabled:opacity-25");
  });

  it("gives every control one shared height", () => {
    // The user-facing scale: one height per density, in the 32-40px band.
    for (const density of ["comfortable", "condensed", "icon"] as ToolbarDensity[]) {
      expect(CONTROL_HEIGHT[density]).toBeGreaterThanOrEqual(32);
      expect(CONTROL_HEIGHT[density]).toBeLessThanOrEqual(40);
    }
    expect(CONTROL_HEIGHT.comfortable).toBe(36);
    // Every control in the row is sized from the shared constants, never ad
    // hoc: triggers and the segmented group take the class, plain buttons and
    // the editing badge take the inline height.
    expect(toolbarSource).toContain("CONTROL_HEIGHT_CLASS: Record<ToolbarDensity, string>");
    expect(toolbarSource).toContain("style={{ height: CONTROL_HEIGHT[density] }}");
    expect(toolbarSource).toContain("${CONTROL_HEIGHT_CLASS[density]}");
    // The row itself lays controls out on a grid whose control row is exactly
    // the shared height, so nothing can be taller or shorter than its slot.
    expect(toolbarSource).toContain("`${CONTROL_HEIGHT[density]}px`");
  });

  it("builds every control from one shared style, not per-control styling", () => {
    expect(toolbarSource).toContain("const CONTROL_BASE =");
    expect(toolbarSource).toContain("const CONTROL_IDLE =");
    expect(toolbarSource).toContain("const CONTROL_ACTIVE =");
    expect(toolbarSource).toContain("const CONTROL_SHELL =");
    // One border colour, one radius, one focus ring for the whole toolbar.
    expect(toolbarSource).toContain("border-[#303839]/15");
    expect(toolbarSource).toContain("rounded-lg");
    expect(toolbarSource).toContain("focus-visible:ring-[#D4AF37]");
    // Every dropdown trigger goes through the same builder.
    expect(toolbarSource).toContain("const dropdownTrigger =");
    expect(toolbarSource).toContain("triggerClassName={dropdownTrigger()}");
    expect(toolbarSource).toContain("iconSize(density)");
  });

  it("renders each control at exactly the width the planner budgeted", () => {
    // This is the property that makes an overflowing toolbar impossible: the
    // planner's arithmetic and the painted row read the same table.
    expect(toolbarSource).toContain("const size = (id: ToolbarControlId) => controlWidth(id, density)");
    for (const id of ["fontFamily", "fontSize", "fontWeight", "textColor", "bold", "italic", "textAlign", "letterSpacing", "lineHeight", "layout", "duplicate", "delete"] as ToolbarControlId[]) {
      expect(toolbarSource).toContain(`size("${id}")`);
      expect(CONTROL_WIDTH[id].comfortable).toBeGreaterThan(0);
    }
    expect(toolbarSource).toContain("style={{ gap: CONTROL_GAP, padding: 6 }}");
    expect(CONTROL_GAP).toBeGreaterThan(0);
  });

  it("keeps the font family and weight triggers wide enough to read", () => {
    // "Cormorant Garamond" at 13px semibold needs ~130px plus chevron and padding.
    expect(CONTROL_WIDTH.fontFamily.comfortable).toBeGreaterThanOrEqual(168);
    // "Semibold" is the longest weight label.
    expect(CONTROL_WIDTH.fontWeight.comfortable).toBeGreaterThanOrEqual(92);
    // The menu is wider than its trigger and shows the full names.
    expect(toolbarSource).toContain("menuWidth={264}");
    expect(toolbarSource).toContain("previewFont");
    expect(dropdownSource).toContain("Math.max(menuWidth ?? 0, rect.width");
  });

  it("puts every caption on one line at one shared height", () => {
    expect(CAPTION_HEIGHT).toBeGreaterThan(0);
    // Reserved for every item, captioned or not, so nothing rides higher.
    expect(toolbarSource).toContain("gridTemplateRows: showCaption ? `${CAPTION_HEIGHT}px ${CONTROL_HEIGHT[density]}px`");
    expect(toolbarSource).toContain('caption="Size"');
    expect(toolbarSource).toContain('caption="Spacing"');
    expect(toolbarSource).toContain('caption="Line"');
    expect(toolbarSource).toContain('caption="Font"');
    expect(toolbarSource).toContain('caption="Weight"');
    // One caption style, defined once.
    expect(toolbarSource).toContain("const captionClass =");
  });

  it("uses one divider between major groups and none inside them", () => {
    const dividers = toolbarSource.match(/<Divider density=\{density\} \/>/g) || [];
    expect(dividers.length).toBe(1);
    expect(toolbarSource).toContain("{index > 0 &&");
  });

  it("keeps the Husnalogy palette and avoids decorative effects", () => {
    expect(toolbarSource).toContain("#303839");
    expect(toolbarSource).toContain("#D4AF37");
    expect(toolbarSource).toContain("#F4ECEC");
    expect(toolbarSource).not.toContain("gradient-to");
    expect(toolbarSource).not.toContain("drop-shadow-");
  });

  it("offers a reset for letter spacing and line height", () => {
    expect(toolbarSource).toContain("resetLabel=\"Reset letter spacing to 0\"");
    expect(toolbarSource).toContain("onReset={() => patch({ letterSpacing: 0 })}");
    expect(toolbarSource).toContain("onReset={() => patch({ lineHeight: TEXT_TOOLBAR_DEFAULTS.lineHeight })}");
    expect(toolbarSource).toContain('label="Reset letter spacing"');
    expect(toolbarSource).toContain('label="Reset line height"');
  });

  it("keeps the toolbar centred over the canvas workspace, not the window", () => {
    // The toolbar host sits inside <main>, which already excludes the tool
    // rail, the layers panel and the inspector.
    expect(builderSource).toContain('<div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-3">');
    expect(toolbarSource).toContain('<div ref={hostRef} className="pointer-events-none flex w-full justify-center">');
  });
});
