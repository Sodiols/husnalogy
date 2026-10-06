"use client";

import EditableNumericStepper from "./EditableNumericStepper";
import { isSvgElement } from "@/lib/customizer/v2/element-colour";

// Contextual toolbar for a selected customer-inserted element (spec §14):
// colour, opacity and flip. Structural commands (duplicate, delete, arrange…)
// live in the shared object menu, opened by right click or "More actions".

type Props = {
  layer: any;
  onPatch: (patch: any, group?: string) => void;
  /** The template's allowed customer colours; empty = any colour. */
  palette?: readonly string[];
};

export default function CustomerElementToolbar({ layer, onPatch, palette = [] }: Props) {
  const divider = <span className="mx-0.5 h-5 w-px shrink-0 bg-[#303839]/12" aria-hidden />;
  const tint = String(layer.tintColor || "");
  // Every SVG can be recoloured — single-colour or not. A raster element that
  // already carries a tint keeps its control so the tint can be changed back.
  const recolourable = isSvgElement(layer) || Boolean(tint);

  return (
    <div
      className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-[#303839]/12 bg-white px-2 py-1.5 shadow-[0_6px_24px_rgba(48,56,57,0.14)] no-scrollbar"
      role="toolbar"
      aria-label="Element options"
    >
      <span className="whitespace-nowrap px-1 text-[10px] font-bold uppercase tracking-wide text-[#303839]/50">Element</span>

      {recolourable && (
        <div role="group" aria-label="Element colour" className="flex shrink-0 items-center gap-1">
          {palette.length ? (
            palette.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={`Element colour ${swatch}`}
                aria-pressed={tint.toLowerCase() === swatch.toLowerCase()}
                onClick={() => onPatch({ tintColor: swatch }, "element-tint")}
                className={`h-7 w-7 shrink-0 rounded-full border shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] ${
                  tint.toLowerCase() === swatch.toLowerCase() ? "border-[#303839] ring-2 ring-[#303839] ring-offset-1" : "border-[#303839]/15"
                }`}
                style={{ backgroundColor: swatch }}
              />
            ))
          ) : (
            <label
              className="relative grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg border border-[#303839]/12 hover:bg-[#303839]/5 focus-within:ring-2 focus-within:ring-[#303839]"
              title="Element colour"
            >
              <span
                className="h-4 w-4 rounded-sm border border-[#303839]/20"
                style={{ background: tint || "conic-gradient(#D4AF37 0 25%, #8FB9A8 0 50%, #C9A0B4 0 75%, #303839 0)" }}
                aria-hidden
              />
              <input
                type="color"
                value={tint || "#303839"}
                onChange={(e) => onPatch({ tintColor: e.target.value }, "element-tint")}
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label="Element colour"
              />
            </label>
          )}
          <button
            type="button"
            aria-pressed={!tint}
            onClick={() => onPatch({ tintColor: "" }, "element-tint-original")}
            title="Show the artwork's own colours"
            className={`h-11 shrink-0 rounded-lg px-2.5 text-[11px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] ${
              !tint ? "bg-[#303839] text-white" : "text-[#303839] hover:bg-[#303839]/5"
            }`}
          >
            Original
          </button>
        </div>
      )}

      <EditableNumericStepper label="Element opacity" value={Math.round((layer.opacity === undefined ? 1 : Number(layer.opacity)) * 100)} minimum={10} maximum={100} step={5} largeStep={25} allowNegative={false} allowDecimal={false} formatValue={(value) => `${Math.round(value)}%`} onCommit={(value) => onPatch({ opacity: value / 100 }, "element-opacity")} showLabel className="h-11 w-32 shrink-0 rounded-lg bg-white px-1" />

      <button
        type="button"
        aria-label="Flip horizontally"
        aria-pressed={Boolean(layer.flipX)}
        onClick={() => onPatch({ flipX: !layer.flipX })}
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
          layer.flipX ? "bg-[#303839] text-white" : "text-[#303839] hover:bg-[#303839]/5"
        }`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M12 3v18M8 8 4 12l4 4M16 8l4 4-4 4" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Flip vertically"
        aria-pressed={Boolean(layer.flipY)}
        onClick={() => onPatch({ flipY: !layer.flipY })}
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
          layer.flipY ? "bg-[#303839] text-white" : "text-[#303839] hover:bg-[#303839]/5"
        }`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M3 12h18M8 8l4-4 4 4M8 16l4 4 4-4" />
        </svg>
      </button>

    </div>
  );
}
