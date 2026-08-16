import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { newTextLayer } from "@/app/admin/dashboard/design-builder/builder-utils";
import {
  canonicalTextLayerUpdate,
  getTextPlacementStyle,
  isEmptyText,
  normalizeCanonicalText,
  normalizeInlineText,
  textPlacementGestureIsClick,
} from "../text-editing";
import { fallbackMeasure, layoutText, resolveTextBox } from "../text-layout";
import { buildPageSvg } from "../svg";
import { clientPointToDocument, resolveLayerSelectionGeometry } from "../selection-geometry";
import { normalizeCustomizerTemplate, normalizeEditorState, normalizeUserLayer } from "@/lib/customizer";

const template = {
  canvasWidthPx: 1500,
  canvasHeightPx: 2100,
  pages: [{ id: "front", label: "Front", enabled: true, backgroundColor: "#fff" }],
  fields: [],
  layers: [],
  safeArea: { top: 90, right: 90, bottom: 90, left: 90 },
  settings: {},
};

describe("canonical inline text rules", () => {
  it("normalizes browser and persisted newline variants without flattening multiline text", () => {
    expect(normalizeCanonicalText("MADISON\r\n&\rKENNEDY")).toBe("MADISON\n&\nKENNEDY");
    expect(normalizeInlineText("MADISON\r\n&\rKENNEDY", true)).toBe("MADISON\n&\nKENNEDY");
    expect(normalizeInlineText("MADISON\r\n&\rKENNEDY", false)).toBe("MADISON\n&\nKENNEDY");
    expect(isEmptyText(" \n \r\n")).toBe(true);
  });

  it("preserves leading, trailing, and internal newlines through saved editor-state normalization", () => {
    const userLayer = normalizeUserLayer({
      type: "text",
      page: "front",
      text: "\nMADISON\r\n&\nKENNEDY\n",
      textStyle: { multiline: true },
    });
    expect(userLayer.text).toBe("\nMADISON\n&\nKENNEDY\n");

    const state = normalizeEditorState({
      layerOverrides: {
        template_text: { properties: { text: "\nMADISON\r\n&\nKENNEDY\n" } },
      },
    });
    expect(state.layerOverrides.template_text.properties.text).toBe("\nMADISON\n&\nKENNEDY\n");
  });

  it("preserves manual and repeated Enter breaks inside one multiline layout", () => {
    const result = layoutText(
      {
        text: "MADISON\n&\n\nKENNEDY",
        width: 800,
        height: 400,
        fontFamily: "Cormorant Garamond",
        fontSize: 48,
        multiline: true,
        lineHeight: 1.25,
      },
      fallbackMeasure,
    );
    expect(result.lines.map((line) => line.text)).toEqual(["MADISON", "&", "", "KENNEDY"]);
  });

  it("promotes a stale single-line object when its canonical value contains a newline", () => {
    const result = layoutText(
      {
        text: "MADISON\n&\nKENNEDY",
        width: 800,
        height: 100,
        fontFamily: "Cormorant Garamond",
        fontSize: 48,
        multiline: false,
      },
      fallbackMeasure,
    );
    expect(result.lines.map((line) => line.text)).toEqual(["MADISON", "&", "KENNEDY"]);
  });

  it("promotes text and mode atomically without changing the rest of the style", () => {
    const update = canonicalTextLayerUpdate("Salman\r\nadfasdf", {
      fontFamily: "Inter",
      fontSize: 52,
      fontWeight: "700",
      color: "#112233",
      textAlign: "right",
      letterSpacing: 1.5,
      lineHeight: 1.3,
      multiline: false,
      autoSizeMode: "width",
      fitMode: "fixed",
    });
    expect(update.text).toBe("Salman\nadfasdf");
    expect(update.textStyle).toMatchObject({
      fontFamily: "Inter",
      fontSize: 52,
      fontWeight: "700",
      color: "#112233",
      textAlign: "right",
      letterSpacing: 1.5,
      lineHeight: 1.3,
      multiline: true,
      autoSizeMode: "height",
      fitMode: "auto-height",
    });
  });
});

