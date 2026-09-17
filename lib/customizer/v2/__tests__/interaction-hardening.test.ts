/**
 * Pure contracts behind the hardened interaction foundation.
 *
 * The browser suite proves these end to end; these tests pin the rules
 * themselves, deterministically and without a DOM, so a regression names the
 * exact rule that broke.
 */

import { describe, expect, it } from "vitest";

import { createHistoryStacks } from "@/app/components/customizer/useCustomizerHistory";
import {
  applyGeometryOverrides,
  layerRecordsEquivalent,
  reuseEquivalentLayers,
} from "@/app/components/customizer/customizer-utils";
import { createTransientGeometryStore } from "@/lib/customizer/v2/interaction/transient-preview";
import {
  documentToScreenOffset,
  panForZoomAtPoint,
  panForZoomChange,
  screenToDocumentOffset,
} from "@/lib/customizer/v2/zoom";

/* -------------------------------------------------------------------------- */
/* History checkpoints (crop Cancel rollback)                                 */
/* -------------------------------------------------------------------------- */

describe("history checkpoints", () => {
  it("rolls back ANY number of steps recorded after the checkpoint", () => {
    const stacks = createHistoryStacks<string>();
    stacks.record("A");
    stacks.record("B");
    const checkpoint = stacks.checkpoint();

    // A crop session: pan, pan again, wheel zoom — three committed steps.
    stacks.record("crop-1");
    stacks.record("crop-2");
    stacks.record("crop-3");
    expect(stacks.depth().past).toBe(5);

    stacks.restoreCheckpoint(checkpoint);
    expect(stacks.depth()).toEqual({ past: 2, future: 0 });

    // Undo must now walk ONLY pre-session states, never a canceled crop state.
    expect(stacks.undo("current")).toBe("B");
    expect(stacks.undo("B")).toBe("A");
    expect(stacks.undo("A")).toBeNull();
  });

  it("restores the redo stack that existed when the session opened", () => {
    const stacks = createHistoryStacks<string>();
    stacks.record("A");
    stacks.record("B");
    stacks.undo("C"); // redo stack now holds "C"
    const checkpoint = stacks.checkpoint();

    stacks.record("crop-1"); // a commit clears redo
    expect(stacks.depth().future).toBe(0);

    stacks.restoreCheckpoint(checkpoint);
    expect(stacks.redo("B")).toBe("C");
  });

  it("is a copy: later records do not leak into a checkpoint", () => {
    const stacks = createHistoryStacks<string>();
    stacks.record("A");
    const checkpoint = stacks.checkpoint();
    stacks.record("B");
    expect(checkpoint.past).toEqual(["A"]);
  });

  it("does not let a group window opened inside discarded steps absorb the next edit", () => {
    let clock = 1000;
    const stacks = createHistoryStacks<string>(50, () => clock);
    stacks.record("A");
    const checkpoint = stacks.checkpoint();
    stacks.record("crop", "crop-zoom");
    stacks.restoreCheckpoint(checkpoint);

    clock += 100; // inside the 900ms group window
    expect(stacks.record("next", "crop-zoom"), "a real edit was swallowed by a discarded group").toBe(true);
    expect(stacks.depth().past).toBe(2);
  });

  it("reports whether a record actually pushed an entry", () => {
    let clock = 0;
    const stacks = createHistoryStacks<string>(50, () => clock);
    expect(stacks.record("A", "g")).toBe(true);
    clock += 10;
    expect(stacks.record("B", "g")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Per-layer transient geometry                                               */
/* -------------------------------------------------------------------------- */

describe("transient geometry store", () => {
  it("notifies only the layers whose override changed", () => {
    const store = createTransientGeometryStore();
    const calls: string[] = [];
    store.subscribe("a", () => calls.push("a"));
    store.subscribe("b", () => calls.push("b"));
    store.subscribe("c", () => calls.push("c"));

    const aPatch = { width: 10 };
    store.set({ a: aPatch });
    expect(calls).toEqual(["a"]);

    calls.length = 0;
    // Same object for "a", new layer "b": only "b" is told.
    store.set({ a: aPatch, b: { rotation: 5 } });
    expect(calls).toEqual(["b"]);
  });

  it("notifies every previously overridden layer when cleared", () => {
    const store = createTransientGeometryStore();
    const calls: string[] = [];
    store.subscribe("a", () => calls.push("a"));
    store.subscribe("b", () => calls.push("b"));
    store.set({ a: { x: 1 }, b: { x: 2 } });
    calls.length = 0;

    store.set(null);
    expect(calls.sort()).toEqual(["a", "b"]);
    expect(store.get("a")).toBeNull();
    expect(store.size()).toBe(0);
  });

  it("stops notifying after unsubscribe, so an unmounted layer is never touched", () => {
    const store = createTransientGeometryStore();
    let count = 0;
    const unsubscribe = store.subscribe("a", () => {
      count += 1;
    });
    unsubscribe();
    store.set({ a: { x: 1 } });
    expect(count).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Layer identity reuse (memoized renderer)                                    */
/* -------------------------------------------------------------------------- */

describe("layer identity reuse", () => {
  const base = () => [
    { id: "a", type: "shape", x: 1, y: 2, width: 3, height: 4, textStyle: { fontSize: 10 } },
    {
      id: "g",
      type: "grid",
      slots: [{ id: "s1", transform: { zoom: 1, offsetX: 0 } }],
    },
  ];

  it("treats structurally identical records as equivalent", () => {
    expect(layerRecordsEquivalent(base()[1], base()[1])).toBe(true);
  });

  it("detects a nested change, such as one grid slot's crop offset", () => {
    const changed = base();
    (changed[1] as any).slots[0].transform.offsetX = 5;
    expect(layerRecordsEquivalent(base()[1], changed[1])).toBe(false);
  });

  it("keeps the previous object for unchanged layers and a new one for the changed layer", () => {
    const previous = base();
    const next = base();
    (next[0] as any).x = 99;
    const result = reuseEquivalentLayers(previous, next);
    expect(result[0]).toBe(next[0]);
    expect(result[1]).toBe(previous[1]);
  });

  it("returns the previous array when nothing changed", () => {
    const previous = base();
    expect(reuseEquivalentLayers(previous, base())).toBe(previous);
  });
});

/* -------------------------------------------------------------------------- */
/* Image transform merge preservation                                          */
/* -------------------------------------------------------------------------- */

describe("image transform merge", () => {
  it("preserves every unrelated transform property through a crop override", () => {
    const layer = {
      id: "p",
      imageTransform: {
        zoom: 2,
        offsetX: 1,
        offsetY: 2,
        rotation: 90,
        flipX: true,
        flipY: true,
        fitMode: "contain",
        cropX: 0.1,
        cropY: 0.2,
        cropWidth: 0.5,
        cropHeight: 0.6,
      },
    };
    const [merged] = applyGeometryOverrides([layer], { p: { imageTransform: { offsetX: 30 } } });
    expect(merged.imageTransform).toEqual({ ...layer.imageTransform, offsetX: 30 });
  });
});

/* -------------------------------------------------------------------------- */
/* Zoom at a screen point                                                      */
/* -------------------------------------------------------------------------- */

describe("zoom at a screen point", () => {
  const cases: Array<[string, number, number]> = [
    ["zoom in", 0.8, 2.4],
    ["zoom out", 3, 0.35],
  ];

  for (const [label, from, to] of cases) {
    it(`keeps the document point under the pointer fixed (${label})`, () => {
      const pan = { panX: 37, panY: -21 };
      const pointer = { x: -180, y: 95 }; // relative to the workspace centre

      const documentPoint = screenToDocumentOffset(pointer, pan, from);
      const nextPan = panForZoomAtPoint(pan, from, to, pointer);
      const landed = documentToScreenOffset(documentPoint, nextPan, to);

      expect(landed.x).toBeCloseTo(pointer.x, 9);
      expect(landed.y).toBeCloseTo(pointer.y, 9);
    });
  }

  it("reduces to the centre-preserving zoom when the pointer is at the centre", () => {
    const pan = { panX: 40, panY: 12 };
    expect(panForZoomAtPoint(pan, 1, 2, { x: 0, y: 0 })).toEqual(panForZoomChange(pan, 1, 2));
  });

  it("round-trips screen and document coordinates", () => {
    const pan = { panX: 5, panY: 7 };
    const point = { x: 123.5, y: -44.25 };
    const back = documentToScreenOffset(screenToDocumentOffset(point, pan, 1.75), pan, 1.75);
    expect(back.x).toBeCloseTo(point.x, 9);
    expect(back.y).toBeCloseTo(point.y, 9);
  });

  it("ignores an invalid zoom instead of producing NaN pan", () => {
    expect(panForZoomAtPoint({ panX: 1, panY: 2 }, 0, 2, { x: 5, y: 5 })).toEqual({ panX: 1, panY: 2 });
  });
});
