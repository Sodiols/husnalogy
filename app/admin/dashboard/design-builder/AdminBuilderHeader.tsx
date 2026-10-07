"use client";

// Fixed header of the full-screen admin template studio (Section 19).
//
// Styled as the rest of the studio: a white bar, dark text, a light segmented
// control for the sections, round icon buttons, a navy outlined secondary
// action and a solid navy primary one.

const TABS = [
  { id: "design", label: "Design" },
  { id: "fields", label: "Fields" },
  { id: "options", label: "Product Options" },
  { id: "preview", label: "Customer Preview" },
  { id: "mockups", label: "Mockups" },
  { id: "settings", label: "Settings" },
];

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A] focus-visible:ring-offset-2 focus-visible:ring-offset-white";

function IconButton({ label, onClick, disabled, children }: any) {
  return (
    <button
      type="button"
      data-shape="round"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`grid h-9 w-9 cursor-pointer place-items-center rounded-full text-[#1f2425] transition-colors hover:bg-[#F2F3F5] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent ${FOCUS}`}
    >
      {children}
    </button>
  );
}

const CHIP_TONES: Record<string, string> = {
  Published: "bg-emerald-50 text-emerald-700",
  Active: "bg-emerald-50 text-emerald-700",
  Unsaved: "bg-[#FFF6DD] text-[#6b5414]",
  Draft: "bg-[#F2F3F5] text-[#303839]/75",
  Inactive: "bg-[#F2F3F5] text-[#303839]/75",
};

type Props = {
  templateName: string;
  productName: string;
  statusChips: string[];
  saveStatusLabel: string;
  tab: string;
  onTabChange: (tab: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onBack: () => void;
  onSaveDraft?: () => void;
  onPublish?: () => void;
  publishLabel?: string;
  saving?: boolean;
};

export default function AdminBuilderHeader({
  templateName,
  productName,
  statusChips,
  saveStatusLabel,
  tab,
  onTabChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onBack,
  onSaveDraft,
  onPublish,
  publishLabel = "Publish",
  saving = false,
}: Props) {
  return (
    <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-x-3 border-b border-[#303839]/10 bg-white px-3 py-2 xl:h-16 xl:flex-nowrap xl:py-0 2xl:px-5">
      {/* Left: identity and status */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <IconButton label="Back to Product" onClick={onBack}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m15 18-6-6 6-6" />
          </svg>
        </IconButton>
        <span className="hidden h-6 w-px shrink-0 bg-[#303839]/12 md:block" aria-hidden />
        <div className="hidden min-w-0 md:block">
          <p className="truncate text-[15px] font-bold leading-tight text-[#1f2425]" title={templateName || "Untitled template"}>
            {templateName || "Untitled template"}
          </p>
          <p className="truncate text-[12px] leading-tight text-[#303839]/60">{productName}</p>
        </div>
        <div className="hidden items-center gap-1.5 xl:flex">
          {statusChips.map((chip) => (
            <span key={chip} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${CHIP_TONES[chip] || "bg-[#F2F3F5] text-[#303839]/75"}`}>
              {chip}
            </span>
          ))}
          {saveStatusLabel && (
            <span className="ml-0.5 whitespace-nowrap text-[12px] text-[#303839]/55" aria-live="polite">
              {saveStatusLabel}
            </span>
          )}
        </div>
      </div>

      {/* Centre: section tabs as a segmented control */}
      <nav
        className="order-3 flex w-full shrink-0 items-center gap-0.5 overflow-x-auto rounded-full bg-[#F2F3F5] p-1 no-scrollbar xl:order-none xl:w-auto"
        aria-label="Builder sections"
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              data-shape="round"
              onClick={() => onTabChange(t.id)}
              aria-current={active ? "page" : undefined}
              className={`cursor-pointer whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] transition-colors lg:px-3.5 ${FOCUS} ${
                active ? "bg-white font-semibold text-[#1f2425] shadow-[0_1px_3px_rgba(31,36,37,0.14)]" : "font-medium text-[#303839]/65 hover:text-[#1f2425]"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {/* Right: history, then the document actions */}
      <div className="flex flex-1 items-center justify-end gap-1.5">
        <IconButton label="Undo (Ctrl+Z)" onClick={onUndo} disabled={!canUndo}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 14 4 9l5-5" />
            <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
          </svg>
        </IconButton>
        <IconButton label="Redo (Ctrl+Shift+Z)" onClick={onRedo} disabled={!canRedo}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m15 14 5-5-5-5" />
            <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
          </svg>
        </IconButton>
        <span className="mx-1 hidden h-6 w-px bg-[#303839]/12 sm:block" aria-hidden />
        <button
          type="button"
          data-shape="round"
          onClick={() => onTabChange("preview")}
          className={`hidden h-9 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] font-semibold text-[#1f2425] transition-colors hover:bg-[#F2F3F5] md:flex ${FOCUS}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          Preview
        </button>
        {onSaveDraft && (
          <button
            type="button"
            data-shape="round"
            onClick={onSaveDraft}
            disabled={saving}
            className={`hidden h-9 cursor-pointer items-center whitespace-nowrap rounded-full border-[1.5px] border-[#27307A] bg-white px-4 text-[13px] font-semibold text-[#27307A] transition-colors hover:bg-[#27307A]/[0.05] disabled:cursor-wait disabled:opacity-50 sm:flex ${FOCUS}`}
          >
            {saving ? "Saving…" : "Save Draft"}
          </button>
        )}
        {onPublish && (
          <button
            type="button"
            data-shape="round"
            onClick={onPublish}
            disabled={saving}
            className={`flex h-9 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-full bg-[#27307A] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#1f2766] disabled:cursor-wait disabled:opacity-50 ${FOCUS}`}
          >
            {saving ? "Working…" : publishLabel}
          </button>
        )}
      </div>
    </header>
  );
}
