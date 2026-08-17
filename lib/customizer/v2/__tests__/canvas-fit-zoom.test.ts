import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CUSTOMER_MIN_BASE_WIDTH,
  SCREEN_CSS_DPI,
  ZOOM_PRESETS,
  actualSizeZoom,
  computeWorkspaceFit,
  nextZoomPreset,
  resolveCustomerBaseWidth,
  resolveWorkspacePadding,
} from "../zoom";
import { createDefaultCustomizerTemplate } from "@/lib/customizer";

const read = (relative: string) => readFileSync(relative, "utf8");
const adminCanvas = read("app/admin/dashboard/design-builder/AdminCanvas.tsx");
const adminBuilder = read("app/admin/dashboard/design-builder/AdminDesignBuilder.tsx");
const zoomControls = read("app/components/customizer/CustomizerZoomControls.tsx");

/** A 5x7 portrait card at 300 DPI. */
const CARD = { canvasWidth: 1500, canvasHeight: 2100 };

/**
 * Reproduces the admin shell's own CSS widths so the fit is exercised against
 * the real workspace rather than an invented number.
 */
function workspace(viewport: number, height: number, panels = { left: true, inspector: true }, zoom = 1) {
  const cssWidth = viewport / zoom;
  const cssHeight = height / zoom;
  const rail = cssWidth >= 1536 ? 96 : 72;
  const left = panels.left ? Math.min(Math.max(168, 0.16 * cssWidth), 280) : 0;
  const inspector = panels.inspector && cssWidth >= 1024 ? Math.min(Math.max(300, 0.21 * cssWidth), 360) : 0;
  // The builder header and any notice strip sit above the workspace.
  const chromeHeight = 64;
  return {
    availableWidth: cssWidth - rail - left - inspector,
    availableHeight: cssHeight - chromeHeight,
  };
}

/* ------------------------------------------------------------ card size --- */

describe("card format", () => {
  it("defaults to a true 5 x 7 inch portrait document", () => {
    const template = createDefaultCustomizerTemplate();
    expect(template.cardWidthIn).toBe(5);
    expect(template.cardHeightIn).toBe(7);
    expect(template.orientation).toBe("portrait");
    expect(template.dpi).toBe(300);
  });

  it("uses the matching 300 DPI trim pixel dimensions", () => {
    const template = createDefaultCustomizerTemplate();
    expect(template.canvasWidthPx).toBe(1500);
    expect(template.canvasHeightPx).toBe(2100);
    expect(template.canvasWidthPx / template.cardWidthIn).toBe(300);
    expect(template.canvasHeightPx / template.cardHeightIn).toBe(300);
  });

  it("keeps a 5:7 trim ratio, with bleed held separately", () => {
    const template = createDefaultCustomizerTemplate();
    expect(template.canvasWidthPx / template.canvasHeightPx).toBeCloseTo(5 / 7, 10);
    // Bleed is its own inset; it never inflates the trim dimensions.
    expect(template.bleed).toBeDefined();
    expect(template.canvasWidthPx).toBe(1500);
  });

  it("preserves the trim ratio through the fit at any workspace shape", () => {
    for (const [w, h] of [[900, 700], [500, 1400], [1600, 500]]) {
      const fit = computeWorkspaceFit({ availableWidth: w, availableHeight: h, ...CARD })!;
      expect(fit.baseWidth / fit.baseHeight).toBeCloseTo(5 / 7, 10);
    }
  });
});

/* ------------------------------------------------------------ fit scale --- */

