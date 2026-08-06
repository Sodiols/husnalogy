import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  countTextLines,
  customerFieldInputType,
  isMultilineCustomerField,
  normalizeCustomerFieldText,
  resolveCustomerFieldEditor,
} from "../customer-fields";
import { validateCustomerState } from "../validate";

const panel = readFileSync(
  join(process.cwd(), "app/components/customizer/CustomerEditPanel.tsx"),
  "utf8",
);

describe("isMultilineCustomerField", () => {
  it("follows the connected text layer, not the field type string", () => {
    // The exact regression: field created as plain "text", admin later ticked
    // "Multiline (wraps in box)" on the layer.
    expect(isMultilineCustomerField({ type: "text" }, { type: "text", textStyle: { multiline: true } })).toBe(true);
    // And the reverse: a textarea-typed field bound to a single-line layer must
    // stay single line, because the server rejects newlines for that layer.
    expect(isMultilineCustomerField({ type: "textarea" }, { type: "text", textStyle: { multiline: false } })).toBe(false);
  });

  it("falls back to the field type when no text layer is connected", () => {
    expect(isMultilineCustomerField({ type: "textarea" }, null)).toBe(true);
    expect(isMultilineCustomerField({ type: "text" }, null)).toBe(false);
    expect(isMultilineCustomerField({ type: "textarea" }, { type: "image" })).toBe(true);
  });
});

describe("resolveCustomerFieldEditor", () => {
  it("gives a multiline layer a textarea even when the field says text", () => {
    const editor = resolveCustomerFieldEditor({ type: "text" }, { type: "text", textStyle: { multiline: true } });
    expect(editor.control).toBe("textarea");
    expect(editor.multiline).toBe(true);
  });

  it("keeps non-text field types intact", () => {
    expect(resolveCustomerFieldEditor({ type: "select" }, null).control).toBe("select");
    expect(resolveCustomerFieldEditor({ type: "checkbox" }, null).control).toBe("checkbox");
    expect(resolveCustomerFieldEditor({ type: "image" }, null).control).toBe("image");
    expect(resolveCustomerFieldEditor({ type: "file" }, null).control).toBe("image");
    expect(customerFieldInputType(resolveCustomerFieldEditor({ type: "number" }, null))).toBe("number");
    expect(customerFieldInputType(resolveCustomerFieldEditor({ type: "date" }, null))).toBe("date");
    expect(customerFieldInputType(resolveCustomerFieldEditor({ type: "time" }, null))).toBe("time");
  });

  it("takes the tighter of the field and layer character limits", () => {
    expect(resolveCustomerFieldEditor({ type: "text", maxLength: 40 }, { type: "text", maxChars: 25 }).maxLength).toBe(25);
    expect(resolveCustomerFieldEditor({ type: "text", maxLength: 12 }, { type: "text", maxChars: 90 }).maxLength).toBe(12);
    expect(resolveCustomerFieldEditor({ type: "text" }, { type: "text" }).maxLength).toBe(0);
    expect(resolveCustomerFieldEditor({ type: "text", maxLength: 0 }, { type: "text", maxChars: 30 }).maxLength).toBe(30);
  });

  it("reports one line for single-line fields and the layer limit for multiline", () => {
    expect(resolveCustomerFieldEditor({ type: "text" }, { type: "text" }).maxLines).toBe(1);
    expect(
      resolveCustomerFieldEditor({ type: "text" }, { type: "text", maxLines: 3, textStyle: { multiline: true } }).maxLines,
    ).toBe(3);
    expect(
      resolveCustomerFieldEditor({ type: "text" }, { type: "text", textStyle: { multiline: true } }).maxLines,
    ).toBe(0);
  });
});

