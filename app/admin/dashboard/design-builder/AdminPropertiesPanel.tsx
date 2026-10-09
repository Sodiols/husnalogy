"use client";

// The selected layer's content, styling, and customer-facing template settings.
// Transform geometry remains available on the canvas rather than in this panel.

import { FONT_SIZE_RULES } from "@/lib/customizer/v2/text-toolbar";
import { FONT_SIZE_POINT_RULES, documentPxToPoints, fontSizeBoundsInPoints, pointsToDocumentPx } from "@/lib/customizer/v2/type-units";
import PaintControl from "@/app/components/customizer/PaintControl";
import { useRef, useState } from "react";
import { getConnectedField, uploadBuilderImage, type BuilderAsset } from "./builder-utils";
import { customerEditablePermissionBundle, isFieldCompatibleWithLayer } from "@/lib/customizer";
import EditableNumericStepper from "@/app/components/customizer/EditableNumericStepper";
import { effectiveTextGrowth, getTextAutoSizeMode } from "@/lib/customizer/v2/text-layout";
import TextGrowthControl from "@/app/components/customizer/TextGrowthControl";
import {
  countTextLines,
  insertTextNewline,
  resolveTextEditorKeyAction,
  multilineTextPatch,
} from "@/lib/customizer/v2/text-editing";
import { isSvgElement } from "@/lib/customizer/v2/element-colour";
import { useFamilyCapabilities, useSelectableFamilies } from "@/app/components/customizer/useGoogleFonts";
import {
  LETTER_SPACING_RULES,
  LINE_HEIGHT_RULES,
  TEXT_TOOLBAR_DEFAULTS,
  nearestSupportedWeight,
  resolveWeightOptions,
} from "@/lib/customizer/v2/text-toolbar";

// Shared with the studio's side panels: dark text, light-grey cards, navy
// focus and actions, sentence-case labels.
const controlClass = "h-10 w-full rounded-md border border-[#303839]/20 bg-white px-3 text-[14px] text-[#1f2425] outline-none transition-colors placeholder:text-[#303839]/40 hover:border-[#303839]/35 focus:border-[#27307A] focus:ring-2 focus:ring-[#27307A]/15";
const OUTLINE_PILL = "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border-[1.5px] border-[#27307A] bg-white px-3 text-[13px] font-semibold text-[#27307A] transition-colors hover:bg-[#27307A]/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-wait disabled:opacity-50";
const HINT = "mt-1 text-[12px] leading-snug text-[#303839]/60";

/**
 * The preset the Mask shape select shows. A stored mask object is what every
 * renderer draws, so it wins over the legacy name; a clipping mask's polygon
 * has no preset and shows as "custom".
 */
function maskSelectValue(layer: any): string {
  const kind = layer?.mask && typeof layer.mask === "object" ? String(layer.mask.kind || "") : "";
  if (!kind) return layer?.maskShape || "rectangle";
  if (kind === "polygon" || kind === "path") return "custom";
  if (kind === "arch") return "arch-full";
  if (kind === "arch-top") return "arch";
  return kind;
}

