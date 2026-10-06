import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FONT_SIZE_RULES,
  LETTER_SPACING_RULES,
  LINE_HEIGHT_RULES,
  TEXT_TOOLBAR_DEFAULTS,
  boldWeightForFont,
  isBoldWeight,
  nearestSupportedWeight,
  planPopoverPlacement,
  regularWeightForFont,
  resolveWeightOptions,
  sharedTextStyleValue,
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

  it("previews while typing and commits only on Enter, blur or a step", () => {
    expect(stepperSource).toContain("onPreviewChange");
    expect(stepperSource).toContain("if (shouldCommit) onCommit(next)");
    expect(stepperSource).toContain('event.key === "Escape"');
    expect(stepperSource).toContain("onCancel?.(originalValue.current)");
    expect(toolbarSource).toContain("onPreview={(next) => props.onStylePreview({ fontSize: next })}");
    expect(toolbarSource).toContain("onCommit={(next) => props.onStylePatch({ fontSize: next })}");
    // A shape's line weight follows the same preview → commit → cancel contract.
    expect(toolbarSource).toContain("onPreview={(next) => props.onLayerPropsPreview({ strokeWidth: next })}");
    expect(toolbarSource).toContain("onCancel={props.onLayerPropsCancel}");
  });

  it("keeps letter spacing and line height editable in the inspector", () => {
    // The reference toolbar has no spacing controls; the inspector carries them.
    const inspector = read("app/admin/dashboard/design-builder/AdminPropertiesPanel.tsx");
    expect(inspector).toContain('ariaLabel="Letter spacing"');
    expect(inspector).toContain('ariaLabel="Line height"');
    expect(inspector).toContain('ariaLabel="Font weight"');
    expect(inspector).toContain("min={LETTER_SPACING_RULES.minimum}");
    expect(inspector).toContain("max={LINE_HEIGHT_RULES.maximum}");
  });

  it("wires one history entry per interaction and Escape restores the baseline", () => {
    expect(builderSource).toContain("const onSelectedTextStylePreview");
    expect(builderSource).toContain("if (snapshotted) snapshot()");
    expect(builderSource).toContain("if (session) apply(next)");
    expect(builderSource).toContain("const onSelectedTextStyleCancel");
    expect(builderSource).toContain("apply(session.baseline, session.revision)");
  });
});

/* -------------------------------------------------------------- weights --- */

