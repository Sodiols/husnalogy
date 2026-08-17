"use client";

// Contextual text toolbar (Section 5). Rendered ONLY while an editable text
// layer is selected; every control is gated by the layer's admin-configured
// customer permissions. Customer-added text gets the full set.

import { CUSTOMIZER_APPROVED_FONTS } from "@/lib/customizer";
import EditableNumericStepper from "./EditableNumericStepper";
import TextAlignmentDropdown from "./TextAlignmentDropdown";
import ToolbarDropdown, { type ToolbarDropdownOption } from "./ToolbarDropdown";
import {
  LETTER_SPACING_RULES,
  LINE_HEIGHT_RULES,
  resolveFontSizeBounds,
} from "@/lib/customizer/v2/text-toolbar";

type Props = {
  layer: any;
  permissions: Record<string, boolean>;
  isUserLayer: boolean;
  editingText?: boolean;
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
  editingText = false,
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
  // Honour the layer's own limits, exactly as the save validator does.
  const fontSizeBounds = resolveFontSizeBounds(style);
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

  const divider = <span className="mx-1 h-6 w-px shrink-0 bg-[#303839]/10" aria-hidden />;
  // Shared compact field styling. Numeric fields stay fully keyboard editable.
  const numericInput =
    "h-7 w-full rounded-md border border-[#303839]/10 bg-[#F0EDED] px-2 text-center text-xs font-bold tabular-nums text-[#303839] outline-none transition-colors hover:border-[#303839]/20 focus:border-[#D4AF37] focus:bg-white focus:ring-2 focus:ring-[#D4AF37]/20";
  const iconButton =
    "grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]";

  return (
    <div
      data-customizer-text-interaction
      className="pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-xl border border-[#303839]/8 bg-white px-1.5 py-1.5 shadow-[0_6px_24px_rgba(48,56,57,0.10)] no-scrollbar"
      role="toolbar"
      aria-label="Text formatting"
    >
      {editingText && (
        <>
          <span className="shrink-0 rounded-lg bg-[#303839] px-3 py-2 text-[10px] font-extrabold uppercase tracking-[0.11em] text-white">
            Editing text
          </span>
          {divider}
        </>
      )}
      {canEditContent && !editingText && (
        <>
          <button
            type="button"
            onClick={onEditText}
            className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#303839] px-3 text-xs font-bold text-white transition-colors hover:bg-[#414b4c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
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
          minimum={fontSizeBounds.minimum}
          maximum={fontSizeBounds.maximum}
          step={1}
          largeStep={10}
          allowNegative={false}
          allowDecimal={false}
          onCommit={(fontSize) => onStyleChange({ fontSize }, "fontSize")}
          showLabel
          showStepButtons={false}
          className="h-10 w-[68px] shrink-0 px-1"
          inputClassName={numericInput}
        />
      )}

      {canColor && !allowedColors.length && (
        <label className={`relative ${iconButton} hover:bg-[#303839]/5`} title="Text colour">
          <span className="sr-only">Text colour</span>
          <span className="h-5 w-5 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(48,56,57,0.18)]" style={{ background: style.color || "#303839" }} aria-hidden />
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
        <span className="flex shrink-0 items-center gap-1 rounded-lg bg-[#F0EDED] p-1" aria-label="Allowed text colours">
          {allowedColors.map((color) => <button key={color} type="button" aria-label={`Set text colour ${color}`} aria-pressed={(style.color || "").toLowerCase() === color.toLowerCase()} onClick={() => onStyleChange({ color }, "color")} className={`h-7 w-7 rounded-md border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${String(style.color).toLowerCase() === color.toLowerCase() ? "border-[#303839]" : "border-white"}`} style={{ backgroundColor: color }} />)}
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
            className={`${iconButton} font-display text-[17px] italic ${
              italic ? "bg-[#303839] text-white" : "text-[#303839] hover:bg-[#303839]/5"
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
        <EditableNumericStepper label="Letter spacing" value={Number(style.letterSpacing ?? 0)} minimum={LETTER_SPACING_RULES.minimum} maximum={LETTER_SPACING_RULES.maximum} step={LETTER_SPACING_RULES.step} largeStep={LETTER_SPACING_RULES.largeStep} allowNegative allowDecimal onCommit={(letterSpacing) => onStyleChange({ letterSpacing }, "letterSpacing")} showLabel showStepButtons={false} className="h-10 w-[76px] shrink-0 px-1" inputClassName={numericInput} />
      )}

      {canLineHeight && (
        <EditableNumericStepper label="Line height" value={lineHeight} minimum={LINE_HEIGHT_RULES.minimum} maximum={LINE_HEIGHT_RULES.maximum} step={LINE_HEIGHT_RULES.step} largeStep={LINE_HEIGHT_RULES.largeStep} allowNegative={false} allowDecimal onCommit={(lineHeight) => onStyleChange({ lineHeight }, "line-height")} showLabel showStepButtons={false} className="h-10 w-[76px] shrink-0 px-1" inputClassName={numericInput} />
      )}

      {!editingText && (canDuplicate || canDelete) && divider}

      {!editingText && canDuplicate && onDuplicate && (
        <button
          type="button"
          aria-label="Duplicate text"
          onClick={onDuplicate}
          title="Duplicate"
          className={`${iconButton} text-[#303839]/70 hover:bg-[#303839]/5 hover:text-[#303839]`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
            <rect x="9" y="9" width="12" height="12" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
      )}

      {!editingText && canDelete && onDelete && (
        <button
          type="button"
          aria-label="Delete text"
          onClick={onDelete}
          title="Delete"
          className={`${iconButton} text-red-600 hover:bg-red-50`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          </svg>
        </button>
      )}
    </div>
  );
}
