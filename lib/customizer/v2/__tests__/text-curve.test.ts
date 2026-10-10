import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as opentype from "opentype.js";
import { Resvg } from "@resvg/resvg-js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  TEXT_CURVE_MAX,
  TEXT_CURVE_MAX_SWEEP_DEG,
  TEXT_CURVE_MIN,
  layoutCurvedText,
  normalizeTextCurve,
  textCurveApplies,
  textCurveGeometry,
  textCurvePathD,
} from "../text-curve";
import { createOpentypeMeasure, fallbackMeasure, resolveTextBox, type MeasureFn, type MeasureStyle } from "../text-layout";
import { withGposKerning } from "../gpos-kerning";
import { buildPageSvg } from "../svg";
import { resolveLayerSelectionGeometry } from "../selection-geometry";
import { resolveVisibleHandles } from "../interaction/handles";
import { normalizeTextStyleV2, templateToDocument } from "../document";
import { runPreflight } from "../preflight";
import { textStyleOverrideSchema, userLayerSchema } from "../validate";
import { normalizeCustomizerTemplate, normalizeUserLayer } from "../..";
import { templateFromVersionSnapshot } from "../../versions";
import { buildPrintPdf } from "../server/render";
import CustomizerPreview from "@/app/components/customizer/CustomizerPreview";

const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");

/* The repository's own Inter files: real metrics, real glyphs, no network. */
const FONT_DIR = path.join(process.cwd(), "app", "brand-fonts");
const FONT_FILE = path.join(FONT_DIR, "Inter-400.ttf");
const SERIF_FILE = path.join(FONT_DIR, "CormorantGaramond-400.ttf");
function parse(file: string) {
  const buffer = readFileSync(file);
  const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return withGposKerning(opentype.parse(bytes), bytes);
}
const fonts = new Map<string, any>([["Inter", parse(FONT_FILE)], ["Cormorant Garamond", parse(SERIF_FILE)]]);
const realMeasure: MeasureFn = createOpentypeMeasure((style: MeasureStyle) => fonts.get(style.fontFamily) || null);

const STYLE = { fontFamily: "Inter", fontSize: 100, fontWeight: "400", letterSpacing: 0, lineHeight: 1, textAlign: "center", autoSizeMode: "width" };

function card(layerStyle: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    enabled: true,
    cardWidthIn: 5,
    cardHeightIn: 7,
    dpi: 300,
    canvasWidthPx: 1500,
    canvasHeightPx: 2100,
    safeArea: { top: 60, right: 60, bottom: 60, left: 60 },
    pages: [{ id: "front", label: "Front", enabled: true, backgroundColor: "#ffffff" }],
    defaultPage: "front",
    fields: [],
    guides: [],
    layers: [
      {
        id: "t_names",
        page: "front",
        type: "text",
        name: "Names",
        text: "Olivia & Noah",
        x: 750,
        y: 1000,
        width: 900,
        height: 120,
        zIndex: 1,
        textStyle: { ...STYLE, color: "#303839", ...layerStyle },
        ...extra,
      },
    ],
  };
}

function layout(curve: number, overrides: Record<string, unknown> = {}, text = "Olivia & Noah", measure: MeasureFn = realMeasure) {
  const style = { ...STYLE, curve, ...overrides } as any;
  const box = resolveTextBox(
    { x: 750, y: 1000, width: 900, height: 120, text, fontFamily: style.fontFamily, fontSize: style.fontSize, letterSpacing: style.letterSpacing, lineHeight: style.lineHeight, textAlign: style.textAlign, autoSizeMode: style.autoSizeMode, uppercase: style.uppercase },
    measure,
  );
  return { box, curved: layoutCurvedText({ box, text, style, measure }) };
}

/** Ink bounding box of an RGBA render (anything darker than mid-grey). */
function inkBounds(svg: string) {
  const image = new Resvg(svg, { font: { fontFiles: [FONT_FILE, SERIF_FILE], loadSystemFonts: false, defaultFontFamily: "Inter" }, background: "#ffffff" }).render();
  const pixels = image.pixels;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let ink = 0;
  const columnTop = new Map<number, number>();
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (pixels[(y * image.width + x) * 4] >= 128) continue;
      ink += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      if (!columnTop.has(x)) columnTop.set(x, y);
    }
  }
  return { ink, minX, minY, maxX, maxY, columnTop, png: Buffer.from(image.asPng()), width: image.width, height: image.height };
}