describe("click or tap text placement", () => {
  it("uses a small screen-pixel drag threshold", () => {
    expect(textPlacementGestureIsClick(100, 100, 103, 102)).toBe(true);
    expect(textPlacementGestureIsClick(100, 100, 106, 100)).toBe(false);
  });

  it("converts zoomed and panned screen points back to document coordinates", () => {
    const rect = { left: 240, top: 160, width: 750, height: 1050 };
    const point = clientPointToDocument(615, 685, rect, 750, 1050, 0.5);
    expect(point).toEqual({ x: 750, y: 1050 });
  });

  it("creates Admin text at the exact document point with an empty ephemeral editor value", () => {
    const layer = newTextLayer(template, "front", { x: 321.5, y: 876.25, text: "", preset: "body" });
    expect(layer.x).toBe(321.5);
    expect(layer.y).toBe(876.25);
    expect(layer.page).toBe("front");
    expect(layer.text).toBe("");
    expect(layer.textStyle.multiline).toBe(true);
    expect(layer.textStyle.autoSizeMode).toBe("height");
  });

  it("keeps heading presets single-line while the default body preset is multiline", () => {
    expect(getTextPlacementStyle("heading", 1500, 2100).multiline).toBe(false);
    expect(getTextPlacementStyle("subheading", 1500, 2100).multiline).toBe(false);
    expect(getTextPlacementStyle("body", 1500, 2100).multiline).toBe(true);
  });

  it("starts every new text object at line height 1 and letter spacing 1", () => {
    for (const preset of ["heading", "subheading", "body"] as const) {
      const style = getTextPlacementStyle(preset, 1500, 2100);
      expect(style.lineHeight).toBe(1);
      expect(style.letterSpacing).toBe(1);
    }
    const template = { canvasWidthPx: 1500, canvasHeightPx: 2100, layers: [] };
    // Both the placed and the bare admin text factory paths.
    expect(newTextLayer(template, "front", { x: 750, y: 1050 }).textStyle).toMatchObject({
      lineHeight: 1,
      letterSpacing: 1,
    });
    expect(newTextLayer(template, "front").textStyle).toMatchObject({
      lineHeight: 1,
      letterSpacing: 1,
    });
  });

  it("only supplies the default — an explicit spacing is never overwritten", () => {
    const layer = (textStyle: Record<string, unknown>) => ({
      id: "t1", name: "T", page: "front", type: "text", text: "Hi",
      x: 10, y: 10, width: 100, height: 40, textStyle,
    });
    const explicit = normalizeCustomizerTemplate({ enabled: true, layers: [layer({ letterSpacing: 2, lineHeight: 1.15 })] });
    expect(explicit.layers[0].textStyle.letterSpacing).toBe(2);
    expect(explicit.layers[0].textStyle.lineHeight).toBe(1.15);

    const missing = normalizeCustomizerTemplate({ enabled: true, layers: [layer({})] });
    expect(missing.layers[0].textStyle.letterSpacing).toBe(1);
    expect(missing.layers[0].textStyle.lineHeight).toBe(1);

    // A deliberate zero must survive: the default may not ride in on `||`.
    const zero = normalizeCustomizerTemplate({ enabled: true, layers: [layer({ letterSpacing: 0 })] });
    expect(zero.layers[0].textStyle.letterSpacing).toBe(0);
  });
});

