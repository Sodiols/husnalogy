"use client";

/**
 * A shape's Fill Colour or a shape/line's Line Colour (Customizer Point 5),
 * shared by the Design Studio inspector and the customer panel.
 *
 * A paint is a colour or TRANSPARENT. Transparent stores the renderer's real
 * "no paint" value (`"none"`, lib/customizer/v2/paint.ts) — never white — and
 * shows as a checkerboard so it cannot be mistaken for a colour. Picking a
 * colour again restores the last colour used.
 *
 * With a palette (the template's allowed customer colours) only those swatches
 * are offered; the server enforces the same palette, so the control never
 * offers a colour a save would refuse. Transparent is always allowed: it is the
 * absence of a colour.
 */

import { useState } from "react";
import { TRANSPARENT_PAINT, isTransparentPaint } from "@/lib/customizer/v2/paint";
import ColourInput from "./ColourInput";

const CHECKERBOARD =
  "repeating-conic-gradient(#d9d6cf 0% 25%, #ffffff 0% 50%) 50% / 10px 10px";

type Props = {
  label: string;
  value: string | undefined;
  /** Shown in the picker when the stored value is transparent or empty. */
  fallbackColour: string;
  onChange: (paint: string) => void;
  disabled?: boolean;
  palette?: readonly string[];
};

export default function PaintControl({ label, value, fallbackColour, onChange, disabled = false, palette }: Props) {
  const transparent = isTransparentPaint(value);
  const [lastColour, setLastColour] = useState(transparent ? fallbackColour : String(value));
  const colour = transparent ? lastColour : String(value);
  const choices = (palette || []).filter((item) => !isTransparentPaint(item));

  const pick = (next: string) => {
    setLastColour(next);
    onChange(next);
  };

  return (
    <div
      role="group"
      aria-label={label}
      className={`grid gap-2 rounded-xl border border-[#303839]/10 bg-white px-3 py-2.5 ${disabled ? "opacity-45" : ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-[#303839]">{label}</span>
        <div className="flex items-center gap-2">
          {!choices.length && (
            <span className="relative grid h-8 w-8 place-items-center rounded-full border border-[#303839]/15 bg-white shadow-sm">
              <span
                className="h-5 w-5 rounded-full"
                style={{ background: transparent ? CHECKERBOARD : colour }}
                aria-hidden
              />
              <ColourInput
                aria-label={`${label} colour`}
                value={colour}
                fallback={fallbackColour}
                disabled={disabled}
                onChange={pick}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
              />
            </span>
          )}
          <button
            type="button"
            aria-pressed={transparent}
            disabled={disabled}
            onClick={() => (transparent ? onChange(lastColour) : onChange(TRANSPARENT_PAINT))}
            className={`flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] disabled:cursor-not-allowed ${
              transparent
                ? "border-[#303839] bg-[#303839] text-white"
                : "border-[#303839]/15 bg-white text-[#303839]/70 hover:border-[#303839]/30 hover:text-[#303839]"
            }`}
          >
            <span className="h-3.5 w-3.5 rounded-full border border-[#303839]/20" style={{ background: CHECKERBOARD }} aria-hidden />
            Transparent
          </button>
        </div>
      </div>
      {choices.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {choices.map((swatch) => {
            const active = !transparent && swatch.toLowerCase() === String(value || "").toLowerCase();
            return (
              <button
                key={swatch}
                type="button"
                aria-label={`${label} ${swatch}`}
                aria-pressed={active}
                disabled={disabled}
                onClick={() => pick(swatch)}
                className={`h-7 w-7 rounded-full border shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 disabled:cursor-not-allowed ${
                  active ? "border-[#303839] ring-2 ring-[#303839] ring-offset-1" : "border-[#303839]/15"
                }`}
                style={{ backgroundColor: swatch }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
