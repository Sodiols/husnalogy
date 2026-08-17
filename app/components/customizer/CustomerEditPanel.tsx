"use client";

// Customer Edit panel (Section 7): the editable text fields for each page,
// two-way connected to the canvas — focusing a field selects its layer, and
// selecting an editable layer scrolls to / focuses its field.

import { useEffect, useRef, useState } from "react";
import { getEnabledPages, getImageUrl, getLayerPermissions, isValueEmpty } from "./customizer-utils";
import {
  countTextLines,
  customerFieldInputType,
  normalizeCustomerFieldText,
  resolveCustomerFieldEditor,
  type CustomerFieldEditor,
} from "@/lib/customizer/v2/customer-fields";
import { resolveTextEditorKeyAction } from "@/lib/customizer/v2/text-editing";

// One shared keyboard contract with the inline canvas editor: Ctrl/Cmd + Enter
// finishes editing this field (and never inserts a line break), while a plain
// Enter in a multiline field stays a real line break.
const inputClass =
  "w-full rounded-md border border-[#303839]/15 bg-white px-3 py-2.5 text-sm text-[#303839] outline-none transition focus:border-[#D4AF37]";

// Fields shown here are the ones connected to a visible, customer-editable
// layer on an enabled page. Image fields are summarized with a link to the
// Uploads panel where the full upload controls live.
//
// Display order (spec §5 "Display order in Easy Personalize") follows each
// field's position in `template.fields`, which the admin controls with the
// move up/down actions in AdminFieldsPanel — independent of layer z-order or
// creation order, and shared by CustomerEditPanel, CustomerUploadsPanel, and
// AdminCustomerPreview since they all call this same function.
export function mapCustomerFields(template: any) {
  const enabledPageIds = new Set(getEnabledPages(template).map((p: any) => p.id));
  const templateFields = template?.fields || [];
  const fieldById = new Map(templateFields.map((f: any) => [f.id, f]));
  const fieldOrder = new Map<string, number>(templateFields.map((f: any, index: number): [string, number] => [f.id, index]));
  const entries: Array<{ field: any; layer: any; page: string }> = [];
  const seen = new Set<string>();

  (template?.layers || []).forEach((layer: any) => {
    if (!layer.customerEditable || !layer.fieldId || layer.hidden) return;
    if (!enabledPageIds.has(layer.page)) return;
    const permissions = getLayerPermissions(layer);
    // Frames are photo placeholders too — gate them on replaceImage like images,
    // matching validateCustomerValues() in customizer-utils.
    const canEditField =
      layer.type === "image" || layer.type === "frame" ? permissions.replaceImage : permissions.editContent;
    if (!canEditField) return;
    const field: any = fieldById.get(layer.fieldId);
    if (!field || field.customerVisible === false) return;
    if (seen.has(layer.fieldId)) return;
    seen.add(layer.fieldId);
    entries.push({ field, layer, page: layer.page });
  });

  entries.sort((a, b) => (fieldOrder.get(a.field.id) ?? 0) - (fieldOrder.get(b.field.id) ?? 0));
  return entries;
}

// Multiline fields grow with their content instead of scrolling inside a fixed
// box, so a customer typing a three-line verse always sees all three lines.
function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
}

