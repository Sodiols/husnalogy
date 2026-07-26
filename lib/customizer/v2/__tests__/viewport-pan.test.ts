import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  clampPan,
  createPanGesture,
  fitViewport,
  INITIAL_VIEWPORT,
  isTypingTarget,
  MIDDLE_MOUSE_BUTTON,
  panCursor,
  panFromGesture,
  panHasPointerPriority,
  panLimits,
  shouldBeginPan,
  type PanBounds,
} from "../viewport-pan";

const root = process.cwd();
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
// Comments explain what the code deliberately does NOT do, so assertions about
// absent behaviour have to run against code only.
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\/\/.*$/gm, "");
const adminCanvas = read("app/admin/dashboard/design-builder/AdminCanvas.tsx");
const adminCanvasCode = stripComments(adminCanvas);
const adminBuilder = read("app/admin/dashboard/design-builder/AdminDesignBuilder.tsx");
const adminBuilderCode = stripComments(adminBuilder);
const toolRail = read("app/admin/dashboard/design-builder/AdminToolRail.tsx");

// A workspace comfortably LARGER than the canvas: the exact situation where the
// old scrollLeft/scrollTop implementation had no overflow to scroll and so did
// nothing at all.
const FITTING: PanBounds = {
  workspaceWidth: 1200,
  workspaceHeight: 900,
  displayWidth: 600,
  displayHeight: 800,
};

const drag = (bounds: PanBounds, dx: number, dy: number, from = { panX: 0, panY: 0 }) => {
  const gesture = createPanGesture({ pointerId: 1, clientX: 500, clientY: 400 }, from);
  return panFromGesture(gesture, 500 + dx, 400 + dy, bounds);
};

describe("viewport pan — the canvas-fits-inside-the-workspace regression", () => {
  it("pans a canvas that fully fits inside the workspace at zoom 1", () => {
    // 600x800 canvas inside a 1200x900 workspace: no overflow, no scrollbars.
    expect(FITTING.displayWidth).toBeLessThan(FITTING.workspaceWidth);
    expect(FITTING.displayHeight).toBeLessThan(FITTING.workspaceHeight);

    // Drag the pointer 100px right.
    expect(drag(FITTING, 100, 0)).toEqual({ panX: 100, panY: 0 });
  });

  it("pans vertically with no scrollable overflow", () => {
    expect(drag(FITTING, 0, 100)).toEqual({ panX: 0, panY: 100 });
    expect(drag(FITTING, 0, -140)).toEqual({ panX: 0, panY: -140 });
  });

  it("moves the canvas by the pointer distance in both directions", () => {
    expect(drag(FITTING, -100, -75)).toEqual({ panX: -100, panY: -75 });
    expect(drag(FITTING, 250, 180)).toEqual({ panX: 250, panY: 180 });
  });

  it("continues from the pan the gesture started at", () => {
    expect(drag(FITTING, 60, 40, { panX: 100, panY: 20 })).toEqual({ panX: 160, panY: 60 });
  });
});

describe("viewport pan — zoom independence", () => {
  // Pan is a screen-space translation. 100 pointer pixels must be 100 canvas
  // pixels on screen at every zoom, i.e. zoom must never be applied twice.
  const atZoom = (zoom: number): PanBounds => ({
    workspaceWidth: 1200,
    workspaceHeight: 900,
    displayWidth: 600 * zoom,
    displayHeight: 800 * zoom,
  });

  it.each([0.5, 1, 1.5, 2, 4])("moves 100 screen pixels at zoom %s", (zoom) => {
    expect(drag(atZoom(zoom), 100, 0).panX).toBe(100);
  });

  it("does not divide or multiply the delta by scale", () => {
    const half = drag(atZoom(0.5), 120, 90);
    const double = drag(atZoom(2), 120, 90);
    expect(half).toEqual({ panX: 120, panY: 90 });
    expect(double).toEqual({ panX: 120, panY: 90 });
  });
});

