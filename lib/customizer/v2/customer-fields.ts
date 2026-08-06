// How a customer field is presented in Quick Personalize (spec §2/§5).
//
// The control the customer types into MUST agree with what the server accepts.
// Validation preserves real line breaks, and the renderer promotes a legacy
// single-line object when its canonical value contains one. The layer flag
// still chooses whether Quick Personalize starts with an input or textarea.
//
// This used to disagree: CustomerEditPanel picked a <textarea> only when
// `field.type === "textarea"`, while lib/customizer/index.ts keeps a field's
// original type when re-syncing fields from layers. An admin who enabled
// "Multiline (wraps in box)" on a layer whose field had been created as plain
// text therefore left the customer with a single-line <input>: pressing Enter
// submitted/blurred instead of creating a second line, and the multiline design
// was unreachable.
//
// Pure module — no React, no DOM — so the rules are directly testable.

import { normalizeCanonicalText, normalizeInlineText } from "./text-editing";

export type CustomerFieldControl =
  | "text"
  | "textarea"
  | "select"
  | "checkbox"
  | "number"
  | "date"
  | "time"
  | "image";

export type CustomerFieldEditor = {
  control: CustomerFieldControl;
  /** True when the customer may press Enter to create a real new line. */
  multiline: boolean;
  /** 0 means "no limit". */
  maxLength: number;
  /** 0 means "no limit". Mirrors TextLayer.maxLines. */
  maxLines: number;
};

type FieldLike = {
  type?: unknown;
  maxLength?: unknown;
} | null | undefined;

type LayerLike = {
  type?: unknown;
  maxChars?: unknown;
  maxLines?: unknown;
  textStyle?: { multiline?: unknown } | null;
} | null | undefined;

function positiveInt(value: unknown): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Whether the customer may enter line breaks in this field.
 *
 * A connected TEXT layer always decides, because the renderer and the server
 * validator both read `layer.textStyle.multiline`. `field.type === "textarea"`
 * only decides when there is no connected text layer to ask.
 */
export function isMultilineCustomerField(field: FieldLike, layer: LayerLike): boolean {
  if (layer && layer.type === "text") return Boolean(layer.textStyle?.multiline);
  return String(field?.type || "") === "textarea";
}

export function resolveCustomerFieldEditor(field: FieldLike, layer: LayerLike): CustomerFieldEditor {
  const fieldType = String(field?.type || "text");
  const multiline = isMultilineCustomerField(field, layer);

  // A field-level maxLength and the layer's maxChars are both admin limits;
  // the tighter one wins so the customer is never allowed to type text the
  // design cannot hold.
  const limits = [positiveInt(field?.maxLength), positiveInt(layer?.maxChars)].filter((value) => value > 0);
  const maxLength = limits.length ? Math.min(...limits) : 0;
  const maxLines = multiline ? positiveInt(layer?.maxLines) : 1;

  let control: CustomerFieldControl;
  if (fieldType === "image" || fieldType === "file") control = "image";
  else if (fieldType === "select") control = "select";
  else if (fieldType === "checkbox") control = "checkbox";
  else if (fieldType === "number") control = "number";
  else if (fieldType === "date") control = "date";
  else if (fieldType === "time") control = "time";
  else control = multiline ? "textarea" : "text";

  return { control, multiline, maxLength, maxLines };
}

/**
 * The HTML input `type` for single-line controls.
 */
export function customerFieldInputType(editor: CustomerFieldEditor): string {
  if (editor.control === "number") return "number";
  if (editor.control === "date") return "date";
  if (editor.control === "time") return "time";
  return "text";
}

export function countTextLines(value: unknown): number {
  return normalizeCanonicalText(value).split("\n").length;
}

/**
 * Normalize what the customer typed/pasted into what will be stored and
 * rendered:
 *   - CRLF/CR collapse to \n so the value round-trips through the database,
 *     the SVG renderer and the print renderer identically;
 *   - line breaks are never flattened; a manual break promotes an older
 *     single-line layer in the shared renderer;
 *   - extra lines beyond an admin `maxLines` limit are dropped rather than
 *     silently overflowing the text box;
 *   - `maxLength` is applied last, on the final string.
 *
 * Trailing newlines are deliberately preserved: a customer who presses Enter
 * to start a line must not have that line removed the moment they click away.
 */
export function normalizeCustomerFieldText(value: unknown, editor: CustomerFieldEditor): string {
  let text = normalizeInlineText(value, editor.multiline);
  if (editor.multiline && editor.maxLines > 0) {
    const lines = text.split("\n");
    if (lines.length > editor.maxLines) text = lines.slice(0, editor.maxLines).join("\n");
  }
  if (editor.maxLength > 0 && text.length > editor.maxLength) text = text.slice(0, editor.maxLength);
  return text;
}
