import { describe, expect, it } from "vitest";
import {
  customerEditablePermissionBundle,
  isCustomerFieldRequired,
  normalizeCustomerPermissions,
  normalizeCustomizerTemplate,
  prepareCustomizerTemplateForSave,
  resolveCustomerPermissions,
  templateFromRow,
  templateToRow,
  validateCustomizerTemplateDetailed,
} from "@/lib/customizer";
import {
  deletePage,
  duplicateLayer,
  duplicatePage,
  layersForField,
  linkLayerToField,
  removeLayer,
  setCustomerEditable,
  unlinkLayerFromField,
  updateConnectedField,
  canvasPatchesChangeTemplate,
} from "@/app/admin/dashboard/design-builder/builder-utils";
import { normalizePermissionsV2, templateToDocument } from "../document";
import { draftMatchesExpectedRevision, templateFromVersionSnapshot } from "@/lib/customizer/versions";
import { validateCustomerState } from "../validate";
import { getLayerPermissions } from "@/app/components/customizer/customizer-utils";
import { groupLayers } from "../groups";

const text = (id: string, page: string, extra: Record<string, unknown> = {}) => ({
  id, name: id, page, type: "text", text: id, x: 750, y: 500, width: 800, height: 100, zIndex: 1, customerEditable: false, fieldId: "", ...extra,
});
const image = (id: string, page: string, extra: Record<string, unknown> = {}) => ({
  id, name: id, page, type: "image", x: 750, y: 900, width: 600, height: 600, zIndex: 2, customerEditable: false, fieldId: "", ...extra,
});

function linkedNames() {
  let template: any = {
    pages: [{ id: "front", enabled: true }, { id: "back", enabled: true }],
    fields: [],
    layers: [text("names_front", "front"), text("names_back", "back"), image("photo", "front")],
  };
  template = setCustomerEditable(template, "names_front", true);
  template = updateConnectedField(template, "names_front", { label: "Couple", placeholder: "Names", helpText: "Both sides", required: true, options: [] });
  template = linkLayerToField(template, "names_back", "names_front");
  template = setCustomerEditable(template, "photo", true);
  return template;
}

/* ------------------------------------------------------------------ fields */

describe("shared (linked) fields in the builder", () => {
  it("removeLayer keeps a shared field while another layer still binds it", () => {
    const template = linkedNames();
    const next = removeLayer(template, "names_front");
    expect(next.fields.map((field: any) => field.id)).toContain("names_front");
    expect(next.layers.find((layer: any) => layer.id === "names_back").fieldId).toBe("names_front");
    // Removing the last user does drop it.
    expect(removeLayer(next, "names_back").fields.map((field: any) => field.id)).not.toContain("names_front");
  });

  it("deleting a group only drops fields no remaining layer binds", () => {
    let template = linkedNames();
    template = { ...template, layers: groupLayers(template.layers, ["names_front", "photo"], "group_1", "Group") };
    const next = removeLayer(template, "group_1");
    expect(next.layers.map((layer: any) => layer.id)).toEqual(["names_back"]);
    expect(next.fields.map((field: any) => field.id)).toEqual(["names_front"]);
  });

  it("deleting a page keeps fields still bound on another page", () => {
    const next = deletePage(linkedNames(), "front");
    expect(next.fields.map((field: any) => field.id)).toEqual(["names_front"]);
  });

  it("disabling one linked layer keeps the shared field for the other", () => {
    const next = setCustomerEditable(linkedNames(), "names_back", false);
    expect(next.fields.find((field: any) => field.id === "names_front")).toMatchObject({ label: "Couple", required: true });
    expect(next.layers.find((layer: any) => layer.id === "names_front").fieldId).toBe("names_front");
  });

  it("duplicating a linked layer never double-binds the copy", () => {
    const { template, newId } = duplicateLayer(linkedNames(), "names_front");
    const copy = template.layers.find((layer: any) => layer.id === newId);
    expect(copy).toMatchObject({ fieldId: "", customerEditable: false });
    expect(Object.values(copy.customerPermissions).every((value) => value === false)).toBe(true);
    expect(layersForField(template, "names_front")).toHaveLength(2);
  });

  it("renaming the key renames the shared field for EVERY linked layer", () => {
    const next = updateConnectedField(linkedNames(), "names_back", { key: "Couple Names", label: "Your names" });
    expect(next.fields.filter((field: any) => field.id === "couple_names")).toHaveLength(1);
    expect(next.fields.find((field: any) => field.id === "couple_names")).toMatchObject({ label: "Your names", helpText: "Both sides" });
    expect(layersForField(next, "couple_names").map((layer: any) => layer.id).sort()).toEqual(["names_back", "names_front"]);
    expect(next.fields.some((field: any) => field.id === "names_front")).toBe(false);
  });

  it("a rename that collides with another field is suffixed, never merged", () => {
    const next = updateConnectedField(linkedNames(), "names_front", { key: "photo" });
    expect(next.fields.map((field: any) => field.id).sort()).toEqual(["photo", "photo_2"]);
    expect(layersForField(next, "photo_2")).toHaveLength(2);
  });

  it("unlinking gives the layer its own copy of the shared configuration", () => {
    const next = unlinkLayerFromField(linkedNames(), "names_back");
    const back = next.layers.find((layer: any) => layer.id === "names_back");
    expect(back.fieldId).not.toBe("names_front");
    expect(next.fields.find((field: any) => field.id === back.fieldId)).toMatchObject({ placeholder: "Names", helpText: "Both sides", required: true, type: "text" });
    expect(layersForField(next, "names_front").map((layer: any) => layer.id)).toEqual(["names_front"]);
    // A sole user has nothing to unlink from.
    expect(unlinkLayerFromField(next, "names_front")).toBe(next);
  });

  it("refuses to link incompatible layer and field kinds", () => {
    const template = linkedNames();
    expect(linkLayerToField(template, "photo", "names_front")).toBe(template);
    expect(linkLayerToField(template, "names_back", "photo")).toBe(template);
  });
});

