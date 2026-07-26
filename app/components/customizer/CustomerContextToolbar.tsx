"use client";

// Contextual text toolbar (Section 5). Rendered ONLY while an editable text
// layer is selected; every control is gated by the layer's admin-configured
// customer permissions. Customer-added text gets the full set.

import { CUSTOMIZER_APPROVED_FONTS } from "@/lib/customizer";
import EditableNumericStepper from "./EditableNumericStepper";
import TextAlignmentDropdown from "./TextAlignmentDropdown";
import ToolbarDropdown, { type ToolbarDropdownOption } from "./ToolbarDropdown";

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

  const fontSize = Number(style.fontSize ?? 48);
  const weight = String(style.fontWeight || "400");
  const italic = style.fontStyle === "italic";
  const align = style.textAlign || "center";
  const verticalAlign = style.verticalAlign || "middle";
  const lineHeight = Number(style.lineHeight ?? 1.2);
  const fontOptions = CUSTOMIZER_APPROVED_FONTS.filter((font) => !allowedFonts.length || allowedFonts.includes(font.value));
  const fontDropdownOptions: ToolbarDropdownOption[] = fontOptions.map((font) => ({
    value: font.value,
    label: font.label,
    fontFamily: font.stack,
  }));
  const weightOptions: ToolbarDropdownOption[] = [
    { value: "300", label: "Light" },
    { value: "400", label: "Regular" },
    { value: "500", label: "Medium" },
    { value: "600", label: "Semibold" },
    { value: "700", label: "Bold" },
    { value: "800", label: "Extra bold" },
  ];

  const divider = <span className="mx-0.5 h-5 w-px shrink-0 bg-[#303839]/12" aria-hidden />;

  return (
    <div
      className="pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-2xl border border-[#303839]/12 bg-white px-2 py-1.5 shadow-[0_10px_32px_rgba(48,56,57,0.14)] no-scrollbar"
      role="toolbar"
      aria-label="Text formatting"
    >
      {canEditContent && (
        <>
          <button
            type="button"
            onClick={onEditText}
            className="h-10 cursor-pointer whitespace-nowrap rounded-lg bg-[#303839] px-3 text-xs font-bold text-white transition-colors hover:bg-[#414b4c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
          >
            Edit Text
          </button>
          {divider}
        </>
      )}

      {canFont && (
        <ToolbarDropdown
          label="Font family"
          value={style.fontFamily || "Cormorant Garamond"}
          onChange={(fontFamily) => onStyleChange({ fontFamily })}
          options={fontDropdownOptions}
          width="w-52"
          previewFont
        />
      )}

      {canSize && (
        <EditableNumericStepper
          label="Font size"
          value={fontSize}
          minimum={10}
          maximum={400}
          step={1}
          largeStep={10}
          allowNegative={false}
          allowDecimal={false}
          onCommit={(fontSize) => onStyleChange({ fontSize }, "fontSize")}
          showLabel
          showStepButtons={false}
          className="h-11 w-20 shrink-0 px-1"
          inputClassName="h-7 w-full rounded-md border border-[#303839]/12 bg-[#F8F6F1] px-2 text-center text-xs font-extrabold tabular-nums text-[#303839] outline-none transition-colors hover:border-[#303839]/25 focus:border-[#D4AF37] focus:bg-white focus:ring-2 focus:ring-[#D4AF37]/20"
        />
      )}

      {canColor && !allowedColors.length && (
        <label className="relative grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-lg transition-colors hover:bg-[#F8F6F1]" title="Text colour">
          <span className="sr-only">Text colour</span>
          <span className="h-5 w-5 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(48,56,57,0.2)]" style={{ background: style.color || "#303839" }} aria-hidden />
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
        <span className="flex shrink-0 items-center gap-1 rounded-lg bg-[#F8F6F1] p-1" aria-label="Allowed text colours">
          {allowedColors.map((color) => <button key={color} type="button" aria-label={`Set text colour ${color}`} aria-pressed={(style.color || "").toLowerCase() === color.toLowerCase()} onClick={() => onStyleChange({ color }, "color")} className={`h-9 w-9 rounded-md border-2 ${String(style.color).toLowerCase() === color.toLowerCase() ? "border-[#303839]" : "border-white"}`} style={{ backgroundColor: color }} />)}
        </span>
      )}

      {canStyle && (
        <>
          <ToolbarDropdown
            label="Weight"
            value={weight}
            onChange={(fontWeight) => onStyleChange({ fontWeight }, "weight")}
            options={weightOptions}
            width="w-28"
          />
          <button
            type="button"
            aria-label="Italic"
            aria-pressed={italic}
            onClick={() => onStyleChange({ fontStyle: italic ? "normal" : "italic" })}
            className={`grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-lg text-base italic transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${
              italic ? "bg-[#303839] text-white" : "text-[#303839] hover:bg-[#F8F6F1]"
            }`}
          >
            I
          </button>
        </>
      )}

      {(canAlign || canVerticalAlign) && (
        <TextAlignmentDropdown
          horizontal={align}
          vertical={verticalAlign}
          canHorizontal={canAlign}
          canVertical={canVerticalAlign}
          onHorizontalChange={(textAlign) => onStyleChange({ textAlign }, "alignment")}
          onVerticalChange={(verticalAlign) => onStyleChange({ verticalAlign }, "vertical-alignment")}
        />
      )}

      {canSpacing && (
        <EditableNumericStepper label="Letter spacing" value={Number(style.letterSpacing ?? 0)} minimum={-2} maximum={20} step={0.1} largeStep={1} allowNegative allowDecimal onCommit={(letterSpacing) => onStyleChange({ letterSpacing }, "letterSpacing")} showLabel showStepButtons={false} className="h-11 w-24 shrink-0 px-1" inputClassName="h-7 w-full rounded-md border border-[#303839]/12 bg-[#F8F6F1] px-2 text-center text-xs font-extrabold tabular-nums text-[#303839] outline-none transition-colors hover:border-[#303839]/25 focus:border-[#D4AF37] focus:bg-white focus:ring-2 focus:ring-[#D4AF37]/20" />
      )}


      {canLineHeight && (
        <EditableNumericStepper label="Line height" value={lineHeight} minimum={0.7} maximum={3} step={0.1} largeStep={0.5} allowNegative={false} allowDecimal onCommit={(lineHeight) => onStyleChange({ lineHeight }, "line-height")} showLabel showStepButtons={false} className="h-11 w-24 shrink-0 px-1" inputClassName="h-7 w-full rounded-md border border-[#303839]/12 bg-[#F8F6F1] px-2 text-center text-xs font-extrabold tabular-nums text-[#303839] outline-none transition-colors hover:border-[#303839]/25 focus:border-[#D4AF37] focus:bg-white focus:ring-2 focus:ring-[#D4AF37]/20" />
      )}

      {(canDuplicate || canDelete) && divider}

      {canDuplicate && onDuplicate && (
        <button
          type="button"
          aria-label="Duplicate text"
          onClick={onDuplicate}
          title="Duplicate"
          className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-lg text-[#303839] transition-colors hover:bg-[#F8F6F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
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
          title="Delete"
          className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-lg text-red-700 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          </svg>
        </button>
      )}
    </div>
  );
}
