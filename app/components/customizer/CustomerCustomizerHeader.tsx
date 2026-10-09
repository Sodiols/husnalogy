"use client";

// Fixed top header of the customer customizer (Section 3).
// Left: close / save & exit / title / save status.
// Centre: Design – Options – Review tabs.
// Right: undo, redo, preview, and the stage-aware primary button.
//
// Mobile (spec §8): the main row carries only Close, the design identity, Undo
// and the primary action. The steps get their own full-width row, and the
// remaining actions live in a More menu — the previous layout tried to fit the
// step nav plus the primary button into one row and overflowed the viewport by
// ~85px at 320px wide.

import { useEffect, useRef, useState } from "react";

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
      data-shape="round"
      className="grid h-9 w-9 cursor-pointer place-items-center rounded-full text-[#1f2425] transition-colors hover:bg-[#F3F1EC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent pointer-coarse:h-11 pointer-coarse:w-11"
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

const MoreIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
);

// Overflow menu for the actions that do not fit a 320px phone row. Closes on
// Escape and on any outside pointer press, and returns focus to its trigger.
function MoreMenu({ items }: { items: Array<{ label: string; onSelect: () => void; disabled?: boolean }> }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const usable = items.filter(Boolean);
  if (!usable.length) return null;

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        data-shape="round"
        className="grid h-11 w-11 cursor-pointer place-items-center rounded-full text-[#1f2425] transition-colors hover:bg-[#F3F1EC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
      >
        {MoreIcon}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-xl border border-[#303839]/10 bg-white py-1 shadow-[0_12px_32px_rgba(48,56,57,0.16)]"
        >
          {usable.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className="flex min-h-11 w-full items-center px-4 text-left text-sm font-semibold text-[#303839] transition-colors hover:bg-cream focus-visible:outline-none focus-visible:bg-cream disabled:opacity-40"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
    <header className="relative z-40 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-[#303839]/8 bg-white px-2 sm:h-16 sm:gap-3 sm:px-5">
      {/* Left: exit, product identity, page, save status */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <IconButton label="Close customizer" onClick={onClose}>
          {CloseIcon}
        </IconButton>
        <span className="hidden h-6 w-px shrink-0 bg-[#303839]/12 sm:block" aria-hidden />
        <div className="hidden min-w-0 sm:block">
          <h1 className="min-w-0 truncate text-[15px] font-bold leading-tight text-[#1f2425]">{productTitle}</h1>
          <div className="flex items-center gap-2 text-[11px] leading-tight">
            {activePageLabel && <span className="shrink-0 font-semibold text-[#303839]/45">{activePageLabel}</span>}
            {activePageLabel && (
              <span className="hidden h-2.5 w-px shrink-0 bg-[#303839]/15 lg:block" aria-hidden />
            )}
            {/* Status is carried by the LABEL; the dot is decorative only, so
                the state is never communicated by colour alone (spec §22). */}
            <span
              className={`hidden items-center gap-1.5 whitespace-nowrap font-semibold lg:flex ${
                saveStatus === "error"
                  ? "text-red-600"
                  : saveStatus === "offline"
                    ? "text-[#303839]/70"
                    : "text-[#303839]/45"
              }`}
              aria-live="polite"
              role="status"
            >
              {saveStatus === "saved" && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />}
              {saveStatus === "saved-local" && <span className="h-1.5 w-1.5 rounded-full bg-[#D4AF37]" aria-hidden />}
              {saveStatusLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Centre: segmented step control. Hidden below sm — it gets its own
          full-width row there so the main row never overflows a 320px phone. */}
      <nav
        className="hidden shrink-0 items-center gap-0.5 rounded-full bg-[#F3F1EC] p-1 sm:flex"
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
              data-shape="round"
              className={`cursor-pointer whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-white lg:px-3.5 ${
                active
                  ? "bg-white font-semibold text-[#1f2425] shadow-[0_1px_3px_rgba(31,36,37,0.14)]"
                  : locked
                    ? "font-medium text-[#303839]/30"
                    : "font-medium text-[#303839]/65 hover:text-[#1f2425]"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </nav>

      {/* Mobile identity: product + save status, between Close and the actions. */}
      <div className="min-w-0 flex-1 sm:hidden">
        <p className="truncate text-[14px] font-bold leading-tight text-[#1f2425]">{productTitle}</p>
        <p
          className={`truncate text-[10px] font-semibold leading-tight ${
            saveStatus === "error" ? "text-red-600" : "text-[#303839]/50"
          }`}
          role="status"
          aria-live="polite"
        >
          {activePageLabel}
          {activePageLabel && saveStatusLabel ? " · " : ""}
          {saveStatusLabel}
        </p>
      </div>

      {/* Right: history, preview, help, primary action */}
      <div className="flex min-w-0 items-center justify-end gap-1.5 sm:flex-1">
        {/* Undo stays reachable on every screen size (spec §8). */}
        <IconButton label="Undo" onClick={onUndo} disabled={!canUndo}>
          {UndoIcon}
        </IconButton>
        <div className="hidden items-center gap-0.5 sm:flex">
          <IconButton label="Redo" onClick={onRedo} disabled={!canRedo}>
            {RedoIcon}
          </IconButton>
        </div>
        <span className="mx-1 hidden h-6 w-px bg-[#303839]/12 sm:block" aria-hidden />
        <button
          type="button"
          onClick={onTogglePreview}
          aria-pressed={previewMode}
          data-shape="round"
          className={`hidden h-9 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-white sm:flex ${
            previewMode
              ? "bg-[#303839] text-white hover:bg-[#414b4c]"
              : "text-[#1f2425] hover:bg-[#F3F1EC]"
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
        {/* The studio's outlined secondary action (Save Draft), in brand ink. */}
        <button
          type="button"
          onClick={onSaveExit}
          disabled={savingDraft || !restoreReady}
          data-shape="round"
          className="hidden h-9 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-full border-[1.5px] border-[#303839] bg-white px-4 text-[13px] font-semibold text-[#303839] transition-colors hover:bg-[#303839]/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-wait disabled:opacity-50 md:flex"
        >
          {savingDraft ? "Saving…" : "Save & Exit"}
        </button>
        {/* The studio's solid primary action (Publish), in brand ink. */}
        <button
          type="button"
          onClick={onPrimary}
          disabled={primaryDisabled}
          data-shape="round"
          className="flex h-9 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-full bg-[#303839] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#414b4c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-40 pointer-coarse:h-11"
        >
          {primaryLabel}
        </button>
      </div>
    </header>

    {/* Mobile secondary bar: the step progression gets the full width, and the
        occasional actions move into a More menu so the row fits at 320px. */}
    <div className="relative z-40 flex h-14 shrink-0 items-center gap-2 border-b border-[#303839]/8 bg-white px-2 sm:hidden">
      <nav className="flex min-w-0 flex-1 items-center gap-0.5 rounded-full bg-[#F3F1EC] p-1" aria-label="Customizer steps">
        {STEPS.map((s) => {
          const active = step === s.id;
          const locked = s.id === "review" && !canEnterReview && !active;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onStepChange(s.id)}
              aria-current={active ? "step" : undefined}
              // 44px minimum touch target (spec §22).
              data-shape="round"
              className={`min-h-11 min-w-0 flex-1 truncate rounded-full cursor-pointer px-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
                active
                  ? "bg-white font-semibold text-[#1f2425] shadow-[0_1px_3px_rgba(31,36,37,0.14)]"
                  : locked
                    ? "font-medium text-[#303839]/30"
                    : "font-medium text-[#303839]/65"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </nav>
      <MoreMenu
        items={[
          { label: savingDraft ? "Saving…" : "Save & Exit", onSelect: onSaveExit, disabled: savingDraft || !restoreReady },
          { label: canRedo ? "Redo" : "Redo (nothing to redo)", onSelect: onRedo, disabled: !canRedo },
          { label: previewMode ? "Exit preview" : "Preview", onSelect: onTogglePreview },
          ...(onHelp ? [{ label: "Help and keyboard shortcuts", onSelect: onHelp }] : []),
        ]}
      />
    </div>
    </>
  );
}