describe("text curve value", () => {
  it("defaults to straight and stores integers in -100…100", () => {
    expect(normalizeTextCurve(undefined)).toBe(0);
    expect(normalizeTextCurve(null)).toBe(0);
    expect(normalizeTextCurve("")).toBe(0);
    expect(normalizeTextCurve("abc")).toBe(0);
    expect(normalizeTextCurve(Number.NaN)).toBe(0);
    expect(normalizeTextCurve(Infinity)).toBe(0);
    expect(normalizeTextCurve(42.4)).toBe(42);
    expect(normalizeTextCurve("-17")).toBe(-17);
    expect(normalizeTextCurve(-0.3)).toBe(0);
    expect(Object.is(normalizeTextCurve(-0.3), -0)).toBe(false);
    expect(normalizeTextCurve(250)).toBe(TEXT_CURVE_MAX);
    expect(normalizeTextCurve(-999)).toBe(TEXT_CURVE_MIN);
  });

  it("applies to single-line text only, and keeps its value for multiline text", () => {
    expect(textCurveApplies({ curve: 40 }, "Olivia")).toBe(true);
    expect(textCurveApplies({ curve: 0 }, "Olivia")).toBe(false);
    expect(textCurveApplies({ curve: 40, multiline: true }, "Olivia")).toBe(false);
    expect(textCurveApplies({ curve: 40 }, "Olivia\nNoah")).toBe(false);
    expect(textCurveApplies({ curve: 40 }, "Olivia\r\nNoah")).toBe(false);
  });
});

describe("text curve geometry", () => {
  it("is straight (null) at 0 and for empty text", () => {
    expect(textCurveGeometry({ curve: 0, advance: 500, fontSize: 100 })).toBeNull();
    expect(textCurveGeometry({ curve: 50, advance: 0, fontSize: 100 })).toBeNull();
    expect(textCurveGeometry({ curve: 50, advance: 500, fontSize: 0 })).toBeNull();
    expect(layout(0).curved).toBeNull();
    expect(layout(60, {}, "   ").curved).toBeNull();
  });

  it("maps the value linearly to the arc's sweep (documented maximum 330°)", () => {
    for (const curve of [10, 25, 50, 75]) {
      const geometry = textCurveGeometry({ curve, advance: 2000, fontSize: 60 })!;
      expect(geometry.sweep).toBeCloseTo((curve / 100) * (TEXT_CURVE_MAX_SWEEP_DEG * Math.PI) / 180, 9);
      expect(geometry.radius).toBeCloseTo(2000 / geometry.sweep, 6);
    }
  });

  it("bends upward for positive values and downward for negative ones", () => {
    const arch = textCurveGeometry({ curve: 50, advance: 900, fontSize: 100 })!;
    const smile = textCurveGeometry({ curve: -50, advance: 900, fontSize: 100 })!;
    expect(arch.direction).toBe(1);
    expect(smile.direction).toBe(-1);
    // Arch: the circle's centre is below the apex. Smile: above it.
    expect(arch.centerDy).toBeGreaterThan(arch.apexDy);
    expect(smile.centerDy).toBeLessThan(smile.apexDy);
    // Mirror images of each other.
    expect(smile.width).toBeCloseTo(arch.width, 9);
    expect(smile.height).toBeCloseTo(arch.height, 9);
    expect(smile.apexDy).toBeCloseTo(-arch.apexDy, 9);
  });

  it("bends more as the value grows, with no jump anywhere in the range", () => {
    let previous = textCurveGeometry({ curve: 1, advance: 2400, fontSize: 80 })!;
    for (let curve = 2; curve <= 100; curve += 1) {
      const geometry = textCurveGeometry({ curve, advance: 2400, fontSize: 80 })!;
      expect(Number.isFinite(geometry.radius)).toBe(true);
      // Tighter with every step…
      expect(geometry.radius).toBeLessThan(previous.radius);
      expect(geometry.sweep).toBeGreaterThan(previous.sweep);
      // …and smoothly: one slider step never moves the bounds by more than a sliver of the run.
      expect(Math.abs(geometry.width - previous.width)).toBeLessThan(2400 * 0.05);
      expect(Math.abs(geometry.height - previous.height)).toBeLessThan(2400 * 0.05);
      previous = geometry;
    }
  });

  it("handles the maximum values safely: no NaN, no infinite or folded radius", () => {
    for (const curve of [TEXT_CURVE_MIN, TEXT_CURVE_MAX, 1, -1]) {
      for (const advance of [1, 12, 300, 50000]) {
        const geometry = textCurveGeometry({ curve, advance, fontSize: 90 })!;
        for (const value of Object.values(geometry)) expect(Number.isFinite(value as number)).toBe(true);
        expect(geometry.sweep).toBeLessThanOrEqual((TEXT_CURVE_MAX_SWEEP_DEG * Math.PI) / 180 + 1e-12);
        // Never tighter than one font size: short words cannot fold into themselves.
        expect(geometry.radius).toBeGreaterThanOrEqual(90 - 1e-9);
        expect(textCurvePathD(0, 0, geometry)).not.toMatch(/NaN|Infinity/);
      }
    }
  });

  it("puts the apex at exactly half the path's length, so the text centres on it", () => {
    const geometry = textCurveGeometry({ curve: 70, advance: 800, fontSize: 90 })!;
    const d = textCurvePathD(500, 400, geometry);
    const numbers = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    // M x0 y0 A r r 0 0 f x1 y1 A r r 0 0 f x2 y2
    const [x0, y0, , , , , , x1, y1, , , , , , x2, y2] = numbers;
    expect(x1).toBeCloseTo(500, 2);
    expect(y1).toBeCloseTo(400 - geometry.radius, 2);
    // Symmetric ends: the two arcs are the same length.
    expect(x0 - 500).toBeCloseTo(-(x2 - 500), 2);
    expect(y0).toBeCloseTo(y2, 2);
  });
});