describe("resolved multiline bounds and rendering parity", () => {
  it("auto-heights from manual line breaks without changing the configured width", () => {
    const box = resolveTextBox(
      {
        x: 500,
        y: 600,
        width: 700,
        height: 80,
        text: "MADISON\n&\nKENNEDY",
        fontFamily: "Cormorant Garamond",
        fontSize: 50,
        lineHeight: 1.2,
        multiline: true,
        autoSizeMode: "height",
        textAlign: "center",
      },
      fallbackMeasure,
    );
    expect(box.width).toBe(700);
    expect(box.height).toBe(180);
    expect(box.x).toBe(500);
    expect(box.y).toBe(650);
    expect(box.y - box.height / 2).toBe(600 - 80 / 2);
  });

  it("uses the auto-height result for selection and hit-test geometry", () => {
    const resolved = resolveLayerSelectionGeometry(
      {
        id: "body",
        type: "text",
        x: 500,
        y: 600,
        width: 700,
        height: 80,
        text: "MADISON\n&\nKENNEDY",
        textStyle: {
          fontFamily: "Cormorant Garamond",
          fontSize: 50,
          lineHeight: 1.2,
          multiline: true,
          autoSizeMode: "height",
        },
      },
      {
        text: "MADISON\n&\nKENNEDY",
        measure: fallbackMeasure,
        safeBounds: { left: 0, top: 0, right: 1500, bottom: 2100 },
      },
    );
    expect(resolved.height).toBe(180);
    expect(resolved.width).toBe(700);
    expect(resolved.y).toBe(650);
  });

  it("resizes selection geometry even when a restored layer still says single-line", () => {
    const resolved = resolveLayerSelectionGeometry(
      {
        id: "legacy-single",
        type: "text",
        x: 500,
        y: 600,
        width: 700,
        height: 60,
        text: "Salman\nadfasdf",
        textStyle: {
          fontFamily: "Cormorant Garamond",
          fontSize: 50,
          lineHeight: 1.2,
          multiline: false,
          autoSizeMode: "width",
        },
      },
      {
        text: "Salman\nadfasdf",
        measure: fallbackMeasure,
        safeBounds: { left: 0, top: 0, right: 1500, bottom: 2100 },
      },
    );
    expect(resolved.height).toBe(120);
    expect(resolved.y - resolved.height / 2).toBe(600 - 60 / 2);
  });

  it("emits one SVG tspan per preserved manual line", () => {
    const svg = buildPageSvg({
      template: {
        ...template,
        layers: [
          {
            id: "multiline",
            name: "Names",
            page: "front",
            type: "text",
            text: "MADISON\n&\nKENNEDY",
            x: 750,
            y: 700,
            width: 900,
            height: 300,
            zIndex: 1,
            opacity: 1,
            textStyle: {
              fontFamily: "Cormorant Garamond",
              fontSize: 72,
              lineHeight: 1.2,
              textAlign: "center",
              multiline: true,
            },
          },
        ],
      },
      values: {},
      pageId: "front",
      mode: "print",
      measure: fallbackMeasure,
    });
    expect(svg.match(/<tspan /g)).toHaveLength(3);
    expect(svg).toContain(">MADISON</tspan>");
    expect(svg).toContain(">&amp;</tspan>");
    expect(svg).toContain(">KENNEDY</tspan>");
  });

  it("emits two SVG lines from a legacy single-line object without flattening", () => {
    const svg = buildPageSvg({
      template: {
        ...template,
        layers: [
          {
            id: "promoted",
            name: "Promoted",
            page: "front",
            type: "text",
            text: "Salman\nadfasdf",
            x: 750,
            y: 700,
            width: 900,
            height: 90,
            zIndex: 1,
            opacity: 1,
            textStyle: {
              fontFamily: "Cormorant Garamond",
              fontSize: 72,
              lineHeight: 1.2,
              textAlign: "center",
              multiline: false,
              autoSizeMode: "width",
            },
          },
        ],
      },
      values: {},
      pageId: "front",
      mode: "print",
      measure: fallbackMeasure,
    });
    expect(svg.match(/<tspan /g)).toHaveLength(2);
    expect(svg).toContain(">Salman</tspan>");
    expect(svg).toContain(">adfasdf</tspan>");
    expect(svg).toContain('xml:space="preserve"');
  });

  it("wires both canvases to canonical live drafts, one-shot insertion, and empty-layer discard", () => {
    const admin = readFileSync("app/admin/dashboard/design-builder/AdminCanvas.tsx", "utf8");
    const customer = readFileSync("app/components/customizer/CustomizerWorkspace.tsx", "utf8");
    const inline = readFileSync("app/components/customizer/InlineCanvasTextEditor.tsx", "utf8");
    const builder = readFileSync("app/admin/dashboard/design-builder/AdminDesignBuilder.tsx", "utf8");
    const personalize = readFileSync("app/products/[slug]/personalize/personalize-client.tsx", "utf8");
    for (const source of [admin, customer]) {
      // Text is inserted by the toolbar and handed to the canvas for editing.
      // No canvas surface gesture may ever create a text object (spec §11–§15).
      expect(source).not.toContain('mode: "text-placement"');
      expect(source).toContain("editTextRequest");
      expect(source).toContain("beginTextEditing(layer.id, Boolean(editTextRequest.created))");
      expect(source).toContain("pointerExceededDragThreshold");
      expect(source).toContain("onTextDraftChange");
      expect(source).toContain("onTextDiscard");
      expect(source).toContain("<InlineCanvasTextEditor");
    }
    // Both editors return to their resting state as part of the insertion.
    expect(builder).toContain('setActiveTool("select")');
    expect(builder).toContain("const insertTextLayer = ");
    expect(personalize).toContain("const insertCustomerText = ");
    expect(inline).toContain("setSelectionRange");
    // Escape still cancels — it is now resolved through the shared keyboard
    // contract in text-editing.ts along with Enter and Ctrl+Enter.
    expect(inline).toContain("resolveTextEditorKeyAction");
    expect(inline).toContain('action === "cancel"');
    expect(inline).toContain("onDraftChange?.(next)");
    expect(inline).toContain("Done");
  });
});
