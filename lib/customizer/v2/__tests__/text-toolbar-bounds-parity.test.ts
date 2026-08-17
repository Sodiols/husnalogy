import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FONT_SIZE_RULES,
  LETTER_SPACING_RULES,
  LINE_HEIGHT_RULES,
  resolveFontSizeBounds,
} from "../text-toolbar";
import { validateCustomerState } from "../validate";

// Spec §15: the numeric text controls must offer exactly the range the save
// validator accepts. The customer toolbar used to hardcode 10–400 for font
// size, −2–20 for letter spacing and 0.7–3 for line height, none of which
// matched the engine constants the admin toolbar and the validator use.

const toolbarSource = readFileSync(
  path.join(process.cwd(), "app/components/customizer/CustomerContextToolbar.tsx"),
  "utf8",
);

describe("resolveFontSizeBounds", () => {
  it("falls back to the shared font-size rules", () => {
    expect(resolveFontSizeBounds(undefined)).toEqual({
      minimum: FONT_SIZE_RULES.minimum,
      maximum: FONT_SIZE_RULES.maximum,
    });
    expect(resolveFontSizeBounds({})).toEqual({ minimum: 4, maximum: 500 });
  });

  it("narrows to the layer's own limits", () => {
    expect(resolveFontSizeBounds({ minFontSize: 24, maxFontSize: 96 })).toEqual({
      minimum: 24,
      maximum: 96,
    });
  });

  it("never drops below the engine floor", () => {
    expect(resolveFontSizeBounds({ minFontSize: 1 }).minimum).toBe(4);
  });

  it("keeps the maximum at or above the minimum", () => {
    const bounds = resolveFontSizeBounds({ minFontSize: 120, maxFontSize: 40 });
    expect(bounds.maximum).toBeGreaterThanOrEqual(bounds.minimum);
  });

  it("allows a layer to raise the ceiling above the old hardcoded 400", () => {
    expect(resolveFontSizeBounds({ maxFontSize: 500 }).maximum).toBe(500);
  });
});

describe("the toolbar no longer hardcodes its numeric ranges", () => {
  it("derives font size from the layer's bounds", () => {
    expect(toolbarSource).toContain("const fontSizeBounds = resolveFontSizeBounds(style);");
    expect(toolbarSource).toContain("minimum={fontSizeBounds.minimum}");
    expect(toolbarSource).toContain("maximum={fontSizeBounds.maximum}");
    expect(toolbarSource).not.toContain("minimum={10}\n          maximum={400}");
  });

  it("derives letter spacing and line height from the shared rules", () => {
    expect(toolbarSource).toContain("minimum={LETTER_SPACING_RULES.minimum}");
    expect(toolbarSource).toContain("maximum={LINE_HEIGHT_RULES.maximum}");
  });
});

describe("the validator clamps to the same window the toolbar offers", () => {
  const template = (textStyle: Record<string, unknown>) => ({
    pages: [{ id: "front", enabled: true }],
    fields: [],
    settings: {},
    layers: [
      {
        id: "headline",
        name: "Headline",
        page: "front",
        type: "text",
        text: "Hello",
        customerEditable: true,
        textStyle,
      },
    ],
  });

  const setFontSize = (textStyle: Record<string, unknown>, fontSize: number) =>
    validateCustomerState(template(textStyle), {
      editorState: { layerOverrides: { headline: { textStyle: { fontSize } } } },
    } as any);

  it("accepts a size the toolbar would now offer", () => {
    const bounds = resolveFontSizeBounds({ minFontSize: 24, maxFontSize: 96 });
    const result = setFontSize({ minFontSize: 24, maxFontSize: 96 }, bounds.maximum);
    expect(result.violations).toEqual([]);
    expect(result.sanitizedEditorState.layerOverrides.headline.textStyle.fontSize).toBe(96);
  });

  it("rejects a size below the layer minimum, which the old 10 floor allowed", () => {
    const result = setFontSize({ minFontSize: 24 }, 12);
    expect(result.violations.some((v: any) => v.code === "font-size-out-of-range")).toBe(true);
    expect(result.sanitizedEditorState.layerOverrides.headline.textStyle.fontSize).toBe(24);
  });

  it("accepts 500, which the old 400 ceiling made unreachable", () => {
    const result = setFontSize({}, 500);
    expect(result.violations).toEqual([]);
    expect(result.sanitizedEditorState.layerOverrides.headline.textStyle.fontSize).toBe(500);
  });
});
