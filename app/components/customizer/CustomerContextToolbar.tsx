"use client";

// Contextual text toolbar (Section 5). Rendered ONLY while an editable text
// layer is selected; every control is gated by the layer's admin-configured
// customer permissions. Customer-added text gets the full set.
//
// Drawn exactly like the studio's selection toolbar (AdminContextToolbar) —
// "Font:" trigger, "Font size − 17 +", colour chip, Bold / Italic, the
// alignment menu — through the shared CustomerToolbarKit, in brand colours.

import { FONT_SIZE_POINT_RULES, documentPxToPoints, fontSizeBoundsInPoints, pointsToDocumentPx } from "@/lib/customizer/v2/type-units";
import { useEffect } from "react";
import TextAlignmentDropdown from "./TextAlignmentDropdown";
import { effectiveTextGrowth } from "@/lib/customizer/v2/text-layout";
import GoogleFontSelector from "./GoogleFontSelector";
import { ToolbarButton, ToolbarColourControl, ToolbarShell, ToolbarStepper, useCompact } from "./CustomerToolbarKit";
import {
  ensureGoogleFontLoaded,
  reportGoogleFontLoadFailure,
  useFamilyCapabilities,
  useSelectableFamilies,
} from "./useGoogleFonts";
import {
  LETTER_SPACING_RULES,
  LINE_HEIGHT_RULES,
  boldWeightForFont,
  isBoldWeight,
  nearestSupportedWeight,
  regularWeightForFont,
  resolveFontSizeBounds,
} from "@/lib/customizer/v2/text-toolbar";

type Props = {
  layer: any;
  /** The artboard's DPI: font sizes are shown in points (lib/customizer/v2/type-units). */
  dpi?: unknown;
  permissions: Record<string, boolean>;
  isUserLayer: boolean;
  editingText?: boolean;
  onStyleChange: (patch: any, group?: string) => void;
  onEditText: () => void;
  allowedFonts?: string[];
  allowedColors?: string[];
  /** Toggle the Fonts side panel; without it the Font pill opens a floating list. */
  onToggleFonts?: () => void;
  fontsPanelOpen?: boolean;
};

/** The font picker, narrower in the compact density (as in the studio). */
function FontPicker(props: { value: string; onChange: (family: string) => void; onOpen: () => void; allowedFonts: string[]; onToggleFonts?: () => void; fontsPanelOpen?: boolean }) {
  const compact = useCompact();
  return (
    <GoogleFontSelector
      label="Font family"
      value={props.value}
      onChange={props.onChange}
      onOpen={props.onOpen}
      allowedFonts={props.allowedFonts}
      className={compact ? "w-[132px]" : "w-[164px]"}
      triggerPrefix="Font:"
      triggerClassName={`h-[var(--tb-size,36px)] rounded-full px-3 text-[13px] ${props.fontsPanelOpen ? "!bg-[#303839] !text-white [&_span]:!text-white" : "hover:bg-[#303839]/[0.06]"}`}
      portal
      onOpenPanel={props.onToggleFonts}
      panelOpen={props.fontsPanelOpen}
    />
  );
}

