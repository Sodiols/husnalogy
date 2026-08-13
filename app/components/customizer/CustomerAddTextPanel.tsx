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
      <p className="p-5 text-sm text-[#303839]/55">
        Adding your own text is not available on {pageLabel} for this design.
      </p>
    );
  }

  return (
    <div className="grid gap-4 bg-[#F4ECEC]/45 p-4">
      <div className="rounded-2xl border border-[#303839]/8 bg-white p-4 shadow-[0_8px_28px_rgba(48,56,57,0.06)]">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#303839]/45">Add text</p>
        <p className="mt-1 font-display text-[21px] leading-tight text-[#303839]">Choose a text style</p>
        <p className="mt-1 text-xs leading-relaxed text-[#303839]/55">
          Choose a style to add one text box to the card, then type straight into it.
        </p>

        <div className="mt-3 grid gap-2">
          {([
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
                className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${
                  active
                    ? "border-[#D4AF37] bg-[#D4AF37]/8"
                    : "border-[#303839]/10 hover:border-[#D4AF37]/60 hover:bg-[#F8F6F1]"
                }`}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#303839] font-display text-base text-white" aria-hidden>
                  {sample}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-bold text-[#303839]">{label}</span>
                  <span className="mt-0.5 block text-[10px] text-[#303839]/48">{description}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-xl bg-[#303839] px-3 py-3 text-white">
          <svg className="shrink-0 text-[#D4AF37]" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <path d="M4 7V5h16v2M12 5v14M9 19h6" />
          </svg>
          <span className="text-[11px] font-bold">Each choice adds one text box to {pageLabel}</span>
        </div>
      </div>

      {pageLayers.length > 0 && (
        <div className="grid gap-2 rounded-2xl border border-[#303839]/8 bg-white p-3">
          <h4 className="text-xs font-extrabold uppercase tracking-wide text-[#303839]/60">Your text on {pageLabel}</h4>
          {pageLayers.map((layer) => (
            <div
              key={layer.id}
              className={`rounded-lg border p-2.5 transition ${
                selectedLayerId === layer.id ? "border-[#D4AF37] bg-[#D4AF37]/5" : "border-[#303839]/12"
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
                className="min-h-10 w-full resize-none rounded-md border border-[#303839]/12 bg-white px-2.5 py-2 text-sm text-[#303839] outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/15"
                aria-label="Your text"
              />
              <div className="mt-1.5 flex justify-end">
                <button
                  type="button"
                  onClick={() => onDeleteLayer(layer.id)}
                  className="text-xs font-bold text-red-700 underline-offset-2 hover:underline"
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
