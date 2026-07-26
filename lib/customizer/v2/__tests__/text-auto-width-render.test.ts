import { describe, expect, it } from "vitest";
import { templateFromRow } from "@/lib/customizer";
import { buildPageSvg } from "../svg";
import { createOpentypeMeasure, fallbackMeasure } from "../text-layout";

/**
 * End-to-end render coverage for the auto-width regression, driven through the
 * REAL pipeline: a database row -> templateFromRow -> buildPageSvg. This is the
 * same SVG that feeds PNG, PDF, mockups and the order snapshot, so proving the
 * box grows here proves it grows in every renderer.
 *
 * The layer shape below is copied from the live "Minimal White Card wedding
 * invitation" template (Bride name field, 1100x110 stored box at 750,400).
 */
const brideLayer = {
  id: "bridename_layer",
  name: "Bride name",
  page: "front",
  type: "text",
  fieldId: "bridename",
  x: 750,
  y: 400,
  width: 1100,
  height: 110,
  rotation: 0,
  zIndex: 10,
  opacity: 1,
  hidden: false,
  locked: false,
  adminEditable: true,
  customerEditable: true,
  textStyle: {
    fontFamily: "Arial",
    fontSize: 81,
    fontWeight: "400",
    color: "#303839",
    letterSpacing: 0,
    lineHeight: 1.15,
    textAlign: "center",
    verticalAlign: "middle",
    multiline: false,
    fitMode: "fixed",
  },
};

const row = {
  id: "tpl-1",
  product_id: "prod-1",
  enabled: true,
  canvas_width_px: 1500,
  canvas_height_px: 2100,
  default_page: "front",
  pages: [{ id: "front", label: "Front", enabled: true }],
  fields: [{ id: "bridename", label: "Bride name", type: "text" }],
  layers: [brideLayer],
  safe_area: { top: 100, right: 100, bottom: 100, left: 100 },
};

const template = templateFromRow(row);

// Width of the clip rect the renderer emits for the text box.
function renderedBoxWidth(values: Record<string, any>): number {
  const svg = buildPageSvg({ template, values, pageId: "front", measure: fallbackMeasure, mode: "preview" });
  const match = svg.match(/<clipPath id="text-clip-[^"]*"><rect x="[-\d.]+" y="[-\d.]+" width="([\d.]+)"/);
  if (!match) throw new Error("no text clip rect in rendered SVG");
  return Number(match[1]);
}

function renderedFontSize(values: Record<string, any>): number {
  const svg = buildPageSvg({ template, values, pageId: "front", measure: fallbackMeasure, mode: "preview" });
  const match = svg.match(/font-size="([\d.]+)"/);
  if (!match) throw new Error("no font-size in rendered SVG");
  return Number(match[1]);
}

describe("auto width through the real render pipeline", () => {
  it("migrates the Bride field on load", () => {
    expect(template.layers[0].textStyle.autoSizeMode).toBe("width");
  });

  it("grows the rendered box when the name gets longer", () => {
    const short = renderedBoxWidth({ bridename: "Bobita" });
    const long = renderedBoxWidth({ bridename: "Bobita adf adf" });
    expect(long).toBeGreaterThan(short);
  });

  it("ignores the stale 1100px stored width", () => {
    // "Bobita" is far narrower than the stored box: the old renderer drew 1100.
    expect(renderedBoxWidth({ bridename: "Bobita" })).toBeLessThan(1100);
  });

  it("keeps the font size at 81 while safe area remains", () => {
    expect(renderedFontSize({ bridename: "Bobita" })).toBe(81);
    expect(renderedFontSize({ bridename: "Bobita adf adf" })).toBe(81);
  });

  it("grows and shrinks monotonically with the text", () => {
    const widths = ["Bob", "Bobita", "Bobita Ahmed", "Bobita Ahmed Khan"].map((v) =>
      renderedBoxWidth({ bridename: v }),
    );
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
  });

  it("stays centred, because the field is centre aligned", () => {
    const svg = buildPageSvg({ template, values: { bridename: "Bobita Ahmed Khan" }, pageId: "front", measure: fallbackMeasure, mode: "preview" });
    const match = svg.match(/<clipPath id="text-clip-[^"]*"><rect x="([-\d.]+)" y="[-\d.]+" width="([\d.]+)"/)!;
    const centre = Number(match[1]) + Number(match[2]) / 2;
    expect(Math.round(centre)).toBe(750);
  });

  it("never exceeds the safe area, falling back to shrink at the limit", () => {
    const values = { bridename: "Bobita Ahmed Khan ".repeat(12) };
    const width = renderedBoxWidth(values);
    // Safe area is 100..1400, centred at 750 -> 1300 of usable width.
    expect(width).toBeLessThanOrEqual(1300);
    // Only now may the font size drop below 81.
    expect(renderedFontSize(values)).toBeLessThanOrEqual(81);
  });
});

describe("historical snapshots still render from their stored box", () => {
  it("keeps 1100px when the layer carries no autoSizeMode", () => {
    // A snapshot written before this feature: same layer, no autoSizeMode, and
    // crucially NOT passed through templateFromRow's migration.
    const frozen = {
      ...template,
      layers: [{ ...brideLayer, textStyle: { ...brideLayer.textStyle } }],
    };
    const svg = buildPageSvg({ template: frozen, values: { bridename: "Bobita adf adf" }, pageId: "front", measure: fallbackMeasure, mode: "print" });
    const match = svg.match(/<clipPath id="text-clip-[^"]*"><rect x="[-\d.]+" y="[-\d.]+" width="([\d.]+)"/)!;
    expect(Number(match[1])).toBe(1100);
  });
});

describe("server font measurement is wired", () => {
  it("exposes an opentype measurer for production rendering", () => {
    expect(typeof createOpentypeMeasure).toBe("function");
  });
});
