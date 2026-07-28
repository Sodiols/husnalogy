import { describe, expect, it } from "vitest";
import { moveConnectedField } from "@/app/admin/dashboard/design-builder/builder-utils";
import { mapCustomerFields } from "@/app/components/customizer/CustomerEditPanel";

// Spec §5: admin must be able to set "Display order in Easy Personalize",
// independent of layer z-order/creation order. Order lives in the position
// of each field within `template.fields`; mapCustomerFields (shared by
// CustomerEditPanel, CustomerUploadsPanel, and AdminCustomerPreview) must
// respect that order rather than the order layers happen to appear in.

function textLayer(id: string, fieldId: string) {
  return { id, name: id, type: "text", page: "front", customerEditable: true, fieldId, text: "x" };
}

function imageLayer(id: string, fieldId: string) {
  return { id, name: id, type: "image", page: "front", customerEditable: true, fieldId };
}

function field(id: string, type = "text") {
  return { id, label: id, type, customerVisible: true };
}

const basePages = [{ id: "front", label: "Front", enabled: true }];

describe("mapCustomerFields respects template.fields order, not layer order", () => {
  it("sorts entries by field array position even when layers are declared in a different order", () => {
    const template = {
      pages: basePages,
      // Fields intentionally declared in the desired Easy Personalize order.
      fields: [field("groomName"), field("brideName"), field("weddingDate")],
      // Layers (canvas z-order / creation order) declared in a DIFFERENT order.
      layers: [textLayer("l-date", "weddingDate"), textLayer("l-bride", "brideName"), textLayer("l-groom", "groomName")],
    };

    const entries = mapCustomerFields(template);
    expect(entries.map((e) => e.field.id)).toEqual(["groomName", "brideName", "weddingDate"]);
  });

  it("keeps photo fields in the same shared order (used by CustomerUploadsPanel too)", () => {
    const template = {
      pages: basePages,
      fields: [field("mainPhoto", "image"), field("brideName")],
      layers: [textLayer("l-bride", "brideName"), imageLayer("l-photo", "mainPhoto")],
    };

    const entries = mapCustomerFields(template);
    expect(entries.map((e) => e.field.id)).toEqual(["mainPhoto", "brideName"]);
  });
});

describe("moveConnectedField reorders Easy Personalize display order (spec §5)", () => {
  it("moves a field up, swapping its position with the previous connected field", () => {
    const template = {
      fields: [field("a"), field("b"), field("c")],
      layers: [textLayer("la", "a"), textLayer("lb", "b"), textLayer("lc", "c")],
    };
    const moved = moveConnectedField(template, "lc", "up");
    expect(moved.fields.map((f: any) => f.id)).toEqual(["a", "c", "b"]);
  });

  it("moves a field down", () => {
    const template = {
      fields: [field("a"), field("b"), field("c")],
      layers: [textLayer("la", "a"), textLayer("lb", "b"), textLayer("lc", "c")],
    };
    const moved = moveConnectedField(template, "la", "down");
    expect(moved.fields.map((f: any) => f.id)).toEqual(["b", "a", "c"]);
  });

  it("is a no-op at the boundaries", () => {
    const template = {
      fields: [field("a"), field("b")],
      layers: [textLayer("la", "a"), textLayer("lb", "b")],
    };
    expect(moveConnectedField(template, "la", "up").fields.map((f: any) => f.id)).toEqual(["a", "b"]);
    expect(moveConnectedField(template, "lb", "down").fields.map((f: any) => f.id)).toEqual(["a", "b"]);
  });

  it("skips over orphan fields (not connected to any customer-editable layer) so the visible order always changes", () => {
    // "orphan" sits between b and c in the raw array but has no connected layer.
    const template = {
      fields: [field("a"), field("b"), field("orphan"), field("c")],
      layers: [textLayer("la", "a"), textLayer("lb", "b"), textLayer("lc", "c")],
    };
    const moved = moveConnectedField(template, "lc", "up");
    // b and c (the two visibly connected neighbours) swap; orphan's slot moves
    // with c but the *visible* order is now a, c, b — not left unchanged.
    const visibleOrder = moved.fields.map((f: any) => f.id).filter((id: string) => id !== "orphan");
    expect(visibleOrder).toEqual(["a", "c", "b"]);
  });

  it("is a no-op when the layer has no connected field", () => {
    const template = { fields: [field("a")], layers: [{ id: "l1", customerEditable: false, fieldId: "" }] };
    expect(moveConnectedField(template, "l1", "up")).toBe(template);
  });
});