describe("curved text layout", () => {
  it("keeps the font size and the straight line's centre (moving the slider never jumps)", () => {
    const { box, curved } = layout(1);
    expect(curved).not.toBeNull();
    expect(curved!.fontSize).toBe(100);
    expect(curved!.centerX).toBeCloseTo(box.x, 6);
    expect(curved!.centerY).toBeCloseTo(box.y, 6);
    // At curve 1 the frame is all but the straight box.
    expect(Math.abs(curved!.frame.width - box.width)).toBeLessThan(box.width * 0.05);
    expect(curved!.frame.x).toBe(box.x);
    expect(curved!.frame.y).toBe(box.y);
  });

  it("follows font, letter spacing and uppercase changes while curved", () => {
    const base = layout(60).curved!;
    const serif = layout(60, { fontFamily: "Cormorant Garamond" }).curved!;
    const spaced = layout(60, { letterSpacing: 20 }).curved!;
    const upper = layout(60, { uppercase: true }).curved!;
    expect(serif.geometry.radius).not.toBeCloseTo(base.geometry.radius, 0);
    // Wider spacing = longer run = larger radius at the same sweep.
    expect(spaced.geometry.radius).toBeGreaterThan(base.geometry.radius);
    expect(spaced.geometry.sweep).toBeCloseTo(base.geometry.sweep, 9);
    expect(upper.text).toBe("OLIVIA & NOAH");
    expect(upper.geometry.radius).toBeGreaterThan(base.geometry.radius);
  });

  it("keeps special characters and Unicode intact", () => {
    for (const text of ["Zoë & Renée", "José ♥ Mía", "عائشة", "李 & 王", "Olivia 💍 Noah", "Fi ffl & Æ"]) {
      const curved = layout(45, {}, text, fallbackMeasure).curved!;
      expect(curved.text).toBe(text);
      expect(curved.pathD).not.toMatch(/NaN|Infinity/);
    }
  });

  it("is laid out from the left or right edge's own centre for aligned text", () => {
    const left = layout(30, { textAlign: "left", autoSizeMode: "fixed" });
    const line = realMeasure("Olivia & Noah", { fontFamily: "Inter", fontSize: 100, fontWeight: "400", fontStyle: "normal", letterSpacing: 0 });
    expect(left.curved!.centerX).toBeCloseTo(left.box.x - left.box.width / 2 + line / 2, 3);
    // The frame stays symmetric about the box centre (the rotation pivot).
    expect(left.curved!.frame.x).toBe(left.box.x);
    expect(left.curved!.frame.width / 2).toBeGreaterThanOrEqual(left.box.x - (left.curved!.centerX - left.curved!.geometry.width / 2) - 1);
  });
});

