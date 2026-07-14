import { describe, it, expect } from "vitest";
import { validateCustomerState, assertOwnedUploadPath } from "../validate";

const template = {
  pages: [{ id: "front", enabled: true, allowCustomerText: true }],
  settings: { allowCustomerText: false, allowCustomerElements: false },
  fields: [
    { id: "names", label: "Names", type: "text", maxLength: 20 },
    { id: "photo", label: "Photo", type: "image" },
  ],
  layers: [
    {
      id: "names_layer",
      name: "Names",
      page: "front",
      type: "text",
      fieldId: "names",
      customerEditable: true,
      customerPermissions: {
        editContent: true,
        changeFont: true,
        changeColor: false,
        move: false,
        rotate: false,
      },
    },
    {
      id: "photo_layer",
      name: "Photo",
      page: "front",
      type: "image",
      fieldId: "photo",
      customerEditable: true,
      customerPermissions: { replaceImage: true, cropImage: true, zoomImage: true, repositionImage: true, flipImage: false },
    },
  ],
};

describe("server customization validation", () => {
  it("accepts permitted text values and clamps unknown fields", () => {
    const result = validateCustomerState(template, { values: { names: "A & B", ghost: "x" } });
    expect(result.sanitizedValues.names).toBe("A & B");
    expect(result.sanitizedValues.ghost).toBeUndefined();
    expect(result.violations.some((v) => v.code === "unknown-field")).toBe(true);
  });

  it("unlocks movement when Customer editable is checked", () => {
    const result = validateCustomerState(template, {
      editorState: { layerOverrides: { names_layer: { transform: { x: 10, y: 10 } } }, userLayers: [] },
    });
    expect(result.violations.some((v) => v.code === "move-not-allowed")).toBe(false);
    expect(result.sanitizedEditorState.layerOverrides.names_layer.transform).toMatchObject({ x: 10, y: 10 });
  });

  it("unlocks every text style control when Customer editable is checked", () => {
    const result = validateCustomerState(template, {
      editorState: {
        layerOverrides: {
          names_layer: { textStyle: { fontFamily: "Inter", color: "#ff0000" } },
        },
        userLayers: [],
      },
    });
    expect(result.violations.some((v) => v.code === "color-not-allowed")).toBe(false);
    expect(result.sanitizedEditorState.layerOverrides.names_layer.textStyle.fontFamily).toBe("Inter");
    expect(result.sanitizedEditorState.layerOverrides.names_layer.textStyle.color).toBe("#ff0000");
  });

  it("rejects customer changes when Customer editable is unchecked", () => {
    const lockedTemplate = {
      ...template,
      layers: template.layers.map((layer) =>
        layer.id === "names_layer" ? { ...layer, customerEditable: false } : layer,
      ),
    };
    const result = validateCustomerState(lockedTemplate, {
      editorState: { layerOverrides: { names_layer: { transform: { x: 10 } } }, userLayers: [] },
    });

    expect(result.violations.some((v) => v.code === "move-not-allowed")).toBe(true);
    expect(result.sanitizedEditorState.layerOverrides.names_layer).toBeUndefined();
  });

  it("rejects overrides for layers that do not exist", () => {
    const result = validateCustomerState(template, {
      editorState: { layerOverrides: { forged: { transform: { x: 1 } } }, userLayers: [] },
    });
    expect(result.violations.some((v) => v.code === "unknown-layer")).toBe(true);
  });

  it("unlocks crop and flip controls when Customer editable is checked", () => {
    const result = validateCustomerState(template, {
      editorState: {
        layerOverrides: { photo_layer: { imageTransform: { zoom: 2, flipX: true } } },
        userLayers: [],
      },
    });
    expect(result.violations.some((v) => v.code === "flip-not-allowed")).toBe(false);
    expect(result.sanitizedEditorState.layerOverrides.photo_layer.imageTransform.zoom).toBe(2);
    expect(result.sanitizedEditorState.layerOverrides.photo_layer.imageTransform.flipX).toBe(true);
  });

  it("allows customer text layers on pages that allow them", () => {
    const result = validateCustomerState(template, {
      editorState: {
        layerOverrides: {},
        userLayers: [{ id: "u1", type: "text", page: "front", text: "hello", x: 1, y: 1, width: 100, height: 40 }],
      },
    });
    expect(result.sanitizedEditorState.userLayers).toHaveLength(1);
  });

  it("rejects customer element layers when elements are disabled", () => {
    const result = validateCustomerState(template, {
      editorState: {
        layerOverrides: {},
        userLayers: [{ id: "e1", type: "element", page: "front", src: "x.svg", x: 1, y: 1, width: 100, height: 100 }],
      },
    });
    expect(result.violations.some((v) => v.code === "user-element-not-allowed")).toBe(true);
    expect(result.sanitizedEditorState.userLayers).toHaveLength(0);
  });

  it("rejects select values outside the configured options", () => {
    const withSelect = {
      ...template,
      fields: [...template.fields, { id: "flavour", label: "Flavour", type: "select", options: ["Rose", "Oud"] }],
    };
    const result = validateCustomerState(withSelect, { values: { flavour: "Vanilla" } });
    expect(result.violations.some((v) => v.code === "invalid-option")).toBe(true);
    expect(result.sanitizedValues.flavour).toBeUndefined();
  });

  it("enforces upload path ownership", () => {
    expect(assertOwnedUploadPath("user-1", "user-1/customizer/a.jpg")).toBe(true);
    expect(assertOwnedUploadPath("user-1", "user-2/customizer/a.jpg")).toBe(false);
    expect(assertOwnedUploadPath("user-1", "user-1/../user-2/a.jpg")).toBe(false);
  });
});
