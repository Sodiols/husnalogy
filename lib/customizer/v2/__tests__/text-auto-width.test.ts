import { describe, expect, it } from "vitest";
import {
  availableTextWidth,
  getTextAutoSizeMode,
  isAutoWidthText,
  migrateTextAutoSizing,
  resolveTextBox,
  shouldMigrateToAutoWidth,
  type MeasureFn,
} from "../text-layout";

// Deterministic stand-in for the real font measurer: width scales with font
// size, weight and letter spacing exactly like a real measurer would, so the
// assertions below are about the resolver, not about any one font file.
const measure: MeasureFn = (text, style) => {
  const perChar = style.fontSize * 0.5 * (String(style.fontWeight) === "700" ? 1.1 : 1);
  return text.length * perChar + text.length * (style.letterSpacing || 0);
};

const AUTO = { autoSizeMode: "width" as const };

const base = {
  x: 750,
  y: 500,
  width: 300,
  height: 100,
  fontFamily: "Arial",
  fontSize: 81,
  textAlign: "center" as const,
  ...AUTO,
};

describe("auto-size mode resolution", () => {
  it("is explicit-only — no autoSizeMode means legacy behaviour", () => {
    expect(getTextAutoSizeMode({})).toBe("fixed");
    expect(getTextAutoSizeMode({ fitMode: "shrink" })).toBe("shrink");
    expect(getTextAutoSizeMode({ fitMode: "auto-height" })).toBe("height");
  });

  it("honours an explicit mode over fitMode", () => {
    expect(getTextAutoSizeMode({ autoSizeMode: "width", fitMode: "shrink" })).toBe("width");
  });

  it("never auto-widths multiline text", () => {
    expect(isAutoWidthText({ autoSizeMode: "width", multiline: true })).toBe(false);
    expect(isAutoWidthText({ autoSizeMode: "width" })).toBe(true);
  });
});

describe("the Bobita regression", () => {
  const bobita = resolveTextBox({ ...base, text: "Bobita" }, measure);
  const longer = resolveTextBox({ ...base, text: "Bobita adf adf" }, measure);

  it("grows the box instead of reporting overflow", () => {
    expect(longer.width).toBeGreaterThan(bobita.width);
    expect(longer.autoWidth).toBe(true);
    expect(longer.clampedBySafeArea).toBe(false);
  });

  it("ignores the stale stored width entirely", () => {
    // The stored 300px is what used to clip the text.
    expect(longer.width).toBeGreaterThan(300);
    expect(bobita.width).toBeLessThan(300);
  });

  it("keeps growing as the name gets longer", () => {
    const widths = ["Bob", "Bobita", "Bobita Ahmed", "Bobita Ahmed Khan"].map(
      (text) => resolveTextBox({ ...base, text }, measure).width,
    );
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
    expect(new Set(widths).size).toBe(4);
  });

  it("shrinks again when characters are deleted", () => {
    const wide = resolveTextBox({ ...base, text: "Bobita Ahmed Khan" }, measure).width;
    const narrow = resolveTextBox({ ...base, text: "Bob" }, measure).width;
    expect(narrow).toBeLessThan(wide);
  });

  it("never changes the font size", () => {
    // resolveTextBox owns the box only; font size is not among its outputs.
    expect(Object.keys(longer).sort()).toEqual(
      ["autoWidth", "clampedBySafeArea", "height", "width", "x", "y"],
    );
  });
});

describe("alignment anchoring", () => {
  const text = "Bobita Ahmed Khan";

  it("keeps the visual centre fixed when centred", () => {
    const box = resolveTextBox({ ...base, textAlign: "center", text }, measure);
    expect(box.x).toBe(base.x);
  });

  it("keeps the left edge fixed when left aligned", () => {
    const storedLeft = base.x - base.width / 2;
    const box = resolveTextBox({ ...base, textAlign: "left", text }, measure);
    expect(Math.round(box.x - box.width / 2)).toBe(storedLeft);
  });

  it("keeps the right edge fixed when right aligned", () => {
    const storedRight = base.x + base.width / 2;
    const box = resolveTextBox({ ...base, textAlign: "right", text }, measure);
    expect(Math.round(box.x + box.width / 2)).toBe(storedRight);
  });
});

