import { describe, expect, it } from "vitest";
import { removeCustomerLayers, reorderLayerByDrop } from "../customer-actions";

describe("customer layer drag ordering", () => {
  it("moves an editable customer layer to the dropped position", () => {
    const layers = [
      { id: "a", zIndex: 1, isUserLayer: true },
      { id: "b", zIndex: 2, isUserLayer: true },
      { id: "c", zIndex: 3, isUserLayer: true },
    ];
    const reordered = reorderLayerByDrop(layers, "a", "c");
    expect(reordered.sort((left, right) => left.zIndex - right.zIndex).map((layer) => layer.id)).toEqual(["b", "c", "a"]);
  });

  it("does not cross an administrator-protected layer", () => {
    const layers = [
      { id: "customer", zIndex: 1, isUserLayer: true, customerEditable: true },
      { id: "protected", zIndex: 2, customerEditable: false },
      { id: "target", zIndex: 3, isUserLayer: true, customerEditable: true },
    ];
    expect(reorderLayerByDrop(layers, "customer", "target")).toBe(layers);
  });

  it("deletes a selected customer group with all of its descendants", () => {
    const layers = [
      { id: "group", type: "group", groupId: "", childIds: ["a", "nested"] },
      { id: "a", type: "text", groupId: "group" },
      { id: "nested", type: "group", groupId: "group", childIds: ["b", "c"] },
      { id: "b", type: "shape", groupId: "nested" },
      { id: "c", type: "image", groupId: "nested" },
      { id: "keep", type: "text", groupId: "" },
    ];
    expect(removeCustomerLayers(layers, ["group"]).map((layer) => layer.id)).toEqual(["keep"]);
  });

  it("unwraps a group after deleting one of its final two children", () => {
    const layers = [
      { id: "group", type: "group", groupId: "", childIds: ["a", "b"] },
      { id: "a", type: "text", groupId: "group" },
      { id: "b", type: "shape", groupId: "group" },
    ];
    expect(removeCustomerLayers(layers, ["a"])).toEqual([{ id: "b", type: "shape", groupId: "" }]);
  });
});
