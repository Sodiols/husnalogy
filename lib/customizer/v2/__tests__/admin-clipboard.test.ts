// Admin Copy / Cut / Paste (spec §32) and the document invariants every clone
// operation has to preserve (spec §28).
//
// These commands share `cloneLayersInto` with Duplicate and, through
// `lib/customizer/v2/clipboard`, with the customer editor — so the thing being
// pinned here is that "a copy of a group" means the same everywhere: fresh ids,
// relationships pointing at the copies, and a contiguous z-block on top.

import { describe, expect, it } from "vitest";

import {
  copyLayersToClipboard,
  cutLayers,
  duplicateLayer,
  layersForPage,
  pasteLayers,
} from "@/app/admin/dashboard/design-builder/builder-utils";
import { validateGroupRelationships } from "../groups";

const layer = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  type: "shape",
  page: "front",
  x: 100,
  y: 100,
  width: 100,
  height: 60,
  rotation: 0,
  opacity: 1,
  zIndex: 1,
  hidden: false,
  locked: false,
  adminEditable: true,
  groupId: "",
  ...extra,
});

/** A page with a nested group, a loose shape, and a locked shape. */
const template = () => ({
  pages: [{ id: "front", enabled: true }, { id: "back", enabled: true }],
  fields: [{ id: "f1", label: "Name" }],
  layers: [
    layer("g1", { type: "group", zIndex: 1, childIds: ["t1", "g2"] }),
    layer("t1", { type: "text", zIndex: 2, groupId: "g1", fieldId: "f1" }),
    layer("g2", { type: "group", zIndex: 3, groupId: "g1", childIds: ["t2"] }),
    layer("t2", { type: "text", zIndex: 4, groupId: "g2" }),
    layer("loose", { zIndex: 5 }),
    layer("frozen", { zIndex: 6, locked: true }),
  ],
});

/** Every invariant §28 says an operation must never break. */
function expectValidDocument(next: any) {
  const layers = next.layers || [];
  const ids = layers.map((item: any) => item.id);
  expect(new Set(ids).size, "duplicate layer ids").toBe(ids.length);
  expect(validateGroupRelationships(layers), "dangling or cyclic group links").toEqual([]);

  const byId = new Map<string, any>(layers.map((item: any) => [String(item.id), item]));
  for (const item of layers) {
    for (const childId of item.childIds ?? []) {
      expect(byId.has(childId), `${item.id} lists a child that does not exist: ${childId}`).toBe(true);
      expect(byId.get(childId).groupId, `${childId} is listed by ${item.id} but not parented to it`).toBe(item.id);
    }
    expect(Number.isFinite(Number(item.x)), `${item.id} has non-finite x`).toBe(true);
    expect(Number.isFinite(Number(item.y)), `${item.id} has non-finite y`).toBe(true);
    expect(Number(item.width), `${item.id} has a non-positive width`).toBeGreaterThan(0);
    expect(Number(item.height), `${item.id} has a non-positive height`).toBeGreaterThan(0);
    expect(Number.isFinite(Number(item.zIndex)), `${item.id} has a non-finite zIndex`).toBe(true);
    expect(["front", "back"], `${item.id} references an unknown page`).toContain(item.page);
  }
}

describe("admin clipboard — copy", () => {
  it("captures the whole subtree, not just the selected rows", () => {
    const clipboard = copyLayersToClipboard(template(), ["g1"]);
    expect(clipboard.rootIds).toEqual(["g1"]);
    expect(clipboard.layers.map((item: any) => item.id).sort()).toEqual(["g1", "g2", "t1", "t2"]);
  });

  it("deep-copies, so deleting the original does not empty the clipboard", () => {
    const source = template();
    const clipboard = copyLayersToClipboard(source, ["g1"]);
    source.layers.length = 0;
    expect(clipboard.layers).toHaveLength(4);
    expect(clipboard.layers[0].id).toBe("g1");
  });

  it("copies a mixed selection of a group and an unrelated object", () => {
    const clipboard = copyLayersToClipboard(template(), ["g1", "loose"]);
    expect(clipboard.layers.map((item: any) => item.id).sort()).toEqual(["g1", "g2", "loose", "t1", "t2"]);
  });
});

