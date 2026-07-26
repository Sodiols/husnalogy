"use client";

import { CUSTOMIZER_APPROVED_FONTS } from "@/lib/customizer";
import EditableNumericStepper from "@/app/components/customizer/EditableNumericStepper";
import TextAlignmentDropdown from "@/app/components/customizer/TextAlignmentDropdown";
import ToolbarDropdown, {
  type ToolbarDropdownOption,
} from "@/app/components/customizer/ToolbarDropdown";
import type { AlignMode } from "./builder-utils";

type Props = {
  layer: any;
  selectedLayers?: any[];
  selectionCount: number;
  onStylePatch: (patch: Record<string, unknown>) => void;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: "horizontal" | "vertical") => void;
  onMatchSize: (dimension: "width" | "height" | "both") => void;
  onDelete: () => void;
};

const FONT_OPTIONS: ToolbarDropdownOption[] = CUSTOMIZER_APPROVED_FONTS.map((font) => ({
  value: font.value,
  label: font.label,
  fontFamily: font.stack,
}));

const WEIGHT_OPTIONS: ToolbarDropdownOption[] = [
  { value: "300", label: "Light" },
  { value: "400", label: "Regular" },
  { value: "500", label: "Medium" },
  { value: "600", label: "Semibold" },
  { value: "700", label: "Bold" },
];

const buttonClass =
  "grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[#303839]/65 transition hover:bg-[#F8F6F1] hover:text-[#303839] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] disabled:cursor-not-allowed disabled:opacity-25";

function Divider() {
  return <span className="mx-1 h-8 w-px shrink-0 bg-[#303839]/10" aria-hidden />;
}

function ToolbarStepper({ label, value, mixed = false, onChange, step = 1, largeStep, min = -Infinity, max = Infinity, width = "w-24" }: any) {
  return (
    <EditableNumericStepper
      label={label}
      value={Number(value) || 0}
      minimum={Number.isFinite(min) ? min : undefined}
      maximum={Number.isFinite(max) ? max : undefined}
      step={step}
      largeStep={largeStep ?? (step < 1 ? step * 10 : Math.max(10, step * 5))}
      allowNegative={!Number.isFinite(min) || min < 0}
      allowDecimal={step < 1}
      onCommit={onChange}
      mixed={mixed}
      showLabel
      showStepButtons={false}
      className={`h-11 shrink-0 px-1 ${width}`}
      inputClassName="h-7 min-w-0 w-full rounded-md border border-[#303839]/12 bg-[#F8F6F1] px-2 text-center text-[13px] font-extrabold tabular-nums text-[#303839] outline-none transition-colors hover:border-[#303839]/25 focus:border-[#D4AF37] focus:bg-white focus:ring-2 focus:ring-[#D4AF37]/20"
    />
  );
}

function sharedStyleValue(layers: any[], key: string, fallback: unknown) {
  const values = layers.map((layer) => layer?.textStyle?.[key] ?? fallback);
  return { value: values[0] ?? fallback, mixed: values.some((value) => value !== values[0]) };
}