export default function CustomerContextToolbar({
  layer,
  dpi,
  permissions,
  isUserLayer,
  editingText = false,
  onStyleChange,
  onEditText,
  allowedFonts = [],
  allowedColors = [],
  onToggleFonts,
  fontsPanelOpen = false,
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
  const canEditContent = isUserLayer || Boolean(permissions.editContent);

  const fontSize = Number(style.fontSize ?? 48);
  // Honour the layer's own limits, exactly as the save validator does — shown
  // in points, like every font-size control (type-units.ts).
  const fontSizeBounds = fontSizeBoundsInPoints(resolveFontSizeBounds(style), dpi);
  const italic = style.fontStyle === "italic";
  const align = style.textAlign || "center";
  const verticalAlign = style.verticalAlign || "middle";
  const lineHeight = Number(style.lineHeight ?? 1.2);

  // Weights and italic availability come from the selected family's real
  // Google Fonts variants, never a fixed list (spec §13).
  const { families } = useSelectableFamilies(allowedFonts);
  const capabilities = useFamilyCapabilities(style.fontFamily, families);
  const weight = nearestSupportedWeight(capabilities.weights, String(style.fontWeight || "400"));
  const bold = isBoldWeight(weight);
  const noItalicCut = capabilities.known && !capabilities.hasItalic && !italic;

  // Load the face this layer actually uses so the canvas measures against real
  // metrics instead of a fallback and then reflowing (spec §14).
  useEffect(() => {
    if (style.fontFamily) void ensureGoogleFontLoaded(style.fontFamily, weight, italic ? "italic" : "normal").catch(reportGoogleFontLoadFailure);
  }, [style.fontFamily, weight, italic]);

  // Switching family may leave the current weight unsupported — snap it to the
  // nearest cut the new family genuinely has, grouped with the font change so
  // it stays ONE undo step.
  const onFontFamilyChange = (fontFamily: string) => {
    const entry = families.find((item) => item.family.toLowerCase() === fontFamily.toLowerCase());
    const nextWeights = entry?.weights?.length ? entry.weights : ["400", "700"];
    const patch: Record<string, unknown> = { fontFamily };
    const snapped = nearestSupportedWeight(nextWeights, weight);
    if (snapped !== weight) patch.fontWeight = snapped;
    if (italic && entry && !entry.hasItalic) patch.fontStyle = "normal";
    void ensureGoogleFontLoaded(fontFamily, snapped, italic && entry?.hasItalic ? "italic" : "normal").catch(reportGoogleFontLoadFailure);
    onStyleChange(patch, "fontFamily");
  };

  const sections: React.ReactNode[] = [];

  if (editingText) {
    sections.push(
      <span key="editing" className="shrink-0 whitespace-nowrap rounded-full bg-[#303839] px-3 py-2 text-[13px] font-semibold text-white">
        Editing text
      </span>,
    );
  } else if (canEditContent) {
    sections.push(<ToolbarButton key="edit" label="Edit Text" icon="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" showLabel primary onClick={onEditText} />);
  }

  if (canFont) {
    sections.push(
      <FontPicker
        key="font"
        value={style.fontFamily || ""}
        onChange={onFontFamilyChange}
        onOpen={() => {
          if (style.fontFamily) void ensureGoogleFontLoaded(style.fontFamily, weight, italic ? "italic" : "normal").catch(reportGoogleFontLoadFailure);
        }}
        allowedFonts={allowedFonts}
        onToggleFonts={onToggleFonts}
        fontsPanelOpen={fontsPanelOpen}
      />,
    );
  }

  if (canSize) {
    sections.push(
      // Shown and typed in points; stored in document px (type-units.ts).
      <ToolbarStepper
        key="size"
        caption="Font size"
        label="Font size"
        value={documentPxToPoints(fontSize, dpi)}
        minimum={fontSizeBounds.minimum}
        maximum={fontSizeBounds.maximum}
        step={FONT_SIZE_POINT_RULES.step}
        largeStep={FONT_SIZE_POINT_RULES.largeStep}
        allowDecimal
        onCommit={(points) => onStyleChange({ fontSize: pointsToDocumentPx(points, dpi) }, "fontSize")}
      />,
    );
  }

  // Colour · Bold · Italic · alignment: one group, as in the studio.
  if (canColor || canStyle || canAlign || canVerticalAlign) {
    sections.push(
      <div key="style" className="flex shrink-0 items-center">
        {canColor && (
          <ToolbarColourControl
            title="Text colour"
            value={style.color || "#303839"}
            palette={allowedColors}
            swatchLabel="Set text colour"
            pickerLabel="Custom text colour"
            onChange={(color) => onStyleChange({ color }, "color")}
          />
        )}
        {canStyle && (
          <>
            <ToolbarButton
              label="Bold"
              pressed={bold}
              onClick={() => onStyleChange({ fontWeight: bold ? regularWeightForFont(capabilities.weights) : boldWeightForFont(capabilities.weights) }, "weight")}
            >
              <span className="text-[15px] font-black leading-none">B</span>
            </ToolbarButton>
            {/* Italic is offered only when the family genuinely ships one
                (spec §13) — production would otherwise have no cut to render. */}
            <ToolbarButton
              label="Italic"
              pressed={italic}
              disabled={noItalicCut}
              title={noItalicCut ? "Italic — this font has no italic cut" : "Italic"}
              onClick={() => onStyleChange({ fontStyle: italic ? "normal" : "italic" })}
            >
              <span className="font-serif text-[16px] italic leading-none">I</span>
            </ToolbarButton>
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
            growth={effectiveTextGrowth(style, layer?.text)}
            canGrowth={canVerticalAlign}
            onGrowthChange={(growthDirection) => onStyleChange({ growthDirection }, "text-growth")}
          />
        )}
      </div>,
    );
  }

  if (canSpacing || canLineHeight) {
    sections.push(
      <div key="spacing" className="flex shrink-0 items-center">
        {canSpacing && (
          <ToolbarStepper
            caption="Letter spacing"
            label="Letter spacing"
            value={Number(style.letterSpacing ?? 0)}
            minimum={LETTER_SPACING_RULES.minimum}
            maximum={LETTER_SPACING_RULES.maximum}
            step={LETTER_SPACING_RULES.step}
            largeStep={LETTER_SPACING_RULES.largeStep}
            allowNegative
            allowDecimal
            onCommit={(letterSpacing) => onStyleChange({ letterSpacing }, "letterSpacing")}
          />
        )}
        {canLineHeight && (
          <ToolbarStepper
            caption="Line height"
            label="Line height"
            value={lineHeight}
            minimum={LINE_HEIGHT_RULES.minimum}
            maximum={LINE_HEIGHT_RULES.maximum}
            step={LINE_HEIGHT_RULES.step}
            largeStep={LINE_HEIGHT_RULES.largeStep}
            allowDecimal
            onCommit={(lineHeight) => onStyleChange({ lineHeight }, "line-height")}
          />
        )}
      </div>,
    );
  }

  return (
    <ToolbarShell
      label="Text formatting"
      selectionKey={String(layer?.id || "")}
      sections={sections}
      attributes={{ "data-customer-text-toolbar": true }}
    />
  );
}