describe("prepareCustomizerTemplateForSave", () => {
  it("keeps a shared field as one definition and its full configuration", () => {
    const prepared = prepareCustomizerTemplateForSave({
      ...linkedNames(),
      fields: [
        { id: "photo", label: "Photo", type: "image", customerVisible: false },
        { id: "names_front", label: "Couple", type: "select", required: true, placeholder: "Names", helpText: "Both sides", options: ["A", "B"], maxLength: 40 },
      ],
    });
    expect(prepared.fields.map((field: any) => field.id)).toEqual(["photo", "names_front"]);
    expect(prepared.fields[1]).toMatchObject({ type: "select", required: true, placeholder: "Names", helpText: "Both sides", options: ["A", "B"], maxLength: 40, customerVisible: true });
    expect(prepared.fields[0].customerVisible).toBe(false);
    expect(prepared.layers.filter((layer: any) => layer.fieldId === "names_front")).toHaveLength(2);
  });

  it("generates ids only for missing or conflicting bindings, appended in layer order", () => {
    const prepared = prepareCustomizerTemplateForSave({
      fields: [{ id: "names", label: "Names", type: "text" }],
      layers: [
        text("names_layer", "front", { customerEditable: true, fieldId: "names" }),
        // A photo pointing at the TEXT field conflicts: it gets its own id.
        image("Portrait", "front", { customerEditable: true, fieldId: "names" }),
        // A new editable layer with no id gets one from its name.
        text("Venue", "back", { customerEditable: true, fieldId: "" }),
        // Not editable: its dangling reference is cleared.
        text("decor", "front", { customerEditable: false, fieldId: "names" }),
      ],
    });
    expect(prepared.fields.map((field: any) => [field.id, field.type])).toEqual([["names", "text"], ["portrait", "image"], ["venue", "text"]]);
    expect(prepared.layers.map((layer: any) => layer.fieldId)).toEqual(["names", "portrait", "venue", ""]);
  });

  it("drops only genuinely unused fields and is idempotent", () => {
    const once = prepareCustomizerTemplateForSave({
      fields: [{ id: "orphan", label: "Orphan" }, { id: "hidden", label: "Hidden", customerVisible: false }],
      layers: [text("h", "back", { customerEditable: true, hidden: true, fieldId: "hidden" })],
    });
    expect(once.fields.map((field: any) => field.id)).toEqual(["hidden"]);
    const twice = prepareCustomizerTemplateForSave(once);
    expect(twice).toEqual(once);
  });

  it("survives the database row mapping unchanged", () => {
    const prepared = normalizeCustomizerTemplate(prepareCustomizerTemplateForSave({ ...linkedNames(), enabled: true }));
    const reloaded = templateFromRow({ id: "t", product_id: "p", ...templateToRow("p", prepared) });
    expect(reloaded.fields).toEqual(prepared.fields);
    expect(reloaded.layers.map((layer: any) => layer.fieldId)).toEqual(prepared.layers.map((layer: any) => layer.fieldId));
  });
});

