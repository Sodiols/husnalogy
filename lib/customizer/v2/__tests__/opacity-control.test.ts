/**
 * Universal opacity.
 *
 * Opacity now covers every visual layer type and a multi-selection, uses the
 * document's existing `opacity` property (no parallel system), and drags as one
 * history step rather than one per pixel.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");
const panel = read("app/components/customizer/CustomerSelectionPanel.tsx");
const stepper = read("app/components/customizer/EditableNumericStepper.tsx");
const personalize = read("app/products/[slug]/personalize/personalize-client.tsx");

describe("opacity control", () => {
  it("covers every visual layer type", () => {
    for (const type of ["text", "image", "frame", "shape", "element", "group", "qrCode", "grid", "background"]) {
      expect(panel).toContain(`"${type}"`);
    }
    expect(panel).toContain("const opacityApplies = layers.every(");
  });

  it("is offered for a multi-selection, not just one object", () => {
    // The old control was gated on `layers.length === 1`.
    expect(panel).toContain("{opacityApplies && (");
    expect(panel).toContain("multiple={layers.length > 1}");
    expect(panel).not.toContain("{layers.length === 1 && (\n        <div className=\"mt-4\">");
  });

  it("treats an absent opacity as fully opaque", () => {
    // `opacity` is optional in the document; a missing value means 100%, and
    // reading it as 0 would show every untouched layer as invisible.
    expect(panel).toContain("Number.isFinite(rawOpacity) ? rawOpacity : 1");
  });

  it("pairs a slider with the exact numeric value", () => {
    expect(panel).toContain("<EditableNumericStepper");
    expect(panel).toContain("slider");
    expect(panel).toContain("onPreviewChange={onPreview}");
  });

  it("keeps the slider inside the ONE shared numeric control", () => {
    // The editor's contract is a single numeric control with one set of rules;
    // an ad-hoc range input elsewhere would drift from them.
    expect(stepper).toContain("slider?: boolean");
    expect(stepper).toContain('type="range"');
    expect(stepper).toContain("if (!slider) return stepperBody;");
  });

  it("streams a live preview and commits once on release", () => {
    expect(stepper).toContain("if (onPreviewChange) onPreviewChange(next);");
    expect(stepper).toContain("onPointerUp={(event) => onCommit(");
  });

  it("applies to every permitted member under ONE history key", () => {
    expect(personalize).toContain("const historyGroup = `opacity-${selectedLayers.map((layer: any) => layer.id).join(\"-\")}`");
    expect(personalize).toContain("for (const layer of selectedLayers)");
    // Uses the document's own opacity property, on the existing override path.
    expect(personalize).toContain('updateLayerOverride(layer.id, "transform", { opacity }, historyGroup)');
  });

  it("still respects the customer permission", () => {
    expect(panel).toContain('const canOpacity = allow("changeOpacity")');
    expect(panel).toContain("disabled={!canOpacity}");
    expect(personalize).toContain("getLayerPermissions(layer).changeOpacity");
  });
});
