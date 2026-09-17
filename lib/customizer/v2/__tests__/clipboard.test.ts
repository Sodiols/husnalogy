// Regression coverage for cloning layers — Duplicate, Copy and Paste (spec §18).
//
// Paste used to force `groupId: ""` onto every clone and leave `childIds`
// pointing at the ORIGINALS, and Copy stored only the selected rows rather than
// the subtree. Pasting a copied group therefore produced a container whose
// children belonged to the group it was copied from: a document
// `validateGroupRelationships` rejects, where moving either group dragged the
// other one's contents.

import { describe, expect, it } from "vitest";

import { clonedIdsFor, expandCloneSelection, relinkClones } from "../clipboard";
import { validateGroupRelationships } from "../groups";

const layers = [
  { id: "g1", type: "group", groupId: "", childIds: ["t1", "g2"] },
  { id: "t1", type: "text", groupId: "g1" },
  { id: "g2", type: "group", groupId: "g1", childIds: ["t2"] },
  { id: "t2", type: "text", groupId: "g2" },
  { id: "loose", type: "shape", groupId: "" },
];

/** Stand-in for the editor's own id factory. */
const mint = (sources: readonly any[]) => sources.map((source) => ({ ...source, id: `${source.id}_copy` }));

describe("clipboard — what gets cloned", () => {
  it("pulls in every descendant of a selected group, at any depth", () => {
    const expanded = expandCloneSelection(layers, ["g1"]).map((layer) => layer.id);
    expect(expanded).toEqual(["g1", "t1", "g2", "t2"]);
  });

  it("keeps the document's own order so the clone stacks like the original", () => {
    expect(expandCloneSelection(layers, ["t2", "g1"]).map((l) => l.id)).toEqual(["g1", "t1", "g2", "t2"]);
  });

  it("leaves unrelated layers out", () => {
    expect(expandCloneSelection(layers, ["loose"]).map((l) => l.id)).toEqual(["loose"]);
    expect(expandCloneSelection(layers, []).length).toBe(0);
  });

  it("terminates on a corrupt parent cycle instead of hanging", () => {
    const cyclic = [
      { id: "a", type: "group", groupId: "b", childIds: ["b"] },
      { id: "b", type: "group", groupId: "a", childIds: ["a"] },
    ];
    expect(expandCloneSelection(cyclic, ["a"]).map((l) => l.id).sort()).toEqual(["a", "b"]);
  });
});

describe("clipboard — how the clones refer to each other", () => {
  it("rebuilds the whole group hierarchy against the copies", () => {
    const sources = expandCloneSelection(layers, ["g1"]);
    const copies = relinkClones(sources, mint(sources));

    const byId = new Map(copies.map((copy: any) => [copy.id, copy]));
    expect(byId.get("g1_copy").childIds).toEqual(["t1_copy", "g2_copy"]);
    expect(byId.get("g2_copy").childIds).toEqual(["t2_copy"]);
    expect(byId.get("t1_copy").groupId).toBe("g1_copy");
    expect(byId.get("t2_copy").groupId).toBe("g2_copy");
    // The copy is self-contained: no clone references a source id.
    const sourceIds = new Set(layers.map((layer) => layer.id));
    for (const copy of copies as any[]) {
      expect(sourceIds.has(copy.groupId)).toBe(false);
      for (const childId of copy.childIds ?? []) expect(sourceIds.has(childId)).toBe(false);
    }
  });

  it("produces a document with no dangling group relationships", () => {
    const sources = expandCloneSelection(layers, ["g1"]);
    const copies = relinkClones(sources, mint(sources));
    expect(validateGroupRelationships([...layers, ...copies])).toEqual([]);
  });

  it("makes a partially copied child a top-level object rather than adopting it", () => {
    // Copying only the inner text must not splice the copy into the group the
    // customer did not touch.
    const sources = expandCloneSelection(layers, ["t1"]);
    const copies = relinkClones(sources, mint(sources)) as any[];
    expect(copies).toHaveLength(1);
    expect(copies[0].groupId).toBe("");
  });

  it("drops child ids whose layer was not cloned", () => {
    const sources = [{ id: "g", type: "group", groupId: "", childIds: ["kept", "absent"] }, { id: "kept", groupId: "g" }];
    const copies = relinkClones(sources, mint(sources)) as any[];
    expect(copies[0].childIds).toEqual(["kept_copy"]);
  });

  it("stays aligned when the caller refuses to clone one of the sources", () => {
    // The editor drops a source whose normaliser rejects it. Pairing is by
    // INDEX, so callers must drop source and clone together — this asserts the
    // contract the customer editor now upholds.
    const sources = expandCloneSelection(layers, ["g1"]).filter((layer) => layer.id !== "t1");
    const copies = relinkClones(sources, mint(sources)) as any[];
    const group = copies.find((copy) => copy.id === "g1_copy");
    expect(group.childIds).toEqual(["g2_copy"]);
  });
});

describe("clipboard — what ends up selected", () => {
  it("selects the clones of the requested layers, not every descendant", () => {
    const sources = expandCloneSelection(layers, ["g1"]);
    const copies = relinkClones(sources, mint(sources));
    expect(clonedIdsFor(sources, copies, ["g1"])).toEqual(["g1_copy"]);
  });

  it("selects every requested layer in a multi-selection clone", () => {
    const sources = expandCloneSelection(layers, ["g2", "loose"]);
    const copies = relinkClones(sources, mint(sources));
    expect(clonedIdsFor(sources, copies, ["g2", "loose"]).sort()).toEqual(["g2_copy", "loose_copy"]);
  });
});