describe("required fields the customer cannot reach", () => {
  const layers = [text("t", "front", { customerEditable: true, fieldId: "f" })];
  it("is required only when visible and bound to a reachable editable layer", () => {
    const pages = new Set(["front"]);
    expect(isCustomerFieldRequired({ id: "f", required: true }, layers, pages)).toBe(true);
    expect(isCustomerFieldRequired({ id: "f", required: true, customerVisible: false }, layers, pages)).toBe(false);
    expect(isCustomerFieldRequired({ id: "f", required: true }, [{ ...layers[0], customerInteractionDisabled: true }], pages)).toBe(false);
    expect(isCustomerFieldRequired({ id: "f", required: true }, [{ ...layers[0], hidden: true }], pages)).toBe(false);
    expect(isCustomerFieldRequired({ id: "f", required: true }, layers, new Set(["back"]))).toBe(false);
  });

  it("warns the administrator instead of publishing an impossible requirement", () => {
    const { warnings } = validateCustomizerTemplateDetailed({
      canvasWidthPx: 1500,
      canvasHeightPx: 2100,
      pages: [{ id: "front", enabled: true }],
      fields: [{ id: "f", label: "Venue", type: "text", required: true, customerVisible: false }],
      layers,
    });
    expect(warnings.some((warning) => warning.includes("treated as optional"))).toBe(true);
  });
});

/* ------------------------------------------------------------- permissions */

describe("customer permission model", () => {
  it("keeps explicit restrictions and fills missing keys with documented defaults", () => {
    const stored = normalizeCustomerPermissions({ move: false, resize: false, rotate: false }, { customerEditable: true });
    expect(stored).toMatchObject({ move: false, resize: false, rotate: false, replaceImage: true, cropImage: true, editContent: true });
    expect(normalizePermissionsV2({ move: false }, { customerEditable: true }).move).toBe(false);
  });

  it("turning customer editing off denies everything, whatever was stored", () => {
    const stored = normalizeCustomerPermissions(customerEditablePermissionBundle(true), { customerEditable: false });
    expect(Object.values(stored).every((value) => value === false)).toBe(true);
    expect(Object.values(resolveCustomerPermissions({ customerEditable: false, customerPermissions: { move: true } })).some(Boolean)).toBe(false);
  });

  it("folds position lock, interaction disabled and legacy image flags into the effective set", () => {
    expect(resolveCustomerPermissions({ customerEditable: true, positionLocked: true })).toMatchObject({ move: false, resize: false, rotate: false, changeLayerOrder: false, editContent: true });
    expect(Object.values(resolveCustomerPermissions({ customerEditable: true, customerInteractionDisabled: true })).some(Boolean)).toBe(false);
    expect(resolveCustomerPermissions({ customerEditable: true, allowZoom: false })).toMatchObject({ zoomImage: false, cropImage: false, repositionImage: true });
    expect(resolveCustomerPermissions({ customerEditable: true, allowReposition: false, customerPermissions: { cropImage: true } })).toMatchObject({ repositionImage: false, cropImage: false });
  });

  it("browser and server resolve the same rules", () => {
    const layer = { id: "t", name: "T", type: "text", page: "front", customerEditable: true, positionLocked: true, customerPermissions: {} };
    expect(getLayerPermissions(layer).move).toBe(false);
    const result = validateCustomerState(
      { pages: [{ id: "front", enabled: true }], settings: {}, fields: [], layers: [layer] },
      { editorState: { layerOverrides: { t: { transform: { x: 5 }, textStyle: { fontFamily: "Inter" } } }, userLayers: [] } },
    );
    expect(result.violations.map((violation) => violation.code)).toEqual(["move-not-allowed"]);
    expect(result.sanitizedEditorState.layerOverrides.t.textStyle.fontFamily).toBe("Inter");
  });

  it("accepts a shared value while any bound layer is editable", () => {
    const template = {
      pages: [{ id: "front", enabled: true }, { id: "back", enabled: true }],
      settings: {},
      fields: [{ id: "names", label: "Names", type: "text" }],
      layers: [
        { id: "a", page: "front", type: "text", fieldId: "names", customerEditable: true, maxChars: 30 },
        { id: "b", page: "back", type: "text", fieldId: "names", customerEditable: true, customerInteractionDisabled: true, maxChars: 10 },
      ],
    };
    const result = validateCustomerState(template, { values: { names: "Ana & Benjamin" } });
    // Accepted through layer "a", trimmed to the tightest bound layer limit.
    expect(result.sanitizedValues.names).toBe("Ana & Benj");
    expect(result.violations.map((violation) => violation.code)).toEqual(["value-too-long"]);
  });
});

/* ---------------------------------------------------------------- pages */