describe("selection and handles", () => {
  it("selects the curved text by its drawn bounds, centred on the box", () => {
    const layer = card({ curve: 60 }).layers[0];
    const resolved = resolveLayerSelectionGeometry(layer, { text: layer.text, measure: realMeasure, safeBounds: { left: 60, top: 60, right: 1440, bottom: 2040 } }) as any;
    const { curved } = layout(60);
    expect(resolved.textCurved).toBe(true);
    expect(resolved.width).toBe(curved!.frame.width);
    expect(resolved.height).toBe(curved!.frame.height);
    expect(resolved.x).toBe(750);
    // An arch is much taller than its straight line.
    expect(resolved.height).toBeGreaterThan(200);
  });

  it("leaves straight text exactly as before", () => {
    const layer = card({}).layers[0];
    const resolved = resolveLayerSelectionGeometry(layer, { text: layer.text, measure: realMeasure, safeBounds: { left: 60, top: 60, right: 1440, bottom: 2040 } }) as any;
    expect(resolved.textCurved).toBeUndefined();
  });

  it("offers corner handles only (uniform scale) for curved text", () => {
    expect(resolveVisibleHandles({ resizable: true, isText: true, singleLineAutoSize: true, curved: true }).sort()).toEqual(["ne", "nw", "se", "sw"]);
    expect(resolveVisibleHandles({ resizable: true, isText: true, singleLineAutoSize: true })).toContain("e");
  });

  it("scales the stored box with the type on a corner drag, so straightening later stays in proportion", () => {
    const stage = read("app/components/customizer/interaction/CustomizerInteractionStage.tsx");
    expect(stage).toContain("before.curved ? Math.max(1, Math.round((Number(before.documentWidth) || before.width) * applied))");
    expect(read("app/components/customizer/interaction/useInteractionNodes.ts")).toContain("documentWidth: Number(layer.width) || 0");
  });
});

describe("save, publish and personalization keep the curve", () => {
  it("survives template normalization, the canonical document and a published snapshot", () => {
    const normalized = normalizeCustomizerTemplate(card({ curve: -42 }));
    expect(normalized.layers[0].textStyle.curve).toBe(-42);
    const { document } = templateToDocument(normalized);
    expect((document.layers[0] as any).textStyle.curve).toBe(-42);
    const published = templateFromVersionSnapshot({ templateId: "t", document } as any);
    expect(published.layers[0].textStyle.curve).toBe(-42);
  });

  it("is clamped and rounded on save; 0 and missing values are not stored", () => {
    expect(normalizeCustomizerTemplate(card({ curve: 180.6 })).layers[0].textStyle.curve).toBe(100);
    expect("curve" in normalizeCustomizerTemplate(card({ curve: 0 })).layers[0].textStyle).toBe(false);
    expect("curve" in normalizeTextStyleV2({ fontSize: 40 })).toBe(false);
    expect(normalizeTextStyleV2({ fontSize: 40, curve: "-15" }).curve).toBe(-15);
  });

  it("existing designs without a curve render exactly as before (backward compatible)", () => {
    const legacy = card({});
    const svg = buildPageSvg({ template: legacy, pageId: "front", mode: "print", measure: realMeasure });
    expect(svg).not.toContain("textPath");
    expect(svg).toContain("<tspan");
    // A stored 0 is the same document as no curve at all.
    expect(buildPageSvg({ template: card({ curve: 0 }), pageId: "front", mode: "print", measure: realMeasure })).toBe(svg);
  });

  it("is carried by customer duplicates, accepted on customer-added text, and never settable through a customer override", () => {
    expect(normalizeUserLayer({ id: "u1", page: "front", type: "text", text: "Hi", textStyle: { curve: 35 } }).textStyle.curve).toBe(35);
    expect(userLayerSchema.safeParse({ id: "u1", page: "front", type: "text", x: 1, y: 1, width: 10, height: 10, textStyle: { curve: 35 } }).success).toBe(true);
    expect(userLayerSchema.safeParse({ id: "u1", page: "front", type: "text", x: 1, y: 1, width: 10, height: 10, textStyle: { curve: 500 } }).success).toBe(false);
    // The customer may restyle permitted properties of a template text; curvature is the designer's.
    expect(textStyleOverrideSchema.safeParse({ curve: 20 }).success).toBe(false);
  });

  it("renders the customer's personalised wording along the designer's curve", () => {
    const template = card({ curve: 50 }, { fieldId: "names", customerEditable: true });
    template.fields = [{ id: "names", label: "Names", type: "text", required: true }] as any;
    const svg = buildPageSvg({ template, values: { names: "Amira & Yusuf" }, pageId: "front", mode: "print", measure: realMeasure });
    expect(svg).toMatch(/<textPath href="#text-curve-t_names" startOffset="50%">Amira &amp; Yusuf<\/textPath>/);
  });
});

