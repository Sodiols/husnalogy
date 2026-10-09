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
import { TextStyleList, TextStyleTip } from "./TextStyleList";

// Same rows as the studio's Add Text panel (both render TextStyleList).
const PRESETS = ([
  ["text", "Add Text", "Fits your words, wraps at the edge"],
  ["heading", "Add Heading", "Large single-line title"],
  ["subheading", "Add Subheading", "Refined supporting line"],
  ["body", "Add Body Text", "Multiline invitation copy"],
] as const).map(([id, label, description]) => ({ id, label, description }));

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
      <div className="grid gap-4">
        <p className="text-[13px] leading-relaxed text-[#303839]/70">
          Click a style to add one text box to {pageLabel}, then type straight into it.
        </p>
        <TextStyleList items={PRESETS} selected={selectedPreset} onSelect={onSelectPreset} />
        <TextStyleTip>Each click adds one text box. Drag it into place on the card, or edit it below.</TextStyleTip>
      </div>

      {pageLayers.length > 0 && (
        <div className="grid gap-2.5">
          <h4 className="text-[14px] font-bold text-[#1f2425]">Your text on {pageLabel}</h4>
          {pageLayers.map((layer) => (
            <div
              key={layer.id}
              className={`rounded-[10px] border bg-white p-2.5 transition-[border-color,box-shadow] duration-200 ${
                selectedLayerId === layer.id ? "border-[#D4AF37] shadow-[0_0_0_1px_#D4AF37]" : "border-[#303839]/12"
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
