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
};

export default function CustomerContextToolbar({
  layer,
  permissions,
  isUserLayer,
  onStyleChange,
  onEditText,
  onDuplicate,
  onDelete,
}: Props) {
  const style = layer?.textStyle || {};
  const allow = (key: string) => isUserLayer || Boolean(permissions[key]);

  const canFont = allow("changeFont");
  const canSize = allow("changeFontSize");
  const canColor = allow("changeColor");
  const canAlign = allow("changeAlignment");
  const canSpacing = allow("changeLetterSpacing");
  const canStyle = allow("editStyle");
  const canDuplicate = isUserLayer || Boolean(permissions.duplicate);
  const canDelete = isUserLayer || Boolean(permissions.delete);
  const canEditContent = isUserLayer || Boolean(permissions.editContent);

  const fontSize = Number(style.fontSize) || 48;
  const weight = String(style.fontWeight || "400");
  const bold = weight === "bold" || Number(weight) >= 600;
  const italic = style.fontStyle === "italic";
  const align = style.textAlign || "center";

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
            className="whitespace-nowrap rounded-full bg-[#F4ECEC] px-3 py-1.5 text-xs font-bold text-[#303839] hover:bg-[#ECE9E1]"
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
          className="h-8 max-w-[150px] rounded-md border border-[#303839]/12 bg-white px-1.5 text-xs font-semibold text-[#303839] outline-none focus:border-[#303839]/40"
        >
          {CUSTOMIZER_APPROVED_FONTS.map((font) => (
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
            className="grid h-8 w-7 place-items-center text-sm text-[#303839] hover:bg-[#F4ECEC]"
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
            className="grid h-8 w-7 place-items-center text-sm text-[#303839] hover:bg-[#F4ECEC]"
          >
            +
          </button>
        </span>
      )}

      {canColor && (
        <label className="relative grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md border border-[#303839]/12 hover:bg-[#F4ECEC]" title="Text colour">
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

      {canStyle && (
        <>
          <button
            type="button"
            aria-label="Bold"
            aria-pressed={bold}
            onClick={() => onStyleChange({ fontWeight: bold ? "400" : "700" })}
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-md text-sm font-black transition ${
              bold ? "bg-[#303839] text-white" : "text-[#303839] hover:bg-[#F4ECEC]"
            }`}
          >
            B
          </button>
          <button
            type="button"
            aria-label="Italic"
            aria-pressed={italic}
            onClick={() => onStyleChange({ fontStyle: italic ? "normal" : "italic" })}
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-md text-sm italic transition ${
              italic ? "bg-[#303839] text-white" : "text-[#303839] hover:bg-[#F4ECEC]"
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
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[#303839] hover:bg-[#F4ECEC]"
        >
          <AlignIcon align={align} />
        </button>
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

      {(canDuplicate || canDelete) && divider}

      {canDuplicate && onDuplicate && (
        <button
          type="button"
          aria-label="Duplicate text"
          onClick={onDuplicate}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[#303839] hover:bg-[#F4ECEC]"
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
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-red-700 hover:bg-red-50"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          </svg>
        </button>
      )}
    </div>
  );
}