describe("admin text toolbar — font weight", () => {
  // Weights now come from the selected family's real Google Fonts variants,
  // so these take the family's available weights rather than a family name.
  const PLAYFAIR = ["400", "700"]; // serif with no light/medium cuts
  const MONTSERRAT = ["100", "400", "600", "800"]; // wide variable-ish range

  it("offers exactly the weights the family ships — never a fixed list", () => {
    expect(resolveWeightOptions(PLAYFAIR).map((option) => option.value)).toEqual(["400", "700"]);
    expect(resolveWeightOptions(MONTSERRAT).map((option) => option.value)).toEqual(["100", "400", "600", "800"]);
  });

  it("labels weights on the standard CSS scale", () => {
    expect(resolveWeightOptions(PLAYFAIR).map((option) => option.label)).toEqual(["Regular", "Bold"]);
    expect(resolveWeightOptions(MONTSERRAT).map((option) => option.label)).toEqual([
      "Thin",
      "Regular",
      "Semibold",
      "Extra bold",
    ]);
  });

  it("never offers a weight the family cannot draw", () => {
    // Playfair has no 300/500/600 — none of them may appear as an option.
    const values = resolveWeightOptions(PLAYFAIR).map((option) => option.value);
    expect(values).not.toContain("300");
    expect(values).not.toContain("500");
    expect(values).not.toContain("600");
  });

  it("snaps an unavailable weight to the nearest cut the renderer will use", () => {
    expect(nearestSupportedWeight(PLAYFAIR, "500")).toBe("400");
    expect(nearestSupportedWeight(PLAYFAIR, "600")).toBe("700");
    expect(nearestSupportedWeight(MONTSERRAT, "700")).toBe("800");
    expect(nearestSupportedWeight(MONTSERRAT, "400")).toBe("400");
  });

  it("falls back to a safe pair when the catalog has not loaded yet", () => {
    expect(resolveWeightOptions(undefined).map((option) => option.value)).toEqual(["400", "700"]);
    expect(resolveWeightOptions([]).map((option) => option.value)).toEqual(["400", "700"]);
  });

  it("toggles bold to the heaviest available cut and back to regular", () => {
    expect(boldWeightForFont(PLAYFAIR)).toBe("700");
    expect(regularWeightForFont(PLAYFAIR)).toBe("400");
    // Montserrat's heaviest is 800 and its lightest-at-or-below-400 is 400.
    expect(boldWeightForFont(MONTSERRAT)).toBe("800");
    expect(regularWeightForFont(MONTSERRAT)).toBe("400");
    expect(isBoldWeight("700")).toBe(true);
    expect(isBoldWeight("600")).toBe(true);
    expect(isBoldWeight("400")).toBe(false);
  });

  it("handles a family whose only cut is heavy", () => {
    expect(boldWeightForFont(["900"])).toBe("900");
    expect(regularWeightForFont(["900"])).toBe("900");
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

  it("keeps text alignment and text growth in one small dropdown, apart from the Alignment panel", () => {
    expect(toolbarSource).toContain('aria-label="Text alignment"');
    expect(toolbarSource).toContain('aria-label="Text growth"');
    expect(toolbarSource).toContain('label: "Align text left"');
    expect(toolbarSource).toContain('label: "Align text centre"');
    expect(toolbarSource).toContain('label: "Align text right"');
    expect(toolbarSource).toContain('up: "Grow upward"');
    expect(toolbarSource).toContain('center: "Grow from centre"');
    expect(toolbarSource).toContain('down: "Grow downward"');
    // Growth writes growthDirection — it is not vertical alignment.
    expect(toolbarSource).toContain("onGrowth={(value) => props.onStylePatch({ growthDirection: value })}");
    expect(toolbarSource).not.toContain("verticalAlign");
    // The word "Alignment" opens the full panel; the mini dropdown never does.
    expect(toolbarSource).toContain('aria-controls="admin-alignment-panel"');
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
  it("stays one row and scrolls sideways when the workspace is narrow — never wraps", () => {
    expect(toolbarSource).toContain("overflow-x-auto");
    expect(toolbarSource).not.toContain("flex-wrap");
    // A vertical wheel over an overflowing bar scrolls it sideways.
    expect(toolbarSource).toContain("strip.scrollLeft += event.deltaY");
  });

  it("renders every menu through a portal that a scrolling bar cannot clip", () => {
    expect(popoverSource).toContain("createPortal");
    expect(popoverSource).toContain("planPopoverPlacement");
    expect(popoverSource).toContain("z-[240]");
    expect(dropdownSource).toContain("createPortal");
    expect(dropdownSource).toContain("planPopoverPlacement");
    // The font list too: the toolbar asks the shared selector to portal it.
    expect(toolbarSource).toMatch(/^\s*portal\s*$/m);
    expect(read("app/components/customizer/GoogleFontSelector.tsx")).toContain("createPortal(panel, document.body)");
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

  it("names every icon-only control and explains a disabled one", () => {
    expect(toolbarSource).toContain("aria-label={label}");
    expect(toolbarSource).toContain("aria-pressed={pressed}");
    expect(toolbarSource).toContain("title={disabled && reason ? `${label} — ${reason}` : label}");
    expect(toolbarSource).toContain('label="Copy"');
    expect(toolbarSource).toContain('label="Delete" path={ICONS.trash}');
    expect(toolbarSource).toContain('label="Scale smaller"');
    expect(toolbarSource).toContain('label="Scale larger"');
  });

  it("builds every control from one shared style with an obvious on state", () => {
    expect(toolbarSource).toContain("const BUTTON =");
    expect(toolbarSource).toContain("const BUTTON_ON =");
    expect(toolbarSource).toContain("const ICON_BUTTON = `${BUTTON} w-9`");
    expect(toolbarSource).toContain("const TEXT_BUTTON = `${BUTTON} px-3`");
    expect(toolbarSource).not.toContain("gradient-to");
    expect(toolbarSource).not.toContain("drop-shadow-");
  });

  it("uses the shared searchable Google Fonts selector, shown as Font: <name>", () => {
    expect(toolbarSource).toContain("<GoogleFontSelector");
    expect(toolbarSource).toContain('from "@/app/components/customizer/GoogleFontSelector"');
    expect(toolbarSource).toContain('triggerPrefix="Font:"');
    expect(toolbarSource).not.toContain("CUSTOMIZER_APPROVED_FONTS");
  });

  it("derives bold and italic from the selected family's real cuts", () => {
    expect(toolbarSource).toContain("useFamilyCapabilities");
    expect(toolbarSource).toContain("nearestSupportedWeight(capabilities.weights, fontWeight.value)");
    expect(toolbarSource).toContain("boldWeightForFont(capabilities.weights)");
  });

  it("keeps a font change to a single undo step by patching weight in the same call", () => {
    expect(toolbarSource).toContain("const applyFontFamily = (next: string) => {");
    expect(toolbarSource).toContain("props.onStylePatch(change);");
  });

  it("separates the toolbar's groups with one divider each", () => {
    expect(toolbarSource).toContain("{index > 0 && <Separator />}");
  });

  it("keeps the toolbar centred over the canvas workspace, not the window", () => {
    expect(builderSource).toContain('<div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-3">');
    expect(toolbarSource).toContain('<div className="pointer-events-none flex w-full justify-center">');
  });
});
