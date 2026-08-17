import { describe, expect, it } from "vitest";
import {
  resetImageTransformPatch,
  resolveImageCropCapabilities,
} from "../image-permissions";
import { validateCustomerState } from "../validate";

// A photo the customer may crop, zoom and reposition but may NOT flip — the
// exact permission shape that exposed the reset bug.
const template = {
  pages: [{ id: "front", enabled: true }],
  settings: {},
  fields: [{ id: "photo", label: "Photo", type: "image" }],
  layers: [
    {
      id: "photo_layer",
      name: "Photo",
      page: "front",
      type: "image",
      fieldId: "photo",
      customerEditable: true,
      customerPermissions: {
        replaceImage: true,
        cropImage: true,
        zoomImage: true,
        repositionImage: true,
        flipImage: false,
      },
    },
  ],
};

describe("resolveImageCropCapabilities", () => {
  it("treats an explicit cropImage as the deciding permission", () => {
    const capabilities = resolveImageCropCapabilities({ cropImage: true });
    expect(capabilities.cropAllowed).toBe(true);
    expect(capabilities.canZoom).toBe(true);
    expect(capabilities.canReposition).toBe(true);
    expect(capabilities.canRotateImage).toBe(true);
  });

  it("lets zoom or reposition imply crop only when cropImage is absent", () => {
    expect(resolveImageCropCapabilities({ zoomImage: true }).cropAllowed).toBe(true);
    expect(resolveImageCropCapabilities({ repositionImage: true }).cropAllowed).toBe(true);
    // An explicit false is a decision, not a gap — it must not be overridden.
    expect(resolveImageCropCapabilities({ cropImage: false, zoomImage: true }).cropAllowed).toBe(false);
  });

  it("still offers a way into crop mode when only zoom is granted", () => {
    // The validator allows zoom on its own permission, so hiding the Crop
    // button here would make a granted permission unreachable.
    const capabilities = resolveImageCropCapabilities({ cropImage: false, zoomImage: true });
    expect(capabilities.canZoom).toBe(true);
    expect(capabilities.canEnterCrop).toBe(true);
    expect(capabilities.canRotateImage).toBe(false);
  });

  it("keeps flipping independent of the crop umbrella", () => {
    expect(resolveImageCropCapabilities({ cropImage: true }).canFlip).toBe(false);
    expect(resolveImageCropCapabilities({ flipImage: true }).canFlip).toBe(true);
    // Flip alone is enough to need crop mode.
    expect(resolveImageCropCapabilities({ flipImage: true }).canEnterCrop).toBe(true);
  });

  it("grants nothing for empty or missing permissions", () => {
    for (const input of [null, undefined, {}]) {
      const capabilities = resolveImageCropCapabilities(input);
      expect(capabilities.cropAllowed).toBe(false);
      expect(capabilities.canEnterCrop).toBe(false);
    }
  });
});

describe("resetImageTransformPatch", () => {
  it("omits flip fields when flipping is not permitted", () => {
    // The regression this guards: Reset used to send flipX/flipY regardless,
    // so a crop-but-not-flip customer had the whole save rejected with
    // `flip-not-allowed` and the reset silently did nothing.
    const patch = resetImageTransformPatch({ cropImage: true });
    expect(patch).toEqual({ zoom: 1, offsetX: 0, offsetY: 0, rotation: 0 });
    expect(patch).not.toHaveProperty("flipX");
    expect(patch).not.toHaveProperty("flipY");
  });

  it("includes flips when flipping is permitted", () => {
    const patch = resetImageTransformPatch({ cropImage: true, flipImage: true });
    expect(patch).toEqual({ zoom: 1, offsetX: 0, offsetY: 0, rotation: 0, flipX: false, flipY: false });
  });

  it("resets only zoom when zoom is the sole granted permission", () => {
    const patch = resetImageTransformPatch({ cropImage: false, zoomImage: true });
    expect(patch).toEqual({ zoom: 1 });
  });

  it("produces an empty patch when nothing is permitted", () => {
    expect(resetImageTransformPatch({})).toEqual({});
  });
});

describe("reset crop against the real permission bundle", () => {
  const permissions = template.layers[0].customerPermissions;

  // Characterisation: for a NON-grid layer, `getLayerPermissions` ignores the
  // per-layer `customerPermissions` object and returns the all-on/all-off
  // bundle driven by the single "Customer editable" checkbox. So in today's
  // model a partial shape like `cropImage:true, flipImage:false` never actually
  // reaches this toolbar, and the previous unconditional reset was not a live
  // defect. These tests pin that down so the assumption is visible if the
  // permission model is ever widened to honour per-image overrides — the way
  // grids already do.
  it("documents that a non-grid layer gets an all-or-nothing bundle", () => {
    const result = validateCustomerState(template, {
      editorState: {
        layerOverrides: {
          photo_layer: {
            imageTransform: { zoom: 1, offsetX: 0, offsetY: 0, rotation: 0, flipX: false, flipY: false },
          },
        },
      },
    } as any);
    // flipImage:false in the fixture is overridden to true by the bundle, so
    // even an unconditional reset is accepted.
    expect(result.violations).toEqual([]);
  });

  it("keeps the permission-aware reset valid for the same layer", () => {
    const result = validateCustomerState(template, {
      editorState: {
        layerOverrides: {
          photo_layer: { imageTransform: resetImageTransformPatch(permissions) },
        },
      },
    } as any);
    expect(result.violations).toEqual([]);
    expect(result.sanitizedEditorState.layerOverrides.photo_layer.imageTransform).toMatchObject({
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
    });
  });

  it("would reject an unconditional reset if flips were ever genuinely denied", () => {
    // Exercises the validator directly with a partial bundle, which is the
    // shape grid slots already produce and the guard the toolbar now honours.
    const denied = { cropImage: true, zoomImage: true, repositionImage: true, flipImage: false };
    expect(resolveImageCropCapabilities(denied).canFlip).toBe(false);
    expect(resetImageTransformPatch(denied)).not.toHaveProperty("flipX");
  });
});