describe("normalizeCustomerFieldText", () => {
  const multi = resolveCustomerFieldEditor({ type: "text" }, { type: "text", textStyle: { multiline: true } });
  const single = resolveCustomerFieldEditor({ type: "text" }, { type: "text" });

  it("keeps a line break the customer typed with Enter", () => {
    expect(normalizeCustomerFieldText("Salman\nBobita", multi)).toBe("Salman\nBobita");
  });

  it("keeps a trailing empty line so blurring never eats a fresh line", () => {
    expect(normalizeCustomerFieldText("Salman\n", multi)).toBe("Salman\n");
    expect(normalizeCustomerFieldText("Salman\n\n", multi)).toBe("Salman\n\n");
  });

  it("normalizes CRLF and CR to \\n so storage and rendering agree", () => {
    expect(normalizeCustomerFieldText("Salman\r\nBobita", multi)).toBe("Salman\nBobita");
    expect(normalizeCustomerFieldText("Salman\rBobita", multi)).toBe("Salman\nBobita");
  });

  it("never flattens pasted line breaks when the previous design mode is single line", () => {
    expect(normalizeCustomerFieldText("Salman\nBobita", single)).toBe("Salman\nBobita");
    expect(normalizeCustomerFieldText("Salman\r\n\r\nBobita", single)).toBe("Salman\n\nBobita");
  });

  it("enforces the admin line limit", () => {
    const limited = resolveCustomerFieldEditor({ type: "text" }, { type: "text", maxLines: 2, textStyle: { multiline: true } });
    expect(normalizeCustomerFieldText("a\nb\nc\nd", limited)).toBe("a\nb");
  });

  it("enforces the character limit after normalizing", () => {
    const limited = resolveCustomerFieldEditor({ type: "text", maxLength: 5 }, { type: "text", textStyle: { multiline: true } });
    expect(normalizeCustomerFieldText("ab\ncdef", limited)).toBe("ab\ncd");
  });
});

describe("countTextLines", () => {
  it("counts what the customer sees", () => {
    expect(countTextLines("")).toBe(1);
    expect(countTextLines("one")).toBe(1);
    expect(countTextLines("one\ntwo")).toBe(2);
    expect(countTextLines("one\r\ntwo\r\nthree")).toBe(3);
    expect(countTextLines("one\n")).toBe(2);
  });
});

describe("panel <-> server agreement", () => {
  // The whole point of routing the panel through this module: what the panel
  // lets the customer type is exactly what validateCustomerState() accepts.
  const template = {
    id: "tpl_1",
    version: 1,
    pages: [{ id: "front", enabled: true }],
    fields: [{ id: "names", label: "Names", type: "text", customerVisible: true }],
    layers: [
      {
        id: "names_layer",
        type: "text",
        page: "front",
        fieldId: "names",
        customerEditable: true,
        textStyle: { multiline: true },
      },
    ],
  };

  it("accepts a saved line break for a multiline layer typed through the panel rules", () => {
    const editor = resolveCustomerFieldEditor(template.fields[0], template.layers[0]);
    const typed = normalizeCustomerFieldText("Salman\r\nBobita", editor);
    const result = validateCustomerState(template, { values: { names: typed } });
    expect(result.violations.some((violation) => violation.code === "multiline-not-allowed")).toBe(false);
    expect(result.sanitizedValues.names).toBe("Salman\nBobita");
  });

  it("preserves and validates a line break from a restored single-line layer", () => {
    const singleTemplate = {
      ...template,
      layers: [{ ...template.layers[0], textStyle: { multiline: false } }],
    };
    const editor = resolveCustomerFieldEditor(singleTemplate.fields[0], singleTemplate.layers[0]);
    const typed = normalizeCustomerFieldText("Salman\nBobita", editor);
    expect(typed).toBe("Salman\nBobita");
    const result = validateCustomerState(singleTemplate, { values: { names: typed } });
    expect(result.violations.some((violation) => violation.code === "multiline-not-allowed")).toBe(false);
    expect(result.sanitizedValues.names).toBe("Salman\nBobita");
  });
});

describe("CustomerEditPanel wiring", () => {
  it("decides its control through the shared resolver, not field.type alone", () => {
    expect(panel).toContain("resolveCustomerFieldEditor");
    expect(panel).toContain("normalizeCustomerFieldText");
    expect(panel).not.toContain('field.type === "textarea" ? (');
  });

  it("renders a textarea whenever the resolver says multiline", () => {
    expect(panel).toContain('editor.control === "textarea"');
  });
});
