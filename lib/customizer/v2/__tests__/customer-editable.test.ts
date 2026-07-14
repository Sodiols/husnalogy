import { describe, expect, it } from "vitest";
import {
  CUSTOMER_PERMISSION_KEYS,
  customerEditablePermissionBundle,
} from "@/lib/customizer";
import { setCustomerEditable } from "@/app/admin/dashboard/design-builder/builder-utils";

const template = {
  fields: [],
  layers: [
    {
      id: "headline",
      name: "Headline",
      type: "text",
      text: "Your text",
      customerEditable: false,
      customerPermissions: {},
      fieldId: "",
    },
  ],
};

describe("single customer-editable control", () => {
  it("creates one complete enabled permission bundle", () => {
    const permissions = customerEditablePermissionBundle(true);

    expect(Object.keys(permissions)).toEqual([...CUSTOMER_PERMISSION_KEYS]);
    expect(Object.values(permissions).every(Boolean)).toBe(true);
  });

  it("enables every customer action and creates the connected field", () => {
    const updated = setCustomerEditable(template, "headline", true);
    const layer = updated.layers[0];

    expect(layer.customerEditable).toBe(true);
    expect(Object.values(layer.customerPermissions).every(Boolean)).toBe(true);
    expect(layer.fieldId).toBe("headline");
    expect(updated.fields).toHaveLength(1);
  });

  it("disables every customer action and removes the connected field", () => {
    const enabled = setCustomerEditable(template, "headline", true);
    const disabled = setCustomerEditable(enabled, "headline", false);
    const layer = disabled.layers[0];

    expect(layer.customerEditable).toBe(false);
    expect(Object.values(layer.customerPermissions).every((value) => value === false)).toBe(true);
    expect(layer.fieldId).toBe("");
    expect(disabled.fields).toHaveLength(0);
  });
});
