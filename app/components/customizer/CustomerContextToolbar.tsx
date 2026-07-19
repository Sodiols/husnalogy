"use client";

// Contextual text toolbar (Section 5). Rendered ONLY while an editable text
// layer is selected; every control is gated by the layer's admin-configured
// customer permissions. Customer-added text gets the full set.

import { CUSTOMIZER_APPROVED_FONTS } from "@/lib/customizer";

const ALIGNS = ["left", "center", "right"] as const;

const AlignIcon = ({ align }: { align: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <path d="M4 6h16" />
    <path d={align === "left" ? "M4 12h10M4 18h13" : align === "right" ? "M10 12h10M7 18h13" : "M7 12h10M5.5 18h13"} />
  </svg>
);

type Props = {
  layer: any;
  permissions: Record<string, boolean>;
  isUserLayer: boolean;
  onStyleChange: (patch: any, group?: string) => void;
  onEditText: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  allowedFonts?: string[];
  allowedColors?: string[];
};

export default function CustomerContextToolbar({
  layer,
  permissions,
  isUserLayer,
  onStyleChange,
  onEditText,
  onDuplicate,
  onDelete,
  allowedFonts = [],
  allowedColors = [],
}: Props) {
  const style = layer?.textStyle || {};
  const allow = (key: string) => isUserLayer || Boolean(permissions[key]);

  const canFont = allow("changeFont");
  const canSize = allow("changeFontSize");
  const canColor = allow("changeColor");
  const canAlign = allow("changeAlignment");
  const canSpacing = allow("changeLetterSpacing");
  const canStyle = allow("editStyle");
  const canLineHeight = isUserLayer || Boolean(permissions.changeLineHeight || permissions.editStyle);
  const canVerticalAlign = isUserLayer || Boolean(permissions.changeAlignment || permissions.editStyle);
  const canDuplicate = isUserLayer || Boolean(permissions.duplicate);
  const canDelete = isUserLayer || Boolean(permissions.delete);
  const canEditContent = isUserLayer || Boolean(permissions.editContent);

  const fontSize = Number(style.fontSize) || 48;
  const weight = String(style.fontWeight || "400");
  const italic = style.fontStyle === "italic";
  const align = style.textAlign || "center";
  const verticalAlign = style.verticalAlign || "middle";
  const lineHeight = Number(style.lineHeight) || 1.2;
  const fontOptions = CUSTOMIZER_APPROVED_FONTS.filter((font) => !allowedFonts.length || allowedFonts.includes(font.value));

  const divider = <span className="mx-0.5 h-5 w-px shrink-0 bg-[#303839]/12" aria-hidden />;

  return (
    <div
      className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-[#303839]/12 bg-white px-2 py-1.5 shadow-[0_6px_24px_rgba(48,56,57,0.14)] no-scrollbar"
      role="toolbar"
      aria-label="Text formatting"
    >
      {canEditContent && (
        <>
          <button
            type="button"
            onClick={onEditText}
            className="min-h-11 whitespace-nowrap rounded-full bg-[#F8F6F1] px-3 py-1.5 text-xs font-bold text-[#303839] hover:bg-[#ECE9E1]"
          >
            Edit Text
          </button>
          {divider}
        </>
      )}

      {canFont && (
        <select
          value={style.fontFamily || "Cormorant Garamond"}
          onChange={(e) => onStyleChange({ fontFamily: e.target.value })}
          aria-label="Font family"
          className="h-11 min-w-[190px] max-w-[240px] rounded-lg border border-[#303839]/12 bg-white px-3 text-xs font-semibold text-[#303839] outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
        >
          {fontOptions.map((font) => (
            <option key={font.value} value={font.value}>
              {font.label}
            </option>
          ))}
        </select>
      )}

      {canSize && (
        <span className="flex items-center rounded-md border border-[#303839]/12">
          <button
            type="button"
            aria-label="Decrease font size"
            onClick={() => onStyleChange({ fontSize: Math.max(10, fontSize - 4) }, "fontSize")}
            className="grid h-11 w-10 place-items-center text-sm text-[#303839] hover:bg-[#F8F6F1]"
          >
            −
          </button>
          <span className="w-9 text-center text-xs font-bold text-[#303839]" aria-label="Font size">
            {fontSize}
          </span>
          <button
            type="button"
            aria-label="Increase font size"
            onClick={() => onStyleChange({ fontSize: Math.min(400, fontSize + 4) }, "fontSize")}
            className="grid h-11 w-10 place-items-center text-sm text-[#303839] hover:bg-[#F8F6F1]"
          >
            +
          </button>
        </span>
      )}

      {canColor && !allowedColors.length && (
        <label className="relative grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg border border-[#303839]/12 hover:bg-[#F8F6F1]" title="Text colour">
          <span className="sr-only">Text colour</span>
          <span className="h-4 w-4 rounded-sm border border-[#303839]/20" style={{ background: style.color || "#303839" }} aria-hidden />
          <input
            type="color"
            value={style.color || "#303839"}
            onChange={(e) => onStyleChange({ color: e.target.value }, "color")}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label="Text colour"
          />
        </label>
      )}

      {canColor && allowedColors.length > 0 && (
        <span className="flex shrink-0 items-center gap-1 rounded-lg border border-[#303839]/10 bg-[#F8F6F1] p-1" aria-label="Allowed text colours">
          {allowedColors.map((color) => <button key={color} type="button" aria-label={`Set text colour ${color}`} aria-pressed={(style.color || "").toLowerCase() === color.toLowerCase()} onClick={() => onStyleChange({ color }, "color")} className={`h-9 w-9 rounded-md border-2 ${String(style.color).toLowerCase() === color.toLowerCase() ? "border-[#303839]" : "border-white"}`} style={{ backgroundColor: color }} />)}
        </span>
      )}

      {canStyle && (
        <>
          <select value={weight} onChange={(event) => onStyleChange({ fontWeight: event.target.value }, "weight")} aria-label="Font weight" className="h-11 w-[92px] shrink-0 rounded-lg border border-[#303839]/12 bg-white px-2 text-xs font-semibold outline-none focus:border-[#D4AF37]">
            {["300", "400", "500", "600", "700", "800"].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <button
            type="button"
            aria-label="Italic"
            aria-pressed={italic}
            onClick={() => onStyleChange({ fontStyle: italic ? "normal" : "italic" })}
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg text-sm italic transition ${
              italic ? "bg-[#303839] text-white" : "text-[#303839] hover:bg-[#F8F6F1]"
            }`}
          >
            I
          </button>
        </>
      )}

      {canAlign && (
        <button
          type="button"
          aria-label={`Text alignment: ${align}`}
          onClick={() => {
            const next = ALIGNS[(ALIGNS.indexOf(align as any) + 1) % ALIGNS.length];
            onStyleChange({ textAlign: next });
          }}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[#303839] hover:bg-[#F8F6F1]"
        >
          <AlignIcon align={align} />
        </button>
      )}

      {canVerticalAlign && (
        <select value={verticalAlign} onChange={(event) => onStyleChange({ verticalAlign: event.target.value }, "vertical-align")} aria-label="Vertical alignment" className="h-11 w-[96px] shrink-0 rounded-lg border border-[#303839]/12 bg-white px-2 text-xs font-semibold capitalize outline-none focus:border-[#D4AF37]">
          <option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option>
        </select>
      )}

      {canSpacing && (
        <label className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5" title="Letter spacing">
          <span className="text-[10px] font-bold uppercase text-[#303839]/50">Spacing</span>
          <input
            type="range"
            min={-2}
            max={20}
            step={0.5}
            value={Number(style.letterSpacing) || 0}
            onChange={(e) => onStyleChange({ letterSpacing: Number(e.target.value) }, "letterSpacing")}
            className="w-16 accent-[#303839]"
            aria-label="Letter spacing"
          />
        </label>
      )}


      {canLineHeight && (
        <label className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg bg-[#F8F6F1] px-2" title="Line height">
          <span className="text-[10px] font-bold uppercase text-[#303839]/50">Line</span>
          <input type="range" min={0.7} max={3} step={0.05} value={lineHeight} onChange={(event) => onStyleChange({ lineHeight: Number(event.target.value) }, "line-height")} className="w-20 accent-[#303839]" aria-label="Line height" />
          <span className="w-8 text-center text-[10px] font-bold">{lineHeight.toFixed(2)}</span>
        </label>
      )}

      {(canDuplicate || canDelete) && divider}

      {canDuplicate && onDuplicate && (
        <button
          type="button"
          aria-label="Duplicate text"
          onClick={onDuplicate}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[#303839] hover:bg-[#F8F6F1]"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
            <rect x="9" y="9" width="12" height="12" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
      )}

      {canDelete && onDelete && (
        <button
          type="button"
          aria-label="Delete text"
          onClick={onDelete}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-red-700 hover:bg-red-50"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          </svg>
        </button>
      )}
    </div>
  );
}
