import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  alignLayers,
  arrangeLayerSelection,
  distributeLayers,
  marqueeLayerIdsForSelection,
  selectableLayersForPage,
} from "@/app/admin/dashboard/design-builder/builder-utils";
import { groupLayers, rotatedAxisHalfExtents, ungroupLayers } from "../groups";

const shape = (id: string, x: number, y: number, width = 40, height = 40, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  type: "shape",
  shape: "rectangle",
  page: "front",
  x,
  y,
  width,
  height,
  rotation: 0,
  zIndex: 1,
  hidden: false,
  locked: false,
  adminEditable: true,
  ...extra,
});

describe("admin multi-object selection and alignment", () => {
  it("limits Select All to visible logical objects on the active side", () => {
    const template = {
      layers: [
        shape("front", 40, 40),
        shape("back", 40, 40, 40, 40, { page: "back" }),
        shape("hidden", 80, 40, 40, 40, { hidden: true }),
        shape("nonselectable", 100, 40, 40, 40, { adminEditable: false }),
        shape("group", 140, 40, 120, 40, { type: "group", childIds: ["child"] }),
        shape("child", 140, 40, 40, 40, { groupId: "group" }),
      ],
    };

    expect(selectableLayersForPage(template, "front").map((layer) => layer.id)).toEqual(["front", "group"]);
    expect(selectableLayersForPage(template, "back").map((layer) => layer.id)).toEqual(["back"]);
    expect(selectableLayersForPage(template, "front", "group").map((layer) => layer.id)).toEqual(["front", "child"]);
  });

  it("selects every object a marquee touches, in any drag direction", () => {
    const layers = [
      shape("inside", 50, 50, 20, 20),
      shape("edge", 108, 50, 20, 20),
      shape("outside", 140, 50, 20, 20),
      shape("rotated", 50, 132, 60, 10, { rotation: 90 }),
      shape("hidden", 50, 50, 20, 20, { hidden: true }),
    ];

    // "edge" spans 98–118: clipped by the box, so touch semantics include it.
    expect(marqueeLayerIdsForSelection({ left: 0, top: 0, right: 100, bottom: 100 }, layers)).toEqual([
      "inside",
      "edge",
    ]);
    // Dragged bottom-right to top-left instead: identical result.
    expect(marqueeLayerIdsForSelection({ left: 100, top: 100, right: 0, bottom: 0 }, layers)).toEqual([
      "inside",
      "edge",
    ]);
    const rotated = rotatedAxisHalfExtents(layers[3]);
    expect(rotated.halfH).toBeCloseTo(30);
    // A thin sweep that merely grazes the rotated object still catches it.
    expect(marqueeLayerIdsForSelection({ left: 0, top: 150, right: 100, bottom: 155 }, [layers[3]])).toEqual(["rotated"]);
  });

  it("runs the four-text alignment and equal-edge-gap workflow", () => {
    const template: any = {
      canvasWidthPx: 600,
      canvasHeightPx: 800,
      layers: [
        shape("one", 80, 100, 40, 30, { type: "text", text: "ONE", zIndex: 1 }),
        shape("two", 150, 220, 80, 50, { type: "text", text: "TWO", zIndex: 2 }),
        shape("three", 250, 390, 60, 70, { type: "text", text: "THREE", zIndex: 3 }),
        shape("four", 400, 700, 100, 90, { type: "text", text: "FOUR", zIndex: 4 }),
      ],
    };
    const ids = template.layers.map((layer: any) => layer.id);

    const leftAligned = alignLayers(template, ids, "left");
    const leftEdges = leftAligned.layers.map((layer: any) => layer.x - layer.width / 2);
    expect(new Set(leftEdges).size).toBe(1);

    const centered = alignLayers(leftAligned, ids, "center");
    expect(new Set(centered.layers.map((layer: any) => layer.x)).size).toBe(1);

    const spaced = distributeLayers(centered, ids, "vertical", "spacing");
    const ordered = spaced.layers.slice().sort((a: any, b: any) => a.y - b.y);
    const gaps = ordered.slice(1).map((layer: any, index: number) =>
      (layer.y - layer.height / 2) - (ordered[index].y + ordered[index].height / 2));
    expect(gaps[1]).toBeCloseTo(gaps[0]);
    expect(gaps[2]).toBeCloseTo(gaps[0]);
  });

  it("keeps group children visually fixed through grouping, movement, and ungrouping", () => {
    const original = [
      shape("madison", 100, 120, 120, 40, { type: "text", text: "MADISON" }),
      shape("ampersand", 220, 180, 40, 40, { type: "text", text: "&", zIndex: 2 }),
      shape("kennedy", 340, 240, 120, 40, { type: "text", text: "KENNEDY", zIndex: 3 }),
    ];
    const grouped = groupLayers(original, ["madison", "ampersand", "kennedy"], "group", "Group");
    const movedTemplate = alignLayers(
      { canvasWidthPx: 600, canvasHeightPx: 800, layers: grouped },
      ["group"],
      "centerOnCard",
    );
    const beforeUngroup = new Map(
      movedTemplate.layers.filter((layer: any) => layer.id !== "group").map((layer: any) => [
        layer.id,
        { x: layer.x, y: layer.y, width: layer.width, height: layer.height, rotation: layer.rotation },
      ]),
    );
    const ungrouped = ungroupLayers(movedTemplate.layers, "group");

    expect(ungrouped.some((layer: any) => layer.id === "group")).toBe(false);
    for (const layer of ungrouped) {
      expect({ x: layer.x, y: layer.y, width: layer.width, height: layer.height, rotation: layer.rotation }).toEqual(beforeUngroup.get(layer.id));
      expect(layer.groupId || "").toBe("");
    }
  });

  it("moves a multi-selection through layer order as one block", () => {
    const template: any = {
      layers: [
        shape("a", 10, 10, 20, 20, { zIndex: 1 }),
        shape("b", 20, 20, 20, 20, { zIndex: 2 }),
        shape("c", 30, 30, 20, 20, { zIndex: 3 }),
        shape("d", 40, 40, 20, 20, { zIndex: 4 }),
      ],
    };
    const arranged = arrangeLayerSelection(template, ["a", "c"], "bringToFront");
    expect(arranged.layers.slice().sort((a: any, b: any) => a.zIndex - b.zIndex).map((layer: any) => layer.id)).toEqual([
      "b",
      "d",
      "a",
      "c",
    ]);
  });

  it("keeps editor-only marquee UI out of the shared renderer and wires one drag snapshot", () => {
    const canvas = readFileSync("app/admin/dashboard/design-builder/AdminCanvas.tsx", "utf8");
    const toolbar = readFileSync("app/admin/dashboard/design-builder/AdminContextToolbar.tsx", "utf8");
    const renderer = readFileSync("app/components/customizer/CustomizerPreview.tsx", "utf8");
    const stage = readFileSync("app/components/customizer/interaction/CustomizerInteractionStage.tsx", "utf8");

    // The marquee, the combined selection frame and the drag threshold moved to
    // the shared Konva interaction layer, which both canvases mount. What this
    // guards is unchanged: the editor-only chrome is not in the renderer, and a
    // gesture still takes exactly one history snapshot.
    expect(canvas).toContain("<InteractionStageClient");
    expect(canvas).toContain("onGestureStart={handleGestureStart}");
    expect(canvas).toContain("onBeginChange?.()");
    expect(canvas).toContain("onEnterGroup?.(layer.id)");
    expect(stage).toContain("marqueeRef");
    expect(stage).toContain("hitTestMarquee");
    // Selection chrome is drawn on the Konva overlay and never by the shared
    // renderer, so it cannot reach the PNG/PDF pipeline.
    expect(renderer).not.toContain("data-admin-selection-marquee");
    expect(renderer).not.toContain("Transformer");
    // Distribution, spacing, match size and grouping moved out of the toolbar
    // row into the structured Layout menu; their gating now lives in the pure
    // layoutActionAvailability helper (asserted in admin-text-toolbar.test.ts).
    expect(toolbar).toContain('label="Equal horizontal spacing"');
    expect(toolbar).toContain('label="Equal vertical spacing"');
    expect(toolbar).toContain('label="Group objects"');
    expect(toolbar).toContain('label="Ungroup"');
    expect(toolbar).toContain("layoutActionAvailability");
  });
});