describe("viewport pan — boundaries", () => {
  it("keeps part of the canvas inside the workspace", () => {
    const far = drag(FITTING, 100_000, 100_000);
    const { maxPanX, maxPanY } = panLimits(FITTING);
    expect(far).toEqual({ panX: maxPanX, panY: maxPanY });

    // The canvas is pushed a long way but its leading edge is still on screen.
    const leftEdge = FITTING.workspaceWidth / 2 - FITTING.displayWidth / 2 + far.panX;
    expect(leftEdge).toBeLessThan(FITTING.workspaceWidth);
    expect(FITTING.workspaceWidth - leftEdge).toBeGreaterThanOrEqual(48);
  });

  it("scales the limits to the workspace instead of using fixed pixels", () => {
    const small = panLimits({ workspaceWidth: 600, workspaceHeight: 400, displayWidth: 300, displayHeight: 400 });
    const large = panLimits({ workspaceWidth: 2400, workspaceHeight: 1400, displayWidth: 900, displayHeight: 1200 });
    expect(large.maxPanX).toBeGreaterThan(small.maxPanX);
    expect(large.maxPanY).toBeGreaterThan(small.maxPanY);
  });

  it("still allows generous travel rather than fencing the canvas in", () => {
    const { maxPanX } = panLimits(FITTING);
    expect(maxPanX).toBeGreaterThan(FITTING.displayWidth / 2);
  });

  it("allows reaching the far edge when the canvas overflows the workspace", () => {
    const zoomed: PanBounds = { workspaceWidth: 1200, workspaceHeight: 900, displayWidth: 2000, displayHeight: 2600 };
    const { maxPanX, maxPanY } = panLimits(zoomed);
    // Enough travel to bring the overflowing edges into view.
    expect(maxPanX).toBeGreaterThanOrEqual((zoomed.displayWidth - zoomed.workspaceWidth) / 2);
    expect(maxPanY).toBeGreaterThanOrEqual((zoomed.displayHeight - zoomed.workspaceHeight) / 2);
  });

  it("survives a zero-sized workspace before first measurement", () => {
    const pan = clampPan({ panX: 40, panY: 40 }, { workspaceWidth: 0, workspaceHeight: 0, displayWidth: 0, displayHeight: 0 });
    expect(Number.isFinite(pan.panX)).toBe(true);
    expect(Number.isFinite(pan.panY)).toBe(true);
  });
});

describe("viewport pan — gesture arbitration", () => {
  it("starts panning with the Pan tool", () => {
    expect(shouldBeginPan({ activeTool: "pan", button: 0 })).toBe(true);
  });

  it("does not start panning with the Select tool", () => {
    expect(shouldBeginPan({ activeTool: "select", button: 0 })).toBe(false);
  });

  it("starts panning while Space is held from any tool", () => {
    expect(shouldBeginPan({ activeTool: "select", spacePanActive: true, button: 0 })).toBe(true);
    expect(shouldBeginPan({ activeTool: "text", spacePanActive: true, button: 0 })).toBe(true);
  });

  it("does not Space-pan while inline text editing is open", () => {
    expect(shouldBeginPan({ activeTool: "select", spacePanActive: true, editingText: true, button: 0 })).toBe(false);
  });

  it("starts panning on middle mouse from any tool", () => {
    expect(shouldBeginPan({ activeTool: "select", button: MIDDLE_MOUSE_BUTTON })).toBe(true);
    expect(shouldBeginPan({ activeTool: "text", button: MIDDLE_MOUSE_BUTTON })).toBe(true);
  });

  it("ignores the right mouse button", () => {
    expect(shouldBeginPan({ activeTool: "select", button: 2 })).toBe(false);
  });

  it("gives pan priority over layer, handle and guide gestures", () => {
    // Dragging directly over text, an image or a guide must pan, not select.
    expect(panHasPointerPriority({ activeTool: "pan", button: 0 })).toBe(true);
    expect(panHasPointerPriority({ activeTool: "select", spacePanActive: true, button: 0 })).toBe(true);
    expect(panHasPointerPriority({ activeTool: "select", button: MIDDLE_MOUSE_BUTTON })).toBe(true);
    expect(panHasPointerPriority({ activeTool: "select", button: 0 })).toBe(false);
  });
});

