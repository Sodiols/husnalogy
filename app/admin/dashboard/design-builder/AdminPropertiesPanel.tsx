"use client";

// Left properties panel of the admin studio: everything about the selected
// layer — geometry, type-specific styling, arrangement, the connected customer
// field, and the single customer-editable control (Section 31). No raw
// JSON editing anywhere.

import { useRef, useState } from "react";
import { getConnectedField, uploadBuilderImage } from "./builder-utils";
import { customerEditablePermissionBundle } from "@/lib/customizer";

const controlClass = "h-10 w-full rounded-lg border border-[#303839]/15 bg-white px-3 text-sm text-[#303839] shadow-sm outline-none transition focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20";

function Lbl({ children }: any) {
  return <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[#303839]/55">{children}</span>;
}
function Num({ value, onChange, min, max, step }: any) {
  return (
    <input
      type="number"
      value={value ?? 0}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      className={controlClass}
    />
  );
}
function CarouselStepper({ value, onChange, min = -Infinity, max = Infinity, step = 1, ariaLabel }: any) {
  const numeric = Number(value) || 0;
  const update = (direction: number) => {
    const next = Math.min(max, Math.max(min, numeric + direction * step));
    onChange(Number(next.toFixed(step < 1 ? 2 : 0)));
  };

  return (
    <div role="group" aria-label={ariaLabel} className="grid h-10 w-full grid-cols-[34px_minmax(0,1fr)_34px] items-center overflow-hidden rounded-lg border border-[#303839]/15 bg-white shadow-sm">
      <button type="button" aria-label={`Decrease ${ariaLabel}`} disabled={numeric <= min} onClick={() => update(-1)} className="grid h-full place-items-center border-r border-[#303839]/10 text-[#303839]/55 transition hover:bg-[#F8F6F1] hover:text-[#303839] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#D4AF37] disabled:opacity-25">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
      </button>
      <output className="min-w-0 truncate px-1 text-center text-xs font-extrabold tabular-nums text-[#303839]">{step < 1 ? numeric.toFixed(2).replace(/0+$/, "").replace(/\.$/, "") : Math.round(numeric)}</output>
      <button type="button" aria-label={`Increase ${ariaLabel}`} disabled={numeric >= max} onClick={() => update(1)} className="grid h-full place-items-center border-l border-[#303839]/10 text-[#303839]/55 transition hover:bg-[#F8F6F1] hover:text-[#303839] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#D4AF37] disabled:opacity-25">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 18 6-6-6-6" /></svg>
      </button>
    </div>
  );
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
    <label className="flex items-center gap-2 text-xs font-bold text-[#303839]/75">
      <input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[#303839]" />
      {label}
    </label>
  );
}
function Section({ title, children, subtle = false }: any) {
  return (
    <section className={`rounded-lg p-3 ${subtle ? "bg-[#F8F6F1]" : "border border-[#303839]/10"}`}>
      <h4 className="mb-2.5 text-[11px] font-extrabold uppercase tracking-wide text-[#303839]/70">{title}</h4>
      <div className="grid gap-2.5">{children}</div>
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
      const url = await uploadBuilderImage(file);
      if (url) onLayerPatch(layer.id, { src: url });
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
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setBusy(true);
        try {
          const url = await uploadBuilderImage(file);
          if (url) patchSlot({ src: url, assetId: url });
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
      const url = await uploadBuilderImage(file);
      if (url) onLayerPatch(layer.id, { placeholderImage: url });
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
          <button type="button" onClick={() => onLayerPatch(layer.id, { placeholderImage: "" })} className="rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50">
            Clear
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="sr-only" onChange={(e) => { handle(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}

export default function AdminPropertiesPanel({
  template,
  layer,
  onLayerPatch,
  onStylePatch,
  onFieldPatch,
  onToggleCustomerEditable,
  onDuplicate,
  onRemove,
  onReorder,
  onBringToFront,
  onSendToBack,
}: any) {
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
    <div className="grid gap-3 p-3">
      <div>
        <Lbl>Layer name</Lbl>
        <Txt value={layer.name} onChange={(v: string) => onLayerPatch(layer.id, { name: v })} />
      </div>

      <Section title="Position & size">
        <div className="grid grid-cols-2 gap-2">
          <div><Lbl>X</Lbl><CarouselStepper ariaLabel="X position" value={layer.x} step={10} onChange={(v: number) => onLayerPatch(layer.id, { x: v })} /></div>
          <div><Lbl>Y</Lbl><CarouselStepper ariaLabel="Y position" value={layer.y} step={10} onChange={(v: number) => onLayerPatch(layer.id, { y: v })} /></div>
          <div><Lbl>Width</Lbl><CarouselStepper ariaLabel="Width" value={layer.width} min={10} step={10} onChange={(v: number) => onLayerPatch(layer.id, { width: v })} /></div>
          <div><Lbl>Height</Lbl><CarouselStepper ariaLabel="Height" value={layer.height} min={10} step={10} onChange={(v: number) => onLayerPatch(layer.id, { height: v })} /></div>
          <div><Lbl>Rotation °</Lbl><CarouselStepper ariaLabel="Rotation" value={layer.rotation} min={-360} max={360} onChange={(v: number) => onLayerPatch(layer.id, { rotation: v })} /></div>
          <div>
            <Lbl>Opacity %</Lbl>
            <CarouselStepper ariaLabel="Opacity" value={Math.round((layer.opacity ?? 1) * 100)} min={0} max={100} step={5} onChange={(v: number) => onLayerPatch(layer.id, { opacity: Math.min(1, Math.max(0, v / 100)) })} />
          </div>
        </div>
        <div className="flex flex-wrap gap-3 pt-1">
          <Check checked={layer.locked} onChange={(v: boolean) => onLayerPatch(layer.id, { locked: v })} label="Lock" />
          <Check checked={layer.hidden} onChange={(v: boolean) => onLayerPatch(layer.id, { hidden: v })} label="Hide" />
        </div>
      </Section>

      <Section title="Arrange">
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" onClick={() => onBringToFront(layer.id)} className="rounded-md border border-[#303839]/15 px-2 py-1.5 text-[11px] font-bold hover:bg-[#F8F6F1]">Bring to Front</button>
          <button type="button" onClick={() => onSendToBack(layer.id)} className="rounded-md border border-[#303839]/15 px-2 py-1.5 text-[11px] font-bold hover:bg-[#F8F6F1]">Send to Back</button>
          <button type="button" onClick={() => onReorder(layer.id, "up")} className="rounded-md border border-[#303839]/15 px-2 py-1.5 text-[11px] font-bold hover:bg-[#F8F6F1]">Bring Forward</button>
          <button type="button" onClick={() => onReorder(layer.id, "down")} className="rounded-md border border-[#303839]/15 px-2 py-1.5 text-[11px] font-bold hover:bg-[#F8F6F1]">Send Backward</button>
        </div>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => onDuplicate(layer.id)} className="flex-1 rounded-md border border-[#303839]/15 px-2 py-1.5 text-[11px] font-bold hover:bg-[#F8F6F1]">Duplicate</button>
          <button type="button" onClick={() => onRemove(layer.id)} className="flex-1 rounded-md border border-red-200 px-2 py-1.5 text-[11px] font-bold text-red-700 hover:bg-red-50">Delete</button>
        </div>
      </Section>

      {layer.type === "text" && (
        <Section title="Text">
          <div>
            <Lbl>Text content</Lbl>
            <textarea
              value={layer.text || ""}
              onChange={(e) => onLayerPatch(layer.id, { text: e.target.value })}
              className="min-h-16 w-full rounded-md border border-[#303839]/15 bg-white p-2 text-sm outline-none focus:border-[#303839]/45"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Lbl>Fit mode</Lbl>
              <Sel
                ariaLabel="Text fit mode"
                value={style.fitMode || "fixed"}
                onChange={(v: string) => onStylePatch(layer.id, { fitMode: v })}
                options={[
                  { value: "fixed", label: "Fixed size" },
                  { value: "shrink", label: "Shrink to fit" },
                ]}
              />
            </div>
            {style.fitMode === "shrink" && (
              <div>
                <Lbl>Min font size</Lbl>
                <Num value={style.minFontSize || Math.max(8, Math.round((style.fontSize || 48) * 0.4))} min={4} onChange={(v: number) => onStylePatch(layer.id, { minFontSize: Math.max(4, v) })} />
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <Check checked={style.uppercase} onChange={(v: boolean) => onStylePatch(layer.id, { uppercase: v })} label="Uppercase" />
            <Check checked={style.multiline} onChange={(v: boolean) => onStylePatch(layer.id, { multiline: v })} label="Multiline (wraps in box)" />
          </div>
        </Section>
      )}

      {(layer.type === "image" || layer.type === "frame") && (
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
              <Num value={layer.borderWidth || 0} min={0} max={200} onChange={(v: number) => onLayerPatch(layer.id, { borderWidth: Math.max(0, v) })} />
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

      {layer.type === "grid" && (
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

      {layer.type === "shape" && (
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
          </div>}
        </Section>
      )}

      {layer.type === "element" && (
        <Section title="Element">
          <label><Lbl>Colour tint</Lbl><input type="color" value={layer.tintColor || "#303839"} onChange={(event) => onLayerPatch(layer.id, { tintColor: event.target.value })} className="h-10 w-full rounded-lg border border-[#303839]/15" /></label>
          <div className="flex gap-3"><Check checked={Boolean(layer.flipX)} onChange={(value: boolean) => onLayerPatch(layer.id, { flipX: value })} label="Flip horizontal" /><Check checked={Boolean(layer.flipY)} onChange={(value: boolean) => onLayerPatch(layer.id, { flipY: value })} label="Flip vertical" /></div>
        </Section>
      )}

      {layer.type === "background" && (
        <Section title="Background">
          <label><Lbl>Background colour</Lbl><input type="color" value={layer.color || "#ffffff"} onChange={(event) => onLayerPatch(layer.id, { color: event.target.value })} className="h-10 w-full rounded-lg border border-[#303839]/15" /></label>
          <ImageSrcControl layer={layer} onLayerPatch={onLayerPatch} />
          <div><Lbl>Image fit</Lbl><Sel ariaLabel="Background image fit" value={layer.fitMode || "cover"} onChange={(value: string) => onLayerPatch(layer.id, { fitMode: value })} options={[{ value: "cover", label: "Cover" }, { value: "contain", label: "Contain" }]} /></div>
        </Section>
      )}

      {layer.type === "group" && (
        <Section title="Group behaviour">
          <div><Lbl>Customer selection</Lbl><Sel ariaLabel="Group customer selection" value={layer.childSelection || "children"} onChange={(value: string) => onLayerPatch(layer.id, { childSelection: value })} options={[{ value: "group", label: "Whole group" }, { value: "children", label: "Editable children" }, { value: "none", label: "Not selectable" }]} /></div>
          <Check checked={Boolean(layer.allowCustomerUngroup)} onChange={(value: boolean) => onLayerPatch(layer.id, { allowCustomerUngroup: value })} label="Allow customer to ungroup" />
        </Section>
      )}

      {(
        <Section title="Customer access" subtle>
          <Check
            checked={layer.customerEditable}
            onChange={(v: boolean) => onToggleCustomerEditable(layer.id, v)}
            label="Customer editable"
          />

          {layer.customerEditable && field && (
            <div className="grid gap-2 border-t border-[#303839]/10 pt-2">
              <div><Lbl>Field label (customer sees)</Lbl><Txt value={field.label} onChange={(v: string) => onFieldPatch(layer.id, { label: v })} /></div>
              <div><Lbl>Field key</Lbl><Txt value={field.id} onChange={(v: string) => onFieldPatch(layer.id, { key: v })} /></div>
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
                  <div><Lbl>Max length</Lbl><Num value={field.maxLength || 0} onChange={(v: number) => onFieldPatch(layer.id, { maxLength: v })} /></div>
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
    </div>
  );
}
