"use client";

// Add Text panel (Section 8). Available only when the administrator allowed
// customer-added text for this template/page. Customer text layers are fully
// theirs: movable, resizable, editable, duplicatable, deletable.

import { pageAllowsCustomerText } from "./customizer-utils";
import {
  applyTextEditLimits,
  resolveTextEditorKeyAction,
  type TextPlacementPreset,
} from "@/lib/customizer/v2/text-editing";

type Props = {
  template: any;
  activePage: string;
  userLayers: any[];
  selectedLayerId?: string | null;
  selectedPreset: TextPlacementPreset;
  onSelectPreset: (preset: TextPlacementPreset) => void;
  onSelectLayer: (layerId: string) => void;
  onUpdateText: (layerId: string, text: string) => void;
  onEnableMultiline: (layerId: string) => void;
  onDeleteLayer: (layerId: string) => void;
};

export default function CustomerAddTextPanel({
  template,
  activePage,
  userLayers,
  selectedLayerId,
  selectedPreset,
  onSelectPreset,
  onSelectLayer,
  onUpdateText,
  onEnableMultiline,
  onDeleteLayer,
}: Props) {
  const allowed = pageAllowsCustomerText(template, activePage);
  const pageLayers = (userLayers || []).filter((layer) => layer.page === activePage);
  const pageLabel =
    (template?.pages || []).find((p: any) => p.id === activePage)?.label || "this page";

  if (!allowed) {
    return (
      <p className="p-5 text-sm text-[#303839]/70">
        Adding your own text is not available on {pageLabel} for this design.
      </p>
    );
  }

  return (
    <div className="grid gap-6 p-4">
      <div>
        <p className="text-[12.5px] font-semibold text-[#303839]/70">Add text</p>
        <p className="mt-0.5 text-[16px] font-bold leading-tight text-[#1f2425]">Choose a text style</p>
        <p className="mt-1 text-[13px] leading-relaxed text-[#303839]/70">
          Choose a style to add one text box to the card, then type straight into it.
        </p>

        <div className="mt-3 grid gap-2">
          {([
            ["text", "Add Text", "Fits your words, wraps at the edge", "T"],
            ["heading", "Add Heading", "Large single-line title", "Aa"],
            ["subheading", "Add Subheading", "Refined supporting line", "Ag"],
            ["body", "Add Body Text", "Multiline invitation copy", "¶"],
          ] as const).map(([id, label, description, sample]) => {
            const active = selectedPreset === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => onSelectPreset(id)}
                className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
                  active
                    ? "bg-[#D4AF37]/10 ring-[1.5px] ring-[#D4AF37]"
                    : "bg-[#F8F6F1] hover:bg-[#EFEBE1]"
                }`}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-white font-display text-base text-[#303839] shadow-[0_1px_3px_rgba(31,36,37,0.14)]" aria-hidden>
                  {sample}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-[#1f2425]">{label}</span>
                  <span className="mt-0.5 block text-[12px] text-[#303839]/70">{description}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-[10px] bg-[#303839] px-3 py-3 text-white">
          <svg className="shrink-0 text-[#D4AF37]" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <path d="M4 7V5h16v2M12 5v14M9 19h6" />
          </svg>
          <span className="text-[12.5px] font-semibold">Each choice adds one text box to {pageLabel}</span>
        </div>
      </div>

      {pageLayers.length > 0 && (
        <div className="grid gap-2.5">
          <h4 className="text-[14px] font-bold text-[#1f2425]">Your text on {pageLabel}</h4>
          {pageLayers.map((layer) => (
            <div
              key={layer.id}
              className={`rounded-[10px] p-2.5 transition ${
                selectedLayerId === layer.id ? "bg-[#D4AF37]/10 ring-[1.5px] ring-[#D4AF37]" : "bg-[#F8F6F1]"
              }`}
            >
              <textarea
                value={layer.text || ""}
                onFocus={() => onSelectLayer(layer.id)}
                onChange={(event) => {
                  const limited = applyTextEditLimits(event.target.value, {
                    maxLines: Number(layer.maxLines) || 0,
                    maxLength: Number(layer.maxChars) || 0,
                  });
                  onUpdateText(layer.id, limited.value);
                }}
                onInput={(event) => {
                  event.currentTarget.style.height = "auto";
                  event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 240)}px`;
                }}
                onKeyDown={(event) => {
                  const action = resolveTextEditorKeyAction(event, true);
                  if (action === "commit") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  } else if (action === "newline" && !layer.textStyle?.multiline) {
                    onEnableMultiline(layer.id);
                  }
                }}
                placeholder="Your text"
                rows={layer.textStyle?.multiline ? 2 : 1}
                maxLength={Number(layer.maxChars) > 0 ? Number(layer.maxChars) : undefined}
                className="min-h-10 w-full resize-none rounded-md border border-[#303839]/20 bg-white px-2.5 py-2 text-[14px] text-[#1f2425] outline-none focus:border-[#303839] focus:ring-2 focus:ring-[#303839]/15"
                aria-label="Your text"
              />
              <div className="mt-1.5 flex justify-end">
                <button
                  type="button"
                  onClick={() => onDeleteLayer(layer.id)}
                  className="cursor-pointer rounded-md px-1 text-[12.5px] font-semibold text-red-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
