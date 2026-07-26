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
      className="grid h-10 w-10 place-items-center rounded-lg text-[#303839]/70 transition-colors hover:bg-[#303839]/5 hover:text-[#303839] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] disabled:opacity-30 disabled:hover:bg-transparent"
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
  activePageLabel?: string;
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
  onHelp?: () => void;
  primaryLabel: string;
  primaryDisabled?: boolean;
  onPrimary: () => void;
};

export default function CustomerCustomizerHeader({
  productTitle,
  activePageLabel,
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
  onHelp,
  primaryLabel,
  primaryDisabled,
  onPrimary,
}: Props) {
  return (
    <>
    <header className="relative z-40 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[#303839]/8 bg-white px-3 sm:px-5">
      {/* Left: exit, product identity, page, save status */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <IconButton label="Close customizer" onClick={onClose}>
          {CloseIcon}
        </IconButton>
        <button
          type="button"
          onClick={onSaveExit}
          disabled={savingDraft || !restoreReady}
          className="hidden h-10 shrink-0 items-center whitespace-nowrap rounded-lg px-3 text-xs font-semibold text-[#303839]/70 transition-colors hover:bg-[#303839]/5 hover:text-[#303839] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] disabled:opacity-40 md:flex"
        >
          {savingDraft ? "Saving…" : "Save & Exit"}
        </button>
        <span className="hidden h-6 w-px shrink-0 bg-[#303839]/10 md:block" aria-hidden />
        <div className="hidden min-w-0 sm:block">
          <h1 className="min-w-0 truncate font-display text-[19px] leading-tight text-[#303839]">{productTitle}</h1>
          <div className="flex items-center gap-2 text-[11px] leading-tight">
            {activePageLabel && <span className="shrink-0 font-semibold text-[#303839]/45">{activePageLabel}</span>}
            {activePageLabel && (
              <span className="hidden h-2.5 w-px shrink-0 bg-[#303839]/15 lg:block" aria-hidden />
            )}
            <span
              className={`hidden items-center gap-1.5 whitespace-nowrap font-semibold lg:flex ${
                saveStatus === "error" ? "text-red-600" : "text-[#303839]/45"
              }`}
              aria-live="polite"
            >
              {saveStatus === "saved" && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />}
              {saveStatusLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Centre: segmented step control */}
      <nav
        className="flex shrink-0 items-center gap-0.5 rounded-full bg-[#F0EDED] p-1"
        aria-label="Customizer steps"
      >
        {STEPS.map((s) => {
          const active = step === s.id;
          const locked = s.id === "review" && !canEnterReview && !active;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onStepChange(s.id)}
              aria-current={active ? "step" : undefined}
              className={`rounded-full px-3.5 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] sm:px-5 ${
                active
                  ? "bg-white font-bold text-[#303839] shadow-[0_1px_3px_rgba(48,56,57,0.10)]"
                  : locked
                    ? "font-semibold text-[#303839]/30"
                    : "font-semibold text-[#303839]/55 hover:text-[#303839]"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </nav>

      {/* Right: history, preview, help, primary action */}
      <div className="flex flex-1 items-center justify-end gap-1.5">
        <div className="hidden items-center gap-0.5 sm:flex">
          <IconButton label="Undo" onClick={onUndo} disabled={!canUndo}>
            {UndoIcon}
          </IconButton>
          <IconButton label="Redo" onClick={onRedo} disabled={!canRedo}>
            {RedoIcon}
          </IconButton>
        </div>
        <span className="hidden h-6 w-px bg-[#303839]/10 sm:block" aria-hidden />
        <button
          type="button"
          onClick={onTogglePreview}
          aria-pressed={previewMode}
          className={`hidden h-10 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] sm:flex ${
            previewMode
              ? "bg-[#303839] text-white hover:bg-[#414b4c]"
              : "text-[#303839]/70 hover:bg-[#303839]/5 hover:text-[#303839]"
          }`}
        >
          {EyeIcon}
          {previewMode ? "Exit Preview" : "Preview"}
        </button>
        {onHelp && (
          <div className="hidden lg:block">
            <IconButton label="Help and keyboard shortcuts" onClick={onHelp}>
              <span className="text-sm font-bold">?</span>
            </IconButton>
          </div>
        )}
        <button
          type="button"
          onClick={onPrimary}
          disabled={primaryDisabled}
          className="ml-0.5 flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#303839] px-4 text-xs font-bold text-white transition-colors hover:bg-[#414b4c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] focus-visible:ring-offset-2 disabled:opacity-40 sm:px-5 sm:text-[13px]"
        >
          {primaryLabel}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m9 6 6 6-6 6" />
          </svg>
        </button>
      </div>
    </header>

    {/* Mobile secondary bar: identity + actions that do not fit the main row */}
    <div className="relative z-40 flex h-12 shrink-0 items-center justify-between gap-2 border-b border-[#303839]/8 bg-white px-3 sm:hidden">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onSaveExit}
          disabled={savingDraft || !restoreReady}
          className="h-9 shrink-0 rounded-lg px-2.5 text-xs font-semibold text-[#303839]/70 transition-colors hover:bg-[#303839]/5 hover:text-[#303839] disabled:opacity-40"
        >
          {savingDraft ? "Saving…" : "Save & Exit"}
        </button>
        <span
          className={`min-w-0 truncate text-[11px] font-semibold ${saveStatus === "error" ? "text-red-600" : "text-[#303839]/45"}`}
          aria-live="polite"
        >
          {saveStatusLabel}
        </span>
      </div>
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
        {onHelp && <IconButton label="Help and keyboard shortcuts" onClick={onHelp}>?</IconButton>}
      </div>
    </div>
    </>
  );
}
