"use client";

// Left-column editing panel for the customer customizer. Renders the editable
// fields grouped by the page their layer sits on (front fields, back fields,
// photo uploads), with validation messages. Customers edit only these fields —
// they cannot move design elements.

import { useState } from "react";
import { getEnabledPages, getImageUrl } from "./customizer-utils";

// The customer only ever sees fields that are connected to a customer-editable,
// visible layer on an enabled page. Everything else (decorative layers, orphan
// fields, hidden layers, invisible fields) is excluded.
function groupFieldsByPage(template: any) {
  const enabledPageIds = new Set(getEnabledPages(template).map((p: any) => p.id));
  const fieldById = new Map((template?.fields || []).map((f: any) => [f.id, f]));

  const fieldPage: Record<string, string> = {};
  const layerConfig: Record<string, any> = {};
  (template?.layers || []).forEach((layer: any) => {
    if (!layer.customerEditable || !layer.fieldId) return;
    if (layer.hidden) return;
    if (!enabledPageIds.has(layer.page)) return;
    const field: any = fieldById.get(layer.fieldId);
    if (!field || field.customerVisible === false) return;
    if (fieldPage[layer.fieldId]) return; // first connected layer wins
    fieldPage[layer.fieldId] = layer.page;
    layerConfig[layer.fieldId] = layer;
  });

  const pages = getEnabledPages(template);
  const groups = pages
    .map((page: any) => ({
      page,
      fields: (template?.fields || []).filter((field: any) => fieldPage[field.id] === page.id),
    }))
    .filter((group: any) => group.fields.length);

  // No orphan/unused fields on the customer side.
  return { groups, ungrouped: [] as any[], layerConfig };
}

const inputClass =
  "w-full border border-[#303839]/15 bg-white px-3 py-2.5 text-sm text-[#303839] outline-none transition focus:border-[#303839]/45";