describe("auto height", () => {
  it("derives a tight height from font size and line height", () => {
    const box = resolveTextBox({ ...base, text: "Bobita", lineHeight: 1.2 }, measure);
    expect(box.height).toBe(Math.ceil(81 * 1.2));
    // The stale 100px box left a lot of dead vertical space.
    expect(box.height).not.toBe(base.height);
  });
});

describe("safe area", () => {
  const safe = { left: 100, top: 100, right: 1400, bottom: 1900 };

  it("lets text grow freely while there is room", () => {
    const box = resolveTextBox({ ...base, text: "Bobita adf adf" }, measure, safe);
    expect(box.clampedBySafeArea).toBe(false);
  });

  it("clamps at the safe boundary and flags the fallback", () => {
    const box = resolveTextBox({ ...base, text: "Bobita ".repeat(30) }, measure, safe);
    expect(box.clampedBySafeArea).toBe(true);
    expect(box.width).toBeLessThanOrEqual(2 * Math.min(base.x - safe.left, safe.right - base.x));
  });

  it("never renders outside the safe area", () => {
    const box = resolveTextBox({ ...base, text: "Bobita ".repeat(40) }, measure, safe);
    expect(box.x - box.width / 2).toBeGreaterThanOrEqual(safe.left - 1);
    expect(box.x + box.width / 2).toBeLessThanOrEqual(safe.right + 1);
  });

  it("measures available width from the correct anchor", () => {
    expect(availableTextWidth(750, 300, "center", safe)).toBe(1300);
    expect(availableTextWidth(750, 300, "left", safe)).toBe(800);
    expect(availableTextWidth(750, 300, "right", safe)).toBe(800);
  });
});

describe("migration policy — completed orders must not move", () => {
  const field = { type: "text", fieldId: "bride", customerEditable: true, textStyle: {} };

  it("migrates customer editable single line personalization fields", () => {
    expect(shouldMigrateToAutoWidth(field)).toBe(true);
  });

  it("leaves multiline and paragraph text alone", () => {
    expect(shouldMigrateToAutoWidth({ ...field, textStyle: { multiline: true } })).toBe(false);
  });

  it("respects intentional shrink and auto-height choices", () => {
    expect(shouldMigrateToAutoWidth({ ...field, textStyle: { fitMode: "shrink" } })).toBe(false);
    expect(shouldMigrateToAutoWidth({ ...field, textStyle: { fitMode: "auto-height" } })).toBe(false);
  });

  it("leaves decorative text with no field binding alone", () => {
    expect(shouldMigrateToAutoWidth({ ...field, fieldId: "" })).toBe(false);
  });

  it("migrates field-bound text even when canvas manipulation is disabled", () => {
    // customerEditable governs dragging/restyling on the canvas, NOT whether the
    // customer types the value — a Bride field is still customer-driven.
    expect(shouldMigrateToAutoWidth({ ...field, customerEditable: false })).toBe(true);
  });

  it("never overrides an explicit decision", () => {
    expect(shouldMigrateToAutoWidth({ ...field, textStyle: { autoSizeMode: "fixed" } })).toBe(false);
  });

  it("does not touch non-text layers", () => {
    expect(shouldMigrateToAutoWidth({ type: "image", fieldId: "photo", customerEditable: true })).toBe(false);
  });

  it("stamps only eligible layers and preserves identity otherwise", () => {
    const decorative = { type: "text", fieldId: "", customerEditable: false, textStyle: {} };
    const layers: Array<Record<string, any>> = [field, decorative];
    const next = migrateTextAutoSizing(layers);
    expect(next[0].textStyle.autoSizeMode).toBe("width");
    // Untouched layers keep their identity, so no needless re-renders.
    expect(next[1]).toBe(decorative);
  });

  it("is a no-op when nothing qualifies", () => {
    const layers = [{ type: "text", fieldId: "", customerEditable: false, textStyle: {} }];
    expect(migrateTextAutoSizing(layers)).toBe(layers);
  });
});

