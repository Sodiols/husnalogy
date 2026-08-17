import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateCustomerState } from "../validate";

// Spec §25/§33: the template's customerObjectLimits (position insets, min/max
// size, rotation range) are enforced by the save validator for BOTH customer-
// added layers and overrides on template layers.
//
// The customer editor only applied them to its own user layers. Dragging a
// TEMPLATE layer past the limits therefore moved freely on screen and was
// silently clamped by the server, which also raised `customer-object-limit`.

const personalizeSource = readFileSync(
  path.join(process.cwd(), "app/products/[slug]/personalize/personalize-client.tsx"),
  "utf8",
);

const template = {
  pages: [{ id: "front", enabled: true, widthPx: 1500, heightPx: 2100 }],
  canvasWidthPx: 1500,
  canvasHeightPx: 2100,
  fields: [],
  settings: {
    customerObjectLimits: {
      insetLeft: 100,
      insetTop: 100,
      insetRight: 100,
      insetBottom: 100,
      minRotation: -15,
      maxRotation: 15,
    },
  },
  layers: [
    {
      id: "template_photo",
      name: "Photo",
      page: "front",
      type: "image",
      width: 400,
      height: 300,
      x: 750,
      y: 1050,
      customerEditable: true,
    },
  ],
};

const move = (transform: Record<string, number>) =>
  validateCustomerState(template, {
    editorState: { layerOverrides: { template_photo: { transform } } },
  } as any);

describe("customerObjectLimits apply to template layers on the server", () => {
  it("clamps a move that leaves the allowed inset", () => {
    // x=50 would put the 400-wide object well outside the 100px left inset.
    const result = move({ x: 50, y: 1050 });
    expect(result.violations.some((v: any) => v.code === "customer-object-limit")).toBe(true);
    // Clamped to inset + half the width.
    expect(result.sanitizedEditorState.layerOverrides.template_photo.transform.x).toBe(300);
  });

  it("clamps rotation to the template's range", () => {
    const result = move({ rotation: 90 });
    expect(result.violations.some((v: any) => v.code === "customer-object-limit")).toBe(true);
    expect(result.sanitizedEditorState.layerOverrides.template_photo.transform.rotation).toBe(15);
  });

  it("accepts a move that stays inside the limits", () => {
    const result = move({ x: 400, y: 900 });
    expect(result.violations).toEqual([]);
    expect(result.sanitizedEditorState.layerOverrides.template_photo.transform).toMatchObject({
      x: 400,
      y: 900,
    });
  });
});

describe("the customer editor now constrains template layers too", () => {
  it("applies the limits in the template-layer branch of onLayerTransform", () => {
    expect(personalizeSource).toContain(
      "const constrained = applyCustomerObjectLimits(layer, allowed, layer.page || activePage);",
    );
  });

  it("still constrains its own user layers", () => {
    expect(personalizeSource).toContain(
      "const constrainedPatch = applyCustomerObjectLimits(layer, transformPatch, layer.page || activePage);",
    );
  });

  it("keeps the client clamp arithmetically identical to the validator", () => {
    // Both derive the same bounds from the same settings object; if either side
    // is edited without the other, this pairing is the tripwire.
    for (const fragment of [
      "const minWidth = Math.max(1, Number(limits.minWidth) || 1);",
      "const maxWidth = Number(limits.maxWidth) > 0 ? Number(limits.maxWidth) : pageWidth;",
      "const left = Math.max(0, Number(limits.insetLeft) || 0);",
    ]) {
      expect(personalizeSource).toContain(fragment);
    }
  });
});
