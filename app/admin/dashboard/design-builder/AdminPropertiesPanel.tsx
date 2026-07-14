"use client";

// Left properties panel of the admin studio: everything about the selected
// layer — geometry, type-specific styling, arrangement, the connected customer
// field, and the per-layer customer permission controls (Section 31). No raw
// JSON editing anywhere.

import { useRef, useState } from "react";
import { CUSTOMIZER_APPROVED_FONTS } from "@/lib/customizer";
import { getConnectedField, uploadBuilderImage } from "./builder-utils";

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
      className="h-9 w-full rounded-md border border-[#303839]/15 bg-white px-2 text-sm outline-none focus:border-[#303839]/45"
    />
  );
}
function Txt({ value, onChange, placeholder }: any) {
  return (
    <input
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-[#303839]/15 bg-white px-2 text-sm outline-none focus:border-[#303839]/45"
    />
  );
}
function Sel({ value, onChange, options, ariaLabel }: any) {
  return (
    <select
      value={value ?? ""}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-[#303839]/15 bg-white px-2 text-sm outline-none focus:border-[#303839]/45"
    >
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
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

const PERMISSION_GROUPS: Array<{ title: string; keys: Array<{ key: string; label: string; types: string[] }> }> = [
  {
    title: "Content",
    keys: [
      { key: "editContent", label: "Edit text content", types: ["text"] },
      { key: "replaceImage", label: "Replace photo", types: ["image"] },
      { key: "zoomImage", label: "Zoom photo", types: ["image"] },
      { key: "repositionImage", label: "Reposition photo", types: ["image"] },
    ],
  },
  {
    title: "Styling",
    keys: [
      { key: "changeFont", label: "Change font", types: ["text"] },
      { key: "changeFontSize", label: "Change font size", types: ["text"] },
      { key: "changeColor", label: "Change colour", types: ["text"] },
      { key: "changeAlignment", label: "Change alignment", types: ["text"] },
      { key: "changeLetterSpacing", label: "Change letter spacing", types: ["text"] },
      { key: "editStyle", label: "Bold / italic", types: ["text"] },
    ],
  },
  {
    title: "Layout",
    keys: [
      { key: "move", label: "Move", types: ["text", "image"] },
      { key: "resize", label: "Resize", types: ["text", "image"] },
      { key: "rotate", label: "Rotate", types: ["text", "image"] },
      { key: "duplicate", label: "Duplicate", types: ["text"] },
    ],
  },
];

export default function AdminPropertiesPanel({
  template,
  layer,
  onLayerPatch,
  onStylePatch,
  onFieldPatch,
  onToggleCustomerEditable,
  onPermissionsPatch,
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
  const permissions = layer.customerPermissions || {};

  return (
    <div className="grid gap-3 p-3">
      <div>
        <Lbl>Layer name</Lbl>
        <Txt value={layer.name} onChange={(v: string) => onLayerPatch(layer.id, { name: v })} />
      </div>

      <Section title="Position & size">
        <div className="grid grid-cols-2 gap-2">
          <div><Lbl>X</Lbl><Num value={layer.x} onChange={(v: number) => onLayerPatch(layer.id, { x: v })} /></div>
          <div><Lbl>Y</Lbl><Num value={layer.y} onChange={(v: number) => onLayerPatch(layer.id, { y: v })} /></div>
          <div><Lbl>Width</Lbl><Num value={layer.width} onChange={(v: number) => onLayerPatch(layer.id, { width: v })} /></div>
          <div><Lbl>Height</Lbl><Num value={layer.height} onChange={(v: number) => onLayerPatch(layer.id, { height: v })} /></div>
          <div><Lbl>Rotation °</Lbl><Num value={layer.rotation} onChange={(v: number) => onLayerPatch(layer.id, { rotation: v })} /></div>
          <div>
            <Lbl>Opacity %</Lbl>
            <Num value={Math.round((layer.opacity ?? 1) * 100)} min={0} max={100} onChange={(v: number) => onLayerPatch(layer.id, { opacity: Math.min(1, Math.max(0, v / 100)) })} />
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
              <Lbl>Font family</Lbl>
              <Sel
                ariaLabel="Font family"
                value={style.fontFamily || "Cormorant Garamond"}
                onChange={(v: string) => onStylePatch(layer.id, { fontFamily: v })}
                options={CUSTOMIZER_APPROVED_FONTS.map((f) => ({ value: f.value, label: f.label }))}
              />
            </div>
            <div><Lbl>Font size</Lbl><Num value={style.fontSize} onChange={(v: number) => onStylePatch(layer.id, { fontSize: v })} /></div>
            <div>
              <Lbl>Weight</Lbl>
              <Sel
                ariaLabel="Font weight"
                value={style.fontWeight || "400"}
                onChange={(v: string) => onStylePatch(layer.id, { fontWeight: v })}
                options={[
                  { value: "300", label: "Light" },
                  { value: "400", label: "Regular" },
                  { value: "500", label: "Medium" },
                  { value: "600", label: "Semibold" },
                  { value: "700", label: "Bold" },
                ]}
              />
            </div>
            <div><Lbl>Colour</Lbl><input type="color" aria-label="Text colour" value={style.color || "#303839"} onChange={(e) => onStylePatch(layer.id, { color: e.target.value })} className="h-9 w-full rounded-md border border-[#303839]/15" /></div>
            <div><Lbl>Letter spacing</Lbl><Num value={style.letterSpacing} onChange={(v: number) => onStylePatch(layer.id, { letterSpacing: v })} /></div>
            <div><Lbl>Line height</Lbl><Num value={style.lineHeight} step={0.05} onChange={(v: number) => onStylePatch(layer.id, { lineHeight: v })} /></div>
            <div>
              <Lbl>Align</Lbl>
              <Sel ariaLabel="Text alignment" value={style.textAlign} onChange={(v: string) => onStylePatch(layer.id, { textAlign: v })} options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }]} />
            </div>
            <div>
              <Lbl>Italic</Lbl>
              <Sel ariaLabel="Font style" value={style.fontStyle || "normal"} onChange={(v: string) => onStylePatch(layer.id, { fontStyle: v })} options={[{ value: "normal", label: "Normal" }, { value: "italic", label: "Italic" }]} />
            </div>
          </div>
          <div className="flex gap-3">
            <Check checked={style.uppercase} onChange={(v: boolean) => onStylePatch(layer.id, { uppercase: v })} label="Uppercase" />
            <Check checked={style.multiline} onChange={(v: boolean) => onStylePatch(layer.id, { multiline: v })} label="Multiline" />
          </div>
        </Section>
      )}

      {layer.type === "image" && (
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
                  { value: "circle", label: "Circle / oval" },
                  { value: "arch", label: "Arch" },
                ]}
              />
            </div>
            <div>
              <Lbl>Image fit</Lbl>
              <Sel ariaLabel="Image fit" value={layer.fitMode} onChange={(v: string) => onLayerPatch(layer.id, { fitMode: v })} options={[{ value: "cover", label: "Cover (fill)" }, { value: "contain", label: "Contain (fit)" }]} />
            </div>
          </div>
        </Section>
      )}

      {layer.type === "shape" && (
        <Section title="Shape">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Lbl>Shape</Lbl>
              <Sel ariaLabel="Shape kind" value={layer.shape} onChange={(v: string) => onLayerPatch(layer.id, { shape: v })} options={[{ value: "rectangle", label: "Rectangle" }, { value: "ellipse", label: "Circle / ellipse" }, { value: "line", label: "Line" }]} />
            </div>
            <div><Lbl>Fill</Lbl><input type="color" aria-label="Fill colour" value={layer.fill || "#F4ECEC"} onChange={(e) => onLayerPatch(layer.id, { fill: e.target.value })} className="h-9 w-full rounded-md border border-[#303839]/15" /></div>
            <div><Lbl>Border colour</Lbl><input type="color" aria-label="Border colour" value={layer.stroke || "#303839"} onChange={(e) => onLayerPatch(layer.id, { stroke: e.target.value })} className="h-9 w-full rounded-md border border-[#303839]/15" /></div>
            <div><Lbl>Border width</Lbl><Num value={layer.strokeWidth} onChange={(v: number) => onLayerPatch(layer.id, { strokeWidth: v })} /></div>
            <div><Lbl>Corner radius</Lbl><Num value={layer.borderRadius} onChange={(v: number) => onLayerPatch(layer.id, { borderRadius: v })} /></div>
          </div>
        </Section>
      )}

      {layer.type !== "shape" && (
        <Section title="Customer editing" subtle>
          <Check
            checked={layer.customerEditable}
            onChange={(v: boolean) => onToggleCustomerEditable(layer.id, v)}
            label={layer.type === "image" ? "Customer can replace this photo" : "Customer can edit this text"}
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

              <div className="border-t border-[#303839]/10 pt-2">
                <Lbl>Customer permissions</Lbl>
                <div className="grid gap-2">
                  {PERMISSION_GROUPS.map((group) => {
                    const keys = group.keys.filter((entry) => entry.types.includes(layer.type));
                    if (!keys.length) return null;
                    return (
                      <div key={group.title}>
                        <p className="mb-1 text-[10px] font-bold text-[#303839]/45">{group.title}</p>
                        <div className="grid grid-cols-2 gap-1.5">
                          {keys.map((entry) => (
                            <Check
                              key={entry.key}
                              checked={permissions[entry.key]}
                              onChange={(v: boolean) => onPermissionsPatch(layer.id, { [entry.key]: v })}
                              label={entry.label}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
