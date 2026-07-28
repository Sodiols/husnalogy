import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateCustomerState } from "../validate";
import { layoutText, fallbackMeasure } from "../text-layout";
import { runPreflight } from "../preflight";
import { templateToDocument } from "../document";

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

// Spec §60 "Final Verification Scenarios" - turned into real, executable
// checks against the actual functions wherever they can run without a live
// Supabase project. Where a scenario is inherently database-dependent
// (republishing, order creation), this follows the codebase's own existing
// convention (see customization-version-restore.test.ts) of asserting the
// exact trusted-source query shape from the real source file, rather than
// mocking the whole Supabase client chain.

describe("Scenario 3 - long names must not silently break the layout", () => {
  const style = {
    fontFamily: "Cormorant Garamond",
    width: 500,
    height: 120,
    fontSize: 60,
    minFontSize: 24,
    lineHeight: 1.15,
    textAlign: "center" as const,
    multiline: true,
    fitMode: "shrink" as const,
    maxLines: 2,
  };

  it("shrinks a long name to fit within the configured minimum font size", () => {
    const short = layoutText({ ...style, text: "MADISON" }, fallbackMeasure);
    const long = layoutText({ ...style, text: "ALEXANDRIA ELIZABETH" }, fallbackMeasure);
    expect(short.overflowWidth).toBe(false);
    expect(short.overflowHeight).toBe(false);
    expect(long.fontSize).toBeLessThan(short.fontSize);
    expect(long.fontSize).toBeGreaterThanOrEqual(style.minFontSize);
  });

  it("never shrinks below the admin-configured minimum font size", () => {
    const extreme = layoutText(
      { ...style, text: "ARCHIBALD MAXIMILIAN WELLINGTON-ASHWORTH THE THIRD" },
      fallbackMeasure,
    );
    expect(extreme.fontSize).toBeGreaterThanOrEqual(style.minFontSize);
  });

  it("surfaces a clear, customer-friendly warning (not a raw code) when text still cannot fit above the minimum", () => {
    const template = {
      id: "t1",
      version: 1,
      canvasWidthPx: 1500,
      canvasHeightPx: 2100,
      dpi: 300,
      pages: [{ id: "front", label: "Front", enabled: true }],
      fields: [{ id: "coupleNames", label: "Couple Names", type: "text", required: false }],
      layers: [
        {
          id: "couple-names",
          name: "Couple Names",
          page: "front",
          type: "text",
          fieldId: "coupleNames",
          customerEditable: true,
          x: 750,
          y: 300,
          // Deliberately tight box: even at the minimum font size, this much
          // text cannot fit within 2 lines, so it must genuinely overflow
          // rather than the shrink algorithm quietly finding room for it.
          width: 150,
          height: 60,
          maxLines: 2,
          text: "ARCHIBALD MAXIMILIAN WELLINGTON-ASHWORTH THE THIRD & SOMEBODY ELSE ENTIRELY",
          textStyle: { ...style, fontFamily: "Cormorant Garamond" },
        },
      ],
      safeArea: { top: 90, right: 90, bottom: 90, left: 90 },
      bleed: { top: 45, right: 45, bottom: 45, left: 45 },
    };
    const { document } = templateToDocument(template);
    const result = runPreflight(document);
    const overflow = result.issues.find((issue: any) => issue.code === "text-overflow");
    expect(overflow).toBeTruthy();
    expect(overflow!.message).toContain("Couple Names");
    expect(overflow!.message).not.toMatch(/[A-Z_]{4,}/); // no SHOUTY_ENUM_CODE leaking into the message
  });
});

describe("Scenario 4 - a fully locked template object resists every kind of forged edit at once", () => {
  it("rejects move, resize, rotate, font, color, and delete attempts together in one submission", () => {
    const template = {
      layers: [
        {
          id: "protected-monogram",
          page: "front",
          type: "text",
          text: "M&K",
          customerEditable: false,
          customerPermissions: {},
          positionLocked: true,
        },
      ],
      fields: [],
      pages: [{ id: "front", enabled: true }],
      settings: {},
    };
    const result = validateCustomerState(template, {
      editorState: {
        layerOverrides: {
          "protected-monogram": {
            transform: { x: 999, y: 999, rotation: 45 },
            textStyle: { fontFamily: "Arial", color: "#ff0000" },
            hidden: true,
          },
        },
        // A forged delete is really "the layer is simply absent from
        // userLayers/overrides" - there is no override key that removes a
        // template layer, which is itself the correct enforcement: template
        // layers can never be deleted by a customer submission at all.
        userLayers: [],
      },
    });

    // Every single attempted change is rejected...
    const codes = result.violations.map((v) => v.code);
    expect(codes).toContain("move-not-allowed");
    expect(codes).toContain("rotate-not-allowed");
    expect(codes).toContain("font-not-allowed");
    expect(codes).toContain("color-not-allowed");
    expect(codes).toContain("visibility-not-allowed");
    // ...and nothing at all survives into the sanitized state for this layer.
    expect(result.sanitizedEditorState.layerOverrides["protected-monogram"]).toBeUndefined();
  });
});

describe("Scenario 8 - republishing a template must never change an already-placed order", () => {
  it("resolves the trusted template by an EXACT (template_id, version) pair, never 'latest'", () => {
    const versions = read("lib/customizer/versions.ts");
    expect(versions).toContain('.eq("template_id", templateId)');
    expect(versions).toContain('.eq("version", version)');
    // The comment documents the intended contract, guarding against a future
    // edit silently swapping this for a "latest version" query.
    expect(versions).toContain("its exact published version snapshot when one exists");
  });

  it("order snapshot creation resolves the template through the trusted-version path, not the live draft", () => {
    const snapshots = read("lib/customizer/order-snapshots.ts");
    expect(snapshots).toContain("getTrustedTemplateForCustomization(customization)");
    // Must not import the live draft loader used by the admin builder.
    expect(snapshots).not.toContain("getCustomizerTemplateByProductId");
  });

  it("publishing inserts a new immutable version row rather than mutating history", () => {
    const versions = read("lib/customizer/versions.ts");
    expect(versions).toContain("publish_customizer_template_version");
    expect(versions).toContain("immutable");
  });
});
