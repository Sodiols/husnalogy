"use client";

import { useEffect, useState } from "react";
import { GRID_PRESETS } from "@/lib/customizer/v2/grids";

// Insertion routes that are NOT part of the unified Elements library.
// Shapes, lines, frames and QR moved into CustomerElementsPanel; only Photo
// Grids and Background remain their own tools (spec §24, §25).
export default function CustomerInsertPanel({ tool, onAddGrid, onSetBackground, allowedGridPresets = [], allowedColors = [] }: any) {
  const [background, setBackground] = useState("#ffffff");
  useEffect(() => {
    if (allowedColors.length && !allowedColors.includes(background)) setBackground(allowedColors[0]);
  }, [allowedColors, background]);
  const button = "min-h-12 rounded-lg border border-[#303839]/10 bg-white px-3 text-left text-xs font-semibold capitalize text-[#303839] transition-colors hover:border-[#303839]/25 hover:bg-[#303839]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]";

  const permit = (values: string[], value: string) => !values.length || values.includes(value);
  if (tool === "grids") return <div className="grid grid-cols-2 gap-2 p-4">{GRID_PRESETS.filter((preset) => permit(allowedGridPresets, preset.id)).map((preset) => <button key={preset.id} type="button" onClick={() => onAddGrid(preset.id)} className={button}><span className="block">{preset.label}</span><span className="mt-1 block text-[10px] text-[#303839]/45">{preset.photoCount} slots</span></button>)}</div>;
  if (tool === "background") return <div className="grid gap-3 p-4"><label className="grid gap-1 text-xs font-bold"><span>Page background colour</span>{allowedColors.length ? <span className="grid grid-cols-5 gap-2">{allowedColors.map((color: string) => <button key={color} type="button" aria-label={`Use background colour ${color}`} aria-pressed={background.toLowerCase() === color.toLowerCase()} onClick={() => setBackground(color)} className={`h-12 rounded-xl border-2 ${background.toLowerCase() === color.toLowerCase() ? "border-[#303839]" : "border-white"}`} style={{ backgroundColor: color }} />)}</span> : <input type="color" value={background} onChange={(event) => setBackground(event.target.value)} className="h-12 w-full rounded-xl border border-[#303839]/15" />}</label><button type="button" onClick={() => onSetBackground(background)} className="min-h-12 rounded-xl bg-[#303839] px-4 text-sm font-bold text-white">Apply background</button></div>;
  return null;
}
