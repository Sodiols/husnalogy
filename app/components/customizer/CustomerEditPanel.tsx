"use client";

// Customer Edit panel (Section 7): the editable text fields for each page,
// two-way connected to the canvas — focusing a field selects its layer, and
// selecting an editable layer scrolls to / focuses its field.

import { useEffect, useRef } from "react";
import { getEnabledPages, getImageUrl, getLayerPermissions, isValueEmpty } from "./customizer-utils";

const inputClass =
  "w-full rounded-md border border-[#303839]/15 bg-white px-3 py-2.5 text-sm text-[#303839] outline-none transition focus:border-[#D4AF37]";

// Fields shown here are the ones connected to a visible, customer-editable
// layer on an enabled page. Image fields are summarized with a link to the
// Uploads panel where the full upload controls live.
export function mapCustomerFields(template: any) {
  const enabledPageIds = new Set(getEnabledPages(template).map((p: any) => p.id));
  const fieldById = new Map((template?.fields || []).map((f: any) => [f.id, f]));
  const entries: Array<{ field: any; layer: any; page: string }> = [];
  const seen = new Set<string>();

  (template?.layers || []).forEach((layer: any) => {
    if (!layer.customerEditable || !layer.fieldId || layer.hidden) return;
    if (!enabledPageIds.has(layer.page)) return;
    const permissions = getLayerPermissions(layer);
    const canEditField = layer.type === "image" ? permissions.replaceImage : permissions.editContent;
    if (!canEditField) return;
    const field: any = fieldById.get(layer.fieldId);
    if (!field || field.customerVisible === false) return;
    if (seen.has(layer.fieldId)) return;
    seen.add(layer.fieldId);
    entries.push({ field, layer, page: layer.page });
  });

  return entries;
}

function TextField({ field, value, error, onChange, onFocusField, inputRef, highlighted }: any) {
  const count =
    field.maxLength && typeof value === "string" ? (
      <span className={`text-[11px] font-bold ${value.length > field.maxLength ? "text-red-700" : "text-[#303839]/45"}`}>
        {value.length}/{field.maxLength}
      </span>
    ) : null;

  const shared = {
    id: `cz-field-${field.id}`,
    ref: inputRef,
    value: value || "",
    placeholder: field.placeholder || "",
    maxLength: field.maxLength || undefined,
    onFocus: onFocusField,
    onChange: (e: any) => onChange(e.target.value),
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
      {field.type === "textarea" ? (
        <textarea {...shared} className={`${inputClass} min-h-24`} />
      ) : field.type === "select" ? (
        <select {...shared} className={inputClass}>
          <option value="">Select…</option>
          {(field.options || []).map((opt: string) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : field.type === "checkbox" ? (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-[#303839]">
          <input
            id={`cz-field-${field.id}`}
            ref={inputRef}
            type="checkbox"
            checked={Boolean(value)}
            onFocus={onFocusField}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 accent-[#303839]"
          />
          {field.placeholder || "Yes"}
        </label>
      ) : (
        <input
          {...shared}
          type={field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "time" ? "time" : "text"}
          className={inputClass}
        />
      )}
      {field.helpText && <p className="mt-1 text-xs text-[#303839]/55">{field.helpText}</p>}
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
                  className="text-xs font-bold text-[#303839]/50 underline-offset-2 hover:underline"
                >
                  View page
                </button>
              )}
            </h3>
            <div className="grid gap-1.5">
              {pageEntries.map(({ field, layer }) => {
                if (field.type === "image" || field.type === "file") {
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
                          className="rounded-full border border-[#303839]/15 px-3 py-1 text-xs font-bold text-[#303839] hover:bg-[#F4ECEC]"
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