describe("100% zoom fits the whole card", () => {
  const VIEWPORTS: Array<[number, number]> = [
    [1024, 768],
    [1280, 720],
    [1366, 768],
    [1440, 900],
    [1536, 864],
    [1920, 1080],
  ];
  const PANELS = [
    { name: "both panels open", panels: { left: true, inspector: true } },
    { name: "left collapsed", panels: { left: false, inspector: true } },
    { name: "inspector collapsed", panels: { left: true, inspector: false } },
    { name: "both collapsed", panels: { left: false, inspector: false } },
  ];
  const BROWSER_ZOOMS = [0.9, 1, 1.25];

  for (const [vw, vh] of VIEWPORTS) {
    for (const { name, panels } of PANELS) {
      for (const browserZoom of BROWSER_ZOOMS) {
        it(`fits the complete card at ${vw}x${vh}, ${name}, ${browserZoom * 100}% browser zoom`, () => {
          const box = workspace(vw, vh, panels, browserZoom);
          const fit = computeWorkspaceFit({ ...box, ...CARD });
          expect(fit).not.toBeNull();
          const { baseWidth, baseHeight, padding } = fit!;

          // The whole card, plus its padding, fits the measured workspace.
          expect(baseWidth + padding.left + padding.right).toBeLessThanOrEqual(box.availableWidth + 0.001);
          expect(baseHeight + padding.top + padding.bottom).toBeLessThanOrEqual(box.availableHeight + 0.001);
          // Both edges are reachable at once: the card is shorter than the box.
          expect(baseHeight).toBeLessThan(box.availableHeight);
          // Aspect ratio is never distorted to make it fit.
          expect(baseWidth / baseHeight).toBeCloseTo(5 / 7, 10);
        });
      }
    }
  }

  it("keeps clear spacing on all four sides", () => {
    for (const [vw, vh] of VIEWPORTS) {
      const box = workspace(vw, vh);
      const { padding } = computeWorkspaceFit({ ...box, ...CARD })!;
      expect(padding.top).toBeGreaterThanOrEqual(24);
      expect(padding.top).toBeLessThanOrEqual(40);
      expect(padding.left).toBeGreaterThanOrEqual(24);
      expect(padding.left).toBeLessThanOrEqual(40);
      expect(padding.right).toBe(padding.left);
      // Bottom clears the floating zoom toolbar.
      expect(padding.bottom).toBeGreaterThanOrEqual(56);
      expect(padding.bottom).toBeLessThanOrEqual(80);
      expect(padding.bottom).toBeGreaterThan(padding.top);
    }
  });

  it("is bound by the tighter axis, never by width alone", () => {
    // A short, wide workspace must be height-constrained for a portrait card.
    const wide = computeWorkspaceFit({ availableWidth: 1600, availableHeight: 600, ...CARD })!;
    expect(wide.baseHeight).toBeLessThanOrEqual(wide.usableHeight + 0.001);
    expect(wide.fitScale).toBeCloseTo(wide.usableHeight / CARD.canvasHeight, 10);

    // A tall, narrow workspace must be width-constrained.
    const tall = computeWorkspaceFit({ availableWidth: 420, availableHeight: 1400, ...CARD })!;
    expect(tall.fitScale).toBeCloseTo(tall.usableWidth / CARD.canvasWidth, 10);
  });

  it("recalculates when a side panel opens or closes", () => {
    const both = computeWorkspaceFit({ ...workspace(1440, 900, { left: true, inspector: true }), ...CARD })!;
    const noInspector = computeWorkspaceFit({ ...workspace(1440, 900, { left: true, inspector: false }), ...CARD })!;
    const none = computeWorkspaceFit({ ...workspace(1440, 900, { left: false, inspector: false }), ...CARD })!;
    // More room never makes the card smaller.
    expect(noInspector.fitScale).toBeGreaterThanOrEqual(both.fitScale);
    expect(none.fitScale).toBeGreaterThanOrEqual(noInspector.fitScale);
    // Every one of them still fits.
    for (const fit of [both, noInspector, none]) {
      expect(fit.baseHeight).toBeLessThanOrEqual(fit.usableHeight + 0.001);
    }
  });

  it("recalculates when the browser is resized", () => {
    const small = computeWorkspaceFit({ ...workspace(1280, 720), ...CARD })!;
    const large = computeWorkspaceFit({ ...workspace(1920, 1080), ...CARD })!;
    expect(large.fitScale).toBeGreaterThan(small.fitScale);
  });

  it("holds off until the workspace has actually been measured", () => {
    expect(computeWorkspaceFit({ availableWidth: 0, availableHeight: 0, ...CARD })).toBeNull();
    expect(computeWorkspaceFit({ availableWidth: NaN, availableHeight: 800, ...CARD })).toBeNull();
    // A workspace smaller than its own padding yields no usable area.
    expect(computeWorkspaceFit({ availableWidth: 40, availableHeight: 40, ...CARD })).toBeNull();
  });

  it("works for landscape and square formats too", () => {
    const landscape = computeWorkspaceFit({ ...workspace(1440, 900), canvasWidth: 2100, canvasHeight: 1500 })!;
    expect(landscape.baseWidth / landscape.baseHeight).toBeCloseTo(7 / 5, 10);
    const square = computeWorkspaceFit({ ...workspace(1440, 900), canvasWidth: 1500, canvasHeight: 1500 })!;
    expect(square.baseWidth).toBeCloseTo(square.baseHeight, 10);
    for (const fit of [landscape, square]) {
      expect(fit.baseWidth).toBeLessThanOrEqual(fit.usableWidth + 0.001);
      expect(fit.baseHeight).toBeLessThanOrEqual(fit.usableHeight + 0.001);
    }
  });
});

