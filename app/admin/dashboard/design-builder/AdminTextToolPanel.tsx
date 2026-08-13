"use client";

import type { TextPlacementPreset } from "@/lib/customizer/v2/text-editing";

type Props = {
  preset: TextPlacementPreset;
  onSelectPreset: (preset: TextPlacementPreset) => void;
};

const PRESETS: Array<{
  id: TextPlacementPreset;
  label: string;
  sample: string;
  description: string;
}> = [
  { id: "heading", label: "Add Heading", sample: "A Beautiful Beginning", description: "Large, single-line title" },
  { id: "subheading", label: "Add Subheading", sample: "Together with their families", description: "Refined supporting line" },
  { id: "body", label: "Add Body Text", sample: "Write your message here", description: "Multiline invitation copy" },
];

export default function AdminTextToolPanel({ preset, onSelectPreset }: Props) {
  return (
    <div className="h-full bg-[#F4ECEC] p-4">
      <div className="rounded-2xl border border-[#303839]/8 bg-white p-4 shadow-[0_10px_30px_rgba(48,56,57,0.07)]">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#303839]/45">Add text</p>
        <h2 className="mt-1 font-display text-[24px] leading-tight text-[#303839]">Place text naturally</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-[#303839]/58">
          Each style adds one text box to the centre of the card, ready to type into.
        </p>

        <div className="mt-4 grid gap-2">
          {PRESETS.map((item) => {
            const active = item.id === preset;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                onClick={() => onSelectPreset(item.id)}
                className={`min-h-16 cursor-pointer rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${
                  active
                    ? "border-[#D4AF37] bg-[#D4AF37]/8"
                    : "border-[#303839]/10 bg-white hover:border-[#D4AF37]/60 hover:bg-[#F8F6F1]"
                }`}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-xs font-bold text-[#303839]">{item.label}</span>
                    <span className="mt-0.5 block text-[10px] text-[#303839]/48">{item.description}</span>
                  </span>
                  <span className="shrink-0 font-display text-base text-[#303839]" aria-hidden>
                    {item.sample.slice(0, item.id === "body" ? 8 : 3)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex items-center gap-3 rounded-xl bg-[#303839] px-3 py-3 text-white">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#D4AF37] text-[#303839]" aria-hidden>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 7V5h16v2M12 5v14M9 19h6" />
            </svg>
          </span>
          <span>
            <span className="block text-xs font-bold">One click, one text box</span>
            <span className="mt-0.5 block text-[10px] text-white/58">The editor returns to Select straight away, so the card never gains text by accident.</span>
          </span>
        </div>
      </div>
    </div>
  );
}
