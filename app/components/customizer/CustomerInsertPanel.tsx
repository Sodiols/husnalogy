"use client";

import { useEffect, useState } from "react";
import { GRID_PRESETS } from "@/lib/customizer/v2/grids";
import { isValidQRValue } from "@/lib/customizer/v2/qr";

export default function CustomerInsertPanel({ tool, onAddShape, onAddLine, onAddFrame, onAddGrid, onAddQRCode, onSetBackground, allowedShapes = [], allowedFrameMasks = [], allowedGridPresets = [], allowedColors = [] }: any) {
  const [qrValue, setQrValue] = useState("https://husnalogy.com");
  const [background, setBackground] = useState("#ffffff");
  useEffect(() => {
    if (allowedColors.length && !allowedColors.includes(background)) setBackground(allowedColors[0]);
  }, [allowedColors, background]);
  const button = "min-h-12 rounded-xl border border-[#303839]/12 bg-white px-3 text-left text-xs font-bold text-[#303839] transition hover:border-[#D4AF37] hover:bg-[#F8F6F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]";

  const permit = (values: string[], value: string) => !values.length || values.includes(value);
  if (tool === "shapes") return <div className="grid grid-cols-2 gap-2 p-3">{["rectangle", "rounded-rectangle", "circle", "oval", "triangle", "polygon", "arch"].filter((shape) => permit(allowedShapes, shape)).map((shape) => <button key={shape} type="button" onClick={() => onAddShape(shape)} className={button}>{shape.replace("-", " ")}</button>)}</div>;
  if (tool === "lines") return <div className="grid gap-2 p-3">{["solid", "dashed", "dotted"].map((style) => <button key={style} type="button" onClick={() => onAddLine(style)} className={button}>{style} line</button>)}</div>;
  if (tool === "frames") return <div className="grid grid-cols-2 gap-2 p-3">{["rectangle", "rounded", "circle", "oval", "arch", "arch-top", "arch-bottom"].filter((shape) => permit(allowedFrameMasks, shape)).map((shape) => <button key={shape} type="button" onClick={() => onAddFrame(shape)} className={button}>{shape.replace("-", " ")} frame</button>)}</div>;
  if (tool === "grids") return <div className="grid grid-cols-2 gap-2 p-3">{GRID_PRESETS.filter((preset) => permit(allowedGridPresets, preset.id)).map((preset) => <button key={preset.id} type="button" onClick={() => onAddGrid(preset.id)} className={button}><span className="block">{preset.label}</span><span className="mt-1 block text-[10px] text-[#303839]/45">{preset.photoCount} slots</span></button>)}</div>;
  if (tool === "qr") return <div className="grid gap-3 p-4"><label className="grid gap-1 text-xs font-bold"><span>Destination URL</span><input type="url" value={qrValue} onChange={(event) => setQrValue(event.target.value)} className="h-12 rounded-xl border border-[#303839]/15 px-3 outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20" /></label>{!isValidQRValue(qrValue) && <p className="text-xs font-semibold text-red-700">Enter a valid http, https, email, or telephone destination.</p>}<button type="button" disabled={!isValidQRValue(qrValue)} onClick={() => onAddQRCode(qrValue)} className="min-h-12 rounded-xl bg-[#303839] px-4 text-sm font-bold text-white disabled:opacity-35">Add QR code</button></div>;
  if (tool === "background") return <div className="grid gap-3 p-4"><label className="grid gap-1 text-xs font-bold"><span>Page background colour</span>{allowedColors.length ? <span className="grid grid-cols-5 gap-2">{allowedColors.map((color: string) => <button key={color} type="button" aria-label={`Use background colour ${color}`} aria-pressed={background.toLowerCase() === color.toLowerCase()} onClick={() => setBackground(color)} className={`h-12 rounded-xl border-2 ${background.toLowerCase() === color.toLowerCase() ? "border-[#303839]" : "border-white"}`} style={{ backgroundColor: color }} />)}</span> : <input type="color" value={background} onChange={(event) => setBackground(event.target.value)} className="h-12 w-full rounded-xl border border-[#303839]/15" />}</label><button type="button" onClick={() => onSetBackground(background)} className="min-h-12 rounded-xl bg-[#303839] px-4 text-sm font-bold text-white">Apply background</button></div>;
  return null;
}
