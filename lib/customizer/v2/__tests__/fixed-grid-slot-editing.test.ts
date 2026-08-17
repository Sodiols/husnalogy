import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  anyGridSlotGrantsPhotoEditing,
  gridSlotGrantsPhotoEditing,
} from "../grids";
import { isLayerCustomerInteractive } from "@/app/components/customizer/customizer-utils";
import { validateCustomerState } from "../validate";

const personalizeSource = readFileSync(
  path.join(process.cwd(), "app/products/[slug]/personalize/personalize-client.tsx"),
  "utf8",
);

// Spec §17: "If the admin locks the grid position but allows slot photo
// editing, customers must be able to replace and crop slot images without
// moving the overall grid."
//
// The admin properties panel writes a full permission bundle onto the SLOT, the
// save validator merges `{ ...layerPermissions, ...slot.permissions }`, and
// `applyGridSlotAsset` does the same. Only the canvas disagreed: it asked
// `isLayerCustomerInteractive`, which bailed out as soon as the CONTAINER was
// not customer editable, so the slot buttons were never rendered and the
// permission the admin granted could not be exercised.

const fixedGridWithEditableSlots = {
  id: "photo_grid",
  name: "Photo grid",
  page: "front",
  type: "grid",
  // Container deliberately fixed.
  customerEditable: false,
  customerPermissions: {},
  slots: [
    {
      id: "slot_1",
      x: 0,
      y: 0,
      width: 0.5,
      height: 1,
      permissions: { replaceImage: true, cropImage: true },
    },
    { id: "slot_2", x: 0.5, y: 0, width: 0.5, height: 1, permissions: {} },
  ],
};

describe("grid slot permission helpers", () => {
  it("detects a slot that grants any photo permission", () => {
    expect(gridSlotGrantsPhotoEditing({ permissions: { replaceImage: true } })).toBe(true);
    expect(gridSlotGrantsPhotoEditing({ permissions: { cropImage: true } })).toBe(true);
    expect(gridSlotGrantsPhotoEditing({ permissions: { flipImage: true } })).toBe(true);
  });

  it("ignores slots with no permissions, empty permissions, or unrelated keys", () => {
    expect(gridSlotGrantsPhotoEditing({})).toBe(false);
    expect(gridSlotGrantsPhotoEditing({ permissions: {} })).toBe(false);
    expect(gridSlotGrantsPhotoEditing({ permissions: { move: true } })).toBe(false);
    expect(gridSlotGrantsPhotoEditing(null)).toBe(false);
  });

  it("reports a grid as slot-editable when at least one slot grants a permission", () => {
    expect(anyGridSlotGrantsPhotoEditing(fixedGridWithEditableSlots)).toBe(true);
    expect(anyGridSlotGrantsPhotoEditing({ slots: [{ permissions: {} }] })).toBe(false);
    expect(anyGridSlotGrantsPhotoEditing({})).toBe(false);
  });
});

describe("a fixed grid with editable slots stays reachable", () => {
  it("is interactive on the canvas even though the container is not editable", () => {
    expect(isLayerCustomerInteractive(fixedGridWithEditableSlots)).toBe(true);
  });

  it("is still hidden when the admin disables interaction outright", () => {
    // customerInteractionDisabled is the admin's explicit "customer must never
    // touch this" switch and outranks any slot permission.
    expect(
      isLayerCustomerInteractive({ ...fixedGridWithEditableSlots, customerInteractionDisabled: true }),
    ).toBe(false);
  });

  it("is still hidden when the layer itself is hidden", () => {
    expect(isLayerCustomerInteractive({ ...fixedGridWithEditableSlots, hidden: true })).toBe(false);
  });

  it("stays non-interactive when no slot grants anything", () => {
    const lockedGrid = {
      ...fixedGridWithEditableSlots,
      slots: fixedGridWithEditableSlots.slots.map((slot) => ({ ...slot, permissions: {} })),
    };
    expect(isLayerCustomerInteractive(lockedGrid)).toBe(false);
  });
});

describe("the server already accepted what the canvas was hiding", () => {
  const template = {
    pages: [{ id: "front", enabled: true }],
    settings: {},
    fields: [],
    layers: [fixedGridWithEditableSlots],
  };

  it("accepts a replace + crop on the permitted slot", () => {
    const result = validateCustomerState(template, {
      editorState: {
        layerOverrides: {
          photo_grid: {
            gridSlots: {
              slot_1: {
                assetId: "asset_b",
                src: "https://example.com/b.jpg",
                transform: { zoom: 2, offsetX: 10, offsetY: -5 },
              },
            },
          },
        },
      },
    } as any);
    expect(result.violations).toEqual([]);
    const slot = result.sanitizedEditorState.layerOverrides.photo_grid.gridSlots.slot_1;
    expect(slot.assetId).toBe("asset_b");
    expect(slot.transform).toMatchObject({ zoom: 2, offsetX: 10, offsetY: -5 });
  });

  it("still rejects the same edit on a slot that grants nothing", () => {
    const result = validateCustomerState(template, {
      editorState: {
        layerOverrides: {
          photo_grid: {
            gridSlots: { slot_2: { assetId: "asset_c", src: "https://example.com/c.jpg" } },
          },
        },
      },
    } as any);
    expect(result.violations.some((violation: any) => violation.code === "grid-replace-not-allowed")).toBe(true);
  });

  it("does not let a slot permission unlock moving the fixed container", () => {
    const result = validateCustomerState(template, {
      editorState: { layerOverrides: { photo_grid: { transform: { x: 500, y: 500 } } } },
    } as any);
    expect(result.violations.some((violation: any) => violation.code === "move-not-allowed")).toBe(true);
  });
});

describe("customer editor wiring for a fixed grid", () => {
  it("shows the grid toolbar when slots are editable, not only when the container is", () => {
    expect(personalizeSource).toContain(
      "(selectedLayer?.customerEditable || anyGridSlotGrantsPhotoEditing(selectedLayer))",
    );
  });

  it("no longer blocks slot crop dragging on the container's own editable flag", () => {
    // The merged slot permissions a few lines below are the real gate.
    expect(personalizeSource).not.toMatch(
      /if \(!layer \|\| !slot \|\| !layer\.customerEditable\) return;/,
    );
    expect(personalizeSource).toContain(
      "if (!layer || !slot || layer.customerInteractionDisabled) return;",
    );
  });

  it("still merges the slot's own permissions before allowing an edit", () => {
    expect(personalizeSource).toContain(
      "{ ...getLayerPermissions(layer), ...(slot.permissions || {}) }",
    );
  });
});
