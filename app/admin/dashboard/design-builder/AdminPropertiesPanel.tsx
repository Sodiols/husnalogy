"use client";

// The selected layer's content, styling, and customer-facing template settings.
// Transform geometry remains available on the canvas rather than in this panel.

import { useRef, useState } from "react";
import { getConnectedField, uploadBuilderImage } from "./builder-utils";
import { customerEditablePermissionBundle } from "@/lib/customizer";
import EditableNumericStepper from "@/app/components/customizer/EditableNumericStepper";
import { getTextAutoSizeMode } from "@/lib/customizer/v2/text-layout";
import {
  countTextLines,
  insertTextNewline,
  resolveTextEditorKeyAction,
} from "@/lib/customizer/v2/text-editing";

const controlClass = "h-11 w-full rounded-xl border border-[#303839]/12 bg-white px-3 text-sm text-[#303839] outline-none transition-colors hover:border-[#303839]/25 focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20";

function Lbl({ children }: any) {
  return <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.1em] text-[#303839]/55">{children}</span>;
}
function Num({ value, onChange, min, max, step = 1, ariaLabel = "Numeric value" }: any) {
  return <EditableNumericStepper label={ariaLabel} value={Number(value) || 0} minimum={min} maximum={max} step={step} largeStep={step * 10} allowNegative={min === undefined || min < 0} allowDecimal={step < 1} showStepButtons={false} onCommit={onChange} className="h-11 w-full" inputClassName={controlClass} />;
}
function CarouselStepper({ value, onChange, min = -Infinity, max = Infinity, step = 1, ariaLabel }: any) {
  return <EditableNumericStepper label={ariaLabel} value={Number(value) || 0} minimum={Number.isFinite(min) ? min : undefined} maximum={Number.isFinite(max) ? max : undefined} step={step} largeStep={step < 1 ? step * 10 : Math.max(step * 5, 10)} allowNegative={!Number.isFinite(min) || min < 0} allowDecimal={step < 1} showStepButtons={false} onCommit={onChange} className="h-11 w-full" inputClassName={controlClass} />;
}
function Txt({ value, onChange, placeholder }: any) {
  return (
    <input
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={controlClass}
    />
  );
}
function Sel({ value, onChange, options, ariaLabel }: any) {
  return (
    <span className="relative block min-w-0">
      <select
        value={value ?? ""}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        className={`${controlClass} appearance-none pr-10`}
      >
        {options.map((o: any) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#303839]/50" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m6 9 6 6 6-6" />
      </svg>
    </span>
  );
}
function Check({ checked, onChange, label }: any) {
  return (
    <label className="flex min-h-9 cursor-pointer items-center gap-2.5 text-xs font-semibold text-[#303839]/75">
      <input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} className="h-[18px] w-[18px] accent-[#303839]" />
      {label}
    </label>
  );
}
function Section({ title, children, subtle = false, collapsible = false, defaultOpen = true }: any) {
  const surface = `py-1 ${subtle ? "rounded-xl bg-[#F8F6F1] px-3.5 py-3" : ""}`;
  if (collapsible) {
    return (
      <details className={`${surface} group/section`} open={defaultOpen || undefined}>
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 text-[11px] font-extrabold uppercase tracking-[0.11em] text-[#303839]/70 marker:hidden">
          {title}
          <svg className="shrink-0 transition group-open/section:rotate-180" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
        </summary>
        <div className="mt-3 grid gap-3">{children}</div>
      </details>
    );
  }
  return (
    <section className={surface}>
      <h4 className="mb-3 text-[11px] font-extrabold uppercase tracking-[0.11em] text-[#303839]/70">{title}</h4>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function ImageSrcControl({ layer, onLayerPatch }: any) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const handle = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const asset = await uploadBuilderImage(file, layer.type === "frame" ? "frame" : "image");
      if (asset.url) onLayerPatch(layer.id, {
        src: asset.editorUrl || asset.url,
        assetId: asset.id,
        bucket: asset.bucket,
        path: asset.originalPath,
        originalPath: asset.originalPath,
        editorPath: asset.editorPath,
        thumbnailPath: asset.thumbnailPath,
        originalFilename: asset.originalFilename,
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <Lbl>Layer image (optional)</Lbl>
      <div className="flex items-center gap-2">
        {layer.src ? <img src={layer.src} alt="" className="h-10 w-10 rounded border border-[#303839]/10 object-cover" /> : null}
        <button type="button" onClick={() => inputRef.current?.click()} className="rounded-full border border-[#303839]/15 bg-white px-3 py-1.5 text-xs font-bold hover:bg-[#F8F6F1]">
          {busy ? "Uploading…" : layer.src ? "Replace" : "Upload"}
        </button>
        {layer.src && (
          <button type="button" onClick={() => onLayerPatch(layer.id, { src: "" })} className="rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50">
            Clear
          </button>
        )}
      </div>
      <p className="mt-1 text-[10px] text-[#303839]/45">Leave empty for a customer photo placeholder.</p>
      <input ref={inputRef} type="file" accept="image/*" className="sr-only" onChange={(e) => { handle(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}

function GridSlotEditor({ slot, index, layer, onLayerPatch }: any) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const patchSlot = (patch: any) => onLayerPatch(layer.id, {
    slots: (layer.slots || []).map((item: any) => item.id === slot.id ? { ...item, ...patch } : item),
  });
  const editable = Boolean(slot.permissions?.replaceImage || slot.permissions?.cropImage);
  const transform = slot.transform || {};
  return (
    <div className="grid gap-2 rounded-xl border border-[#303839]/10 bg-[#F8F6F1] p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-extrabold">Photo {index + 1}</span>
        <Check checked={Boolean(slot.required)} onChange={(required: boolean) => patchSlot({ required })} label="Required" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Lbl>Slot mask</Lbl>
          <Sel ariaLabel={`Photo ${index + 1} mask`} value={slot.mask?.kind || "rectangle"} onChange={(kind: string) => patchSlot({ mask: kind === "rounded" ? { kind, radius: 24 } : { kind } })} options={[
            { value: "rectangle", label: "Rectangle" }, { value: "rounded", label: "Rounded" }, { value: "circle", label: "Circle" },
            { value: "oval", label: "Oval" }, { value: "arch", label: "Arch" }, { value: "arch-top", label: "Top arch" }, { value: "arch-bottom", label: "Bottom arch" },
          ]} />
        </div>
        <div className="grid content-end">
          <Check checked={editable} onChange={(value: boolean) => patchSlot({ permissions: customerEditablePermissionBundle(value) })} label="Customer editable" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        {slot.src ? <img src={slot.src} alt="" className="h-10 w-10 rounded-lg border border-[#303839]/10 object-cover" /> : null}
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="min-h-10 rounded-lg border border-[#303839]/12 bg-white px-3 text-xs font-bold hover:border-[#D4AF37] disabled:opacity-50">
          {busy ? "Uploading…" : slot.src ? "Replace default" : "Add default photo"}
        </button>
        {slot.src ? <button type="button" onClick={() => patchSlot({ src: "", assetId: "", bucket: undefined, path: undefined })} className="min-h-10 rounded-lg px-2 text-xs font-bold text-red-700 hover:bg-red-50">Clear</button> : null}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><Lbl>Crop zoom</Lbl><CarouselStepper ariaLabel={`Photo ${index + 1} crop zoom`} value={Math.round((Number(transform.zoom) || 1) * 100)} min={100} max={800} step={5} onChange={(value: number) => patchSlot({ transform: { ...transform, zoom: value / 100 } })} /></div>
        <div><Lbl>Image rotation</Lbl><CarouselStepper ariaLabel={`Photo ${index + 1} image rotation`} value={Number(transform.rotation) || 0} min={-360} max={360} onChange={(rotation: number) => patchSlot({ transform: { ...transform, rotation } })} /></div>
        <div><Lbl>Crop X</Lbl><CarouselStepper ariaLabel={`Photo ${index + 1} crop X position`} value={Number(transform.offsetX) || 0} min={-10000} max={10000} onChange={(offsetX: number) => patchSlot({ transform: { ...transform, offsetX } })} /></div>
        <div><Lbl>Crop Y</Lbl><CarouselStepper ariaLabel={`Photo ${index + 1} crop Y position`} value={Number(transform.offsetY) || 0} min={-10000} max={10000} onChange={(offsetY: number) => patchSlot({ transform: { ...transform, offsetY } })} /></div>
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setBusy(true);
        try {
          const asset = await uploadBuilderImage(file, "image");
          if (asset.url) patchSlot({
            src: asset.editorUrl || asset.url,
            assetId: asset.id,
            bucket: asset.bucket,
            path: asset.originalPath,
            originalPath: asset.originalPath,
            metadata: { ...(slot.metadata || {}), width: asset.width || 0, height: asset.height || 0 },
          });
        } finally {
          setBusy(false);
          event.target.value = "";
        }
      }} />
    </div>
  );
}

function PlaceholderImageControl({ layer, onLayerPatch }: any) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const handle = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const asset = await uploadBuilderImage(file, "image");
      if (asset.url) onLayerPatch(layer.id, {
        placeholderImage: asset.editorUrl || asset.url,
        placeholderAssetId: asset.id,
        placeholderAssetPath: asset.originalPath,
        placeholderAssetBucket: asset.bucket,
        placeholderAssetEditorPath: asset.editorPath,
        placeholderAssetThumbnailPath: asset.thumbnailPath,
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <Lbl>Default placeholder image</Lbl>
      <div className="flex items-center gap-2">
        {layer.placeholderImage ? (
          <img src={layer.placeholderImage} alt="" className="h-10 w-10 rounded border border-[#303839]/10 object-cover" />
        ) : null}
        <button type="button" onClick={() => inputRef.current?.click()} className="rounded-full border border-[#303839]/15 bg-white px-3 py-1.5 text-xs font-bold hover:bg-[#F8F6F1]">
          {busy ? "Uploading…" : layer.placeholderImage ? "Replace" : "Upload"}
        </button>
        {layer.placeholderImage && (
          <button type="button" onClick={() => onLayerPatch(layer.id, { placeholderImage: "", placeholderAssetId: "", placeholderAssetPath: "", placeholderAssetBucket: "", placeholderAssetEditorPath: "", placeholderAssetThumbnailPath: "" })} className="rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50">
            Clear
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="sr-only" onChange={(e) => { handle(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}

const INSPECTOR_TABS = [
  { id: "design", label: "Design" },
  { id: "settings", label: "Settings" },
  { id: "advanced", label: "Advanced" },
];

export default function AdminPropertiesPanel({
  template,
  layer,
  onLayerPatch,
  onStylePatch,
  onFieldPatch,
  onLinkField,
  onToggleCustomerEditable,
}: any) {
  // Declared before the early return so the hook order stays stable.
  const [inspectorTab, setInspectorTab] = useState("design");

  if (!layer) {
    return (
      <div className="p-5 text-sm text-[#303839]/55">
        <p className="font-semibold text-[#303839]">Nothing selected</p>
        <p className="mt-1">Select a layer on the canvas, or add one from the tool rail.</p>
      </div>
    );
  }

  const field = getConnectedField(template, layer);
  const style = layer?.textStyle || {};

  return (
    <div data-customizer-text-interaction className="bg-white">
      {/* Inspector tabs. Purely a routing layer over the existing sections —
          every control below keeps its original handler. */}
      <div className="sticky top-0 z-10 flex items-center gap-0.5 border-b border-[#303839]/8 bg-white px-3 pt-3">
        {INSPECTOR_TABS.map((entry) => {
          const active = inspectorTab === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setInspectorTab(entry.id)}
              aria-current={active ? "true" : undefined}
              className={`relative px-3 pb-2.5 text-[11px] font-bold uppercase tracking-[0.1em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${
                active ? "text-[#303839]" : "text-[#303839]/40 hover:text-[#303839]/70"
              }`}
            >
              {entry.label}
              <span
                aria-hidden
                className={`absolute inset-x-2 bottom-0 h-[2px] rounded-full ${active ? "bg-[#D4AF37]" : "bg-transparent"}`}
              />
            </button>
          );
        })}
      </div>

    <div className="grid gap-6 p-5">
      {inspectorTab === "design" && (
        <div>
          <Lbl>Layer name</Lbl>
          <Txt value={layer.name} onChange={(v: string) => onLayerPatch(layer.id, { name: v })} />
        </div>
      )}

      {inspectorTab === "design" && layer.type === "text" && (
        <Section title="Text">
          <div>
            <Lbl>Text content</Lbl>
            <textarea
              value={layer.text || ""}
              rows={style.multiline ? 3 : 1}
              maxLength={Number(layer.maxChars) > 0 ? Number(layer.maxChars) : undefined}
              onChange={(event) => onLayerPatch(layer.id, { text: event.target.value })}
              onInput={(event) => {
                event.currentTarget.style.height = "auto";
                event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 320)}px`;
              }}
              // Admin editing may convert an existing single-line layer in
              // place. Ctrl/Cmd + Enter is the only Enter-based save action.
              onKeyDown={(event) => {
                const action = resolveTextEditorKeyAction(event, true);
                if (action === "commit") {
                  event.preventDefault();
                  event.currentTarget.blur();
                  return;
                }
                if (action !== "newline") return;
                const inserted = insertTextNewline(event.currentTarget.value, {
                  start: event.currentTarget.selectionStart ?? event.currentTarget.value.length,
                  end: event.currentTarget.selectionEnd ?? event.currentTarget.value.length,
                });
                if (Number(layer.maxLines) > 0 && countTextLines(inserted.value) > Number(layer.maxLines)) {
                  event.preventDefault();
                  return;
                }
                if (!style.multiline) onStylePatch(layer.id, {
                  multiline: true,
                  autoSizeMode: "height",
                  fitMode: "auto-height",
                });
              }}
              title="Enter adds a line. Ctrl/Cmd + Enter finishes editing."
              className="min-h-11 w-full resize-y rounded-xl border border-[#303839]/12 bg-white p-3 text-sm leading-relaxed text-[#303839] outline-none transition-colors focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
            />
          </div>
          <div>
            <Lbl>Font size</Lbl>
            <Num ariaLabel="Font size" value={style.fontSize ?? 48} min={4} max={500} onChange={(fontSize: number) => onStylePatch(layer.id, { fontSize })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Lbl>Text sizing</Lbl>
              <Sel
                ariaLabel="Text sizing"
                value={getTextAutoSizeMode(style)}
                // fitMode is kept in sync so the layout engine and every legacy
                // path keep behaving exactly as before.
                onChange={(v: string) => onStylePatch(layer.id, {
                  autoSizeMode: v,
                  fitMode: v === "height" ? "auto-height" : v === "shrink" ? "shrink" : "fixed",
                })}
                options={[
                  { value: "width", label: "Auto width (single line)" },
                  { value: "fixed", label: "Fixed width" },
                  { value: "height", label: "Auto height" },
                  { value: "shrink", label: "Shrink to fit" },
                ]}
              />
            </div>
            {getTextAutoSizeMode(style) === "shrink" && (
              <div>
                <Lbl>Min font size</Lbl>
                <Num ariaLabel="Minimum font size" value={style.minFontSize || Math.max(8, Math.round((style.fontSize || 48) * 0.4))} min={4} onChange={(v: number) => onStylePatch(layer.id, { minFontSize: Math.max(4, v) })} />
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <Check checked={style.uppercase} onChange={(v: boolean) => onStylePatch(layer.id, { uppercase: v })} label="Uppercase" />
            <Check checked={style.multiline} onChange={(v: boolean) => onStylePatch(layer.id, { multiline: v })} label="Multiline (wraps in box)" />
          </div>
        </Section>
      )}

      {inspectorTab === "design" && (layer.type === "image" || layer.type === "frame") && (
        <Section title="Image / photo area">
          <ImageSrcControl layer={layer} onLayerPatch={onLayerPatch} />
          <PlaceholderImageControl layer={layer} onLayerPatch={onLayerPatch} />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Lbl>Mask shape</Lbl>
              <Sel
                ariaLabel="Mask shape"
                value={layer.maskShape}
                onChange={(v: string) => onLayerPatch(layer.id, { maskShape: v })}
                options={[
                  { value: "rectangle", label: "Rectangle" },
                  { value: "rounded", label: "Rounded rectangle" },
                  { value: "circle", label: "Circle" },
                  { value: "oval", label: "Oval" },
                  { value: "arch", label: "Arch (top)" },
                  { value: "arch-bottom", label: "Arch (bottom)" },
                  { value: "arch-full", label: "Arch (both ends)" },
                ]}
              />
            </div>
            <div>
              <Lbl>Image fit</Lbl>
              <Sel ariaLabel="Image fit" value={layer.fitMode} onChange={(v: string) => onLayerPatch(layer.id, { fitMode: v })} options={[{ value: "cover", label: "Cover (fill)" }, { value: "contain", label: "Contain (fit)" }]} />
            </div>
            <div>
              <Lbl>Frame border colour</Lbl>
              <input
                type="color"
                aria-label="Frame border colour"
                value={layer.borderColor || "#303839"}
                onChange={(e) => onLayerPatch(layer.id, { borderColor: e.target.value })}
                className="h-9 w-full rounded-md border border-[#303839]/15"
              />
            </div>
            <div>
              <Lbl>Frame border width</Lbl>
              <Num ariaLabel="Frame border width" value={layer.borderWidth || 0} min={0} max={200} onChange={(v: number) => onLayerPatch(layer.id, { borderWidth: Math.max(0, v) })} />
            </div>
            <div className="col-span-2">
              <Lbl>Frame background</Lbl>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Frame background colour"
                  value={layer.backgroundColor || "#F8F6F1"}
                  onChange={(e) => onLayerPatch(layer.id, { backgroundColor: e.target.value })}
                  className="h-9 w-full rounded-md border border-[#303839]/15"
                />
                {layer.backgroundColor ? (
                  <button
                    type="button"
                    onClick={() => onLayerPatch(layer.id, { backgroundColor: "" })}
                    className="shrink-0 rounded-full border border-[#303839]/15 px-3 py-1.5 text-[11px] font-bold hover:bg-[#F8F6F1]"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </Section>
      )}

      {inspectorTab === "advanced" && (layer.type === "image" || layer.type === "frame") && (
        <Section title="Image crop defaults" collapsible defaultOpen={false}>
          <div className="grid grid-cols-2 gap-2">
            <div><Lbl>Crop zoom</Lbl><CarouselStepper ariaLabel="Image crop zoom" value={Math.round((Number(layer.imageTransform?.zoom) || 1) * 100)} min={100} max={800} step={5} onChange={(value: number) => onLayerPatch(layer.id, { imageTransform: { ...(layer.imageTransform || {}), zoom: value / 100 } })} /></div>
            <div><Lbl>Image rotation</Lbl><CarouselStepper ariaLabel="Image crop rotation" value={Number(layer.imageTransform?.rotation) || 0} min={-360} max={360} onChange={(rotation: number) => onLayerPatch(layer.id, { imageTransform: { ...(layer.imageTransform || {}), rotation } })} /></div>
            <div><Lbl>Crop X</Lbl><CarouselStepper ariaLabel="Image crop X position" value={Number(layer.imageTransform?.offsetX) || 0} min={-10000} max={10000} onChange={(offsetX: number) => onLayerPatch(layer.id, { imageTransform: { ...(layer.imageTransform || {}), offsetX } })} /></div>
            <div><Lbl>Crop Y</Lbl><CarouselStepper ariaLabel="Image crop Y position" value={Number(layer.imageTransform?.offsetY) || 0} min={-10000} max={10000} onChange={(offsetY: number) => onLayerPatch(layer.id, { imageTransform: { ...(layer.imageTransform || {}), offsetY } })} /></div>
          </div>
        </Section>
      )}

      {inspectorTab === "advanced" && (layer.type === "image" || layer.type === "frame") && (
        <Section title="Image filters" collapsible defaultOpen={false}>
          <div className="grid grid-cols-2 gap-2">
            {[
              ["brightness", "Brightness", 0, 2, 0.05, 1],
              ["contrast", "Contrast", 0, 2, 0.05, 1],
              ["saturation", "Saturation", 0, 2, 0.05, 1],
              ["grayscale", "Grayscale", 0, 1, 0.05, 0],
              ["sepia", "Sepia", 0, 1, 0.05, 0],
            ].map(([key, label, min, max, step, fallback]: any) => (
              <div key={key}><Lbl>{label}</Lbl><CarouselStepper ariaLabel={label} value={layer.filters?.[key] ?? fallback} min={min} max={max} step={step} onChange={(value: number) => onLayerPatch(layer.id, { filters: { ...(layer.filters || {}), [key]: value } })} /></div>
            ))}
          </div>
          <button type="button" onClick={() => onLayerPatch(layer.id, { filters: { brightness: 1, contrast: 1, saturation: 1, grayscale: 0, sepia: 0, tintAmount: 0 } })} className="min-h-10 rounded-lg border border-[#303839]/15 text-xs font-bold hover:bg-[#F8F6F1]">Reset filters</button>
        </Section>
      )}

      {inspectorTab === "design" && layer.type === "grid" && (
        <Section title="Photo grid">
          <div className="grid grid-cols-2 gap-2">
            <div><Lbl>Columns</Lbl><CarouselStepper ariaLabel="Grid columns" value={layer.columns || 2} min={1} max={12} onChange={(value: number) => onLayerPatch(layer.id, { columns: value })} /></div>
            <div><Lbl>Rows</Lbl><CarouselStepper ariaLabel="Grid rows" value={layer.rows || 2} min={1} max={12} onChange={(value: number) => onLayerPatch(layer.id, { rows: value })} /></div>
            <div><Lbl>Gap</Lbl><CarouselStepper ariaLabel="Grid gap" value={layer.gap || 0} min={0} max={200} onChange={(value: number) => onLayerPatch(layer.id, { gap: value })} /></div>
            <div><Lbl>Padding</Lbl><CarouselStepper ariaLabel="Grid padding" value={layer.padding || 0} min={0} max={300} onChange={(value: number) => onLayerPatch(layer.id, { padding: value })} /></div>
            <div><Lbl>Corner radius</Lbl><CarouselStepper ariaLabel="Grid corner radius" value={layer.cornerRadius || 0} min={0} max={500} onChange={(value: number) => onLayerPatch(layer.id, { cornerRadius: value })} /></div>
            <div><Lbl>Border width</Lbl><CarouselStepper ariaLabel="Grid border width" value={layer.borderWidth || 0} min={0} max={100} onChange={(value: number) => onLayerPatch(layer.id, { borderWidth: value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label><Lbl>Background</Lbl><input type="color" value={layer.backgroundColor || "#F8F6F1"} onChange={(event) => onLayerPatch(layer.id, { backgroundColor: event.target.value })} className="h-10 w-full rounded-lg border border-[#303839]/15" /></label>
            <label><Lbl>Border</Lbl><input type="color" value={layer.borderColor || "#303839"} onChange={(event) => onLayerPatch(layer.id, { borderColor: event.target.value })} className="h-10 w-full rounded-lg border border-[#303839]/15" /></label>
          </div>
          <Check
            checked={layer.customerEditable && ["move", "resize", "rotate"].every((key) => layer.customerPermissions?.[key] === false)}
            onChange={(fixed: boolean) => onLayerPatch(layer.id, {
              customerPermissions: { ...(layer.customerPermissions || customerEditablePermissionBundle(true)), move: !fixed, resize: !fixed, rotate: !fixed },
            })}
            label="Keep grid position fixed for customers"
          />
          <div className="grid gap-1.5 border-t border-[#303839]/10 pt-2">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#303839]/45">Slots</p>
            {(layer.slots || []).map((slot: any, index: number) => (
              <GridSlotEditor key={slot.id} slot={slot} index={index} layer={layer} onLayerPatch={onLayerPatch} />
            ))}
          </div>
        </Section>
      )}

      {inspectorTab === "design" && layer.type === "shape" && (
        <Section title={layer.shape === "line" ? "Line" : "Shape"}>
          {layer.shape !== "line" && <div className="grid grid-cols-2 gap-2">
            <label><Lbl>Fill</Lbl><input type="color" value={layer.fill || "#F8F6F1"} onChange={(event) => onLayerPatch(layer.id, { fill: event.target.value })} className="h-10 w-full rounded-lg border border-[#303839]/15" /></label>
            <label><Lbl>Border</Lbl><input type="color" value={layer.stroke || "#303839"} onChange={(event) => onLayerPatch(layer.id, { stroke: event.target.value })} className="h-10 w-full rounded-lg border border-[#303839]/15" /></label>
            <div><Lbl>Border width</Lbl><CarouselStepper ariaLabel="Shape border width" value={layer.strokeWidth || 0} min={0} max={100} onChange={(value: number) => onLayerPatch(layer.id, { strokeWidth: value })} /></div>
            <div><Lbl>Corner radius</Lbl><CarouselStepper ariaLabel="Shape corner radius" value={layer.borderRadius || 0} min={0} max={500} onChange={(value: number) => onLayerPatch(layer.id, { borderRadius: value })} /></div>
          </div>}
          {layer.shape === "line" && <div className="grid grid-cols-2 gap-2">
            <label><Lbl>Colour</Lbl><input type="color" value={layer.stroke || "#303839"} onChange={(event) => onLayerPatch(layer.id, { stroke: event.target.value })} className="h-10 w-full rounded-lg border border-[#303839]/15" /></label>
            <div><Lbl>Thickness</Lbl><CarouselStepper ariaLabel="Line thickness" value={layer.strokeWidth || 4} min={1} max={100} onChange={(value: number) => onLayerPatch(layer.id, { strokeWidth: value })} /></div>
            <div><Lbl>Style</Lbl><Sel ariaLabel="Line style" value={layer.lineStyle || "solid"} onChange={(value: string) => onLayerPatch(layer.id, { lineStyle: value })} options={[{ value: "solid", label: "Solid" }, { value: "dashed", label: "Dashed" }, { value: "dotted", label: "Dotted" }]} /></div>
            <div><Lbl>Caps</Lbl><Sel ariaLabel="Line caps" value={layer.lineCap || "round"} onChange={(value: string) => onLayerPatch(layer.id, { lineCap: value })} options={[{ value: "butt", label: "Flat" }, { value: "round", label: "Round" }, { value: "square", label: "Square" }]} /></div>
            <div><Lbl>Start</Lbl><Sel ariaLabel="Line start cap" value={layer.lineStartCap || "none"} onChange={(value: string) => onLayerPatch(layer.id, { lineStartCap: value })} options={[{ value: "none", label: "None" }, { value: "circle", label: "Circle" }, { value: "arrow", label: "Arrow" }]} /></div>
            <div><Lbl>End</Lbl><Sel ariaLabel="Line end cap" value={layer.lineEndCap || "none"} onChange={(value: string) => onLayerPatch(layer.id, { lineEndCap: value })} options={[{ value: "none", label: "None" }, { value: "circle", label: "Circle" }, { value: "arrow", label: "Arrow" }]} /></div>
          </div>}
        </Section>
      )}

      {inspectorTab === "design" && layer.type === "element" && (
        <Section title="Element">
          <label><Lbl>Colour tint</Lbl><input type="color" value={layer.tintColor || "#303839"} onChange={(event) => onLayerPatch(layer.id, { tintColor: event.target.value })} className="h-10 w-full rounded-lg border border-[#303839]/15" /></label>
          <div className="flex gap-3"><Check checked={Boolean(layer.flipX)} onChange={(value: boolean) => onLayerPatch(layer.id, { flipX: value })} label="Flip horizontal" /><Check checked={Boolean(layer.flipY)} onChange={(value: boolean) => onLayerPatch(layer.id, { flipY: value })} label="Flip vertical" /></div>
        </Section>
      )}

      {inspectorTab === "design" && layer.type === "qrCode" && (
        <Section title="QR code">
          <label><Lbl>Destination</Lbl><Txt value={layer.value} placeholder="https://example.com" onChange={(value: string) => onLayerPatch(layer.id, { value })} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label><Lbl>Foreground</Lbl><input type="color" value={layer.foregroundColor || "#303839"} onChange={(event) => onLayerPatch(layer.id, { foregroundColor: event.target.value })} className="h-10 w-full rounded-lg border border-[#303839]/15" /></label>
            <label><Lbl>Background</Lbl><input type="color" value={layer.backgroundColor || "#ffffff"} onChange={(event) => onLayerPatch(layer.id, { backgroundColor: event.target.value })} className="h-10 w-full rounded-lg border border-[#303839]/15" /></label>
            <div><Lbl>Quiet zone</Lbl><CarouselStepper ariaLabel="QR quiet zone" value={layer.margin ?? 4} min={0} max={16} onChange={(margin: number) => onLayerPatch(layer.id, { margin })} /></div>
            <div><Lbl>Error correction</Lbl><Sel ariaLabel="QR error correction" value={layer.errorCorrection || "M"} onChange={(errorCorrection: string) => onLayerPatch(layer.id, { errorCorrection })} options={[{ value: "L", label: "Low" }, { value: "M", label: "Medium" }, { value: "Q", label: "Quartile" }, { value: "H", label: "High" }]} /></div>
          </div>
          <Check checked={Boolean(layer.required)} onChange={(required: boolean) => onLayerPatch(layer.id, { required })} label="Required and preflight checked" />
        </Section>
      )}

      {inspectorTab === "design" && layer.type === "background" && (
        <Section title="Background">
          <label><Lbl>Background colour</Lbl><input type="color" value={layer.color || "#ffffff"} onChange={(event) => onLayerPatch(layer.id, { color: event.target.value })} className="h-10 w-full rounded-lg border border-[#303839]/15" /></label>
          <ImageSrcControl layer={layer} onLayerPatch={onLayerPatch} />
          <div><Lbl>Image fit</Lbl><Sel ariaLabel="Background image fit" value={layer.fitMode || "cover"} onChange={(value: string) => onLayerPatch(layer.id, { fitMode: value })} options={[{ value: "cover", label: "Cover" }, { value: "contain", label: "Contain" }]} /></div>
        </Section>
      )}

      {inspectorTab === "advanced" && layer.type === "group" && (
        <Section title="Group behaviour" collapsible defaultOpen={false}>
          <div><Lbl>Customer selection</Lbl><Sel ariaLabel="Group customer selection" value={layer.childSelection || "children"} onChange={(value: string) => onLayerPatch(layer.id, { childSelection: value })} options={[{ value: "group", label: "Whole group" }, { value: "children", label: "Editable children" }, { value: "none", label: "Not selectable" }]} /></div>
          <Check checked={Boolean(layer.allowCustomerUngroup)} onChange={(value: boolean) => onLayerPatch(layer.id, { allowCustomerUngroup: value })} label="Allow customer to ungroup" />
        </Section>
      )}

      {inspectorTab === "settings" && (
        <Section title="Customer access" subtle>
          <Check
            checked={layer.customerEditable}
            onChange={(v: boolean) => onToggleCustomerEditable(layer.id, v)}
            label="Customer editable"
          />
          <Check checked={Boolean(layer.positionLocked)} onChange={(positionLocked: boolean) => onLayerPatch(layer.id, { positionLocked })} label="Position locked for customers" />
          <Check checked={Boolean(layer.customerInteractionDisabled)} onChange={(customerInteractionDisabled: boolean) => onLayerPatch(layer.id, { customerInteractionDisabled })} label="Customer interaction disabled" />

          {layer.customerEditable && field && (
            <div className="grid gap-2 border-t border-[#303839]/10 pt-2">
              <div><Lbl>Field label (customer sees)</Lbl><Txt value={field.label} onChange={(v: string) => onFieldPatch(layer.id, { label: v })} /></div>
              <div><Lbl>Field key</Lbl><Txt value={field.id} onChange={(v: string) => onFieldPatch(layer.id, { key: v })} /></div>
              {(() => {
                // Linked wedding fields (spec §15): e.g. the couple's names
                // repeated on Front and Back should update together. This
                // links this layer to an EXISTING field instead of renaming
                // its own - typing an existing key above only auto-suffixes
                // to avoid a collision, it can never point at another field.
                const compatible = (template?.fields || []).filter(
                  (f: any) => f.id !== field.id && (f.type === "image") === (field.type === "image"),
                );
                if (!compatible.length) return null;
                return (
                  <div>
                    <Lbl>Link to another field</Lbl>
                    <Sel
                      ariaLabel="Link to another field"
                      value=""
                      onChange={(value: string) => value && onLinkField(layer.id, value)}
                      options={[
                        { value: "", label: "— Use own field —" },
                        ...compatible.map((f: any) => ({ value: f.id, label: f.label || f.id })),
                      ]}
                    />
                    <p className="mt-1 text-[11px] leading-relaxed text-[#303839]/45">
                      Sharing a field means the customer edits it once and every linked layer updates together.
                    </p>
                  </div>
                );
              })()}
              {layer.type === "text" && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Lbl>Field type</Lbl>
                    <Sel
                      ariaLabel="Field type"
                      value={field.type}
                      onChange={(v: string) => onFieldPatch(layer.id, { type: v })}
                      options={[
                        { value: "text", label: "Single line text" },
                        { value: "textarea", label: "Multiline text" },
                        { value: "date", label: "Date" },
                        { value: "time", label: "Time" },
                        { value: "number", label: "Number" },
                        { value: "select", label: "Select menu" },
                      ]}
                    />
                  </div>
                  <div><Lbl>Max length</Lbl><Num ariaLabel="Maximum field length" value={field.maxLength || 0} min={0} onChange={(v: number) => onFieldPatch(layer.id, { maxLength: v })} /></div>
                  <div className="col-span-2"><Lbl>Placeholder</Lbl><Txt value={field.placeholder} onChange={(v: string) => onFieldPatch(layer.id, { placeholder: v })} /></div>
                  {field.type === "select" && (
                    <div className="col-span-2">
                      <Lbl>Choices (one per line)</Lbl>
                      <textarea
                        value={(field.options || []).join("\n")}
                        onChange={(e) => onFieldPatch(layer.id, { options: e.target.value.split("\n").map((s: string) => s.trim()).filter(Boolean) })}
                        className="min-h-16 w-full rounded-md border border-[#303839]/15 bg-white p-2 text-sm outline-none focus:border-[#303839]/45"
                      />
                    </div>
                  )}
                </div>
              )}
              <div><Lbl>Helper text</Lbl><Txt value={field.helpText} onChange={(v: string) => onFieldPatch(layer.id, { helpText: v })} /></div>
              <Check checked={field.required} onChange={(v: boolean) => onFieldPatch(layer.id, { required: v })} label={layer.type === "image" ? "Photo required" : "Required field"} />
            </div>
          )}
        </Section>
      )}

      {inspectorTab === "advanced" && !["image", "frame", "group"].includes(layer.type) && (
        <p className="text-xs leading-relaxed text-[#303839]/45">
          This layer type has no advanced settings. Crop defaults and filters appear here for
          images and photo areas, and grouping behaviour for groups.
        </p>
      )}
    </div>
    </div>
  );
}