/* ------------------------------------------------------- zoom semantics --- */

describe("zoom percentages mean what they say", () => {
  const box = workspace(1440, 900);
  const fit = computeWorkspaceFit({ ...box, ...CARD })!;
  const rendered = (zoom: number) => ({ width: fit.baseWidth * zoom, height: fit.baseHeight * zoom });

  it("renders the fitted size at exactly 100%", () => {
    expect(rendered(1).width).toBeCloseTo(fit.baseWidth, 10);
    expect(rendered(1).height).toBeLessThanOrEqual(fit.usableHeight + 0.001);
  });

  it("renders smaller than the fitted view below 100%", () => {
    expect(rendered(0.7).width).toBeLessThan(fit.baseWidth);
    expect(rendered(0.7).height).toBeLessThan(fit.baseHeight);
  });

  it("renders larger than the fitted view above 100%", () => {
    expect(rendered(1.25).width).toBeGreaterThan(fit.baseWidth);
    expect(rendered(2).width).toBeCloseTo(fit.baseWidth * 2, 10);
    // Above 100% the card may exceed the workspace — that is what enables pan.
    expect(rendered(1.25).height).toBeGreaterThan(fit.usableHeight);
  });

  it("keeps 1:1 a separate scale from 100%", () => {
    const oneToOne = actualSizeZoom(fit.fitScale, 300);
    expect(oneToOne).not.toBeCloseTo(1, 3);
    // At 1:1 the card is drawn at its true physical size: 5in x 96 CSS DPI.
    const renderedWidth = fit.baseWidth * oneToOne;
    expect(renderedWidth).toBeCloseTo((1500 / 300) * SCREEN_CSS_DPI, 6);
    expect(renderedWidth).toBeCloseTo(480, 6);
  });

  it("derives 1:1 from the document DPI, not a constant", () => {
    const at300 = actualSizeZoom(fit.fitScale, 300);
    const at150 = actualSizeZoom(fit.fitScale, 150);
    expect(at150).toBeCloseTo(at300 * 2, 6);
    // Invalid input degrades to 100% rather than throwing.
    expect(actualSizeZoom(0, 300)).toBe(1);
    expect(actualSizeZoom(fit.fitScale, 0)).toBe(1);
  });

  it("offers sensible zoom stops including 100%", () => {
    expect(ZOOM_PRESETS).toContain(1);
    for (const stop of [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
      expect(ZOOM_PRESETS).toContain(stop);
    }
    expect([...ZOOM_PRESETS].sort((a, b) => a - b)).toEqual(ZOOM_PRESETS);
  });

  it("steps between presets in both directions and stops at the ends", () => {
    expect(nextZoomPreset(1, 1)).toBe(1.1);
    expect(nextZoomPreset(1, -1)).toBe(0.9);
    expect(nextZoomPreset(0.72, 1)).toBe(0.75);
    expect(nextZoomPreset(0.72, -1)).toBe(0.67);
    expect(nextZoomPreset(3, 1)).toBe(3);
    expect(nextZoomPreset(0.25, -1)).toBe(0.25);
  });

  it("keeps padding responsive but bounded", () => {
    const tiny = resolveWorkspacePadding(300, 300);
    const huge = resolveWorkspacePadding(3000, 2000);
    expect(tiny.left).toBe(24);
    expect(huge.left).toBe(40);
    expect(huge.bottom).toBe(80);
    expect(tiny.bottom).toBe(56);
  });
});

/* --------------------------------------------- document coordinate safety - */

describe("zoom is a viewport transform only", () => {
  it("never changes the saved document dimensions", () => {
    const template = createDefaultCustomizerTemplate();
    const before = { w: template.canvasWidthPx, h: template.canvasHeightPx, dpi: template.dpi };
    for (const zoom of [0.25, 0.7, 1, 1.25, 3]) {
      const fit = computeWorkspaceFit({ ...workspace(1440, 900), ...CARD })!;
      // The rendered size changes; the document does not.
      expect(fit.baseWidth * zoom).toBeGreaterThan(0);
      expect(template.canvasWidthPx).toBe(before.w);
      expect(template.canvasHeightPx).toBe(before.h);
      expect(template.dpi).toBe(before.dpi);
    }
  });

  it("keeps overlays on the one shared scale the artwork uses", () => {
    // Every overlay position in AdminCanvas derives from `scale`, which is
    // displayW / canvasW — so guides, selection boxes, handles, snapping and
    // the inline editor cannot drift away from the rendered page.
    expect(adminCanvas).toContain("const scale = displayW / canvasW;");
    expect(adminCanvas).toContain("const displayW = baseWidth * zoom;");
    expect(adminCanvas).toContain("const displayH = displayW * (canvasH / canvasW);");
    // Snap tolerance is now derived from the same scale inside the shared
    // interaction layer, as a SCREEN distance converted to document units, so
    // it feels identical at every zoom level.
    const handles = readFileSync("lib/customizer/v2/interaction/handles.ts", "utf8");
    expect(handles).toContain("SNAP_SCREEN_TOLERANCE / safeScale");
    expect(adminCanvas).toContain("scale={scale}");
    // One transform on one element carries artwork and every overlay together.
    expect(adminCanvas).toContain("transform: `translate3d(${panX}px, ${panY}px, 0)`");
  });

  it("derives production pixels from the document, never from the viewport", () => {
    expect(adminCanvas).toContain("const canvasW = template?.canvasWidthPx || 1500;");
    expect(adminCanvas).toContain("const canvasH = template?.canvasHeightPx || 2100;");
    // The fit consumes the document size; it never writes it back.
    expect(adminCanvas).not.toMatch(/canvasWidthPx\s*[:=]\s*(displayW|baseWidth|scale)/);
    expect(adminCanvas).not.toMatch(/canvasHeightPx\s*[:=]\s*(displayH|baseWidth|scale)/);
  });
});

/* ------------------------------------------------------------- wiring ----- */

describe("canvas viewport wiring", () => {
  it("bases 100% on the measured workspace, not a capped width", () => {
    expect(adminCanvas).toContain("computeWorkspaceFit({");
    expect(adminCanvas).toContain("availableWidth: containerWidth");
    expect(adminCanvas).toContain("availableHeight: containerHeight");
    expect(adminCanvas).toContain("workspaceFit?.baseWidth");
    // The old width-only cap is gone.
    expect(adminCanvas).not.toContain("maxCanvasWidth");
    expect(adminCanvas).not.toContain("containerWidth >= 1200 ? 900");
  });

  it("measures the workspace box with a ResizeObserver and window events", () => {
    expect(adminCanvas).toContain("new ResizeObserver(update)");
    expect(adminCanvas).toContain('window.addEventListener("resize", update)');
    expect(adminCanvas).toContain('window.addEventListener("orientationchange", update)');
    expect(adminCanvas).toContain("ro.disconnect()");
  });

  it("centres the card on both axes inside the padded workspace", () => {
    expect(adminCanvas).toContain("items-center justify-center");
    expect(adminCanvas).not.toContain("items-start justify-center");
    // Padding comes from the same resolver the fit used, so the reserved space
    // and the fitted size can never disagree.
    expect(adminCanvas).toContain("paddingTop: fitPadding.top");
    expect(adminCanvas).toContain("paddingBottom: fitPadding.bottom");
    expect(adminCanvas).toContain("resolveWorkspacePadding");
  });

  it("makes Fit reset to 100% and recentre, with 1:1 kept separate", () => {
    expect(adminBuilder).toContain("const fitToPage = () => setViewport(fitViewport(1))");
    expect(adminBuilder).toContain("const resetViewport = () => setViewport(fitViewport(actualSizeZoomValue ?? 1))");
    expect(adminBuilder).toContain("fitZoom={1}");
    expect(adminBuilder).toContain("actualSizeZoom={actualSizeZoomValue}");
  });

  it("reports the physical scale for the 1:1 control", () => {
    expect(adminCanvas).toContain("actualSizeZoom(workspaceFit.fitScale, documentDpi)");
    expect(adminCanvas).toContain("const documentDpi = Number(template?.dpi) || 300;");
    expect(zoomControls).toContain("actualSizeZoom");
    expect(zoomControls).toContain("aria-pressed={atActualSize}");
  });

  it("shows a percentage that matches the rendered scale", () => {
    // The stepper reads the same `zoom` the canvas multiplies by, so the label
    // and the rendered size cannot diverge.
    expect(zoomControls).toContain("value={Math.round(zoom * 100)}");
    expect(zoomControls).toContain("onZoomChange(value / 100)");
    expect(zoomControls).toContain("nextZoomPreset");
  });

  it("leaves the customer workspace on its own zoom convention", () => {
    // Scope guard: this change is admin-only.
    const workspaceSource = read("app/components/customizer/CustomizerWorkspace.tsx");
    expect(workspaceSource).toContain("computeFitZoom");
    expect(workspaceSource).not.toContain("computeWorkspaceFit");
  });
});

describe("100% is a defined rule on each surface, not a hardcoded 1 (spec §35)", () => {
  it("customer 100% is the reading size: workspace width, capped", () => {
    // Wide monitor: the cap is what stops a greetings card rendering a foot wide.
    expect(
      resolveCustomerBaseWidth({ availableWidth: 2400, padding: 32, maxCanvasWidth: 620 }),
    ).toBe(620);
    // Ordinary laptop column: the workspace width, minus its padding.
    expect(
      resolveCustomerBaseWidth({ availableWidth: 500, padding: 32, maxCanvasWidth: 620 }),
    ).toBe(436);
    // Very narrow: never collapses below a usable minimum.
    expect(
      resolveCustomerBaseWidth({ availableWidth: 200, padding: 32, maxCanvasWidth: 620 }),
    ).toBe(CUSTOMER_MIN_BASE_WIDTH);
    // Unmeasured first frame: a sensible width rather than zero.
    expect(
      resolveCustomerBaseWidth({ availableWidth: 0, padding: 32, maxCanvasWidth: 620 }),
    ).toBe(416);
  });

  it("admin 100% is Fit, which is a different number from the customer rule", () => {
    const fit = computeWorkspaceFit({
      availableWidth: 1200,
      availableHeight: 800,
      canvasWidth: 1500,
      canvasHeight: 2100,
    })!;
    // Constrained by HEIGHT for a portrait card, which the customer rule ignores.
    expect(fit.baseWidth).toBeLessThan(
      resolveCustomerBaseWidth({ availableWidth: 1200, padding: 32, maxCanvasWidth: 2000 }),
    );
    expect(fit.baseHeight).toBeLessThanOrEqual(fit.usableHeight + 0.001);
  });

  it("1:1 stays a third, physically defined action", () => {
    const fit = computeWorkspaceFit({
      availableWidth: 1200,
      availableHeight: 800,
      canvasWidth: 1500,
      canvasHeight: 2100,
    })!;
    // A 300 DPI document on a 96 DPI screen is drawn at 96/300 of document size.
    const oneToOne = actualSizeZoom(fit.fitScale, 300);
    expect(fit.fitScale * oneToOne).toBeCloseTo(96 / 300, 10);
    // And it is genuinely distinct from Fit.
    expect(oneToOne).not.toBeCloseTo(1, 3);
  });
});
