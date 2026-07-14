"use client";

// Add Text panel (Section 8). Available only when the administrator allowed
// customer-added text for this template/page. Customer text layers are fully
// theirs: movable, resizable, editable, duplicatable, deletable.

import { pageAllowsCustomerText } from "./customizer-utils";

type Props = {
  template: any;
  activePage: string;
  userLayers: any[];
  selectedLayerId?: string | null;
  onAddText: () => void;
  onSelectLayer: (layerId: string) => void;
  onUpdateText: (layerId: string, text: string) => void;
  onDeleteLayer: (layerId: string) => void;
};

export default function CustomerAddTextPanel({
  template,
  activePage,
  userLayers,
  selectedLayerId,
  onAddText,
  onSelectLayer,
  onUpdateText,
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
    <div className="grid gap-4 p-4">
      <button
        type="button"
        onClick={onAddText}
        className="flex items-center justify-center gap-2 rounded-lg border border-[#303839]/15 bg-white px-4 py-3 text-sm font-bold text-[#303839] transition hover:bg-[#F8F6F1]"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add a text box
      </button>
      <p className="text-xs text-[#303839]/55">
        Your text is added to {pageLabel}. Drag it on the design to position it, and use the
        toolbar above the design to style it.
      </p>

      {pageLayers.length > 0 && (
        <div className="grid gap-2">
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
                onChange={(e) => onUpdateText(layer.id, e.target.value)}
                placeholder="Your text"
                rows={2}
                className="w-full resize-none rounded-md border border-[#303839]/12 bg-white px-2.5 py-2 text-sm text-[#303839] outline-none focus:border-[#D4AF37]"
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