function PhotoField({ field, value, layer, onChange, onUploadPhoto, error }: any) {
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const url = getImageUrl(value);
  const allowZoom = !layer || layer.allowZoom !== false;
  const allowReposition = !layer || layer.allowReposition !== false;

  const handleFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setUploadError("");
    try {
      const uploaded = await onUploadPhoto(file);
      if (uploaded?.url) {
        onChange({ ...uploaded, zoom: 1, offsetX: 0, offsetY: 0 });
      }
    } catch (e: any) {
      setUploadError(e?.message || "Could not upload this photo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-[#303839]">
        {field.label}
        {field.required && <span className="text-[#D4AF37]"> *</span>}
      </label>

      {url ? (
        <div className="border border-[#303839]/12 bg-white p-3">
          <div className="flex items-center gap-3">
            <div className="h-16 w-16 shrink-0 overflow-hidden border border-[#303839]/10 bg-[#F4ECEC]">
              <img src={url} alt={field.label} className="h-full w-full object-cover" />
            </div>
            <label className="cursor-pointer border border-[#303839]/15 bg-white px-3 py-1.5 text-xs font-bold text-[#303839] hover:bg-[#F4ECEC]">
              {busy ? "Uploading…" : "Replace photo"}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => handleFile(e.target.files?.[0])} />
            </label>
          </div>

          {(allowZoom || allowReposition) && (
            <div className="mt-3 grid gap-2">
              {allowZoom && (
                <label className="flex items-center gap-2 text-xs font-bold text-[#303839]/70">
                  <span className="w-16">Zoom</span>
                  <input
                    type="range"
                    min={1}
                    max={3}
                    step={0.05}
                    value={Number(value?.zoom) || 1}
                    onChange={(e) => onChange({ ...value, zoom: Number(e.target.value) })}
                    className="flex-1 accent-[#303839]"
                  />
                </label>
              )}
              {allowReposition && (
                <>
                  <label className="flex items-center gap-2 text-xs font-bold text-[#303839]/70">
                    <span className="w-16">Move X</span>
                    <input type="range" min={-300} max={300} step={5} value={Number(value?.offsetX) || 0} onChange={(e) => onChange({ ...value, offsetX: Number(e.target.value) })} className="flex-1 accent-[#303839]" />
                  </label>
                  <label className="flex items-center gap-2 text-xs font-bold text-[#303839]/70">
                    <span className="w-16">Move Y</span>
                    <input type="range" min={-300} max={300} step={5} value={Number(value?.offsetY) || 0} onChange={(e) => onChange({ ...value, offsetY: Number(e.target.value) })} className="flex-1 accent-[#303839]" />
                  </label>
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        <label className="flex h-24 cursor-pointer items-center justify-center border border-dashed border-[#303839]/25 bg-white text-xs font-bold text-[#303839]/60 hover:bg-[#F4ECEC]">
          {busy ? "Uploading…" : "Upload a photo (JPG, PNG, WebP)"}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => handleFile(e.target.files?.[0])} />
        </label>
      )}

      {field.helpText && <p className="mt-1 text-xs text-[#303839]/55">{field.helpText}</p>}
      {(uploadError || error) && <p className="mt-1 text-xs font-bold text-red-700">{uploadError || error}</p>}
    </div>
  );
}

function Field({ field, value, layer, onChange, onUploadPhoto, error }: any) {
  if (field.type === "image" || field.type === "file") {
    return <PhotoField field={field} value={value} layer={layer} onChange={onChange} onUploadPhoto={onUploadPhoto} error={error} />;
  }

  const header = (
    <label htmlFor={`cz-${field.id}`} className="mb-1.5 block text-sm font-semibold text-[#303839]">
      {field.label}
      {field.required && <span className="text-[#D4AF37]"> *</span>}
    </label>
  );

  const help = field.helpText ? <p className="mt-1 text-xs text-[#303839]/55">{field.helpText}</p> : null;
  const err = error ? <p className="mt-1 text-xs font-bold text-red-700">{error}</p> : null;
  const count =
    field.maxLength && typeof value === "string" ? (
      <span className={`ml-2 text-[11px] font-bold ${value.length > field.maxLength ? "text-red-700" : "text-[#303839]/45"}`}>
        {value.length}/{field.maxLength}
      </span>
    ) : null;

  if (field.type === "textarea") {
    return (
      <div>
        {header}
        <textarea id={`cz-${field.id}`} value={value || ""} placeholder={field.placeholder} maxLength={field.maxLength || undefined} onChange={(e) => onChange(e.target.value)} className={`${inputClass} min-h-24`} />
        {count}
        {help}
        {err}
      </div>
    );
  }

  if (field.type === "select") {
    return (
      <div>
        {header}
        <select id={`cz-${field.id}`} value={value || ""} onChange={(e) => onChange(e.target.value)} className={inputClass}>
          <option value="">Select…</option>
          {(field.options || []).map((opt: string) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
        {help}
        {err}
      </div>
    );
  }

  if (field.type === "checkbox") {
    return (
      <label className="flex cursor-pointer items-start gap-3 border border-[#303839]/12 bg-white px-3 py-2.5 text-sm">
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#303839]" />
        <span>
          <span className="font-semibold text-[#303839]">{field.label}{field.required && <span className="text-[#D4AF37]"> *</span>}</span>
          {field.helpText && <span className="mt-0.5 block text-xs text-[#303839]/55">{field.helpText}</span>}
        </span>
      </label>
    );
  }

  const inputType = field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "time" ? "time" : "text";
  return (
    <div>
      {header}
      {count}
      <input id={`cz-${field.id}`} type={inputType} value={value || ""} placeholder={field.placeholder} maxLength={field.maxLength || undefined} onChange={(e) => onChange(e.target.value)} className={inputClass} />
      {help}
      {err}
    </div>
  );
}

export default function CustomizerFieldsPanel({ template, values, errors = {}, onChange, onUploadPhoto, activePage, onFocusPage }: any) {
  const { groups, ungrouped, layerConfig } = groupFieldsByPage(template);

  const renderField = (field: any) => (
    <Field
      key={field.id}
      field={field}
      value={values[field.id]}
      layer={layerConfig[field.id]}
      error={errors[field.id]}
      onChange={(next: any) => onChange(field.id, next)}
      onUploadPhoto={onUploadPhoto}
    />
  );

  return (
    <div className="grid gap-6">
      {groups.map((group: any) => (
        <section
          key={group.page.id}
          onFocus={() => onFocusPage?.(group.page.id)}
          className={`border p-4 transition ${activePage === group.page.id ? "border-[#303839]/30" : "border-[#303839]/10"}`}
        >
          <h3 className="mb-3 font-display text-xl text-[#303839]">{group.page.label} details</h3>
          <div className="grid gap-4">{group.fields.map(renderField)}</div>
        </section>
      ))}

      {ungrouped.length > 0 && (
        <section className="border border-[#303839]/10 p-4">
          <h3 className="mb-3 font-display text-xl text-[#303839]">Details</h3>
          <div className="grid gap-4">{ungrouped.map(renderField)}</div>
        </section>
      )}
    </div>
  );
}
