"use client";

import type { TextPlacementPreset } from "@/lib/customizer/v2/text-editing";
import { TextStyleList, TextStyleTip, type TextStyleItem } from "@/app/components/customizer/TextStyleList";

/**
 * The studio's Add Text panel. It renders the same TextStyleList as the
 * customer customizer's panel (CustomerAddTextPanel), so both editors offer
 * text styles in exactly the same way.
 */

type Props = {
  preset: TextPlacementPreset;
  onSelectPreset: (preset: TextPlacementPreset) => void;
};

const PRESETS: TextStyleItem[] = [
  { id: "text", label: "Add Text", description: "17 pt, wraps at the safe area" },
  { id: "heading", label: "Add Heading", description: "Large single-line title" },
  { id: "subheading", label: "Add Subheading", description: "Refined supporting line" },
  { id: "body", label: "Add Body Text", description: "Multiline invitation copy" },
];

export default function AdminTextToolPanel({ preset, onSelectPreset }: Props) {
  return (
    <div className="grid gap-4 px-4 pb-6 pt-1">
      <p className="text-[13px] leading-relaxed text-[#303839]/70">
        Click a style to add one text box to the centre of the card, ready to type into.
      </p>
      <TextStyleList items={PRESETS} selected={preset} onSelect={onSelectPreset} />
      <TextStyleTip>One click adds one text box, then the editor returns to Select so the card never gains text by accident.</TextStyleTip>
    </div>
  );
}
