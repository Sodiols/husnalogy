"use client";

import { isSvgElement } from "@/lib/customizer/v2/element-colour";
import { ToolbarButton, ToolbarColourControl, ToolbarShell, ToolbarStepper } from "./CustomerToolbarKit";

// Contextual toolbar for a selected customer-inserted element (spec §14):
// colour, opacity and flip. Structural commands (duplicate, delete, arrange…)
// live in the shared object menu, opened by right click or "More actions".
// Drawn like the studio's selection toolbar through CustomerToolbarKit.

type Props = {
  layer: any;
  onPatch: (patch: any, group?: string) => void;
  /** The template's allowed customer colours; empty = any colour. */
  palette?: readonly string[];
};

const ICONS = {
  flipX: "M12 3v18M8 8 4 12l4 4M16 8l4 4-4 4",
  flipY: "M3 12h18M8 8l4-4 4 4M8 16l4 4 4-4",
} as const;

export default function CustomerElementToolbar({ layer, onPatch, palette = [] }: Props) {
  const tint = String(layer.tintColor || "");
  // Every SVG can be recoloured — single-colour or not. A raster element that
  // already carries a tint keeps its control so the tint can be changed back.
  const recolourable = isSvgElement(layer) || Boolean(tint);

  const sections: React.ReactNode[] = [];
  if (recolourable) {
    sections.push(
      <ToolbarColourControl
        key="colour"
        title="Element colour"
        value={tint}
        palette={palette}
        swatchLabel="Element colour"
        pickerLabel="Custom element colour"
        onChange={(tintColor) => onPatch({ tintColor }, "element-tint")}
        original={{ label: "Original colours", active: !tint, onSelect: () => onPatch({ tintColor: "" }, "element-tint-original") }}
      />,
    );
  }
  sections.push(
    <ToolbarStepper
      key="opacity"
      caption="Opacity"
      label="Element opacity"
      value={Math.round((layer.opacity === undefined ? 1 : Number(layer.opacity)) * 100)}
      minimum={10}
      maximum={100}
      step={5}
      largeStep={25}
      formatValue={(value) => `${Math.round(value)}%`}
      widthClass="w-[112px]"
      onCommit={(value) => onPatch({ opacity: value / 100 }, "element-opacity")}
    />,
  );
  sections.push(
    <div key="flip" className="flex shrink-0 items-center">
      <ToolbarButton label="Flip horizontally" icon={ICONS.flipX} pressed={Boolean(layer.flipX)} onClick={() => onPatch({ flipX: !layer.flipX })} />
      <ToolbarButton label="Flip vertically" icon={ICONS.flipY} pressed={Boolean(layer.flipY)} onClick={() => onPatch({ flipY: !layer.flipY })} />
    </div>,
  );

  return <ToolbarShell label="Element options" selectionKey={`element-${layer?.id || ""}`} sections={sections} />;
}
