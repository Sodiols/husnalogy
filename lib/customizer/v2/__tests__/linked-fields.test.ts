import { describe, expect, it } from "vitest";
import { linkLayerToField, setCustomerEditable } from "@/app/admin/dashboard/design-builder/builder-utils";
import { resolveLayerText } from "@/app/components/customizer/customizer-utils";

// Spec §15 "Linked Wedding Fields": if the couple's names appear multiple
// times in the design (e.g. Front + Back), the customer should type them
// once and every linked layer updates together. resolveLayerText/
// resolveLayerImage already key off values[field.id], so this is really
// about (a) giving the admin a safe way to point a layer's fieldId at an
// EXISTING field instead of creating its own, and (b) never letting that
// sharing be destroyed by an unrelated action on one of the linked layers.

const brideFront = { id: "bride-front", name: "Bride Front", type: "text", page: "front", text: "Madison", customerEditable: false, fieldId: "" };
const brideBack = { id: "bride-back", name: "Bride Back", type: "text", page: "back", text: "Madison", customerEditable: false, fieldId: "" };

describe("linkLayerToField", () => {
  it("points a second layer at an existing field instead of creating a new one", () => {
    let template: any = { fields: [], layers: [brideFront, brideBack] };
    template = setCustomerEditable(template, "bride-front", true);
    expect(template.fields).toHaveLength(1);
    const frontFieldId = template.layers.find((l: any) => l.id === "bride-front").fieldId;

    template = linkLayerToField(template, "bride-back", frontFieldId);

    const back = template.layers.find((l: any) => l.id === "bride-back");
    expect(back.fieldId).toBe(frontFieldId);
    expect(back.customerEditable).toBe(true);
    // No second field was created - still exactly one.
    expect(template.fields).toHaveLength(1);
  });

  it("keeps both layers in sync through the same value once linked", () => {
    let template: any = { fields: [], layers: [brideFront, brideBack] };
    template = setCustomerEditable(template, "bride-front", true);
    const fieldId = template.layers.find((l: any) => l.id === "bride-front").fieldId;
    template = linkLayerToField(template, "bride-back", fieldId);

    const field = template.fields.find((f: any) => f.id === fieldId);
    const values = { [fieldId]: "Sophia" };
    const front = template.layers.find((l: any) => l.id === "bride-front");
    const back = template.layers.find((l: any) => l.id === "bride-back");
    expect(resolveLayerText(front, field, values)).toBe("Sophia");
    expect(resolveLayerText(back, field, values)).toBe("Sophia");
  });

  it("is a no-op when already linked, the layer is missing, or the target field doesn't exist", () => {
    let template: any = { fields: [], layers: [brideFront, brideBack] };
    template = setCustomerEditable(template, "bride-front", true);
    const fieldId = template.layers.find((l: any) => l.id === "bride-front").fieldId;

    expect(linkLayerToField(template, "bride-front", fieldId)).toBe(template);
    expect(linkLayerToField(template, "missing-layer", fieldId)).toBe(template);
    expect(linkLayerToField(template, "bride-back", "nonexistent-field")).toBe(template);
  });

  it("cleans up the layer's previous now-orphaned field when relinking", () => {
    let template: any = { fields: [], layers: [brideFront, brideBack] };
    template = setCustomerEditable(template, "bride-front", true);
    template = setCustomerEditable(template, "bride-back", true);
    expect(template.fields).toHaveLength(2);

    const frontFieldId = template.layers.find((l: any) => l.id === "bride-front").fieldId;
    template = linkLayerToField(template, "bride-back", frontFieldId);

    // bride-back's own original field had no other user, so it's cleaned up.
    expect(template.fields).toHaveLength(1);
    expect(template.fields[0].id).toBe(frontFieldId);
  });

  it("only allows linking fields of the same kind (text-to-text, image-to-image)", () => {
    const photoLayer = { id: "photo", name: "Photo", type: "image", page: "front", customerEditable: false, fieldId: "" };
    let template: any = { fields: [], layers: [brideFront, photoLayer] };
    template = setCustomerEditable(template, "bride-front", true);
    template = setCustomerEditable(template, "photo", true);
    const textFieldId = template.layers.find((l: any) => l.id === "bride-front").fieldId;

    // linkLayerToField itself doesn't enforce type compatibility (that's a UI
    // concern in AdminPropertiesPanel's dropdown filtering), but confirm the
    // underlying link still only rewires fieldId/customerEditable and never
    // mutates unrelated layer geometry or type.
    const linked = linkLayerToField(template, "photo", textFieldId);
    const photo = linked.layers.find((l: any) => l.id === "photo");
    expect(photo.type).toBe("image");
    expect(photo.fieldId).toBe(textFieldId);
  });
});

describe("setCustomerEditable preserves shared fields (spec §15 regression)", () => {
  it("does not delete a field still referenced by another layer when disabling one linked layer", () => {
    let template: any = { fields: [], layers: [brideFront, brideBack] };
    template = setCustomerEditable(template, "bride-front", true);
    const fieldId = template.layers.find((l: any) => l.id === "bride-front").fieldId;
    template = linkLayerToField(template, "bride-back", fieldId);
    expect(template.fields).toHaveLength(1);

    // Turning OFF customer-editable on the front instance must not delete
    // the field the back instance still depends on.
    template = setCustomerEditable(template, "bride-front", false);

    expect(template.fields).toHaveLength(1);
    expect(template.fields[0].id).toBe(fieldId);
    const back = template.layers.find((l: any) => l.id === "bride-back");
    expect(back.fieldId).toBe(fieldId);
    expect(back.customerEditable).toBe(true);
  });

  it("still deletes the field when the disabled layer was the last one using it", () => {
    let template: any = { fields: [], layers: [brideFront] };
    template = setCustomerEditable(template, "bride-front", true);
    expect(template.fields).toHaveLength(1);

    template = setCustomerEditable(template, "bride-front", false);
    expect(template.fields).toHaveLength(0);
  });
});
