"use client";

// Right panel of the Design Builder: settings for the selected layer (including
// the two independent controls — admin-editable and customer-editable — plus the
// connected field's label/key/required/max length) and the page's layer list.

import { useRef, useState } from "react";
import { getConnectedField, layersForPage, uploadBuilderImage } from "./builder-utils";

function Lbl({ children }: any) {
  return <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[#111111]/55">{children}</span>;
}
function Num({ value, onChange }: any) {
  return (
    <input
      type="number"
      value={value ?? 0}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      className="h-9 w-full border border-[#111111]/15 bg-white px-2 text-sm outline-none focus:border-[#111111]/45"
    />
  );
}
function Txt({ value, onChange, placeholder }: any) {
  return (
    <input
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full border border-[#111111]/15 bg-white px-2 text-sm outline-none focus:border-[#111111]/45"
    />
  );
}
function Sel({ value, onChange, options }: any) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="h-9 w-full border border-[#111111]/15 bg-white px-2 text-sm outline-none focus:border-[#111111]/45">
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
function Check({ checked, onChange, label }: any) {
  return (
    <label className="flex items-center gap-2 text-xs font-bold text-[#111111]/75">
      <input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[#111111]" />
      {label}
    </label>
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
        {layer.src ? <img src={layer.src} alt="" className="h-10 w-10 border border-[#111111]/10 object-cover" /> : null}
        <button type="button" onClick={() => inputRef.current?.click()} className="border border-[#111111]/15 bg-white px-2 py-1.5 text-xs font-bold hover:bg-[#F8F8F8]">
          {busy ? "Uploading…" : layer.src ? "Replace" : "Upload"}
        </button>
        {layer.src && (
          <button type="button" onClick={() => onLayerPatch(layer.id, { src: "" })} className="border border-red-200 bg-white px-2 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50">
            Clear
          </button>
        )}
      </div>
      <p className="mt-1 text-[10px] text-[#111111]/45">Leave empty for a customer photo placeholder.</p>
      <input ref={inputRef} type="file" accept="image/*" className="sr-only" onChange={(e) => { handle(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}

export default function AdminLayerPanel({
  template,
  pageId,
  selectedLayerId,
  onSelect,
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
  const layers = layersForPage(template, pageId).slice().reverse(); // top layer first
  const layer = (template.layers || []).find((l: any) => l.id === selectedLayerId) || null;
  const field = layer ? getConnectedField(template, layer) : null;
  const style = layer?.textStyle || {};

  return (
    <div className="flex h-full flex-col">
      {/* Selected layer settings */}
      <div className="flex-1 overflow-y-auto p-3">
        {!layer ? (
          <p className="mt-8 text-center text-sm text-[#111111]/50">Select a layer to edit its settings.</p>
        ) : (
          <div className="grid gap-4">
            <div>
              <Lbl>Layer name</Lbl>
              <Txt value={layer.name} onChange={(v: string) => onLayerPatch(layer.id, { name: v })} />
            </div>

            <div>
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[#111111]/55">Arrange</span>
              <div className="grid grid-cols-2 gap-1.5">
                <button type="button" onClick={() => onBringToFront(layer.id)} className="border border-[#111111]/15 px-2 py-1 text-[11px] font-bold hover:bg-[#F8F8F8]">Bring to Front</button>
                <button type="button" onClick={() => onSendToBack(layer.id)} className="border border-[#111111]/15 px-2 py-1 text-[11px] font-bold hover:bg-[#F8F8F8]">Send to Back</button>
                <button type="button" onClick={() => onReorder(layer.id, "up")} className="border border-[#111111]/15 px-2 py-1 text-[11px] font-bold hover:bg-[#F8F8F8]">Bring Forward</button>
                <button type="button" onClick={() => onReorder(layer.id, "down")} className="border border-[#111111]/15 px-2 py-1 text-[11px] font-bold hover:bg-[#F8F8F8]">Send Backward</button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => onDuplicate(layer.id)} className="border border-[#111111]/15 px-2 py-1 text-[11px] font-bold hover:bg-[#F8F8F8]">Duplicate</button>
              <button type="button" onClick={() => onRemove(layer.id)} className="border border-red-200 px-2 py-1 text-[11px] font-bold text-red-700 hover:bg-red-50">Delete</button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div><Lbl>X</Lbl><Num value={layer.x} onChange={(v: number) => onLayerPatch(layer.id, { x: v })} /></div>
              <div><Lbl>Y</Lbl><Num value={layer.y} onChange={(v: number) => onLayerPatch(layer.id, { y: v })} /></div>
              <div><Lbl>Width</Lbl><Num value={layer.width} onChange={(v: number) => onLayerPatch(layer.id, { width: v })} /></div>
              <div><Lbl>Height</Lbl><Num value={layer.height} onChange={(v: number) => onLayerPatch(layer.id, { height: v })} /></div>
              <div><Lbl>Rotation</Lbl><Num value={layer.rotation} onChange={(v: number) => onLayerPatch(layer.id, { rotation: v })} /></div>
              <div>
                <Lbl>Opacity %</Lbl>
                <Num value={Math.round((layer.opacity ?? 1) * 100)} onChange={(v: number) => onLayerPatch(layer.id, { opacity: Math.min(1, Math.max(0, v / 100)) })} />
              </div>
            </div>

            <div className="flex flex-wrap gap-3 border-y border-[#111111]/10 py-2">
              <Check checked={layer.locked} onChange={(v: boolean) => onLayerPatch(layer.id, { locked: v })} label="Lock" />
              <Check checked={layer.hidden} onChange={(v: boolean) => onLayerPatch(layer.id, { hidden: v })} label="Hide" />
            </div>

            {layer.type === "text" && (
              <div className="grid gap-2">
                <div>
                  <Lbl>Text content</Lbl>
                  <textarea value={layer.text || ""} onChange={(e) => onLayerPatch(layer.id, { text: e.target.value })} className="min-h-16 w-full border border-[#111111]/15 bg-white p-2 text-sm outline-none focus:border-[#111111]/45" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Lbl>Font family</Lbl><Txt value={style.fontFamily} onChange={(v: string) => onStylePatch(layer.id, { fontFamily: v })} /></div>
                  <div><Lbl>Font size</Lbl><Num value={style.fontSize} onChange={(v: number) => onStylePatch(layer.id, { fontSize: v })} /></div>
                  <div><Lbl>Weight</Lbl><Txt value={style.fontWeight} onChange={(v: string) => onStylePatch(layer.id, { fontWeight: v })} /></div>
                  <div><Lbl>Color</Lbl><input type="color" value={style.color || "#111111"} onChange={(e) => onStylePatch(layer.id, { color: e.target.value })} className="h-9 w-full border border-[#111111]/15" /></div>
                  <div><Lbl>Letter spacing</Lbl><Num value={style.letterSpacing} onChange={(v: number) => onStylePatch(layer.id, { letterSpacing: v })} /></div>
                  <div><Lbl>Line height</Lbl><Num value={style.lineHeight} onChange={(v: number) => onStylePatch(layer.id, { lineHeight: v })} /></div>
                  <div><Lbl>Align</Lbl><Sel value={style.textAlign} onChange={(v: string) => onStylePatch(layer.id, { textAlign: v })} options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }]} /></div>
                </div>
                <div className="flex gap-3">
                  <Check checked={style.uppercase} onChange={(v: boolean) => onStylePatch(layer.id, { uppercase: v })} label="Uppercase" />
                  <Check checked={style.multiline} onChange={(v: boolean) => onStylePatch(layer.id, { multiline: v })} label="Multiline" />
                </div>
              </div>
            )}

            {layer.type === "image" && (
              <div className="grid gap-2">
                <ImageSrcControl layer={layer} onLayerPatch={onLayerPatch} />
                <div className="grid grid-cols-2 gap-2">
                  <div><Lbl>Mask</Lbl><Sel value={layer.maskShape} onChange={(v: string) => onLayerPatch(layer.id, { maskShape: v })} options={[{ value: "rectangle", label: "Rectangle" }, { value: "rounded", label: "Rounded" }, { value: "circle", label: "Circle" }, { value: "arch", label: "Arch" }]} /></div>
                  <div><Lbl>Fit</Lbl><Sel value={layer.fitMode} onChange={(v: string) => onLayerPatch(layer.id, { fitMode: v })} options={[{ value: "cover", label: "Cover" }, { value: "contain", label: "Contain" }]} /></div>
                </div>
                <div className="flex gap-3">
                  <Check checked={layer.allowZoom !== false} onChange={(v: boolean) => onLayerPatch(layer.id, { allowZoom: v })} label="Allow zoom" />
                  <Check checked={layer.allowReposition !== false} onChange={(v: boolean) => onLayerPatch(layer.id, { allowReposition: v })} label="Allow reposition" />
                </div>
              </div>
            )}

            {layer.type === "shape" && (
              <div className="grid grid-cols-2 gap-2">
                <div><Lbl>Shape</Lbl><Sel value={layer.shape} onChange={(v: string) => onLayerPatch(layer.id, { shape: v })} options={[{ value: "rectangle", label: "Rectangle" }, { value: "ellipse", label: "Ellipse" }, { value: "line", label: "Line" }]} /></div>
                <div><Lbl>Fill</Lbl><input type="color" value={layer.fill || "#F8F8F8"} onChange={(e) => onLayerPatch(layer.id, { fill: e.target.value })} className="h-9 w-full border border-[#111111]/15" /></div>
                <div><Lbl>Stroke</Lbl><input type="color" value={layer.stroke || "#111111"} onChange={(e) => onLayerPatch(layer.id, { stroke: e.target.value })} className="h-9 w-full border border-[#111111]/15" /></div>
                <div><Lbl>Stroke width</Lbl><Num value={layer.strokeWidth} onChange={(v: number) => onLayerPatch(layer.id, { strokeWidth: v })} /></div>
                <div><Lbl>Corner radius</Lbl><Num value={layer.borderRadius} onChange={(v: number) => onLayerPatch(layer.id, { borderRadius: v })} /></div>
              </div>
            )}

            {/* The two-controls model */}
            {layer.type !== "shape" && (
              <div className="border border-[#111111]/12 bg-[#F8F8F8] p-3">
                <Check
                  checked={layer.customerEditable}
                  onChange={(v: boolean) => onToggleCustomerEditable(layer.id, v)}
                  label="Make customer editable"
                />
                {layer.customerEditable && field && (
                  <div className="mt-3 grid gap-2">
                    <div><Lbl>Field label (customer sees)</Lbl><Txt value={field.label} onChange={(v: string) => onFieldPatch(layer.id, { label: v })} /></div>
                    <div><Lbl>Field key</Lbl><Txt value={field.id} onChange={(v: string) => onFieldPatch(layer.id, { key: v })} /></div>
                    {layer.type === "text" && (
                      <div className="grid grid-cols-2 gap-2">
                        <div><Lbl>Max length</Lbl><Num value={field.maxLength || 0} onChange={(v: number) => onFieldPatch(layer.id, { maxLength: v })} /></div>
                        <div className="flex items-end"><Check checked={field.required} onChange={(v: boolean) => onFieldPatch(layer.id, { required: v })} label="Required" /></div>
                        <div className="col-span-2"><Lbl>Placeholder</Lbl><Txt value={field.placeholder} onChange={(v: string) => onFieldPatch(layer.id, { placeholder: v })} /></div>
                      </div>
                    )}
                    {layer.type === "image" && (
                      <div className="flex items-end"><Check checked={field.required} onChange={(v: boolean) => onFieldPatch(layer.id, { required: v })} label="Required photo" /></div>
                    )}
                    <div><Lbl>Help text</Lbl><Txt value={field.helpText} onChange={(v: string) => onFieldPatch(layer.id, { helpText: v })} /></div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Layer list */}
      <div className="max-h-56 shrink-0 overflow-y-auto border-t border-[#111111]/10 bg-white p-2">
        <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-wide text-[#111111]/55">Layers</p>
        <div className="grid gap-1">
          {layers.map((l: any) => (
            <button
              key={l.id}
              type="button"
              onClick={() => onSelect(l.id)}
              className={`flex items-center justify-between gap-2 border px-2 py-1.5 text-left text-xs transition ${
                l.id === selectedLayerId ? "border-[#111111] bg-[#111111] text-white" : "border-[#111111]/12 bg-white text-[#111111] hover:bg-[#F8F8F8]"
              }`}
            >
              <span className="flex items-center gap-1.5 truncate">
                <span className="opacity-60">{l.type === "text" ? "T" : l.type === "image" ? "▣" : "◆"}</span>
                <span className="truncate">{l.name}</span>
                {l.customerEditable && <span className="rounded-sm bg-[#BDBDBD] px-1 text-[9px] font-bold text-[#111111]">EDIT</span>}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {l.hidden && <span className="opacity-60">hidden</span>}
                {l.locked && <span className="opacity-60">🔒</span>}
              </span>
            </button>
          ))}
          {!layers.length && <p className="px-1 py-2 text-xs text-[#111111]/50">No layers on this page yet.</p>}
        </div>
      </div>
    </div>
  );
}
