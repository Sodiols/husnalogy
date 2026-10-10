"use client";

import { useEffect, useState } from "react";
import { GRID_PRESETS } from "@/lib/customizer/v2/grids";
import ColourInput from "./ColourInput";

// Insertion routes that are NOT part of the unified Elements library.
// Shapes, lines, frames and QR moved into CustomerElementsPanel; only Photo
// Grids and Background remain their own tools (spec §24, §25).
export default function CustomerInsertPanel({ tool, onAddGrid, onSetBackground, allowedGridPresets = [], allowedColors = [] }: any) {
  const [background, setBackground] = useState("#ffffff");
  useEffect(() => {
    if (allowedColors.length && !allowedColors.includes(background)) setBackground(allowedColors[0]);
  }, [allowedColors, background]);
  const button = "min-h-12 cursor-pointer rounded-[10px] bg-[#F8F6F1] px-3 py-2 text-left text-[13px] font-semibold capitalize text-[#1f2425] transition-colors hover:bg-[#EFEBE1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-white";

  const permit = (values: string[], value: string) => !values.length || values.includes(value);
  if (tool === "grids") return <div className="grid grid-cols-2 gap-2 p-4">{GRID_PRESETS.filter((preset) => permit(allowedGridPresets, preset.id)).map((preset) => <button key={preset.id} type="button" onClick={() => onAddGrid(preset.id)} className={button}><span className="block">{preset.label}</span><span className="mt-0.5 block text-[12px] font-normal text-[#303839]/70">{preset.photoCount} slots</span></button>)}</div>;
  if (tool === "background") return (
    <div className="grid gap-4 p-4">
      <label className="grid gap-2">
        <span className="text-[12.5px] font-semibold text-[#1f2425]">Page background colour</span>
        {allowedColors.length ? (
          <span className="grid grid-cols-5 gap-2">
            {allowedColors.map((color: string) => {
              const active = background.toLowerCase() === color.toLowerCase();
              return (
                <button
                  key={color}
                  type="button"
                  aria-label={`Use background colour ${color}`}
                  aria-pressed={active}
                  onClick={() => setBackground(color)}
                  className={`h-12 cursor-pointer rounded-[10px] shadow-[inset_0_0_0_1px_rgba(48,56,57,0.12)] transition ${active ? "ring-2 ring-[#303839] ring-offset-2" : "hover:shadow-[inset_0_0_0_1px_rgba(48,56,57,0.3)]"}`}
                  style={{ backgroundColor: color }}
                />
              );
            })}
          </span>
        ) : (
          <span className="flex h-12 items-center gap-3 rounded-[10px] bg-[#F8F6F1] px-3">
            <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full shadow-[inset_0_0_0_1px_rgba(48,56,57,0.18)]" style={{ backgroundColor: background }}>
              <ColourInput aria-label="Background colour" value={background} onChange={setBackground} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
            </span>
            <span className="text-[13.5px] font-semibold uppercase tabular-nums text-[#1f2425]">{background}</span>
          </span>
        )}
      </label>
      <button type="button" data-shape="round" onClick={() => onSetBackground(background)} className="min-h-11 cursor-pointer rounded-full bg-[#303839] px-4 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#434c4d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2">Apply background</button>
    </div>
  );
  return null;
}
