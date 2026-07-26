import { describe, expect, it } from "vitest";
import { isUnchangedPersistedOverrideViolation } from "../../save-validation";

const violation = (code: string) => ({
  code,
  layerId: "text-layer",
  message: code,
});

describe("customization save version drift", () => {
  const existingEditorState = {
    layerOverrides: {
      "text-layer": {
        transform: {
          x: 725,
          y: 292,
          width: 655,
          height: 163,
          zIndex: 2,
        },
      },
    },
    userLayers: [],
  };

  it("recognizes unchanged transform overrides from an older saved draft", () => {
    const submittedEditorState = structuredClone(existingEditorState);

    expect(
      isUnchangedPersistedOverrideViolation(
        violation("move-not-allowed"),
        submittedEditorState,
        existingEditorState,
      ),
    ).toBe(true);
    expect(
      isUnchangedPersistedOverrideViolation(
        violation("resize-not-allowed"),
        submittedEditorState,
        existingEditorState,
      ),
    ).toBe(true);
    expect(
      isUnchangedPersistedOverrideViolation(
        violation("layer-order-not-allowed"),
        submittedEditorState,
        existingEditorState,
      ),
    ).toBe(true);
  });

  it("continues rejecting newly changed forbidden values", () => {
    const submittedEditorState = structuredClone(existingEditorState);
    submittedEditorState.layerOverrides["text-layer"].transform.x = 900;

    expect(
      isUnchangedPersistedOverrideViolation(
        violation("move-not-allowed"),
        submittedEditorState,
        existingEditorState,
      ),
    ).toBe(false);
  });

  it("does not soften unrelated permission violations", () => {
    expect(
      isUnchangedPersistedOverrideViolation(
        violation("property-not-allowed"),
        existingEditorState,
        existingEditorState,
      ),
    ).toBe(false);
  });
});
