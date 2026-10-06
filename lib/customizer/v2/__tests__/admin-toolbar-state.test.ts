import { describe, expect, it } from "vitest";
import { adminToolbarKind, alignmentPanelAvailability } from "../admin-toolbar-state";

const shape = (id: string, kind = "rectangle", extra: Record<string, unknown> = {}) => ({ id, type: "shape", shape: kind, page: "front", x: 100, y: 100, width: 100, height: 80, ...extra });
const photo = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: "image", src: "https://example.test/a.png", page: "front", x: 300, y: 300, width: 200, height: 200, ...extra });
const text = (id: string) => ({ id, type: "text", text: "Hi", page: "front", x: 0, y: 0, width: 100, height: 40 });

describe("which toolbar a selection gets", () => {
  it("one object gets its own toolbar", () => {
    expect(adminToolbarKind([text("t")])).toBe("text");
    expect(adminToolbarKind([shape("s")])).toBe("shape");
    expect(adminToolbarKind([shape("l", "line")])).toBe("line");
    expect(adminToolbarKind([photo("p")])).toBe("image");
    expect(adminToolbarKind([{ ...photo("f"), type: "frame", src: "" }])).toBe("image");
    expect(adminToolbarKind([{ id: "g", type: "group", childIds: [] }])).toBe("group");
    expect(adminToolbarKind([{ id: "q", type: "qrCode" }])).toBe("object");
    expect(adminToolbarKind([{ id: "e", type: "element", src: "x.svg" }])).toBe("object");
  });

  it("nothing selected gets no toolbar", () => {
    expect(adminToolbarKind([])).toBeNull();
    expect(adminToolbarKind([null as any])).toBeNull();
  });

  it("one photo plus one maskable shape gets the Mask toolbar, whichever was selected first", () => {
    for (const kind of ["rectangle", "rounded-rectangle", "circle", "ellipse", "oval", "triangle", "arch"]) {
      expect(adminToolbarKind([photo("p"), shape("s", kind)]), kind).toBe("mask");
      expect(adminToolbarKind([shape("s", kind), photo("p")]), kind).toBe("mask");
    }
  });

  it("a photo with a shape the mask engine cannot draw falls through to the multi toolbar", () => {
    expect(adminToolbarKind([photo("p"), shape("l", "line")])).toBe("multi");
    expect(adminToolbarKind([photo("p"), shape("s", "path", { path: "M0 0" })])).toBe("multi");
    // Different pages or groups cannot be clipped together either.
    expect(adminToolbarKind([photo("p"), shape("s", "rectangle", { page: "back" })])).toBe("multi");
    expect(adminToolbarKind([photo("p", { groupId: "g" }), shape("s")])).toBe("multi");
  });

  it("every other selection of two or more gets the multi toolbar", () => {
    expect(adminToolbarKind([text("a"), text("b")])).toBe("multi");
    expect(adminToolbarKind([photo("a"), photo("b")])).toBe("multi");
    expect(adminToolbarKind([text("a"), photo("b")])).toBe("multi");
    expect(adminToolbarKind([shape("a"), shape("b")])).toBe("multi");
    expect(adminToolbarKind([photo("p"), shape("s"), text("t")])).toBe("multi");
  });
});

describe("what the Alignment panel allows", () => {
  it("one object: aligns to the artboard only; Selection is unavailable, and so is distribution", () => {
    const can = alignmentPanelAvailability({ selectionCount: 1, canTransform: true, distributeTarget: "artboard" });
    expect(can.selectionTarget.enabled).toBe(false);
    expect(can.align.enabled).toBe(true);
    expect(can.distribute.enabled).toBe(false);
    expect([can.flip.enabled, can.scale.enabled, can.rotate.enabled]).toEqual([true, true, true]);
  });

  it("two objects: Selection is available; they distribute across the artboard but not within themselves", () => {
    expect(alignmentPanelAvailability({ selectionCount: 2, canTransform: true, distributeTarget: "artboard" }).distribute.enabled).toBe(true);
    const within = alignmentPanelAvailability({ selectionCount: 2, canTransform: true, distributeTarget: "selection" });
    expect(within.selectionTarget.enabled).toBe(true);
    expect(within.distribute.enabled).toBe(false);
    expect(within.distribute.reason).toContain("three");
  });

  it("three objects distribute within the selection", () => {
    expect(alignmentPanelAvailability({ selectionCount: 3, canTransform: true, distributeTarget: "selection" }).distribute.enabled).toBe(true);
  });

  it("a locked selection explains itself instead of silently greying out", () => {
    const can = alignmentPanelAvailability({ selectionCount: 2, canTransform: false, distributeTarget: "artboard" });
    expect([can.align, can.distribute, can.flip, can.scale, can.rotate].every((action) => !action.enabled && /Unlock/.test(action.reason))).toBe(true);
  });
});
