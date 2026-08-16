import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

describe("single-line text resize canvas contract", () => {
  const adminCanvas = read("app/admin/dashboard/design-builder/AdminCanvas.tsx");
  const customerCanvas = read("app/components/customizer/CustomizerWorkspace.tsx");
  const adminBuilder = read("app/admin/dashboard/design-builder/AdminDesignBuilder.tsx");
  const customerEditor = read("app/products/[slug]/personalize/personalize-client.tsx");

  it("uses exactly the west and east handles for auto-sized single-line text", () => {
    for (const canvas of [adminCanvas, customerCanvas]) {
      expect(canvas).toContain('handle.id === "w" || handle.id === "e"');
      expect(canvas).toContain("singleLineTextScale ? SINGLE_LINE_TEXT_HANDLES : HANDLES");
      expect(canvas).toContain('borderRadius');
      expect(canvas).toContain('cursor: h.cursor');
    }
  });

  it("changes font size through measured proportional scaling without glyph distortion", () => {
    for (const canvas of [adminCanvas, customerCanvas]) {
      expect(canvas).toContain('"text-scale" : "resize"');
      expect(canvas).toContain("scaleSingleLineText({");
      expect(canvas).toContain("textStyle: { fontSize: result.fontSize }");
      expect(canvas).toContain("centered: e.altKey");
      expect(canvas).not.toContain("textStyle: { scaleX");
    }
  });

  it("scales the real font size from a corner handle on any text object", () => {
    for (const canvas of [adminCanvas, customerCanvas]) {
      expect(canvas).toContain('const TEXT_SCALE_HANDLES = new Set(["nw", "ne", "sw", "se"])');
      expect(canvas).toContain('? "text-box-scale"');
      expect(canvas).toContain("scaleTextBox({");
      expect(canvas).toContain("textStyle: { fontSize: scaled.fontSize, letterSpacing: scaled.letterSpacing }");
      // Corners join the handle set for single-line text too.
      expect(canvas).toContain("TEXT_SCALE_HANDLES.has(handle.id)");
    }
    // The customer may only scale text the template lets them restyle, and
    // each carried property is gated by its own permission.
    expect(customerCanvas).toContain("const canScaleTextBox");
    expect(customerEditor).toContain("permissions.changeFontSize");
    expect(customerEditor).toContain("permissions.changeLetterSpacing");
  });

  it("keeps one history start while live geometry and toolbar values update", () => {
    expect(adminCanvas).toContain("if (!drag.began)");
    expect(adminCanvas).toContain("onBeginChange?.()");
    expect(adminBuilder).toContain("updateLayerStyle(next, id, textStyle)");
    expect(customerCanvas).toContain('onLayerTransform?.(drag.layerId, {');
    expect(customerEditor).toContain('if (phase === "start")');
    expect(customerEditor).toContain("recordHistory(`transform-${layerId}`)");
    expect(customerEditor).toContain("existing.textStyle");
  });

  it("requires customer resize and font-size permissions", () => {
    expect(customerCanvas).toContain("canResize(layer)");
    expect(customerCanvas).toContain("getLayerPermissions(layer).changeFontSize");
    expect(customerCanvas).toContain("showResizeHandles");
  });

  it("keeps multiline on the existing width-based resize path", () => {
    for (const canvas of [adminCanvas, customerCanvas]) {
      expect(canvas).toContain("isSingleLineAutoSizeText");
      expect(canvas).toContain("getTextResizeConstraints");
    }
  });

  it("keeps typed font sizes synchronized with a tight measured box", () => {
    expect(adminBuilder).toContain("autoSizedSingleLine ? constraints.requiredWidth");
    expect(customerEditor).toContain("getSingleLineTextBox({");
    expect(customerEditor).toContain("width: resized.box.width");
    expect(customerEditor).toContain("height: resized.box.height");
  });
});
