import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateCustomerState } from "../validate";

// Spec §76/§98/§111: a customer must be able to group a permitted TEMPLATE
// layer (e.g. an admin-authored "Bride Name" text object) together with
// their own inserted objects - not just customer-created objects with each
// other. The group container always lives in editorState.userLayers; a
// template layer joins it via a `groupId` override that must be validated
// server-side against the REAL, sanitized set of customer groups - never an
// admin template group, never an arbitrary/forged id, never across pages.

function bridePermittedTemplate(overrides: Partial<any> = {}) {
  return {
    layers: <any[]>[
      {
        id: "bride-name",
        page: "front",
        type: "text",
        text: "Madison",
        customerEditable: true,
        customerPermissions: {},
      },
      {
        id: "locked-border",
        page: "front",
        type: "shape",
        shape: "rectangle",
        customerEditable: false,
        customerPermissions: {},
      },
      {
        id: "back-only-text",
        page: "back",
        type: "text",
        text: "Thank you",
        customerEditable: true,
        customerPermissions: {},
      },
    ],
    fields: [],
    pages: [{ id: "front", enabled: true }, { id: "back", enabled: true }],
    settings: { allowCustomerGrouping: true, allowCustomerText: true },
    ...overrides,
  };
}

const customerGroup = {
  id: "customer_group_1",
  type: "group",
  page: "front",
  x: 100,
  y: 100,
  width: 200,
  height: 80,
};

describe("customer groups spanning template + customer-created layers (server validation)", () => {
  it("accepts a permitted template layer joining a real customer group on the same page", () => {
    const result = validateCustomerState(bridePermittedTemplate(), {
      editorState: {
        layerOverrides: { "bride-name": { groupId: "customer_group_1" } },
        userLayers: [customerGroup],
      },
    });
    expect(result.violations).toEqual([]);
    expect(result.sanitizedEditorState.layerOverrides["bride-name"].groupId).toBe("customer_group_1");
  });

  it("rejects grouping a layer the admin never made customer-editable", () => {
    const result = validateCustomerState(bridePermittedTemplate(), {
      editorState: {
        layerOverrides: { "locked-border": { groupId: "customer_group_1" } },
        userLayers: [customerGroup],
      },
    });
    expect(result.violations.map((v) => v.code)).toContain("group-not-allowed");
    expect(result.sanitizedEditorState.layerOverrides["locked-border"]).toBeUndefined();
  });

  it("rejects a groupId that does not correspond to any real, sanitized customer group", () => {
    const result = validateCustomerState(bridePermittedTemplate(), {
      editorState: {
        layerOverrides: { "bride-name": { groupId: "totally-made-up-id" } },
        userLayers: [],
      },
    });
    expect(result.violations.map((v) => v.code)).toContain("invalid-group-target");
    expect(result.sanitizedEditorState.layerOverrides["bride-name"]).toBeUndefined();
  });

  it("rejects pointing a template layer's groupId at an ADMIN template group id (never customer-writable)", () => {
    // Admin template groups live in template.layers, not userLayers - so even
    // if a malicious client names a real admin group id, it is absent from
    // the sanitized userLayers set and therefore rejected exactly like any
    // other forged id.
    const template = bridePermittedTemplate();
    template.layers.push({ id: "admin-group-1", page: "front", type: "group", childIds: [], customerEditable: false });
    const result = validateCustomerState(template, {
      editorState: {
        layerOverrides: { "bride-name": { groupId: "admin-group-1" } },
        userLayers: [],
      },
    });
    expect(result.violations.map((v) => v.code)).toContain("invalid-group-target");
    expect(result.sanitizedEditorState.layerOverrides["bride-name"]).toBeUndefined();
  });

  it("rejects grouping across pages (spec §96 page isolation)", () => {
    const result = validateCustomerState(bridePermittedTemplate(), {
      editorState: {
        // back-only-text is on the "back" page; the group is on "front".
        layerOverrides: { "back-only-text": { groupId: "customer_group_1" } },
        userLayers: [customerGroup],
      },
    });
    expect(result.violations.map((v) => v.code)).toContain("group-page-mismatch");
    expect(result.sanitizedEditorState.layerOverrides["back-only-text"]).toBeUndefined();
  });

  it("rejects the group target when template-wide grouping is disabled, even if the id would otherwise match", () => {
    const template = bridePermittedTemplate({ settings: { allowCustomerGrouping: false, allowCustomerText: true } });
    const result = validateCustomerState(template, {
      editorState: {
        layerOverrides: { "bride-name": { groupId: "customer_group_1" } },
        userLayers: [customerGroup],
      },
    });
    // The group itself is rejected from userLayers...
    expect(result.violations.map((v) => v.code)).toContain("user-group-not-allowed");
    expect(result.sanitizedEditorState.userLayers.some((l: any) => l.id === "customer_group_1")).toBe(false);
    // ...so the override referencing it is also rejected, not silently kept.
    expect(result.violations.map((v) => v.code)).toContain("invalid-group-target");
    expect(result.sanitizedEditorState.layerOverrides["bride-name"]).toBeUndefined();
  });

  it("clears group membership (ungroup) when a permitted layer submits a null groupId", () => {
    const result = validateCustomerState(bridePermittedTemplate(), {
      editorState: {
        layerOverrides: { "bride-name": { groupId: null } },
        userLayers: [],
      },
    });
    expect(result.violations).toEqual([]);
    expect(result.sanitizedEditorState.layerOverrides["bride-name"].groupId).toBeNull();
  });

  it("rejects clearing group membership on a layer without group permission", () => {
    const result = validateCustomerState(bridePermittedTemplate(), {
      editorState: {
        layerOverrides: { "locked-border": { groupId: null } },
        userLayers: [],
      },
    });
    expect(result.violations.map((v) => v.code)).toContain("group-not-allowed");
  });

  it("still rejects interaction-disabled layers before even reaching the group check", () => {
    const template = bridePermittedTemplate();
    template.layers[0].customerInteractionDisabled = true;
    const result = validateCustomerState(template, {
      editorState: {
        layerOverrides: { "bride-name": { groupId: "customer_group_1" } },
        userLayers: [customerGroup],
      },
    });
    expect(result.violations.map((v) => v.code)).toContain("interaction-disabled");
    expect(result.sanitizedEditorState.layerOverrides["bride-name"]).toBeUndefined();
  });
});