function Lbl({ children }: any) {
  return <span className="mb-1 block text-[12.5px] font-semibold text-[#1f2425]">{children}</span>;
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
function toHex(value: unknown): string | null {
  const match = HEX.exec(String(value ?? "").trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? match[1].split("").map((digit) => digit + digit).join("") : match[1];
  return `#${digits.toLowerCase()}`;
}

/**
 * A colour: a round swatch that opens the system picker (a real colour input
 * sits on it) and the hex value, typed and applied on Enter or blur.
 */
function ColourField({ value, fallback, onChange, ariaLabel, extra }: { value: unknown; fallback: string; onChange: (hex: string) => void; ariaLabel: string; extra?: React.ReactNode }) {
  const current = toHex(value) || fallback;
  const [draft, setDraft] = useState(current.toUpperCase());
  const [shown, setShown] = useState(current);
  if (shown !== current) {
    setShown(current);
    setDraft(current.toUpperCase());
  }
  const apply = () => {
    const hex = toHex(draft);
    if (hex && hex !== current) onChange(hex);
    else setDraft(current.toUpperCase());
  };
  return (
    <div className="flex items-center gap-2">
      <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-[#303839]/20" style={{ backgroundColor: current }}>
        <input
          type="color"
          aria-label={ariaLabel}
          value={current}
          onChange={(event) => onChange(event.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </span>
      <input
        value={draft}
        aria-label={`${ariaLabel} (hex)`}
        spellCheck={false}
        maxLength={7}
        onChange={(event) => setDraft(event.target.value.toUpperCase())}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            apply();
          }
        }}
        onBlur={apply}
        className={`${controlClass} min-w-0 flex-1 tabular-nums`}
      />
      {extra}
    </div>
  );
}
/** Spacing, line height and corner radius: up / down buttons in the field, half a unit per click. */
const SPINNER_STEP = 0.5;

function Num({ value, onChange, min, max, step = 1, ariaLabel = "Numeric value", spinner = false }: any) {
  return <EditableNumericStepper label={ariaLabel} value={Number(value) || 0} minimum={min} maximum={max} step={step} largeStep={step * 10} allowNegative={min === undefined || min < 0} allowDecimal={step < 1} showStepButtons={spinner} stepLayout="spinner" onCommit={onChange} className="h-10 w-full" inputClassName={controlClass} />;
}
/** A font size: shown and typed in points, stored in document px (type-units.ts). */
function PointSize({ px, dpi, minPx = FONT_SIZE_RULES.minimum, maxPx = FONT_SIZE_RULES.maximum, onChange, ariaLabel }: { px: number; dpi: unknown; minPx?: number; maxPx?: number; onChange: (px: number) => void; ariaLabel: string }) {
  const bounds = fontSizeBoundsInPoints({ minimum: minPx, maximum: maxPx }, dpi);
  return <EditableNumericStepper label={ariaLabel} value={documentPxToPoints(px, dpi)} minimum={bounds.minimum} maximum={bounds.maximum} step={FONT_SIZE_POINT_RULES.step} largeStep={FONT_SIZE_POINT_RULES.largeStep} allowNegative={false} allowDecimal showStepButtons={false} onCommit={(points) => onChange(pointsToDocumentPx(points, dpi))} className="h-10 w-full" inputClassName={controlClass} />;
}
function CarouselStepper({ value, onChange, min = -Infinity, max = Infinity, step = 1, ariaLabel, spinner = false }: any) {
  return <EditableNumericStepper label={ariaLabel} value={Number(value) || 0} minimum={Number.isFinite(min) ? min : undefined} maximum={Number.isFinite(max) ? max : undefined} step={step} largeStep={step < 1 ? step * 10 : Math.max(step * 5, 10)} allowNegative={!Number.isFinite(min) || min < 0} allowDecimal={step < 1} showStepButtons={spinner} stepLayout="spinner" onCommit={onChange} className="h-10 w-full" inputClassName={controlClass} />;
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
function Check({ checked, onChange, label, disabled = false }: any) {
  return (
    <label className={`flex min-h-9 items-center gap-2.5 text-[13px] text-[#1f2425] ${disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer"}`}>
      <input type="checkbox" checked={Boolean(checked)} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 shrink-0 cursor-pointer accent-[#27307A]" />
      {label}
    </label>
  );
}
/**
 * Weight, letter spacing and line height. The selection toolbar carries the
 * everyday text controls; these finer ones live here. Weights come from the
 * family's real Google Fonts cuts, so a weight the font cannot draw is never
 * offered.
 */
function TextSpacingFields({ layer, style, onStylePatch }: { layer: any; style: any; onStylePatch: (id: string, patch: any) => void }) {
  const { families } = useSelectableFamilies();
  const family = String(style.fontFamily || TEXT_TOOLBAR_DEFAULTS.fontFamily);
  const capabilities = useFamilyCapabilities(family, families);
  const weight = nearestSupportedWeight(capabilities.weights, style.fontWeight || TEXT_TOOLBAR_DEFAULTS.fontWeight);
  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-3">
      <div className="col-span-2">
        <Lbl>Weight</Lbl>
        <Sel
          ariaLabel="Font weight"
          value={weight}
          onChange={(fontWeight: string) => onStylePatch(layer.id, { fontWeight })}
          options={resolveWeightOptions(capabilities.weights).filter((option) => !option.disabled).map((option) => ({ value: option.value, label: option.label }))}
        />
      </div>
      <div>
        <Lbl>Letter spacing</Lbl>
        <Num
          ariaLabel="Letter spacing"
          value={style.letterSpacing ?? TEXT_TOOLBAR_DEFAULTS.letterSpacing}
          min={LETTER_SPACING_RULES.minimum}
          max={LETTER_SPACING_RULES.maximum}
          step={SPINNER_STEP}
          spinner
          onChange={(letterSpacing: number) => onStylePatch(layer.id, { letterSpacing })}
        />
      </div>
      <div>
        <Lbl>Line height</Lbl>
        <Num
          ariaLabel="Line height"
          value={style.lineHeight ?? TEXT_TOOLBAR_DEFAULTS.lineHeight}
          min={LINE_HEIGHT_RULES.minimum}
          max={LINE_HEIGHT_RULES.maximum}
          step={SPINNER_STEP}
          spinner
          onChange={(lineHeight: number) => onStylePatch(layer.id, { lineHeight })}
        />
      </div>
    </div>
  );
}

function Section({ title, children, subtle = false, collapsible = false, defaultOpen = true }: any) {
  const surface = subtle ? "rounded-[10px] bg-[#F2F3F5] px-3 py-3" : "";
  if (collapsible) {
    return (
      <details className={`${surface} group/section`} open={defaultOpen || undefined}>
        <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 rounded-md text-[14px] font-bold text-[#1f2425] marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A]">
          {title}
          <svg className="shrink-0 transition group-open/section:rotate-180" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
        </summary>
        <div className="mt-2.5 grid gap-3">{children}</div>
      </details>
    );
  }
  return (
    <section className={surface}>
      <h4 className="mb-2.5 text-[14px] font-bold text-[#1f2425]">{title}</h4>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function ImageSrcControl({ layer, onLayerPatch, onReplaceImage }: { layer: any; onLayerPatch: (id: string, patch: any) => void; onReplaceImage: (id: string, asset: BuilderAsset) => void }) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const handle = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const asset = await uploadBuilderImage(file, layer.type === "frame" ? "frame" : "image");
      if (asset.url) onReplaceImage(layer.id, asset);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <Lbl>Layer image (optional)</Lbl>
      <div className="flex items-center gap-2">
        {layer.src ? <img src={layer.src} alt="" className="h-10 w-10 rounded-md border border-[#303839]/10 object-cover" /> : null}
        <button type="button" onClick={() => inputRef.current?.click()} data-shape="round" className={OUTLINE_PILL}>
          {busy ? "Uploading…" : layer.src ? "Replace" : "Upload"}
        </button>
        {layer.src && (
          <button type="button" onClick={() => onLayerPatch(layer.id, { src: "" })} className="cursor-pointer text-[13px] font-semibold text-red-700 underline-offset-2 hover:underline">
            Clear
          </button>
        )}
      </div>
      <p className={HINT}>Leave empty for a customer photo placeholder.</p>
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
    <div className="grid gap-2 rounded-[10px] bg-[#F2F3F5] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-[#1f2425]">Photo {index + 1}</span>
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
        {slot.src ? <img src={slot.src} alt="" className="h-10 w-10 rounded-md border border-[#303839]/10 object-cover" /> : null}
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} data-shape="round" className={OUTLINE_PILL}>
          {busy ? "Uploading…" : slot.src ? "Replace default" : "Add default photo"}
        </button>
        {slot.src ? <button type="button" onClick={() => patchSlot({ src: "", assetId: "", bucket: undefined, path: undefined })} className="cursor-pointer px-1 text-[13px] font-semibold text-red-700 underline-offset-2 hover:underline">Clear</button> : null}
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
          <img src={layer.placeholderImage} alt="" className="h-10 w-10 rounded-md border border-[#303839]/10 object-cover" />
        ) : null}
        <button type="button" onClick={() => inputRef.current?.click()} data-shape="round" className={OUTLINE_PILL}>
          {busy ? "Uploading…" : layer.placeholderImage ? "Replace" : "Upload"}
        </button>
        {layer.placeholderImage && (
          <button type="button" onClick={() => onLayerPatch(layer.id, { placeholderImage: "", placeholderAssetId: "", placeholderAssetPath: "", placeholderAssetBucket: "", placeholderAssetEditorPath: "", placeholderAssetThumbnailPath: "" })} className="cursor-pointer text-[13px] font-semibold text-red-700 underline-offset-2 hover:underline">
            Clear
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="sr-only" onChange={(e) => { handle(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}

/**
 * Layer opacity — admin side.
 *
 * Uses the document's existing `opacity` property, the same one the customer
 * panel and the SVG renderer read, so there is one opacity in the system rather
 * than two. Absent means fully opaque, which is why a missing value reads as
 * 100 rather than 0.
 *
 * Slider plus exact value, both from the shared numeric control: dragging
 * streams a live preview and commits once, so a drag is one history step.
 */
function OpacityField({ layer, onLayerPatch }: any) {
  const raw = Number(layer?.opacity);
  const percent = Math.round((Number.isFinite(raw) ? raw : 1) * 100);
  return (
    <div className="grid gap-1.5">
      <Lbl>Opacity</Lbl>
      <EditableNumericStepper
        slider
        label="Layer opacity"
        value={percent}
        minimum={0}
        maximum={100}
        step={1}
        largeStep={10}
        formatValue={(next: number) => `${Math.round(next)}%`}
        onPreviewChange={(value: number) => onLayerPatch(layer.id, { opacity: value / 100 })}
        onCommit={(value: number) => onLayerPatch(layer.id, { opacity: value / 100 })}
        showStepButtons={false}
        className="flex h-10 w-full items-center gap-3"
        sliderClassName="h-10 min-w-0 flex-1 cursor-pointer accent-[#27307A] disabled:opacity-35"
        inputClassName={`${controlClass} w-[76px] shrink-0 text-center tabular-nums`}
      />
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
  onUnlinkField,
  onToggleCustomerEditable,
  onReplaceImage,
}: any) {
  // Declared before the early return so the hook order stays stable.
  const [inspectorTab, setInspectorTab] = useState("design");

  if (!layer) {
    return (
      <div className="grid justify-items-center gap-2 px-6 py-12 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-[#F2F3F5] text-[#303839]/55" aria-hidden>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m4 4 7 17 2.5-7.5L21 11Z" /></svg>
        </span>
        <p className="text-[15px] font-semibold text-[#1f2425]">Nothing selected</p>
        <p className="text-[13px] leading-relaxed text-[#303839]/65">Select a layer on the canvas, or add one from the tool rail.</p>
      </div>
    );
  }

  const field = getConnectedField(template, layer);
  const style = layer?.textStyle || {};

  return (
    <div data-customizer-text-interaction className="bg-white">
      {/* Inspector tabs. Purely a routing layer over the existing sections —
          every control below keeps its original handler. */}
      <div className="sticky top-0 z-10 bg-white px-4 pb-2 pt-4">
        <div role="tablist" aria-label="Inspector sections" className="flex items-center gap-0.5 rounded-full bg-[#F2F3F5] p-1">
        {INSPECTOR_TABS.map((entry) => {
          const active = inspectorTab === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              data-shape="round"
              onClick={() => setInspectorTab(entry.id)}
              aria-selected={active}
              aria-current={active ? "true" : undefined}
              className={`flex-1 cursor-pointer whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A] focus-visible:ring-offset-1 focus-visible:ring-offset-[#F2F3F5] ${
                active ? "bg-white font-semibold text-[#1f2425] shadow-[0_1px_3px_rgba(31,36,37,0.14)]" : "font-medium text-[#303839]/65 hover:text-[#1f2425]"
              }`}
            >
              {entry.label}
            </button>
          );
        })}
        </div>
      </div>

    <div className="grid gap-5 px-4 pb-6 pt-3">
      {inspectorTab === "design" && (
        <div>
          <Lbl>Layer name</Lbl>
          <Txt value={layer.name} onChange={(v: string) => onLayerPatch(layer.id, { name: v })} />
        </div>
      )}

      {/* Opacity for every visual layer type EXCEPT images, which get their own
          copy inside the photo section next to the crop controls. Admin had no
          opacity control at all before, so this is the other half of the
          customer-side control rather than a second system. */}
      {inspectorTab === "design"
        && !["image", "frame"].includes(layer.type)
        && ["text", "shape", "element", "group", "qrCode", "grid", "background"].includes(layer.type) && (
        <OpacityField layer={layer} onLayerPatch={onLayerPatch} />
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
                if (!style.multiline) onStylePatch(layer.id, multilineTextPatch(style));
              }}
              title="Enter adds a line. Ctrl/Cmd + Enter finishes editing."
              className="min-h-11 w-full resize-y rounded-md border border-[#303839]/20 bg-white p-3 text-[14px] leading-relaxed text-[#1f2425] outline-none transition-colors hover:border-[#303839]/35 focus:border-[#27307A] focus:ring-2 focus:ring-[#27307A]/15"
            />
          </div>
          <div>
            <Lbl>Font size (pt)</Lbl>
            <PointSize ariaLabel="Font size" px={Number(style.fontSize ?? 48)} dpi={template?.dpi} onChange={(fontSize) => onStylePatch(layer.id, { fontSize })} />
          </div>
          <TextSpacingFields layer={layer} style={style} onStylePatch={onStylePatch} />
          <div>
            <Lbl>Text growth</Lbl>
            <TextGrowthControl
              value={effectiveTextGrowth(style, layer.text)}
              onChange={(growthDirection) => onStylePatch(layer.id, { growthDirection })}
            />
          </div>
          <div className="grid gap-3">
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
                  { value: "safe-width", label: "Auto width, wraps at safe area" },
                  { value: "width", label: "Auto width (single line)" },
                  { value: "fixed", label: "Fixed width" },
                  { value: "height", label: "Auto height" },
                  { value: "shrink", label: "Shrink to fit" },
                ]}
              />
            </div>
            {getTextAutoSizeMode(style) === "shrink" && (
              <div>
                <Lbl>Min font size (pt)</Lbl>
                <PointSize ariaLabel="Minimum font size" px={Number(style.minFontSize || Math.max(8, Math.round((style.fontSize || 48) * 0.4)))} dpi={template?.dpi} onChange={(v) => onStylePatch(layer.id, { minFontSize: Math.max(FONT_SIZE_RULES.minimum, v) })} />
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4">
            <Check checked={style.uppercase} onChange={(v: boolean) => onStylePatch(layer.id, { uppercase: v })} label="Uppercase" />
            <Check checked={style.multiline} onChange={(v: boolean) => onStylePatch(layer.id, { multiline: v })} label="Multiline (wraps in box)" />
          </div>
        </Section>
      )}

      {inspectorTab === "design" && (layer.type === "image" || layer.type === "frame") && (
        <Section title="Image / photo area">
          <ImageSrcControl layer={layer} onLayerPatch={onLayerPatch} onReplaceImage={onReplaceImage} />
          <PlaceholderImageControl layer={layer} onLayerPatch={onLayerPatch} />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Lbl>Mask shape</Lbl>
              <Sel
                ariaLabel="Mask shape"
                value={maskSelectValue(layer)}
                // A preset replaces any stored mask object, which would otherwise
                // keep drawing over the chosen preset.
                onChange={(v: string) => v !== "custom" && onLayerPatch(layer.id, { maskShape: v, mask: undefined })}
                options={[
                  { value: "rectangle", label: "Rectangle" },
                  { value: "rounded", label: "Rounded rectangle" },
                  { value: "circle", label: "Circle" },
                  { value: "oval", label: "Oval" },
                  { value: "arch", label: "Arch (top)" },
                  { value: "arch-bottom", label: "Arch (bottom)" },
                  { value: "arch-full", label: "Arch (both ends)" },
                  ...(maskSelectValue(layer) === "custom" ? [{ value: "custom", label: "Clipping shape" }] : []),
                ]}
              />
            </div>
            <div>
              <Lbl>Image fit</Lbl>
              <Sel ariaLabel="Image fit" value={layer.fitMode} onChange={(v: string) => onLayerPatch(layer.id, { fitMode: v })} options={[{ value: "cover", label: "Cover (fill)" }, { value: "contain", label: "Contain (fit)" }]} />
            </div>
            <div>
              <Lbl>Frame border colour</Lbl>
              <ColourField ariaLabel="Frame border colour" value={layer.borderColor} fallback="#303839" onChange={(borderColor) => onLayerPatch(layer.id, { borderColor })} />
            </div>
            <div>
              <Lbl>Frame border width</Lbl>
              <Num ariaLabel="Frame border width" value={layer.borderWidth || 0} min={0} max={200} onChange={(v: number) => onLayerPatch(layer.id, { borderWidth: Math.max(0, v) })} />
            </div>
            <div className="col-span-2">
              <Lbl>Frame background</Lbl>
              <ColourField
                ariaLabel="Frame background colour"
                value={layer.backgroundColor}
                fallback="#f8f6f1"
                onChange={(backgroundColor) => onLayerPatch(layer.id, { backgroundColor })}
                extra={layer.backgroundColor ? (
                  <button type="button" data-shape="round" onClick={() => onLayerPatch(layer.id, { backgroundColor: "" })} className={`${OUTLINE_PILL} shrink-0`}>
                    Clear
                  </button>
                ) : null}
              />
            </div>
          </div>
          {/* Crop and opacity belong with the image they act on, not in a
              separate Advanced tab: you are looking at the photo when you want
              to reframe or fade it. Both write the SAME document properties as
              before — `imageTransform` and `opacity` — so existing templates and
              saved customer crops are unaffected. */}
          <Section title="Crop" collapsible defaultOpen={false}>
            <div className="grid grid-cols-2 gap-2">
              <div><Lbl>Crop zoom</Lbl><CarouselStepper ariaLabel="Image crop zoom" value={Math.round((Number(layer.imageTransform?.zoom) || 1) * 100)} min={100} max={800} step={5} onChange={(value: number) => onLayerPatch(layer.id, { imageTransform: { ...(layer.imageTransform || {}), zoom: value / 100 } })} /></div>
              <div><Lbl>Image rotation</Lbl><CarouselStepper ariaLabel="Image crop rotation" value={Number(layer.imageTransform?.rotation) || 0} min={-360} max={360} onChange={(rotation: number) => onLayerPatch(layer.id, { imageTransform: { ...(layer.imageTransform || {}), rotation } })} /></div>
              <div><Lbl>Crop X</Lbl><CarouselStepper ariaLabel="Image crop X position" value={Number(layer.imageTransform?.offsetX) || 0} min={-10000} max={10000} onChange={(offsetX: number) => onLayerPatch(layer.id, { imageTransform: { ...(layer.imageTransform || {}), offsetX } })} /></div>
              <div><Lbl>Crop Y</Lbl><CarouselStepper ariaLabel="Image crop Y position" value={Number(layer.imageTransform?.offsetY) || 0} min={-10000} max={10000} onChange={(offsetY: number) => onLayerPatch(layer.id, { imageTransform: { ...(layer.imageTransform || {}), offsetY } })} /></div>
            </div>
          </Section>
          <OpacityField layer={layer} onLayerPatch={onLayerPatch} />
        </Section>
      )}

      {inspectorTab === "design" && layer.type === "grid" && (
        <Section title="Photo grid">
          <div className="grid grid-cols-2 gap-2">
            <div><Lbl>Columns</Lbl><CarouselStepper ariaLabel="Grid columns" value={layer.columns || 2} min={1} max={12} onChange={(value: number) => onLayerPatch(layer.id, { columns: value })} /></div>
            <div><Lbl>Rows</Lbl><CarouselStepper ariaLabel="Grid rows" value={layer.rows || 2} min={1} max={12} onChange={(value: number) => onLayerPatch(layer.id, { rows: value })} /></div>
            <div><Lbl>Gap</Lbl><CarouselStepper ariaLabel="Grid gap" value={layer.gap || 0} min={0} max={200} onChange={(value: number) => onLayerPatch(layer.id, { gap: value })} /></div>
            <div><Lbl>Padding</Lbl><CarouselStepper ariaLabel="Grid padding" value={layer.padding || 0} min={0} max={300} onChange={(value: number) => onLayerPatch(layer.id, { padding: value })} /></div>
            <div><Lbl>Corner radius</Lbl><CarouselStepper ariaLabel="Grid corner radius" value={layer.cornerRadius || 0} min={0} max={500} step={SPINNER_STEP} spinner onChange={(value: number) => onLayerPatch(layer.id, { cornerRadius: value })} /></div>
            <div><Lbl>Border width</Lbl><CarouselStepper ariaLabel="Grid border width" value={layer.borderWidth || 0} min={0} max={100} onChange={(value: number) => onLayerPatch(layer.id, { borderWidth: value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2"><Lbl>Background</Lbl><ColourField ariaLabel="Grid background colour" value={layer.backgroundColor} fallback="#f8f6f1" onChange={(backgroundColor) => onLayerPatch(layer.id, { backgroundColor })} /></div>
            <div className="col-span-2"><Lbl>Border</Lbl><ColourField ariaLabel="Grid border colour" value={layer.borderColor} fallback="#303839" onChange={(borderColor) => onLayerPatch(layer.id, { borderColor })} /></div>
          </div>
          {/* Stored as explicit move/resize/rotate:false restrictions, which
              survive save and publication; photo replacement and cropping
              stay governed by the remaining permissions and the slots. */}
          <Check
            checked={layer.customerEditable && ["move", "resize", "rotate"].every((key) => layer.customerPermissions?.[key] === false)}
            disabled={!layer.customerEditable}
            onChange={(fixed: boolean) => onLayerPatch(layer.id, {
              customerPermissions: { ...(layer.customerPermissions || customerEditablePermissionBundle(true)), move: !fixed, resize: !fixed, rotate: !fixed },
            })}
            label={layer.customerEditable ? "Keep grid position fixed for customers" : "Keep grid position fixed (turn on Customer editable first)"}
          />
          <div className="grid gap-1.5 border-t border-[#303839]/10 pt-2">
            <p className="text-[13px] font-semibold text-[#1f2425]">Slots</p>
            {(layer.slots || []).map((slot: any, index: number) => (
              <GridSlotEditor key={slot.id} slot={slot} index={index} layer={layer} onLayerPatch={onLayerPatch} />
            ))}
          </div>
        </Section>
      )}

      {inspectorTab === "design" && layer.type === "shape" && (
        <Section title={layer.shape === "line" ? "Line" : "Shape"}>
          {layer.shape !== "line" && <div className="grid gap-2">
            <PaintControl label="Fill Colour" value={layer.fill} fallbackColour="#f8f6f1" onChange={(fill) => onLayerPatch(layer.id, { fill })} />
            <PaintControl label="Line Colour" value={layer.stroke} fallbackColour="#303839" onChange={(stroke) => onLayerPatch(layer.id, { stroke })} />
            <div className="grid grid-cols-2 gap-2">
              <div><Lbl>Line Weight</Lbl><CarouselStepper ariaLabel="Shape line weight" value={layer.strokeWidth || 0} min={0} max={100} onChange={(value: number) => onLayerPatch(layer.id, { strokeWidth: value })} /></div>
              <div><Lbl>Corner radius</Lbl><CarouselStepper ariaLabel="Shape corner radius" value={layer.borderRadius || 0} min={0} max={500} step={SPINNER_STEP} spinner onChange={(value: number) => onLayerPatch(layer.id, { borderRadius: value })} /></div>
            </div>
          </div>}
          {layer.shape === "line" && <PaintControl label="Line Colour" value={layer.stroke || layer.fill} fallbackColour="#303839" onChange={(stroke) => onLayerPatch(layer.id, { stroke })} />}
          {layer.shape === "line" && <div className="mt-2 grid grid-cols-2 gap-2">
            <div><Lbl>Line Weight</Lbl><CarouselStepper ariaLabel="Line weight" value={layer.strokeWidth || 4} min={1} max={100} onChange={(value: number) => onLayerPatch(layer.id, { strokeWidth: value })} /></div>
            <div><Lbl>Style</Lbl><Sel ariaLabel="Line style" value={layer.lineStyle || "solid"} onChange={(value: string) => onLayerPatch(layer.id, { lineStyle: value })} options={[{ value: "solid", label: "Solid" }, { value: "dashed", label: "Dashed" }, { value: "dotted", label: "Dotted" }]} /></div>
            <div><Lbl>Caps</Lbl><Sel ariaLabel="Line caps" value={layer.lineCap || "round"} onChange={(value: string) => onLayerPatch(layer.id, { lineCap: value })} options={[{ value: "butt", label: "Flat" }, { value: "round", label: "Round" }, { value: "square", label: "Square" }]} /></div>
            <div><Lbl>Start</Lbl><Sel ariaLabel="Line start cap" value={layer.lineStartCap || "none"} onChange={(value: string) => onLayerPatch(layer.id, { lineStartCap: value })} options={[{ value: "none", label: "None" }, { value: "circle", label: "Circle" }, { value: "arrow", label: "Arrow" }]} /></div>
            <div><Lbl>End</Lbl><Sel ariaLabel="Line end cap" value={layer.lineEndCap || "none"} onChange={(value: string) => onLayerPatch(layer.id, { lineEndCap: value })} options={[{ value: "none", label: "None" }, { value: "circle", label: "Circle" }, { value: "arrow", label: "Arrow" }]} /></div>
          </div>}
        </Section>
      )}

      {inspectorTab === "design" && layer.type === "element" && (
        <Section title="Element">
          {/* Any SVG can be recoloured (multicolour artwork becomes the chosen
              colour); Original shows the artwork's own colours. A raster image
              would turn into a solid silhouette, so — exactly as in the
              customer editor — it is offered only for SVGs, or to take an
              existing tint back to Original. */}
          {(isSvgElement(layer) || Boolean(layer.tintColor)) && (
          <div role="group" aria-label="Element colour">
            <Lbl>Colour</Lbl>
            <ColourField
              ariaLabel="Element colour"
              value={layer.tintColor}
              fallback="#303839"
              onChange={(tintColor) => onLayerPatch(layer.id, { tintColor })}
              extra={
                <button
                  type="button"
                  data-shape="round"
                  aria-pressed={!layer.tintColor}
                  onClick={() => onLayerPatch(layer.id, { tintColor: "" })}
                  className={`inline-flex h-8 shrink-0 cursor-pointer items-center rounded-full border-[1.5px] px-3 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A] ${!layer.tintColor ? "border-[#27307A] bg-[#27307A] text-white" : "border-[#27307A] bg-white text-[#27307A] hover:bg-[#27307A]/[0.05]"}`}
                >
                  Original
                </button>
              }
            />
          </div>
          )}
          <div className="flex gap-3"><Check checked={Boolean(layer.flipX)} onChange={(value: boolean) => onLayerPatch(layer.id, { flipX: value })} label="Flip horizontal" /><Check checked={Boolean(layer.flipY)} onChange={(value: boolean) => onLayerPatch(layer.id, { flipY: value })} label="Flip vertical" /></div>
        </Section>
      )}

      {inspectorTab === "design" && layer.type === "qrCode" && (
        <Section title="QR code">
          <label><Lbl>Destination</Lbl><Txt value={layer.value} placeholder="https://example.com" onChange={(value: string) => onLayerPatch(layer.id, { value })} /></label>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2"><Lbl>Foreground</Lbl><ColourField ariaLabel="QR foreground colour" value={layer.foregroundColor} fallback="#303839" onChange={(foregroundColor) => onLayerPatch(layer.id, { foregroundColor })} /></div>
            <div className="col-span-2"><Lbl>Background</Lbl><ColourField ariaLabel="QR background colour" value={layer.backgroundColor} fallback="#ffffff" onChange={(backgroundColor) => onLayerPatch(layer.id, { backgroundColor })} /></div>
            <div><Lbl>Quiet zone</Lbl><CarouselStepper ariaLabel="QR quiet zone" value={layer.margin ?? 4} min={0} max={16} onChange={(margin: number) => onLayerPatch(layer.id, { margin })} /></div>
            <div><Lbl>Error correction</Lbl><Sel ariaLabel="QR error correction" value={layer.errorCorrection || "M"} onChange={(errorCorrection: string) => onLayerPatch(layer.id, { errorCorrection })} options={[{ value: "L", label: "Low" }, { value: "M", label: "Medium" }, { value: "Q", label: "Quartile" }, { value: "H", label: "High" }]} /></div>
          </div>
          <Check checked={Boolean(layer.required)} onChange={(required: boolean) => onLayerPatch(layer.id, { required })} label="Required and preflight checked" />
        </Section>
      )}

      {inspectorTab === "design" && layer.type === "background" && (
        <Section title="Background">
          <div><Lbl>Background colour</Lbl><ColourField ariaLabel="Background layer colour" value={layer.color} fallback="#ffffff" onChange={(color) => onLayerPatch(layer.id, { color })} /></div>
          <ImageSrcControl layer={layer} onLayerPatch={onLayerPatch} onReplaceImage={onReplaceImage} />
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
                // links this layer to an EXISTING compatible field (text with
                // text, photo with photo). Renaming the key above renames the
                // shared field for every linked layer; it never links.
                const linkedLayers = (template?.layers || []).filter(
                  (other: any) => other.id !== layer.id && other.fieldId === field.id,
                );
                const compatible = (template?.fields || []).filter(
                  (f: any) => f.id !== field.id && isFieldCompatibleWithLayer(f, layer),
                );
                if (!compatible.length && !linkedLayers.length) return null;
                return (
                  <div>
                    {linkedLayers.length > 0 && (
                      <div className="mb-2 rounded-md border border-[#303839]/12 bg-[#F2F3F5] p-2 text-[11px] leading-relaxed text-[#303839]/70">
                        <p className="font-bold text-[#303839]">
                          Shared with {linkedLayers.length} other layer{linkedLayers.length === 1 ? "" : "s"}
                        </p>
                        <p>{linkedLayers.map((other: any) => `${other.name || other.id} (${other.page})`).join(", ")}</p>
                        <button
                          type="button"
                          onClick={() => onUnlinkField?.(layer.id)}
                          className="mt-1 font-bold underline underline-offset-2"
                        >
                          Unlink — give this layer its own field
                        </button>
                      </div>
                    )}
                    {compatible.length > 0 && (
                      <>
                        <Lbl>Link to another field</Lbl>
                        <Sel
                          ariaLabel="Link to another field"
                          value=""
                          onChange={(value: string) => value && onLinkField(layer.id, value)}
                          options={[
                            { value: "", label: "— Choose a field to share —" },
                            ...compatible.map((f: any) => ({ value: f.id, label: f.label || f.id })),
                          ]}
                        />
                        <p className="mt-1 text-[11px] leading-relaxed text-[#303839]/45">
                          Sharing a field means the customer edits it once and every linked layer updates together.
                        </p>
                      </>
                    )}
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
                        className="min-h-16 w-full rounded-md border border-[#303839]/15 bg-white p-2 text-sm outline-none focus:border-[#27307A]"
                      />
                    </div>
                  )}
                </div>
              )}
              <div><Lbl>Helper text</Lbl><Txt value={field.helpText} onChange={(v: string) => onFieldPatch(layer.id, { helpText: v })} /></div>
              <Check checked={field.customerVisible !== false} onChange={(v: boolean) => onFieldPatch(layer.id, { customerVisible: v })} label="Visible to customers" />
              {/* A field customers cannot see is never required (see
                  isCustomerFieldRequired), so the control says so. */}
              <Check
                checked={Boolean(field.required) && field.customerVisible !== false}
                disabled={field.customerVisible === false}
                onChange={(v: boolean) => onFieldPatch(layer.id, { required: v })}
                label={field.customerVisible === false ? "Optional while hidden from customers" : layer.type === "image" ? "Photo required" : "Required field"}
              />
            </div>
          )}
        </Section>
      )}

      {inspectorTab === "advanced" && layer.type !== "group" && (
        <p className="rounded-[10px] bg-[#F2F3F5] px-3 py-3 text-[13px] leading-relaxed text-[#303839]/75">
          This layer type has no advanced settings. Photo crop and opacity sit with the image
          under Design, and grouping behaviour appears here for groups.
        </p>
      )}
    </div>
    </div>
  );
}