describe("duplicatePage", () => {
  it("rewrites groupId and childIds to the copies", () => {
    const template: any = {
      pages: [{ id: "front", label: "Front", enabled: true }],
      fields: [],
      layers: groupLayers(
        [
          { id: "a", name: "A", page: "front", type: "shape", x: 10, y: 10, width: 10, height: 10, zIndex: 1 },
          { id: "b", name: "B", page: "front", type: "shape", x: 30, y: 10, width: 10, height: 10, zIndex: 2 },
        ],
        ["a", "b"],
        "g",
        "Group",
      ),
    };
    const { template: next, pageId } = duplicatePage(template, "front");
    const copies = next.layers.filter((layer: any) => layer.page === pageId);
    const group = copies.find((layer: any) => layer.type === "group");
    const children = copies.filter((layer: any) => layer.type === "shape");
    expect(group.id).not.toBe("g");
    expect(children.every((child: any) => child.groupId === group.id)).toBe(true);
    expect([...group.childIds].sort()).toEqual(children.map((child: any) => child.id).sort());
    expect(new Set(next.layers.map((layer: any) => layer.id)).size).toBe(next.layers.length);
  });
});

/* ----------------------------------------------- published document reads */

describe("published documents", () => {
  it("round-trips the configured default page and guides", () => {
    const { document } = templateToDocument({
      pages: [{ id: "front", enabled: true }, { id: "back", enabled: true }],
      defaultPage: "back",
      guides: [{ id: "g", pageId: "back", axis: "horizontal", position: 100 }],
      layers: [],
    });
    expect(document.defaultPageId).toBe("back");
    const template = templateFromVersionSnapshot({ templateId: "t", version: 1, displayVersion: "2", document } as any);
    expect(template.defaultPage).toBe("back");
    expect(template.guides).toHaveLength(1);
  });

  it("reads a document published BEFORE these fields existed exactly as before", () => {
    // What the previous adapter wrote: no defaultPageId, no autoSizeMode, no
    // top-level fitMode, and a default `transform` whose fitMode was copied
    // from the layer.
    const legacy = {
      schemaVersion: 4,
      canvas: { widthPx: 1500, heightPx: 2100 },
      pages: [{ id: "front", name: "Front", enabled: false }, { id: "back", name: "Back", enabled: true }],
      fields: [],
      layers: [
        { id: "p", type: "image", pageId: "back", x: 1, y: 1, width: 10, height: 10, transform: { assetId: "", cropX: 0, cropY: 0, cropWidth: 0, cropHeight: 0, zoom: 1, offsetX: 0, offsetY: 0, rotation: 0, flipX: false, flipY: false, fitMode: "contain" } },
        { id: "t", type: "text", pageId: "back", text: "Hi", textStyle: { fontSize: 40, fitMode: "fixed" } },
      ],
    };
    const template = templateFromVersionSnapshot({ templateId: "t", version: 1, displayVersion: "2", document: legacy } as any);
    // First ENABLED page (the old code returned a disabled first page).
    expect(template.defaultPage).toBe("back");
    const photo = template.layers.find((layer: any) => layer.id === "p");
    // No top-level fitMode is invented, so it keeps rendering as it did.
    expect(photo.fitMode).toBeUndefined();
    expect(photo.imageTransform).toMatchObject({ zoom: 1, offsetX: 0, offsetY: 0, rotation: 0 });
    expect(template.layers.find((layer: any) => layer.id === "t").textStyle.autoSizeMode).toBeUndefined();
    expect(template.guides).toEqual([]);
  });

  it("compares draft revisions by their full timestamp", () => {
    expect(draftMatchesExpectedRevision("2026-10-04T07:00:00.123456+00:00", "2026-10-04T07:00:00.123456+00:00")).toBe(true);
    expect(draftMatchesExpectedRevision("2026-10-04T07:00:00.123457+00:00", "2026-10-04T07:00:00.123456+00:00")).toBe(false);
    expect(draftMatchesExpectedRevision("2026-10-04T07:00:00.123+00:00", "2026-10-04T07:00:00.123000+00:00")).toBe(true);
    expect(draftMatchesExpectedRevision("anything", null)).toBe(true);
    expect(draftMatchesExpectedRevision("", "2026-10-04T07:00:00Z")).toBe(false);
  });
});

describe("canvas gestures that change nothing", () => {
  it("are recognised so they leave no history or unsaved state", () => {
    const template = { layers: [{ id: "a", x: 10, y: 20, width: 30, height: 40, textStyle: { fontSize: 12 } }] };
    expect(canvasPatchesChangeTemplate(template, { a: { x: 10, y: 20 } })).toBe(false);
    expect(canvasPatchesChangeTemplate(template, { a: { textStyle: { fontSize: 12 } } })).toBe(false);
    expect(canvasPatchesChangeTemplate(template, { a: { x: 11 } })).toBe(true);
    expect(canvasPatchesChangeTemplate(template, { a: { textStyle: { fontSize: 13 } } })).toBe(true);
  });
});