// Client wiring: confirm the eligibility + split logic actually reaches the
// server-validated path described above, rather than silently no-oping or
// mutating the trusted template.
describe("groupSelection/ungroupSelection wiring (personalize-client.tsx)", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app/products/[slug]/personalize/personalize-client.tsx"),
    "utf8",
  );

  it("allows a template layer into the eligible set only when it has group permission", () => {
    expect(source).toContain("layer.isUserLayer || getLayerPermissions(layer).group");
  });

  it("computes the new group against the merged (template + customer) layer set", () => {
    expect(source).toContain("groupLayers(effectiveLayers, eligibleIds, groupId, \"Customer group\")");
  });

  it("routes template-layer group membership through layerOverrides, never through template mutation", () => {
    const fnMatch = source.match(/const groupSelection = \(\) => \{[\s\S]*?\n  \};/);
    expect(fnMatch).toBeTruthy();
    const body = fnMatch![0];
    expect(body).toContain("layerOverrides[layerId] = { ...(layerOverrides[layerId] || {}), groupId };");
  });

  it("clears template-layer group membership on ungroup via layerOverrides", () => {
    const fnMatch = source.match(/const ungroupSelection = \(\) => \{[\s\S]*?\n  \};/);
    expect(fnMatch).toBeTruthy();
    const body = fnMatch![0];
    expect(body).toContain("groupId: parentGroupId || null");
  });

  it("transforms and permission-checks every descendant of a mixed logical group", () => {
    expect(source).toContain("const selectedActionLayers = useMemo");
    expect(source).toContain("selectedActionLayers.every(canMoveCustomerLayer)");
    const fnMatch = source.match(/const transformCustomerGroupState = \([\s\S]*?\n  \};/);
    expect(fnMatch).toBeTruthy();
    expect(fnMatch![0]).toContain("transformGroupChildren(effectiveLayers, groupId, patch)");
    expect(fnMatch![0]).toContain("layerOverrides[layer.id] =");
  });
});