function TextField({
  field,
  editor,
  value,
  error,
  onChange,
  onFocusField,
  inputRef,
  highlighted,
}: {
  field: any;
  editor: CustomerFieldEditor;
  value: any;
  error?: string;
  onChange: (next: any) => void;
  onFocusField: () => void;
  inputRef: (el: HTMLElement | null) => void;
  highlighted: boolean;
}) {
  const [keyboardMessage, setKeyboardMessage] = useState("");
  const textValue = typeof value === "string" ? value : "";
  const overLimit = editor.maxLength > 0 && textValue.length > editor.maxLength;
  const count =
    editor.maxLength > 0 && typeof value === "string" ? (
      <span className={`text-[11px] font-bold ${overLimit ? "text-red-700" : "text-[#303839]/45"}`}>
        {textValue.length}/{editor.maxLength}
      </span>
    ) : null;

  const lineCount = editor.multiline ? countTextLines(textValue) : 1;
  const atLineLimit = editor.multiline && editor.maxLines > 0 && lineCount >= editor.maxLines;
  const onFieldKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const action = resolveTextEditorKeyAction(event, editor.multiline);
    if (action === "commit") {
      event.preventDefault();
      (event.currentTarget as HTMLElement).blur();
    } else if (action === "blocked-newline") {
      event.preventDefault();
      setKeyboardMessage("This field supports one line only.");
    } else if (action === "newline") {
      setKeyboardMessage("");
    }
  };

  const shared = {
    id: `cz-field-${field.id}`,
    value: textValue,
    placeholder: field.placeholder || "",
    maxLength: editor.maxLength || undefined,
    onFocus: onFocusField,
    onKeyDown: onFieldKeyDown,
    // Every keystroke and paste is normalized through the same rules the server
    // validates against, so the value in the input, on the canvas, in the saved
    // draft and in the print render are always the same string.
    onChange: (e: any) => onChange(normalizeCustomerFieldText(e.target.value, editor)),
  };

  return (
    <div
      data-field-anchor={field.id}
      className={`rounded-lg border p-3 transition ${highlighted ? "border-[#D4AF37] bg-[#D4AF37]/5" : "border-transparent"}`}
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={`cz-field-${field.id}`} className="block text-sm font-semibold text-[#303839]">
          {field.label}
          {field.required && (
            <span className="text-[#D4AF37]" aria-label="required">
              {" "}*
            </span>
          )}
        </label>
        {count}
      </div>
      {editor.control === "textarea" ? (
        <textarea
          {...shared}
          ref={(el) => {
            inputRef(el);
            autoGrow(el);
          }}
          rows={Math.min(Math.max(lineCount, 2), 8)}
          onInput={(e) => autoGrow(e.currentTarget)}
          // Enter is a line break here, so the browser must not treat it as
          // form submission.
          onKeyDown={onFieldKeyDown}
          aria-describedby={`cz-field-${field.id}-hint`}
          className={`${inputClass} min-h-20 resize-y leading-snug`}
        />
      ) : editor.control === "select" ? (
        <select {...shared} ref={inputRef as any} className={inputClass}>
          <option value="">Select…</option>
          {(field.options || []).map((opt: string) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : editor.control === "checkbox" ? (
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-[#303839]">
          <input
            id={`cz-field-${field.id}`}
            ref={inputRef as any}
            type="checkbox"
            checked={Boolean(value)}
            onFocus={onFocusField}
            onKeyDown={onFieldKeyDown}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 accent-[#303839]"
          />
          {field.placeholder || "Yes"}
        </label>
      ) : (
        <input {...shared} ref={inputRef as any} type={customerFieldInputType(editor)} className={inputClass} />
      )}
      <p id={`cz-field-${field.id}-hint`} className="mt-1 text-xs text-[#303839]/55">
        {field.helpText}
        {field.helpText && editor.multiline ? " " : ""}
        {editor.multiline && (
          <span>
            Press Enter for a new line
            {editor.maxLines > 0 ? ` (up to ${editor.maxLines} lines)` : ""}.
          </span>
        )}
      </p>
      {atLineLimit && (
        <p className="mt-1 text-xs font-bold text-[#303839]/70" role="status">
          This design holds {editor.maxLines} {editor.maxLines === 1 ? "line" : "lines"}.
        </p>
      )}
      {keyboardMessage && (
        <p className="mt-1 text-xs font-bold text-[#8a701d]" role="status" aria-live="polite">
          {keyboardMessage}
        </p>
      )}
      {error && (
        <p className="mt-1 text-xs font-bold text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type Props = {
  template: any;
  values: Record<string, any>;
  errors?: Record<string, string>;
  onChange: (fieldId: string, value: any) => void;
  activePage: string;
  onFocusPage?: (pageId: string) => void;
  selectedLayerId?: string | null;
  onSelectLayer?: (layerId: string | null) => void;
  onOpenUploads?: () => void;
};

export default function CustomerEditPanel({
  template,
  values,
  errors = {},
  onChange,
  activePage,
  onFocusPage,
  selectedLayerId,
  onSelectLayer,
  onOpenUploads,
}: Props) {
  const entries = mapCustomerFields(template);
  const pages = getEnabledPages(template);
  const inputRefs = useRef<Record<string, HTMLElement | null>>({});
  const lastScrolled = useRef<string | null>(null);

  // Canvas selection → focus the matching field.
  useEffect(() => {
    if (!selectedLayerId || lastScrolled.current === selectedLayerId) return;
    const entry = entries.find((item) => item.layer.id === selectedLayerId);
    if (!entry) return;
    lastScrolled.current = selectedLayerId;
    const el = inputRefs.current[entry.field.id];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      if (entry.field.type !== "image" && entry.field.type !== "file") {
        (el as HTMLInputElement).focus?.({ preventScroll: true });
      }
    }
  }, [selectedLayerId, entries]);

  useEffect(() => {
    if (!selectedLayerId) lastScrolled.current = null;
  }, [selectedLayerId]);

  if (!entries.length) {
    return (
      <p className="p-5 text-sm text-[#303839]/55">
        This design has no editable details. Continue to Options when you are ready.
      </p>
    );
  }

  return (
    <div className="grid gap-5 p-4">
      {pages.map((page: any) => {
        const pageEntries = entries.filter((entry) => entry.page === page.id);
        if (!pageEntries.length) return null;
        return (
          <section key={page.id} aria-label={`${page.label} details`}>
            <h3 className="mb-2 flex items-center justify-between font-display text-xl text-[#303839]">
              {page.label}
              {pages.length > 1 && page.id !== activePage && (
                <button
                  type="button"
                  onClick={() => onFocusPage?.(page.id)}
                  className="rounded-md px-1 text-xs font-bold text-[#303839]/50 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
                >
                  View page
                </button>
              )}
            </h3>
            <div className="grid gap-1.5">
              {pageEntries.map(({ field, layer }) => {
                // One shared resolver decides the control, the multiline rule
                // and the limits — the same rule the server validates with.
                const editor = resolveCustomerFieldEditor(field, layer);
                if (editor.control === "image") {
                  const hasPhoto = !isValueEmpty(values[field.id]) && Boolean(getImageUrl(values[field.id]));
                  return (
                    <div
                      key={field.id}
                      data-field-anchor={field.id}
                      ref={(el) => {
                        inputRefs.current[field.id] = el;
                      }}
                      className={`rounded-lg border p-3 transition ${
                        selectedLayerId === layer.id ? "border-[#D4AF37] bg-[#D4AF37]/5" : "border-[#303839]/10"
                      }`}
                    >
                      <p className="text-sm font-semibold text-[#303839]">
                        {field.label}
                        {field.required && <span className="text-[#D4AF37]"> *</span>}
                      </p>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <span className="text-xs text-[#303839]/55">{hasPhoto ? "Photo added" : "No photo yet"}</span>
                        <button
                          type="button"
                          onClick={() => {
                            onSelectLayer?.(layer.id);
                            onOpenUploads?.();
                          }}
                          className="min-h-11 rounded-full border border-[#303839]/15 px-3 py-1 text-xs font-bold text-[#303839] hover:bg-[#303839]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
                        >
                          {hasPhoto ? "Edit photo" : "Upload photo"}
                        </button>
                      </div>
                      {errors[field.id] && (
                        <p className="mt-1 text-xs font-bold text-red-700" role="alert">
                          {errors[field.id]}
                        </p>
                      )}
                    </div>
                  );
                }

                return (
                  <TextField
                    key={field.id}
                    field={field}
                    editor={editor}
                    value={values[field.id]}
                    error={errors[field.id]}
                    highlighted={selectedLayerId === layer.id}
                    inputRef={(el: HTMLElement | null) => {
                      inputRefs.current[field.id] = el;
                    }}
                    onFocusField={() => {
                      lastScrolled.current = layer.id;
                      onFocusPage?.(page.id);
                      onSelectLayer?.(layer.id);
                    }}
                    onChange={(next: any) => onChange(field.id, next)}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