function TextToolbar({ layers, onStylePatch }: { layers: any[]; onStylePatch: Props["onStylePatch"] }) {
  const fontFamily = sharedStyleValue(layers, "fontFamily", "Cormorant Garamond");
  const fontSize = sharedStyleValue(layers, "fontSize", 48);
  const fontWeight = sharedStyleValue(layers, "fontWeight", "400");
  const color = sharedStyleValue(layers, "color", "#303839");
  const fontStyle = sharedStyleValue(layers, "fontStyle", "normal");
  const textAlign = sharedStyleValue(layers, "textAlign", "center");
  const verticalAlign = sharedStyleValue(layers, "verticalAlign", "middle");
  const letterSpacing = sharedStyleValue(layers, "letterSpacing", 0);
  const lineHeight = sharedStyleValue(layers, "lineHeight", 1.15);
  const italic = fontStyle.value === "italic" && !fontStyle.mixed;

  return (
    <>
      <ToolbarDropdown label="Font family" value={String(fontFamily.value)} mixed={fontFamily.mixed} onChange={(fontFamily: string) => onStylePatch({ fontFamily })} options={FONT_OPTIONS} width="w-52" previewFont />
      <Divider />
      <ToolbarStepper label="Font size" value={Number(fontSize.value)} mixed={fontSize.mixed} min={4} max={500} step={1} onChange={(fontSize: number) => onStylePatch({ fontSize })} width="w-20" />
      <Divider />
      <ToolbarDropdown label="Weight" value={String(fontWeight.value)} mixed={fontWeight.mixed} onChange={(fontWeight: string) => onStylePatch({ fontWeight })} options={WEIGHT_OPTIONS} width="w-24" />
      <Divider />
      <label className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg transition-colors hover:bg-[#F8F6F1]" title="Text colour">
        <span className="sr-only">Text colour</span>
        <span className="relative grid h-7 w-7 place-items-center rounded-full border border-[#303839]/15 bg-white shadow-sm">
          <span className="h-4 w-4 rounded-full" style={{ background: color.mixed ? "conic-gradient(#303839 0 25%, #D4AF37 0 50%, #8d6e63 0 75%, #f5f1e8 0)" : String(color.value) }} aria-hidden />
          <input type="color" aria-label={color.mixed ? "Text colour: Mixed" : "Text colour"} value={String(color.value)} onChange={(event) => onStylePatch({ color: event.target.value })} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        </span>
      </label>
      <Divider />
      <button type="button" aria-label={fontStyle.mixed ? "Italic: Mixed" : "Italic"} title="Italic" aria-pressed={italic} onClick={() => onStylePatch({ fontStyle: italic ? "normal" : "italic" })} className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg font-serif text-base italic transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${italic ? "bg-[#303839] text-white" : fontStyle.mixed ? "bg-[#F8F6F1] text-[#303839]" : "text-[#303839]/60 hover:bg-[#F8F6F1] hover:text-[#303839]"}`}>I</button>
      <TextAlignmentDropdown
        horizontal={textAlign.mixed ? "mixed" : String(textAlign.value)}
        vertical={verticalAlign.mixed ? "mixed" : String(verticalAlign.value)}
        onHorizontalChange={(textAlign) => onStylePatch({ textAlign })}
        onVerticalChange={(verticalAlign) => onStylePatch({ verticalAlign })}
      />
      <Divider />
      <ToolbarStepper label="Letter space" value={Number(letterSpacing.value)} mixed={letterSpacing.mixed} step={0.1} min={-20} max={100} onChange={(letterSpacing: number) => onStylePatch({ letterSpacing })} width="w-24" />
      <ToolbarStepper label="Line height" value={Number(lineHeight.value)} mixed={lineHeight.mixed} step={0.1} largeStep={0.5} min={0.5} max={4} onChange={(lineHeight: number) => onStylePatch({ lineHeight })} width="w-24" />
    </>
  );
}

const LAYER_ALIGN: Array<{ mode: AlignMode; label: string; d: string }> = [
  { mode: "left", label: "Align left", d: "M4 3v18M8 8h12v3H8zM8 14h8v3H8z" },
  { mode: "center", label: "Align horizontal centre", d: "M12 3v18M6 8h12v3H6zM8 14h8v3H8z" },
  { mode: "right", label: "Align right", d: "M20 3v18M4 8h12v3H4zM8 14h8v3H8z" },
  { mode: "top", label: "Align top", d: "M3 4h18M8 8h3v12H8zM14 8h3v8h-3z" },
  { mode: "middle", label: "Align vertical centre", d: "M3 12h18M8 6h3v12H8zM14 8h3v8h-3z" },
  { mode: "bottom", label: "Align bottom", d: "M3 20h18M8 4h3v12H8zM14 8h3v8h-3z" },
];

function LayoutToolbar({ selectionCount, onAlign, onDistribute, onMatchSize }: Pick<Props, "selectionCount" | "onAlign" | "onDistribute" | "onMatchSize">) {
  return (
    <>
      <span className="shrink-0 rounded-lg bg-[#303839] px-3 py-2 text-[10px] font-extrabold uppercase tracking-[0.12em] text-white">Layout</span>
      {LAYER_ALIGN.map((button) => (
        <button key={button.mode} type="button" title={button.label} aria-label={button.label} onClick={() => onAlign(button.mode)} className={buttonClass}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden><path d={button.d} /></svg>
        </button>
      ))}
      <Divider />
      <button type="button" title="Distribute horizontally" aria-label="Distribute horizontally" disabled={selectionCount < 3} onClick={() => onDistribute("horizontal")} className={buttonClass}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden><path d="M3 3v18M21 3v18M9 8h6v8H9z" /></svg>
      </button>
      <button type="button" title="Distribute vertically" aria-label="Distribute vertically" disabled={selectionCount < 3} onClick={() => onDistribute("vertical")} className={buttonClass}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden><path d="M3 3h18M3 21h18M8 9h8v6H8z" /></svg>
      </button>
      <Divider />
      {(["width", "height", "both"] as const).map((dimension) => (
        <button key={dimension} type="button" title={`Match ${dimension}`} aria-label={`Match ${dimension}`} disabled={selectionCount < 2} onClick={() => onMatchSize(dimension)} className={`${buttonClass} w-auto px-2 text-[10px] font-extrabold`}>
          {dimension === "width" ? "W" : dimension === "height" ? "H" : "W+H"}
        </button>
      ))}
      {selectionCount > 1 && <span className="shrink-0 rounded-full bg-[#F8F6F1] px-2.5 py-1 text-[10px] font-bold text-[#303839]/65">{selectionCount} selected</span>}
    </>
  );
}

export default function AdminContextToolbar(props: Props) {
  const selectedLayers = props.selectedLayers?.length ? props.selectedLayers : props.layer ? [props.layer] : [];
  const showTextControls = selectedLayers.length > 0 && selectedLayers.every((layer) => layer?.type === "text");

  return (
    <div role="toolbar" aria-label={showTextControls ? "Text formatting" : "Align and distribute"} className="pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-2xl border border-[#303839]/12 bg-white px-2 py-1.5 shadow-[0_12px_36px_rgba(48,56,57,0.14)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {showTextControls ? <TextToolbar layers={selectedLayers} onStylePatch={props.onStylePatch} /> : <LayoutToolbar selectionCount={props.selectionCount} onAlign={props.onAlign} onDistribute={props.onDistribute} onMatchSize={props.onMatchSize} />}
      <Divider />
      <button
        type="button"
        aria-label={`Delete ${props.selectionCount === 1 ? "selected layer" : `${props.selectionCount} selected layers`}`}
        title="Delete selection"
        onClick={props.onDelete}
        className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl text-red-600 transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        </svg>
      </button>
    </div>
  );
}