describe("admin clipboard — paste", () => {
  it("pastes a nested group whose links point only at the copies", () => {
    const base = template();
    const clipboard = copyLayersToClipboard(base, ["g1"]);
    const { template: next, newIds } = pasteLayers(base, clipboard, "front");

    expect(newIds).toHaveLength(1);
    expectValidDocument(next);

    const originalIds = new Set(base.layers.map((item: any) => item.id));
    const copies = next.layers.filter((item: any) => !originalIds.has(item.id));
    expect(copies).toHaveLength(4);
    for (const copy of copies) {
      expect(originalIds.has(copy.groupId), `${copy.id} is parented to an ORIGINAL`).toBe(false);
      for (const childId of copy.childIds ?? []) {
        expect(originalIds.has(childId), `${copy.id} lists an ORIGINAL child`).toBe(false);
      }
    }
    // The original group is untouched.
    const g1 = next.layers.find((item: any) => item.id === "g1");
    expect(g1.childIds.sort()).toEqual(["g2", "t1"]);
  });

  it("stacks the paste as a contiguous block above everything on the page", () => {
    const base = template();
    const clipboard = copyLayersToClipboard(base, ["g1"]);
    const { template: next } = pasteLayers(base, clipboard, "front");

    const originalIds = new Set(base.layers.map((item: any) => item.id));
    const copyZ = next.layers
      .filter((item: any) => !originalIds.has(item.id))
      .map((item: any) => Number(item.zIndex))
      .sort((a: number, b: number) => a - b);
    const highestOriginal = Math.max(...base.layers.map((item: any) => Number(item.zIndex)));

    expect(copyZ[0]).toBeGreaterThan(highestOriginal);
    expect(copyZ[copyZ.length - 1] - copyZ[0], "the paste is not contiguous").toBe(copyZ.length - 1);
    // Relative order inside the block survives.
    const order = layersForPage(next, "front").map((item: any) => item.id);
    expect(order.slice(-4).every((id: string) => !originalIds.has(id))).toBe(true);
  });

  it("offsets the paste so it is visibly a new object", () => {
    const base = template();
    const clipboard = copyLayersToClipboard(base, ["loose"]);
    const { template: next, newIds } = pasteLayers(base, clipboard, "front");
    const copy = next.layers.find((item: any) => item.id === newIds[0]);
    expect(copy.x).toBeGreaterThan(100);
    expect(copy.y).toBeGreaterThan(100);
  });

  it("never re-binds a customer field, and never arrives locked", () => {
    const base = template();
    const { template: next } = pasteLayers(base, copyLayersToClipboard(base, ["g1", "frozen"]), "front");
    const originalIds = new Set(base.layers.map((item: any) => item.id));
    for (const copy of next.layers.filter((item: any) => !originalIds.has(item.id))) {
      expect(copy.fieldId, `${copy.id} kept the original's field binding`).toBe("");
      expect(copy.locked, `${copy.id} pasted locked`).toBe(false);
    }
  });

  it("pastes onto the page the user is looking at", () => {
    const base = template();
    const { template: next, newIds } = pasteLayers(base, copyLayersToClipboard(base, ["loose"]), "back");
    expect(next.layers.find((item: any) => item.id === newIds[0]).page).toBe("back");
    expectValidDocument(next);
  });

  it("repeated pastes never collide, and the document stays valid", () => {
    let next = template();
    const clipboard = copyLayersToClipboard(next, ["g1", "loose"]);
    for (let round = 0; round < 6; round += 1) {
      next = pasteLayers(next, clipboard, "front").template;
      expectValidDocument(next);
    }
    expect(next.layers).toHaveLength(6 + 6 * 5);
  });

  it("an empty clipboard is a no-op", () => {
    const base = template();
    expect(pasteLayers(base, { rootIds: [], layers: [] }, "front").template).toBe(base);
    expect(pasteLayers(base, null, "front").newIds).toEqual([]);
  });
});

describe("admin clipboard — cut", () => {
  it("removes what it copied and leaves a valid document", () => {
    const { template: next, clipboard, removedIds } = cutLayers(template(), ["g1"]);
    expect(removedIds).toEqual(["g1"]);
    expect(clipboard.layers).toHaveLength(4);
    // The group AND its descendants are gone.
    expect(next.layers.map((item: any) => item.id).sort()).toEqual(["frozen", "loose"]);
    expectValidDocument(next);
  });

  it("copies a locked layer but refuses to remove it", () => {
    // Same rule Delete already follows: a cut must not silently destroy
    // something the admin has explicitly locked.
    const { template: next, clipboard, removedIds } = cutLayers(template(), ["frozen"]);
    expect(clipboard.layers.map((item: any) => item.id)).toEqual(["frozen"]);
    expect(removedIds).toEqual([]);
    expect(next.layers.find((item: any) => item.id === "frozen")).toBeDefined();
  });

  it("round-trips through paste with fresh ids", () => {
    const { template: afterCut, clipboard } = cutLayers(template(), ["g1"]);
    const { template: afterPaste, newIds } = pasteLayers(afterCut, clipboard, "front");
    expect(newIds).toHaveLength(1);
    expect(newIds[0]).not.toBe("g1");
    expect(afterPaste.layers).toHaveLength(6);
    expectValidDocument(afterPaste);
  });
});

describe("clone operations keep the document valid", () => {
  it("duplicate leaves every invariant intact", () => {
    expectValidDocument(duplicateLayer(template(), "g1").template);
    expectValidDocument(duplicateLayer(template(), "loose").template);
    expectValidDocument(duplicateLayer(template(), "t1").template);
  });
});
