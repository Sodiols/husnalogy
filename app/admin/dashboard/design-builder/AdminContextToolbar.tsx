"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CUSTOMIZER_APPROVED_FONTS } from "@/lib/customizer";
import type { AlignMode } from "./builder-utils";

type Props = {
  layer: any;
  selectionCount: number;
  onStylePatch: (patch: Record<string, unknown>) => void;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: "horizontal" | "vertical") => void;
  onMatchSize: (dimension: "width" | "height" | "both") => void;
};

type DropdownOption = {
  value: string;
  label: string;
  fontFamily?: string;
};

const FONT_OPTIONS: DropdownOption[] = CUSTOMIZER_APPROVED_FONTS.map((font) => ({
  value: font.value,
  label: font.label,
  fontFamily: font.stack,
}));

const WEIGHT_OPTIONS: DropdownOption[] = [
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

function ToolbarDropdown({ label, value, onChange, options, width = "w-32", previewFont = false }: { label: string; value: string; onChange: (value: string) => void; options: DropdownOption[]; width?: string; previewFont?: boolean }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 280 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const selected = options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    if (!open) return;

    const placeMenu = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuWidth = Math.max(rect.width, previewFont ? 260 : 190);
      const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - menuWidth - 12));
      const top = rect.bottom + 8;
      setPosition({ left, top, width: menuWidth, maxHeight: Math.max(160, Math.min(320, window.innerHeight - top - 12)) });
    };

    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    placeMenu();
    const focusSelected = window.requestAnimationFrame(() => {
      const selectedOption = menuRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
      (selectedOption || menuRef.current?.querySelector<HTMLElement>('[role="option"]'))?.focus();
    });
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);

    return () => {
      window.cancelAnimationFrame(focusSelected);
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [open, previewFont]);

  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') || []);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? Math.min(items.length - 1, current + 1) : Math.max(0, current - 1);
    items[next]?.focus();
  };

  const menu = open && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="listbox"
          aria-label={label}
          onKeyDown={moveFocus}
          style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}
          className="fixed z-[180] overflow-y-auto rounded-2xl border border-[#303839]/12 bg-white p-2 shadow-[0_24px_60px_rgba(48,56,57,0.24)]"
        >
          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            <span className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#303839]/50">{label}</span>
            <span className="rounded-full bg-[#F8F6F1] px-2 py-0.5 text-[9px] font-bold text-[#303839]/45">{options.length} choices</span>
          </div>
          <div className="grid gap-1">
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                  className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-[13px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${
                    isSelected ? "bg-[#303839] text-white" : "text-[#303839] hover:bg-[#F8F6F1]"
                  }`}
                >
                  <span className="truncate font-semibold" style={{ fontFamily: option.fontFamily }}>{option.label}</span>
                  {isSelected && (
                    <svg className="shrink-0 text-[#D4AF37]" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m5 12 4 4L19 6" /></svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className={`grid h-12 shrink-0 grid-rows-[13px_28px] content-center rounded-xl border border-[#303839]/10 bg-[#F8F6F1] px-2.5 shadow-[0_1px_0_rgba(48,56,57,0.03)] transition hover:border-[#303839]/20 ${width}`}>
      <span className="block text-[8px] font-extrabold uppercase tracking-[0.12em] text-[#303839]/45">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="flex h-7 min-w-0 items-center justify-between gap-2 text-left text-[13px] font-bold leading-7 text-[#303839] outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
      >
        <span className="truncate" style={{ fontFamily: previewFont ? selected?.fontFamily : undefined }}>{selected?.label || value}</span>
        <svg className={`shrink-0 text-[#303839]/45 transition-transform duration-150 ${open ? "rotate-180" : ""}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {menu}
    </div>
  );
}

function ToolbarStepper({ label, value, onChange, step = 1, min = -Infinity, max = Infinity, width = "w-24" }: any) {
  const numeric = Number(value) || 0;
  const update = (direction: number) => {
    const next = Math.min(max, Math.max(min, numeric + direction * step));
    onChange(Number(next.toFixed(step < 1 ? 2 : 0)));
  };
  const display = step < 1 ? numeric.toFixed(2).replace(/0+$/, "").replace(/\.$/, "") : Math.round(numeric);

  return (
    <div className={`grid h-12 shrink-0 grid-cols-[24px_minmax(0,1fr)_24px] grid-rows-[13px_1fr] items-center rounded-xl border border-[#303839]/10 bg-[#F8F6F1] px-1 shadow-[0_1px_0_rgba(48,56,57,0.03)] transition hover:border-[#303839]/20 ${width}`} role="group" aria-label={label}>
      <span className="col-span-3 text-center text-[8px] font-extrabold uppercase tracking-[0.12em] text-[#303839]/45">{label}</span>
      <button type="button" aria-label={`Decrease ${label}`} onClick={() => update(-1)} disabled={numeric <= min} className="grid h-6 w-6 place-items-center rounded-md text-[#303839]/55 hover:bg-white hover:text-[#303839] disabled:opacity-25">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
      </button>
      <output className="min-w-0 text-center text-[13px] font-extrabold tabular-nums text-[#303839]">{display}</output>
      <button type="button" aria-label={`Increase ${label}`} onClick={() => update(1)} disabled={numeric >= max} className="grid h-6 w-6 place-items-center rounded-md text-[#303839]/55 hover:bg-white hover:text-[#303839] disabled:opacity-25">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 18 6-6-6-6" /></svg>
      </button>
    </div>
  );
}

const TEXT_ALIGN = [
  { value: "left", label: "Align text left", d: "M4 6h16M4 10h10M4 14h16M4 18h12" },
  { value: "center", label: "Align text centre", d: "M4 6h16M7 10h10M4 14h16M6 18h12" },
  { value: "right", label: "Align text right", d: "M4 6h16M10 10h10M4 14h16M8 18h12" },
];

const VERTICAL_ALIGN = [
  { value: "top", label: "Align text to top", d: "M5 5h14M8 9h8v4H8z" },
  { value: "middle", label: "Align text to middle", d: "M5 12h14M8 8h8v8H8z" },
  { value: "bottom", label: "Align text to bottom", d: "M5 19h14M8 11h8v4H8z" },
];

function ChoiceGroup({ label, value, options, onChange }: any) {
  return (
    <div className="grid h-12 shrink-0 grid-rows-[13px_1fr] rounded-xl border border-[#303839]/10 bg-[#F8F6F1] px-1 shadow-[0_1px_0_rgba(48,56,57,0.03)] transition hover:border-[#303839]/20" role="group" aria-label={label}>
      <span className="text-center text-[8px] font-extrabold uppercase tracking-[0.12em] text-[#303839]/45">{label}</span>
      <span className="flex items-center">
        {options.map((option: any) => (
          <button
            key={option.value}
            type="button"
            title={option.label}
            aria-label={option.label}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`grid h-7 w-7 place-items-center rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${
              value === option.value ? "bg-[#303839] text-white" : "text-[#303839]/55 hover:bg-white hover:text-[#303839]"
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={option.d} /></svg>
          </button>
        ))}
      </span>
    </div>
  );
}

function TextToolbar({ layer, onStylePatch }: Pick<Props, "layer" | "onStylePatch">) {
  const style = layer?.textStyle || {};
  const italic = style.fontStyle === "italic";

  return (
    <>
      <ToolbarDropdown label="Font family" value={style.fontFamily || "Cormorant Garamond"} onChange={(fontFamily: string) => onStylePatch({ fontFamily })} options={FONT_OPTIONS} width="w-52" previewFont />
      <ToolbarStepper label="Font size" value={style.fontSize || 48} min={4} max={500} onChange={(fontSize: number) => onStylePatch({ fontSize })} width="w-20" />
      <ToolbarDropdown label="Weight" value={String(style.fontWeight || "400")} onChange={(fontWeight: string) => onStylePatch({ fontWeight })} options={WEIGHT_OPTIONS} width="w-24" />
      <Divider />
      <label className="grid h-12 w-14 shrink-0 cursor-pointer grid-rows-[13px_1fr] place-items-center rounded-xl border border-[#303839]/10 bg-[#F8F6F1] shadow-[0_1px_0_rgba(48,56,57,0.03)] transition hover:border-[#303839]/20">
        <span className="text-[8px] font-extrabold uppercase tracking-[0.12em] text-[#303839]/45">Colour</span>
        <span className="relative grid h-7 w-7 place-items-center rounded-full border border-[#303839]/15 bg-white shadow-sm">
          <span className="h-4 w-4 rounded-full" style={{ backgroundColor: style.color || "#303839" }} aria-hidden />
          <input type="color" aria-label="Text colour" value={style.color || "#303839"} onChange={(event) => onStylePatch({ color: event.target.value })} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        </span>
      </label>
      <ToolbarStepper label="Letter space" value={style.letterSpacing || 0} step={0.25} min={-20} max={100} onChange={(letterSpacing: number) => onStylePatch({ letterSpacing })} width="w-24" />
      <ToolbarStepper label="Line height" value={style.lineHeight || 1.15} step={0.05} min={0.5} max={4} onChange={(lineHeight: number) => onStylePatch({ lineHeight })} width="w-24" />
      <Divider />
      <ChoiceGroup label="Align" value={style.textAlign || "center"} options={TEXT_ALIGN} onChange={(textAlign: string) => onStylePatch({ textAlign })} />
      <div className="grid h-12 w-12 shrink-0 grid-rows-[13px_1fr] place-items-center rounded-xl border border-[#303839]/10 bg-[#F8F6F1] shadow-[0_1px_0_rgba(48,56,57,0.03)] transition hover:border-[#303839]/20">
        <span className="text-[8px] font-extrabold uppercase tracking-[0.12em] text-[#303839]/45">Italic</span>
        <button type="button" aria-label="Italic" aria-pressed={italic} onClick={() => onStylePatch({ fontStyle: italic ? "normal" : "italic" })} className={`grid h-7 w-7 place-items-center rounded-md font-serif text-sm italic transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${italic ? "bg-[#303839] text-white" : "text-[#303839]/60 hover:bg-white hover:text-[#303839]"}`}>I</button>
      </div>
      <ChoiceGroup label="Vertical" value={style.verticalAlign || "middle"} options={VERTICAL_ALIGN} onChange={(verticalAlign: string) => onStylePatch({ verticalAlign })} />
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
  const showTextControls = props.selectionCount === 1 && props.layer?.type === "text";

  return (
    <div role="toolbar" aria-label={showTextControls ? "Text formatting" : "Align and distribute"} className="pointer-events-auto flex max-w-full items-center gap-1.5 overflow-x-auto rounded-[20px] border border-[#303839]/12 bg-white p-2 shadow-[0_16px_44px_rgba(48,56,57,0.16)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {showTextControls ? <TextToolbar layer={props.layer} onStylePatch={props.onStylePatch} /> : <LayoutToolbar selectionCount={props.selectionCount} onAlign={props.onAlign} onDistribute={props.onDistribute} onMatchSize={props.onMatchSize} />}
    </div>
  );
}
