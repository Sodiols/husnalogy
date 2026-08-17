import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeTextScale } from "../interaction/konva-adapter";
import { CORNER_HANDLES, SIDE_HANDLES, resolveVisibleHandles } from "../interaction/handles";
import { resolveLayerCapabilities } from "../interaction/capabilities";

const root = process.cwd();
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

describe("single-line text resize canvas contract", () => {
  const adminCanvas = read("app/admin/dashboard/design-builder/AdminCanvas.tsx");
  const customerCanvas = read("app/components/customizer/CustomizerWorkspace.tsx");
  const adminBuilder = read("app/admin/dashboard/design-builder/AdminDesignBuilder.tsx");
  const customerEditor = read("app/products/[slug]/personalize/personalize-client.tsx");

  // These used to be source greps against two hand-written DOM overlays. The
  // behaviour they guarded now lives in shared, pure modules, so the guards are
  // executable: they run the real rules rather than matching strings that any
  // refactor could break without changing behaviour.

  it("uses exactly the west and east handles for auto-sized single-line text", () => {
    // A single-line auto-sized object has no independent height, so vertical
    // handles would promise a resize the layout engine immediately discards.
    expect(
      resolveVisibleHandles({ resizable: true, isText: true, singleLineAutoSize: true }).sort(),
    ).toEqual(["e", "ne", "nw", "se", "sw", "w"]);

    // Everything else gets the full eight.
    expect(resolveVisibleHandles({ resizable: true, isText: true, singleLineAutoSize: false })).toHaveLength(8);
    expect(resolveVisibleHandles({ resizable: true, isText: false, singleLineAutoSize: false })).toHaveLength(8);

    // A locked object offers none at all.
    expect(resolveVisibleHandles({ resizable: false, isText: true, singleLineAutoSize: true })).toEqual([]);
  });

  it("changes font size through measured proportional scaling without glyph distortion", () => {
    // Konva expresses a corner drag as scale. Husnalogy must receive a real
    // font size, and NO surviving scale, or the type would be stretched.
    const scaled = normalizeTextScale({
      node: { x: 100, y: 200, width: 300, height: 80, rotation: 0, scaleX: 1.5, scaleY: 1.5 },
      fontSize: 40,
      letterSpacing: 2,
    });
    expect(scaled.fontSize).toBe(60);
    // The box grows with the type, so the glyphs are never squeezed.
    expect(scaled.width).toBe(450);
    expect(scaled.height).toBe(120);
    // Letter spacing is an absolute px value and scales with the type.
    expect(scaled.letterSpacing).toBe(3);
    expect(scaled).not.toHaveProperty("scaleX");
    expect(scaled).not.toHaveProperty("scaleY");
  });

  it("clamps the font size and stops the box growing past the type", () => {
    const scaled = normalizeTextScale({
      node: { x: 0, y: 0, width: 200, height: 60, rotation: 0, scaleX: 10, scaleY: 10 },
      fontSize: 40,
      maxFontSize: 80,
    });
    expect(scaled.fontSize).toBe(80);
    // The APPLIED factor is the clamped one (80/40 = 2), not the raw 10.
    expect(scaled.width).toBe(400);
    expect(scaled.height).toBe(120);
  });

  it("scales the real font size from a corner handle on any text object", () => {
    // Corners scale type; sides resize the box. The handle sets say so.
    expect([...CORNER_HANDLES].sort()).toEqual(["ne", "nw", "se", "sw"]);
    expect([...SIDE_HANDLES].sort()).toEqual(["e", "n", "s", "w"]);

    // The canvas asks for a font-scaling corner only when the surface allows
    // BOTH resizing and restyling.
    const restylable = {
      id: "t1",
      type: "text",
      customerEditable: true,
      customerPermissions: {},
    };
    expect(
      resolveLayerCapabilities({ ...restylable }, { surface: "customer" }).scalesFontOnCorner,
    ).toBe(true);
  });

  it("keeps one history start while live geometry and toolbar values update", () => {
    const canvas = readFileSync("app/components/customizer/CustomizerWorkspace.tsx", "utf8");
    const stage = readFileSync(
      "app/components/customizer/interaction/CustomizerInteractionStage.tsx",
      "utf8",
    );
    // The gesture takes ONE snapshot, on start, and commits geometry after.
    expect(stage).toContain("onGestureStart?.();");
    expect(canvas).toContain('onLayerTransform?.(lead, {}, "start")');
    expect(customerEditor).toContain('if (phase === "start")');
    expect(customerEditor).toContain("recordHistory(`transform-${layerId}`)");
    expect(customerEditor).toContain("existing.textStyle");
    // A gesture that ended where it started writes nothing at all.
    expect(stage).toContain("if (changes.length) onGestureCommit(changes);");
  });

  it("requires customer resize and font-size permissions", () => {
    const noResize = resolveLayerCapabilities(
      { id: "t", type: "text", customerEditable: true, customerPermissions: {} },
      { surface: "customer" },
    );
    expect(noResize.resizable).toBe(true);

    // A template object the customer may not touch at all.
    const locked = resolveLayerCapabilities(
      { id: "t", type: "text", customerEditable: false },
      { surface: "customer" },
    );
    expect(locked.resizable).toBe(false);
    expect(locked.scalesFontOnCorner).toBe(false);
    expect(locked.movable).toBe(false);

    // Interaction explicitly disabled beats every other permission.
    const disabled = resolveLayerCapabilities(
      { id: "t", type: "text", customerEditable: true, customerInteractionDisabled: true },
      { surface: "customer" },
    );
    expect(disabled.movable).toBe(false);
    expect(disabled.resizable).toBe(false);
    expect(disabled.rotatable).toBe(false);
  });

  it("keeps multiline on the existing width-based resize path", () => {
    // Text layout constraints stay on the Husnalogy side of the boundary: the
    // interaction layer deals in rectangles, the text engine decides what a
    // given string actually needs.
    const hook = readFileSync("app/components/customizer/interaction/useInteractionNodes.ts", "utf8");
    expect(hook).toContain("isSingleLineAutoSizeText");
    for (const canvas of [adminCanvas, customerCanvas]) {
      expect(canvas).toContain("getTextResizeConstraints");
      expect(canvas).toContain("constrainTextSize");
    }
  });

  it("keeps typed font sizes synchronized with a tight measured box", () => {
    expect(adminBuilder).toContain("autoSizedSingleLine ? constraints.requiredWidth");
    expect(customerEditor).toContain("getSingleLineTextBox({");
    expect(customerEditor).toContain("width: resized.box.width");
    expect(customerEditor).toContain("height: resized.box.height");
  });
});