describe("persistence — survives save, reload and restore", () => {
  it("keeps autoSizeMode through template normalization", async () => {
    const { normalizeCustomizerTemplate } = await import("@/lib/customizer");
    const normalized = normalizeCustomizerTemplate({
      layers: [{
        id: "t1", type: "text", page: "front", fieldId: "bride", customerEditable: true,
        textStyle: { fontFamily: "Arial", fontSize: 81, autoSizeMode: "width" },
      }],
    });
    expect(normalized.layers[0].textStyle.autoSizeMode).toBe("width");
  });

  it("does not invent an autoSizeMode where none was set", async () => {
    const { normalizeCustomizerTemplate } = await import("@/lib/customizer");
    const normalized = normalizeCustomizerTemplate({
      layers: [{ id: "t1", type: "text", page: "front", textStyle: { fontSize: 48 } }],
    });
    // Absence is meaningful: it is what freezes historical snapshots.
    expect(normalized.layers[0].textStyle.autoSizeMode).toBeUndefined();
  });

  it("rejects a bogus mode rather than persisting it", async () => {
    const { normalizeCustomizerTemplate } = await import("@/lib/customizer");
    const normalized = normalizeCustomizerTemplate({
      layers: [{ id: "t1", type: "text", page: "front", textStyle: { autoSizeMode: "sideways" } }],
    });
    expect(normalized.layers[0].textStyle.autoSizeMode).toBeUndefined();
  });

  it("migrates eligible legacy fields when a template is loaded from the database", async () => {
    const { templateFromRow } = await import("@/lib/customizer");
    const template = templateFromRow({
      id: "tpl", product_id: "p1", enabled: true,
      pages: [{ id: "front", label: "Front" }],
      fields: [{ id: "bride", label: "Bride", type: "text" }],
      layers: [
        { id: "t1", type: "text", page: "front", fieldId: "bride", customerEditable: false, textStyle: { fontSize: 81 } },
        { id: "t2", type: "text", page: "front", fieldId: "", customerEditable: false, textStyle: { fontSize: 24 } },
      ],
    });
    const [bride, decorative] = template.layers;
    expect(bride.textStyle.autoSizeMode).toBe("width");
    // Decorative text is left exactly as it was.
    expect(decorative.textStyle.autoSizeMode).toBeUndefined();
  });

  it("gives customer-added single line text auto width, but not multiline", async () => {
    const { normalizeUserLayer } = await import("@/lib/customizer");
    const single = normalizeUserLayer({ type: "text", text: "Bobita", textStyle: {} });
    const multi = normalizeUserLayer({ type: "text", text: "Para", textStyle: { multiline: true } });
    expect(single.textStyle.autoSizeMode).toBe("width");
    expect(multi.textStyle.autoSizeMode).toBe("height");
  });
});

describe("historical order snapshots render unchanged", () => {
  it("uses the stored box when no autoSizeMode is present", () => {
    // Exactly the shape of a snapshot written before this feature existed.
    const snapshotLayer = { ...base, autoSizeMode: undefined, text: "Bobita adf adf" };
    const box = resolveTextBox(snapshotLayer as any, measure);
    expect(box.autoWidth).toBe(false);
    expect(box.width).toBe(300);
    expect(box.height).toBe(100);
    expect(box.x).toBe(750);
  });

  it("does not infer auto width from field bindings at render time", () => {
    const box = resolveTextBox(
      { ...base, autoSizeMode: undefined, text: "Bobita" } as any,
      measure,
    );
    expect(box.width).toBe(300);
  });
});
