import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  WHEEL_SCROLL_MARGIN,
  normalizeWheelDelta,
  panFromWheel,
  wheelScrollLimits,
  wheelZoomFactor,
} from "@/lib/customizer/v2/viewport-pan";

const fits = { workspaceWidth: 900, workspaceHeight: 700, displayWidth: 500, displayHeight: 700 };
const zoomedIn = { workspaceWidth: 900, workspaceHeight: 700, displayWidth: 1000, displayHeight: 1400 };

describe("the wheel scrolls a zoomed-in artboard", () => {
  it("does nothing when the card already fits", () => {
    expect(wheelScrollLimits(fits)).toEqual({ maxPanX: 0, maxPanY: 0 });
    expect(panFromWheel({ panX: 0, panY: 0 }, { dx: 0, dy: 120 }, fits)).toEqual({ panX: 0, panY: 0 });
  });

  it("scrolls only what is hidden, plus a small margin", () => {
    expect(wheelScrollLimits(zoomedIn)).toEqual({ maxPanX: 50 + WHEEL_SCROLL_MARGIN, maxPanY: 350 + WHEEL_SCROLL_MARGIN });
  });

  it("wheel down moves the card up; up moves it back; never past the edge", () => {
    let pan = { panX: 0, panY: 0 };
    pan = panFromWheel(pan, { dx: 0, dy: 100 }, zoomedIn);
    expect(pan).toEqual({ panX: 0, panY: -100 });
    for (let index = 0; index < 20; index += 1) pan = panFromWheel(pan, { dx: 0, dy: 100 }, zoomedIn);
    expect(pan.panY).toBe(-(350 + WHEEL_SCROLL_MARGIN));
    for (let index = 0; index < 40; index += 1) pan = panFromWheel(pan, { dx: 0, dy: -100 }, zoomedIn);
    expect(pan.panY).toBe(350 + WHEEL_SCROLL_MARGIN);
  });

  it("never yanks back a card that was dragged further out — it only stops it going further", () => {
    const dragged = { panX: 0, panY: -900 };
    expect(panFromWheel(dragged, { dx: 0, dy: 100 }, zoomedIn)).toEqual(dragged);
    expect(panFromWheel(dragged, { dx: 0, dy: -100 }, zoomedIn).panY).toBe(-800);
  });

  it("Shift turns the wheel sideways; lines and pages become pixels", () => {
    expect(normalizeWheelDelta({ deltaX: 0, deltaY: 3, deltaMode: 1, shiftKey: true }, 700)).toEqual({ dx: 48, dy: 0 });
    expect(normalizeWheelDelta({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 700)).toEqual({ dx: 0, dy: 700 });
    expect(normalizeWheelDelta({ deltaX: 12, deltaY: -4 }, 700)).toEqual({ dx: 12, dy: -4 });
  });

  it("Ctrl/⌘+wheel and pinch zoom smoothly in the wheel's direction", () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
    expect(wheelZoomFactor(-100) * wheelZoomFactor(100)).toBeCloseTo(1, 10);
  });

  it("is wired to the studio canvas as a non-passive listener that leaves crop mode alone", () => {
    const canvas = readFileSync(join(process.cwd(), "app/admin/dashboard/design-builder/AdminCanvas.tsx"), "utf8");
    expect(canvas).toContain('element.addEventListener("wheel", onWheel, { passive: false })');
    expect(canvas).toContain("if (cropRef.current) return;");
    const builder = readFileSync(join(process.cwd(), "app/admin/dashboard/design-builder/AdminDesignBuilder.tsx"), "utf8");
    expect(builder).toContain("panForZoomChange({ panX: current.panX, panY: current.panY }, current.zoom, next)");
  });
});