describe("preflight", () => {
  it("does not report box overflow for curved text, but still checks print size", () => {
    const overflowing = card({ curve: 40, autoSizeMode: "fixed", fontSize: 10 }, { width: 50 });
    const { document } = templateToDocument(normalizeCustomizerTemplate(overflowing));
    const codes = runPreflight(document, { measure: realMeasure } as any).issues.map((issue) => issue.code);
    expect(codes).not.toContain("text-overflow");
    expect(codes).not.toContain("text-horizontal-overflow");
    expect(codes).toContain("text-too-small");
  });

  it("checks the safe area against the arc the text draws, not its straight box", () => {
    // Straight, the line sits well inside the 60px safe margin; arched, it rises past it.
    const near = (curve: number) => card({ curve }, { y: 220, customerEditable: true });
    const flagged = (curve: number) => {
      const { document } = templateToDocument(normalizeCustomizerTemplate(near(curve)));
      return runPreflight(document, { measure: realMeasure } as any).issues.some((issue) => issue.code === "outside-safe-area");
    };
    expect(flagged(0)).toBe(false);
    expect(flagged(90)).toBe(true);
  });
});

describe("rendering parity: studio canvas, customer editor and production", () => {
  function clientSvg(template: any) {
    // CustomizerPreview is THE renderer for the Admin studio canvas and the
    // Customer editor alike; server-side it measures with the shared fallback.
    return renderToStaticMarkup(createElement(CustomizerPreview as any, { template, values: {}, page: "front", showSafeArea: false, showBleed: false }));
  }

  for (const curve of [60, -60, 100, -100, 15]) {
    it(`draws the same arc as the print SVG at curve ${curve}`, () => {
      const template = card({ curve });
      const client = clientSvg(template);
      const server = buildPageSvg({ template, pageId: "front", mode: "print", measure: fallbackMeasure });
      const pathOf = (markup: string) => markup.match(/<path id="[^"]*text-curve-t_names" d="([^"]+)"/)?.[1];
      expect(pathOf(client)).toBeTruthy();
      expect(pathOf(client)).toBe(pathOf(server));
      expect(client).toMatch(/<textPath href="#[^"]*text-curve-t_names" startOffset="50%">Olivia &amp; Noah<\/textPath>/);
      expect(server).toMatch(/text-anchor="middle" dominant-baseline="middle" font-size="100"/);
    });
  }

  it("rasterises a real arch in production (resvg, bundled Inter): centred, bent upward, inside the frame", () => {
    const straight = inkBounds(buildPageSvg({ template: card({}), pageId: "front", mode: "print", measure: realMeasure }));
    const archSvg = buildPageSvg({ template: card({ curve: 60 }), pageId: "front", mode: "print", measure: realMeasure });
    const arch = inkBounds(archSvg);
    expect(arch.ink).toBeGreaterThan(straight.ink * 0.85);
    // Centred on the layer.
    expect((arch.minX + arch.maxX) / 2).toBeCloseTo(750, -1);
    // Bent: much taller than the straight line, and the middle sits higher than the ends.
    expect(arch.maxY - arch.minY).toBeGreaterThan((straight.maxY - straight.minY) * 2);
    const middleTop = arch.columnTop.get(750) ?? arch.columnTop.get(751) ?? Infinity;
    const endTop = Math.min(...[...arch.columnTop.entries()].filter(([x]) => x < arch.minX + 30).map(([, y]) => y));
    expect(endTop).toBeGreaterThan(middleTop + 50);
    // The ink lies inside the selection frame the editors show.
    const resolved = resolveLayerSelectionGeometry(card({ curve: 60 }).layers[0], { text: "Olivia & Noah", measure: realMeasure, safeBounds: { left: 60, top: 60, right: 1440, bottom: 2040 } }) as any;
    expect(arch.minX).toBeGreaterThanOrEqual(resolved.x - resolved.width / 2 - 2);
    expect(arch.maxX).toBeLessThanOrEqual(resolved.x + resolved.width / 2 + 2);
    expect(arch.minY).toBeGreaterThanOrEqual(resolved.y - resolved.height / 2 - 2);
    expect(arch.maxY).toBeLessThanOrEqual(resolved.y + resolved.height / 2 + 2);
  });

  it("rasterises a smile bending downward, and a rotated curve around the same centre", () => {
    const smile = inkBounds(buildPageSvg({ template: card({ curve: -60 }), pageId: "front", mode: "print", measure: realMeasure }));
    const middleTop = smile.columnTop.get(750) ?? smile.columnTop.get(751) ?? -Infinity;
    const endTop = Math.min(...[...smile.columnTop.entries()].filter(([x]) => x < smile.minX + 30).map(([, y]) => y));
    expect(middleTop).toBeGreaterThan(endTop + 50);
    const rotated = inkBounds(buildPageSvg({ template: card({ curve: 60 }, { rotation: 90 }), pageId: "front", mode: "print", measure: realMeasure }));
    expect((rotated.minX + rotated.maxX) / 2).toBeCloseTo(750, -2);
    expect((rotated.minY + rotated.maxY) / 2).toBeCloseTo(1000, -2);
  });

  it("produces a print PDF from the curved print PNG", async () => {
    const arch = inkBounds(buildPageSvg({ template: card({ curve: 60 }), pageId: "front", mode: "print", measure: realMeasure }));
    const { pdf } = await buildPrintPdf(
      [{ pageId: "front", png: arch.png, widthPx: arch.width, heightPx: arch.height, dpi: 300, checksum: "x" }],
      { widthIn: 5, heightIn: 7, dpi: 300, bleedPx: { top: 0, right: 0, bottom: 0, left: 0 } },
    );
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(arch.png.length * 0.5);
  });
});

describe("the Design tab control", () => {
  const panel = read("app/admin/dashboard/design-builder/AdminPropertiesPanel.tsx");
  const builder = read("app/admin/dashboard/design-builder/AdminDesignBuilder.tsx");

  it("sits between Letter spacing / Line height and Text growth, styled like Opacity", () => {
    const spacing = panel.indexOf("<TextSpacingFields layer={layer}");
    const curve = panel.indexOf("<TextCurveField key={layer.id}");
    const growth = panel.indexOf("<Lbl>Text growth</Lbl>");
    expect(spacing).toBeGreaterThan(0);
    expect(curve).toBeGreaterThan(spacing);
    expect(growth).toBeGreaterThan(curve);
    expect(panel).toContain('label="Text curve"');
    expect(panel).toContain('sliderClassName="h-10 min-w-0 flex-1 cursor-pointer accent-[#27307A] disabled:cursor-not-allowed disabled:opacity-35"');
  });

  it("previews at most once per frame and commits once, so a drag is one undo step", () => {
    expect(panel).toContain("requestAnimationFrame(");
    expect(panel).toContain("onStylePreview(layer.id, { curve: pending.current })");
    expect(builder).toContain("beginGesture();");
    expect(builder).toContain("flushGestureHistory();");
    expect(builder).toContain("onStylePreview={onStylePreview}");
  });

  it("is disabled, with a reason, for multiline text, and offers Reset", () => {
    expect(panel).toContain("Text curve works on single-line text.");
    expect(panel).toContain("onClick={() => commit(0)}");
  });
});