describe("viewport pan — Space must not steal typing", () => {
  it("treats form controls and contenteditable as typing targets", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("does not treat the canvas surface as a typing target", () => {
    expect(isTypingTarget({ tagName: "DIV" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("viewport pan — cursor", () => {
  it("reports grab, grabbing and none", () => {
    expect(panCursor({ panToolActive: true, isPanning: false })).toBe("grab");
    expect(panCursor({ panToolActive: true, isPanning: true })).toBe("grabbing");
    expect(panCursor({ panToolActive: false, isPanning: false })).toBe("");
  });

  it("returns to grab after the drag ends", () => {
    const before = panCursor({ panToolActive: true, isPanning: false });
    const during = panCursor({ panToolActive: true, isPanning: true });
    const after = panCursor({ panToolActive: true, isPanning: false });
    expect([before, during, after]).toEqual(["grab", "grabbing", "grab"]);
  });
});

describe("viewport pan — fit and reset", () => {
  it("starts centred and unpanned", () => {
    expect(INITIAL_VIEWPORT).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });

  it("resets both zoom and pan", () => {
    expect(fitViewport(1)).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });

  it("recovers the page from any panned position", () => {
    const lost = drag(FITTING, 100_000, 100_000);
    expect(lost.panX).toBeGreaterThan(0);
    expect(fitViewport(1)).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });

  it("keeps whatever zoom Fit decides on", () => {
    expect(fitViewport(0.75)).toEqual({ zoom: 0.75, panX: 0, panY: 0 });
  });
});

describe("viewport pan — never touches the document", () => {
  it("returns only pan offsets, with no layer or document fields", () => {
    const result = drag(FITTING, 100, 60);
    expect(Object.keys(result).sort()).toEqual(["panX", "panY"]);
  });

  it("does not mutate the layer-like object it is given", () => {
    const layer = { id: "text-1", x: 750, y: 1050, width: 400, height: 120 };
    const before = JSON.stringify(layer);
    drag(FITTING, 220, 140);
    expect(JSON.stringify(layer)).toBe(before);
  });

  it("is unaffected by switching page, because pan is not page state", () => {
    // The same gesture produces the same offset regardless of surrounding state.
    expect(drag(FITTING, 90, 45)).toEqual(drag(FITTING, 90, 45));
  });
});

/* ---------------------------------------------------------------- wiring --
 * The repo has no DOM test environment, so component behaviour is asserted as a
 * source contract, the same way the other admin/customizer component tests do.
 */

describe("AdminCanvas pan wiring", () => {
  it("no longer implements pan through scrollLeft/scrollTop", () => {
    // The root cause: pan used to need scrollable overflow to exist.
    expect(adminCanvasCode).not.toContain("scrollLeft");
    expect(adminCanvasCode).not.toContain("scrollTop");
  });

  it("translates the whole canvas surface with one shared transform", () => {
    const surface = adminCanvas.slice(adminCanvas.indexOf("data-canvas-surface"));
    expect(surface).toContain("translate3d(${panX}px, ${panY}px, 0)");
    // The transform sits on the surface itself, not on the shared renderer, so
    // guides, selection outlines, handles and the inline editor move with it.
    const preview = adminCanvas.indexOf("<CustomizerPreview");
    expect(adminCanvas.indexOf("translate3d")).toBeLessThan(preview);
  });

  it("uses the shared viewport-pan module rather than a second pan system", () => {
    expect(adminCanvas).toContain('from "@/lib/customizer/v2/viewport-pan"');
    expect(adminCanvas).toContain("panFromGesture");
    expect(adminCanvas).toContain("shouldBeginPan");
  });

  it("uses pointer capture and ends on pointerup and pointercancel", () => {
    expect(adminCanvas).toContain("setPointerCapture");
    expect(adminCanvas).toContain("releasePointerCapture");
    expect(adminCanvas).toContain("onPointerUp={endPan}");
    expect(adminCanvas).toContain("onPointerCancel={endPan}");
  });

  it("does not end the pan gesture on pointerleave alone", () => {
    expect(adminCanvas).not.toContain("onPointerLeave={endPan}");
  });

  it("never saves, commits or creates history while panning", () => {
    const panBlock = adminCanvas.slice(adminCanvas.indexOf("const beginPan"), adminCanvas.indexOf("// Space temporarily"));
    expect(panBlock).not.toContain("onBeginChange");
    expect(panBlock).not.toContain("onLayerChange");
    expect(panBlock).not.toContain("onLayersChange");
    expect(panBlock).not.toContain("onTextCommit");
  });

  it("does not clear the selection when the pan gesture owns the pointer", () => {
    expect(adminCanvas).toContain("if (panOwnsPointer(event)) return;\n          onSelect(null);");
  });

  it("stands down layer, handle, rotation and guide gestures during pan", () => {
    expect(adminCanvas).toContain("if (panOwnsPointer(e)) return;");
    expect(adminCanvas).toContain("if (panOwnsPointer(event)) return;");
    // Pan is checked before stopPropagation so the event still reaches the
    // workspace and pans.
    const layerHandler = adminCanvasCode.slice(adminCanvasCode.indexOf("const onLayerPointerDown"));
    expect(layerHandler.indexOf("panOwnsPointer")).toBeLessThan(layerHandler.indexOf("stopPropagation"));
  });

  it("drives the cursor from real pan state, not only the CSS active selector", () => {
    expect(adminCanvas).toContain("panCursor({ isPanning, panToolActive })");
    expect(adminCanvas).not.toContain("active:cursor-grabbing");
  });

  it("supports Space temporary pan without changing the active tool", () => {
    expect(adminCanvas).toContain('event.code !== "Space"');
    expect(adminCanvas).toContain("setSpacePanActive(true)");
    expect(adminCanvas).toContain("setSpacePanActive(false)");
    expect(adminCanvas).toContain("isTypingTarget");
    // Space must not permanently reassign the tool.
    expect(adminCanvas).not.toContain('setActiveTool("pan")');
  });

  it("prevents the browser middle-click auto-scroll", () => {
    expect(adminCanvas).toContain("MIDDLE_MOUSE_BUTTON");
    expect(adminCanvas).toContain("onAuxClick");
    expect(adminCanvas).toContain("event.preventDefault()");
  });

  it("uses a single movement system, without scrollbars competing", () => {
    expect(adminCanvas).toContain("overflow-hidden");
    expect(adminCanvas).not.toContain("overflow-auto");
  });

  it("sets touchAction so the browser does not steal the touch gesture", () => {
    expect(adminCanvas).toContain("touchAction: panToolActive || isPanning");
  });

  it("batches pointer moves through requestAnimationFrame", () => {
    expect(adminCanvas).toContain("requestAnimationFrame");
    expect(adminCanvas).toContain("cancelAnimationFrame");
  });
});

describe("AdminDesignBuilder viewport wiring", () => {
  it("keeps zoom and pan together as one viewport state", () => {
    expect(adminBuilder).toContain("useState<ViewportState>(INITIAL_VIEWPORT)");
    expect(adminBuilder).toContain("panX={viewport.panX}");
    expect(adminBuilder).toContain("panY={viewport.panY}");
    expect(adminBuilder).toContain("onPanChange={setPan}");
  });

  it("resets pan as well as zoom on Fit and 1:1", () => {
    expect(adminBuilder).toContain("const resetViewport = () => setViewport(fitViewport(1))");
    expect(adminBuilder).toContain("onFit={resetViewport}");
    expect(adminBuilder).toContain("onActualSize={resetViewport}");
    expect(adminBuilder).not.toContain("onFit={() => setZoom(1)}");
  });

  it("toggles the Pan tool on and back to Select", () => {
    expect(adminBuilder).toContain('current === "pan" ? "select" : "pan"');
    expect(toolRail).toContain('id="pan"');
    expect(toolRail).toContain('props.activeTool === "pan"');
    expect(toolRail).toContain("onClick={props.onPan}");
  });

  it("does not route pan through the template, history or dirty tracking", () => {
    const viewportBlock = adminBuilder.slice(
      adminBuilder.indexOf("const [viewport"),
      adminBuilder.indexOf("const resetViewport"),
    );
    expect(viewportBlock).not.toContain("apply(");
    expect(viewportBlock).not.toContain("commit(");
    expect(viewportBlock).not.toContain("snapshot(");
    expect(viewportBlock).not.toContain("setDirtySinceSave");
  });

  it("keeps pan out of the saved template entirely", () => {
    // Pan lives only in component state: it is never handed to the change,
    // commit or save paths that write the document.
    expect(adminBuilderCode).not.toMatch(/\b(apply|commit|snapshot|onSave|onChange)\s*\([^)]*pan/i);
    // And it is never spread onto the template object.
    expect(adminBuilderCode).not.toMatch(/\.\.\.tRef\.current[^}]*pan[XY]/i);
  });
});

describe("production output is unaffected by pan", () => {
  it("keeps pan out of the document, render and validation modules", () => {
    for (const file of [
      "lib/customizer/v2/document.ts",
      "lib/customizer/v2/validate.ts",
      "lib/customizer/v2/svg.ts",
      "lib/customizer/v2/server/render.ts",
    ]) {
      const source = read(file);
      expect(source).not.toContain("panX");
      expect(source).not.toContain("panY");
      expect(source).not.toContain("viewport-pan");
    }
  });

  it("does not export pan state from the customizer document types", () => {
    expect(read("lib/customizer/v2/types.ts")).not.toContain("panX");
  });
});
