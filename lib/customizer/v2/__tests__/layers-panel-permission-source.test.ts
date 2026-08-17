import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getLayerPermissions } from "@/app/components/customizer/customizer-utils";

// Spec §18/§25: the customer layers panel must gate its controls on the SAME
// resolved permission bundle every other consumer uses — the canvas, the
// arrange toolbar and the save validator all call `getLayerPermissions`.
//
// The panel instead read the raw `layer.customerPermissions` object. For a
// non-grid layer that object is not the source of truth: the admin's single
// "Customer editable" switch expands into the full bundle, and a layer that
// persisted no explicit object therefore lost its Hide, Copy and reorder
// controls while the server would have accepted all three.

const panelSource = readFileSync(
  path.join(process.cwd(), "app/components/customizer/CustomerLayersPanel.tsx"),
  "utf8",
);

describe("the resolved bundle disagrees with the raw object", () => {
  const editableLayerWithoutStoredPermissions = {
    id: "headline",
    type: "text",
    customerEditable: true,
    // No customerPermissions object at all — the case that broke the panel.
  } as any;

  it("grants hide, duplicate and reorder through the bundle", () => {
    const permissions = getLayerPermissions(editableLayerWithoutStoredPermissions);
    expect(permissions.hide).toBe(true);
    expect(permissions.duplicate).toBe(true);
    expect(permissions.changeLayerOrder).toBe(true);
  });

  it("would have denied all three when read from the raw object", () => {
    expect(editableLayerWithoutStoredPermissions.customerPermissions?.hide).toBeUndefined();
    expect(editableLayerWithoutStoredPermissions.customerPermissions?.duplicate).toBeUndefined();
  });

  it("still denies everything for a layer that is not customer editable", () => {
    const permissions = getLayerPermissions({ id: "locked", type: "text", customerEditable: false } as any);
    expect(permissions.hide).toBe(false);
    expect(permissions.duplicate).toBe(false);
    expect(permissions.changeLayerOrder).toBe(false);
  });

  it("keeps honouring per-slot overrides for grids, the documented exception", () => {
    const permissions = getLayerPermissions({
      id: "grid",
      type: "grid",
      customerEditable: true,
      customerPermissions: { move: false },
    } as any);
    expect(permissions.move).toBe(false);
    expect(permissions.replaceImage).toBe(true);
  });
});

describe("the panel resolves permissions through the shared helper", () => {
  it("calls getLayerPermissions instead of reading the raw object", () => {
    expect(panelSource).toContain("const permissions = getLayerPermissions(layer);");
    expect(panelSource).toContain("const canHide = layer.isUserLayer || Boolean(permissions.hide);");
    expect(panelSource).toContain("const canDuplicate = layer.isUserLayer || Boolean(permissions.duplicate);");
  });

  it("no longer reads customerPermissions directly for gating", () => {
    expect(panelSource).not.toContain("layer.customerPermissions?.hide");
    expect(panelSource).not.toContain("layer.customerPermissions?.duplicate");
    expect(panelSource).not.toContain("layer.customerPermissions?.changeLayerOrder");
  });
});
