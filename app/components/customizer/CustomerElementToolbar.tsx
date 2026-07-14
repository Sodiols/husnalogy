"use client";

// Contextual toolbar for a selected customer-inserted element (spec §14):
// colour (tintable elements), opacity, flip, duplicate, delete. Customer
// elements are user layers, so the full set is always available.

type Props = {
  layer: any;
  onPatch: (patch: any, group?: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

export default function CustomerElementToolbar({ layer, onPatch, onDuplicate, onDelete }: Props) {
  const divider = <span className="mx-0.5 h-5 w-px shrink-0 bg-[#303839]/12" aria-hidden />;

  return (
    <div
      className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-[#303839]/12 bg-white px-2 py-1.5 shadow-[0_6px_24px_rgba(48,56,57,0.14)] no-scrollbar"
      role="toolbar"
      aria-label="Element options"
    >
      <span className="whitespace-nowrap px-1 text-[10px] font-bold uppercase tracking-wide text-[#303839]/50">Element</span>

      {layer.tintColor !== undefined && layer.tintColor !== "" && (
        <label
          className="relative grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md border border-[#303839]/12 hover:bg-[#F8F6F1]"
          title="Element colour"
        >
          <span className="sr-only">Element colour</span>
          <span className="h-4 w-4 rounded-sm border border-[#303839]/20" style={{ background: layer.tintColor || "#303839" }} aria-hidden />
          <input
            type="color"
            value={layer.tintColor || "#303839"}
            onChange={(e) => onPatch({ tintColor: e.target.value }, "element-tint")}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label="Element colour"
          />
        </label>
      )}

      <label className="flex shrink-0 items-center gap-1.5 px-1.5" title="Opacity">
        <span className="text-[10px] font-bold uppercase text-[#303839]/50">Opacity</span>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={layer.opacity === undefined ? 1 : Number(layer.opacity)}
          onChange={(e) => onPatch({ opacity: Number(e.target.value) }, "element-opacity")}
          className="w-16 accent-[#303839]"
          aria-label="Element opacity"
        />
      </label>

      <button
        type="button"
        aria-label="Flip horizontally"
        aria-pressed={Boolean(layer.flipX)}
        onClick={() => onPatch({ flipX: !layer.flipX })}
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-md transition ${
          layer.flipX ? "bg-[#303839] text-white" : "text-[#303839] hover:bg-[#F8F6F1]"
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
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-md transition ${
          layer.flipY ? "bg-[#303839] text-white" : "text-[#303839] hover:bg-[#F8F6F1]"
        }`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M3 12h18M8 8l4-4 4 4M8 16l4 4 4-4" />
        </svg>
      </button>

      {divider}

      <button
        type="button"
        aria-label="Duplicate element"
        onClick={onDuplicate}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[#303839] hover:bg-[#F8F6F1]"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
          <rect x="9" y="9" width="12" height="12" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Delete element"
        onClick={onDelete}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-red-700 hover:bg-red-50"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        </svg>
      </button>
    </div>
  );
}
