"use client";

/**
 * Text growth: which edge of a text object holds still when the text gets
 * taller (lib/customizer/v2/text-growth.ts). Shared by the Design Studio
 * inspector and the customer text toolbar so both offer the same three
 * choices with the same names.
 */

import type { TextGrowthDirection } from "@/lib/customizer/v2/text-growth";

export const TEXT_GROWTH_OPTIONS: ReadonlyArray<{ value: TextGrowthDirection; label: string; hint: string; path: string }> = [
  { value: "up", label: "Upward", hint: "The bottom edge stays put; new lines push the text up", path: "M5 20h14M12 16V5M8 9l4-4 4 4" },
  { value: "center", label: "Center", hint: "The centre stays put; the text grows up and down evenly", path: "M5 12h14M12 3v5M9 5l3-3 3 3M12 21v-5M9 19l3 3 3-3" },
  { value: "down", label: "Downward", hint: "The top edge stays put; new lines push the text down", path: "M5 4h14M12 8v11M8 15l4 4 4-4" },
];

export function TextGrowthIcon({ path, size = 16 }: { path: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}

type Props = {
  value: TextGrowthDirection;
  onChange: (value: TextGrowthDirection) => void;
  disabled?: boolean;
};

export default function TextGrowthControl({ value, onChange, disabled = false }: Props) {
  return (
    <div role="radiogroup" aria-label="Text growth" className="grid grid-cols-3 gap-1 rounded-xl border border-[#303839]/12 bg-white p-1">
      {TEXT_GROWTH_OPTIONS.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.hint}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`flex h-10 items-center justify-center gap-1.5 rounded-lg text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] disabled:cursor-not-allowed disabled:opacity-35 ${
              active ? "bg-[#303839] text-white" : "text-[#303839]/70 hover:bg-[#F8F6F1] hover:text-[#303839]"
            }`}
          >
            <TextGrowthIcon path={option.path} />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
