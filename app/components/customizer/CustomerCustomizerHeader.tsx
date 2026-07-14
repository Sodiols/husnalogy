"use client";

// Fixed top header of the customer customizer (Section 3).
// Left: close / save & exit / title / save status.
// Centre: Design – Options – Review tabs.
// Right: undo, redo, preview, and the stage-aware primary button.

const STEPS = [
  { id: "design", label: "Design" },
  { id: "options", label: "Options" },
  { id: "review", label: "Review" },
];

function IconButton({ label, onClick, disabled, children }: any) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid h-9 w-9 place-items-center rounded-full text-[#303839] transition hover:bg-[#F4ECEC] disabled:opacity-35 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

const UndoIcon = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
);

const RedoIcon = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </svg>
);

const CloseIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

const EyeIcon = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

type Props = {
  productTitle: string;
  step: string;
  onStepChange: (step: string) => void;
  canEnterReview: boolean;
  saveStatusLabel: string;
  saveStatus: string;
  onClose: () => void;
  onSaveExit: () => void;
  savingDraft: boolean;
  restoreReady: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  previewMode: boolean;
  onTogglePreview: () => void;
  primaryLabel: string;
  primaryDisabled?: boolean;
  onPrimary: () => void;
};

export default function CustomerCustomizerHeader({
  productTitle,
  step,
  onStepChange,
  canEnterReview,
  saveStatusLabel,
  saveStatus,
  onClose,
  onSaveExit,
  savingDraft,
  restoreReady,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  previewMode,
  onTogglePreview,
  primaryLabel,
  primaryDisabled,
  onPrimary,
}: Props) {
  return (
    <>
    <header className="relative z-40 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-[#303839]/10 bg-white px-3 sm:px-4">
      {/* Left */}
      <div className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2">
        <IconButton label="Close customizer" onClick={onClose}>
          {CloseIcon}
        </IconButton>
        <button
          type="button"
          onClick={onSaveExit}
          disabled={savingDraft || !restoreReady}
          className="hidden whitespace-nowrap rounded-full border border-[#303839]/15 px-3.5 py-1.5 text-xs font-bold text-[#303839] transition hover:bg-[#F4ECEC] disabled:opacity-50 md:block"
        >
          {savingDraft ? "Saving…" : "Save & Exit"}
        </button>
        <h1 className="hidden min-w-0 truncate font-display text-lg text-[#303839] sm:block">{productTitle}</h1>
        <span className="hidden h-5 w-px shrink-0 bg-[#303839]/15 lg:block" aria-hidden />
        <span
          className={`hidden items-center gap-1.5 whitespace-nowrap text-[11px] font-bold lg:flex ${
            saveStatus === "error" ? "text-red-700" : "text-[#303839]/55"
          }`}
          aria-live="polite"
        >
          {saveStatus === "saved" && <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />}
          {saveStatusLabel}
        </span>
      </div>

      {/* Centre tabs */}
      <nav className="flex h-full shrink-0 items-stretch" aria-label="Customizer steps">
        {STEPS.map((s) => {
          const active = step === s.id;
          const locked = s.id === "review" && !canEnterReview && !active;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onStepChange(s.id)}
              aria-current={active ? "step" : undefined}
              className={`relative px-3 text-sm transition sm:px-5 ${
                active
                  ? "font-bold text-[#303839]"
                  : locked
                    ? "font-semibold text-[#303839]/30"
                    : "font-semibold text-[#303839]/55 hover:text-[#303839]"
              }`}
            >
              {s.label}
              <span
                aria-hidden
                className={`absolute inset-x-3 bottom-0 h-[2px] transition sm:inset-x-5 ${active ? "bg-[#303839]" : "bg-transparent"}`}
              />
            </button>
          );
        })}
      </nav>

      {/* Right */}
      <div className="flex flex-1 items-center justify-end gap-1 sm:gap-2">
        <div className="hidden items-center sm:flex">
          <IconButton label="Undo" onClick={onUndo} disabled={!canUndo}>
            {UndoIcon}
          </IconButton>
          <IconButton label="Redo" onClick={onRedo} disabled={!canRedo}>
            {RedoIcon}
          </IconButton>
        </div>
        <span className="hidden h-5 w-px bg-[#303839]/15 sm:block" aria-hidden />
        <button
          type="button"
          onClick={onTogglePreview}
          className={`hidden items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition sm:flex ${
            previewMode
              ? "bg-[#303839] text-white"
              : "border border-[#303839]/15 text-[#303839] hover:bg-[#F4ECEC]"
          }`}
        >
          {EyeIcon}
          {previewMode ? "Exit Preview" : "Preview"}
        </button>
        <button
          type="button"
          onClick={onPrimary}
          disabled={primaryDisabled}
          className="whitespace-nowrap rounded-full bg-[#303839] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#434c4d] disabled:opacity-50 sm:px-5 sm:text-sm"
        >
          {primaryLabel}
        </button>
      </div>
    </header>

    <div className="relative z-40 flex h-11 shrink-0 items-center justify-between border-b border-[#303839]/10 bg-white px-3 sm:hidden">
      <button
        type="button"
        onClick={onSaveExit}
        disabled={savingDraft || !restoreReady}
        className="rounded-full border border-[#303839]/15 px-3 py-1.5 text-xs font-bold text-[#303839] transition hover:bg-[#F4ECEC] disabled:opacity-50"
      >
        {savingDraft ? "Saving…" : "Save & Exit"}
      </button>
      <div className="flex items-center">
        <IconButton label="Undo" onClick={onUndo} disabled={!canUndo}>
          {UndoIcon}
        </IconButton>
        <IconButton label="Redo" onClick={onRedo} disabled={!canRedo}>
          {RedoIcon}
        </IconButton>
        <IconButton label={previewMode ? "Exit preview" : "Preview"} onClick={onTogglePreview}>
          {EyeIcon}
        </IconButton>
      </div>
    </div>
    </>
  );
}
