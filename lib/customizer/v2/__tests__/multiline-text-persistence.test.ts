// Multiline customer text (spec §18, §19, §42).
//
// A line break the customer typed must survive form editing, inline canvas
// editing, autosave, reload, cart restore, the permanent order snapshot and
// production rendering — and a single-line field must never keep one.

import { describe, expect, it } from "vitest";
import { isMultilineTextField, normalizeCanonicalText, normalizeInlineText } from "../text-editing";
import { runPreflight } from "../preflight";
import { resolveCustomerDocument } from "../document";

describe("multiline is decided by the field type or the linked layer", () => {
  it("treats a textarea field as multiline regardless of the layer", () => {
    expect(isMultilineTextField({ type: "textarea" }, null)).toBe(true);
    expect(isMultilineTextField({ type: "textarea" }, { textStyle: { multiline: false } })).toBe(true);
  });

  it("honours a multiline layer even when the field is typed plain text", () => {
    // This is the case a form-only check misses: the layer renders multiple
    // lines, so Enter has to work in the form too.
    expect(isMultilineTextField({ type: "text" }, { textStyle: { multiline: true } })).toBe(true);
  });

  it("keeps a single-line layer single-line", () => {
    expect(isMultilineTextField({ type: "text" }, { textStyle: { multiline: false } })).toBe(false);
    expect(isMultilineTextField({ type: "text" }, null)).toBe(false);
  });

  it("never makes a non-text control multiline", () => {
    for (const type of ["select", "checkbox", "number", "date", "time", "image", "file"]) {
      expect(isMultilineTextField({ type }, { textStyle: { multiline: true } })).toBe(false);
    }
  });
});

describe("line break normalization", () => {
  it("keeps every line break for a multiline field", () => {
    const typed = "Aisha & Omar\n12 December 2026\nDhaka";
    expect(normalizeInlineText(typed, true)).toBe(typed);
  });

  it("collapses line breaks for a single-line field, including pasted ones", () => {
    expect(normalizeInlineText("Aisha\n& Omar", false)).toBe("Aisha & Omar");
    expect(normalizeInlineText("A\n\n\nB", false)).toBe("A B");
  });

  it("normalizes Windows and classic Mac line endings to \\n", () => {
    expect(normalizeCanonicalText("A\r\nB\rC")).toBe("A\nB\nC");
    expect(normalizeInlineText("A\r\nB", true)).toBe("A\nB");
  });

  it("is idempotent, so repeated autosaves cannot drift the value", () => {
    const once = normalizeInlineText("Line one\nLine two", true);
    expect(normalizeInlineText(once, true)).toBe(once);
    const single = normalizeInlineText("Line one\nLine two", false);
    expect(normalizeInlineText(single, false)).toBe(single);
  });

  it("survives a JSON save/reload round trip byte for byte", () => {
    // This is the exact path taken by autosave, reload, cart restore and the
    // permanent snapshot payload.
    const value = normalizeInlineText("Aisha & Omar\nDhaka", true);
    const restored = JSON.parse(JSON.stringify({ names: value })).names;
    expect(restored).toBe("Aisha & Omar\nDhaka");
    expect(restored.split("\n")).toHaveLength(2);
  });
});

describe("multiline text reaches the resolved production document", () => {
  const document: any = {
    schemaVersion: 2,
    canvas: { widthPx: 1500, heightPx: 2100, widthIn: 5, heightIn: 7, dpi: 300 },
    pages: [{ id: "front", name: "Front", enabled: true, safeArea: {}, bleed: {} }],
    fields: [
      { id: "names", label: "Names", type: "text", required: true, maxLength: 0, options: [], customerVisible: true },
    ],
    layers: [
      {
        id: "l_names",
        pageId: "front",
        type: "text",
        name: "Names",
        fieldId: "names",
        customerEditable: true,
        x: 100,
        y: 100,
        width: 1300,
        height: 400,
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        text: "",
        textStyle: {
          fontFamily: "Cormorant Garamond",
          fontSize: 64,
          lineHeight: 1.2,
          letterSpacing: 0,
          textAlign: "center",
          color: "#303839",
          multiline: true,
        },
      },
    ],
    settings: {},
    assets: [],
  };

  it("carries the customer's line breaks into the layer the renderer reads", () => {
    const resolved: any = resolveCustomerDocument(document, { names: "Aisha & Omar\n12 December 2026" }, null);
    const layer = resolved.layers.find((entry: any) => entry.id === "l_names");
    expect(layer.text).toBe("Aisha & Omar\n12 December 2026");
    expect(String(layer.text).split("\n")).toHaveLength(2);
  });

  it("measures the wrapped height so overflow is caught rather than clipped", () => {
    // A deliberately tall block of lines must not silently exceed the text box:
    // preflight has to notice, because the production file cannot clip.
    const tall = Array.from({ length: 24 }, (_, index) => `Line ${index + 1}`).join("\n");
    const resolved = resolveCustomerDocument(document, { names: tall }, null);
    const preflight = runPreflight(resolved as any);
    const overflow = preflight.issues.filter((issue) => /overflow/i.test(`${issue.code} ${issue.message}`));
    expect(overflow.length).toBeGreaterThan(0);
  });

  it("passes preflight for text that fits", () => {
    const resolved = resolveCustomerDocument(document, { names: "Aisha & Omar\n12 December 2026" }, null);
    const preflight = runPreflight(resolved as any);
    const overflow = preflight.issues.filter((issue) => /overflow/i.test(`${issue.code} ${issue.message}`));
    expect(overflow).toHaveLength(0);
  });

  it("blocks a required multiline field left empty", () => {
    const resolved = resolveCustomerDocument(document, { names: "" }, null);
    const preflight = runPreflight(resolved as any);
    expect(preflight.blocking).toBe(true);
  });
});
