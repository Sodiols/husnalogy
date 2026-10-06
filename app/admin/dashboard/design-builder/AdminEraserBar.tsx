"use client";

import EditableNumericStepper from "@/app/components/customizer/EditableNumericStepper";

/** Brush size limits, in artboard pixels. */
export const ERASER_BRUSH = { minimum: 4, maximum: 400 } as const;

type Props = {
  brushSize: number;
  canUndo: boolean;
  canRedo: boolean;
  canRestore: boolean;
  onBrushSize: (size: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  /** Bring back everything erased on this photo (itself one undoable step). */
  onRestore: () => void;
  onCancel: () => void;
  onApply: () => void;
};

function Icon({ path }: { path: string }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}

const BUTTON =
  "flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-[#303839] transition-colors hover:bg-[#303839]/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] disabled:cursor-not-allowed disabled:text-[#303839]/30 disabled:hover:bg-transparent";

/**
 * The eraser's own bar, shown in place of the selection toolbar while erasing.
 * Undo and Redo step through this session's strokes only; nothing reaches the
 * document until Apply.
 */
export default function AdminEraserBar(props: Props) {
  return (
    <div
      data-admin-eraser-bar
      role="toolbar"
      aria-label="Eraser"
      className="flex max-w-full items-center overflow-x-auto rounded-full border border-[#303839]/10 bg-white p-1 shadow-[0_4px_18px_rgba(48,56,57,0.12)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <span className="shrink-0 pl-3 pr-2 text-[13px] font-semibold text-[#303839]">Eraser</span>
      <div className="flex shrink-0 items-center gap-2 px-2 text-[13px] text-[#303839]/80">
        <span aria-hidden className="whitespace-nowrap">Brush size</span>
        {/* The shared numeric control, with its slider: drag, type or step. */}
        <EditableNumericStepper
          label="Brush size"
          value={props.brushSize}
          minimum={ERASER_BRUSH.minimum}
          maximum={ERASER_BRUSH.maximum}
          step={1}
          largeStep={10}
          slider
          sliderClassName="h-9 w-28 accent-[#303839]"
          onCommit={props.onBrushSize}
          className="h-9 w-full rounded-full"
          inputClassName="h-9 w-full rounded-full border border-[#303839]/12 bg-white text-center text-[13px] font-semibold tabular-nums text-[#303839] outline-none focus:border-[#303839]/50"
        />
      </div>
      <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-[#303839]/12" />
      <button type="button" aria-label="Undo erase" title="Undo (Ctrl+Z)" disabled={!props.canUndo} onClick={props.onUndo} className={`${BUTTON} w-9 px-0`}>
        <Icon path="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
      </button>
      <button type="button" aria-label="Redo erase" title="Redo (Ctrl+Y)" disabled={!props.canRedo} onClick={props.onRedo} className={`${BUTTON} w-9 px-0`}>
        <Icon path="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
      </button>
      <button type="button" title="Bring back everything erased on this photo" disabled={!props.canRestore} onClick={props.onRestore} className={BUTTON}>
        Restore all
      </button>
      <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-[#303839]/12" />
      <button type="button" title="Cancel (Escape) — discard this session's strokes" onClick={props.onCancel} className={BUTTON}>
        Cancel
      </button>
      <button
        type="button"
        title="Apply (Enter)"
        onClick={props.onApply}
        className="flex h-9 shrink-0 items-center rounded-full bg-[#303839] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#3D4647] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
      >
        Apply
      </button>
    </div>
  );
}
