import { describe, expect, it } from "vitest";
import {
  ZOOM_MAX,
  ZOOM_MIN,
  clampZoom,
  computeFitWidthZoom,
  computeFitZoom,
  panForZoomChange,
  stepZoom,
} from "../zoom";

// A 5x7 portrait card at 300 DPI — the most common Husnalogy stationery page.
const CARD = { canvasWidth: 1500, canvasHeight: 2100 };

describe("clampZoom", () => {
  it("keeps sane values and rejects nonsense", () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(0)).toBe(1);
    expect(clampZoom(-3)).toBe(1);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom("0.5" as unknown as number)).toBe(0.5);
  });

  it("clamps into the supported range", () => {
    expect(clampZoom(0.01)).toBe(ZOOM_MIN);
    expect(clampZoom(99)).toBe(ZOOM_MAX);
  });
});

describe("computeFitZoom", () => {
  it("returns null until the workspace has been measured", () => {
    expect(computeFitZoom({ availableWidth: 0, availableHeight: 0, baseWidth: 0, ...CARD })).toBeNull();
    expect(
      computeFitZoom({ availableWidth: Number.NaN, availableHeight: 800, baseWidth: 620, ...CARD }),
    ).toBeNull();
  });

  it("is bound by height for a portrait page in a short workspace", () => {
    // baseWidth 620 => height at zoom 1 is 620 * (2100/1500) = 868px, which does
    // not fit in 600px of workspace height. Fit must shrink, not stay at 1.
    const zoom = computeFitZoom({
      availableWidth: 900,
      availableHeight: 600,
      baseWidth: 620,
      padding: 24,
      ...CARD,
    });
    expect(zoom).not.toBeNull();
    // usable height 552 / 868 = 0.6359...
    expect(zoom).toBeCloseTo(552 / 868, 4);
    expect(zoom!).toBeLessThan(1);
  });

  it("never lets the page overflow either axis", () => {
    const input = { availableWidth: 480, availableHeight: 1400, baseWidth: 620, padding: 16, ...CARD };
    const zoom = computeFitZoom(input)!;
    const displayWidth = input.baseWidth * zoom;
    const displayHeight = displayWidth * (CARD.canvasHeight / CARD.canvasWidth);
    expect(displayWidth).toBeLessThanOrEqual(input.availableWidth - input.padding * 2 + 0.001);
    expect(displayHeight).toBeLessThanOrEqual(input.availableHeight - input.padding * 2 + 0.001);
  });

  it("can zoom past 100% when a small page sits in a large workspace", () => {
    const zoom = computeFitZoom({
      availableWidth: 1600,
      availableHeight: 1200,
      baseWidth: 400,
      padding: 24,
      canvasWidth: 1500,
      canvasHeight: 1000,
    })!;
    expect(zoom).toBeGreaterThan(1);
  });

  it("handles landscape pages by binding on width", () => {
    const zoom = computeFitZoom({
      availableWidth: 700,
      availableHeight: 900,
      baseWidth: 620,
      padding: 20,
      canvasWidth: 2100,
      canvasHeight: 1500,
    })!;
    expect(zoom).toBeCloseTo(660 / 620, 4);
  });

  it("returns null rather than a wrong zoom when the workspace has no room", () => {
    expect(
      computeFitZoom({ availableWidth: 40, availableHeight: 400, baseWidth: 620, padding: 24, ...CARD }),
    ).toBeNull();
  });

  it.each([
    [320, 568],
    [360, 800],
    [375, 812],
    [390, 844],
    [414, 896],
    [768, 1024],
    [1024, 768],
    [1366, 768],
    [1440, 900],
    [1920, 1080],
  ])("fits the whole page at %ix%i", (width, height) => {
    // Approximate the customer editor chrome: header + bottom controls.
    const availableWidth = Math.max(120, width - (width >= 1024 ? 420 : 0));
    const availableHeight = Math.max(120, height - 172);
    const baseWidth = Math.min(Math.max(availableWidth - 32, 220), 620);
    const zoom = computeFitZoom({ availableWidth, availableHeight, baseWidth, padding: 16, ...CARD })!;
    const displayWidth = baseWidth * zoom;
    const displayHeight = displayWidth * (CARD.canvasHeight / CARD.canvasWidth);
    expect(displayWidth).toBeLessThanOrEqual(availableWidth + 0.001);
    expect(displayHeight).toBeLessThanOrEqual(availableHeight + 0.001);
  });
});

describe("computeFitWidthZoom", () => {
  it("ignores height", () => {
    const zoom = computeFitWidthZoom({
      availableWidth: 900,
      availableHeight: 200,
      baseWidth: 620,
      padding: 20,
      ...CARD,
    })!;
    expect(zoom).toBeCloseTo(860 / 620, 4);
  });
});

describe("panForZoomChange", () => {
  it("keeps the visual centre while zooming", () => {
    expect(panForZoomChange({ panX: 100, panY: -50 }, 1, 2)).toEqual({ panX: 200, panY: -100 });
    expect(panForZoomChange({ panX: 100, panY: -50 }, 2, 1)).toEqual({ panX: 50, panY: -25 });
  });

  it("is a no-op for invalid zooms", () => {
    expect(panForZoomChange({ panX: 10, panY: 10 }, 0, 2)).toEqual({ panX: 10, panY: 10 });
  });
});

describe("stepZoom", () => {
  it("steps multiplicatively and stays in range", () => {
    expect(stepZoom(1, 1)).toBeCloseTo(1.2, 4);
    expect(stepZoom(1, -1)).toBeCloseTo(1 / 1.2, 4);
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
  });
});
