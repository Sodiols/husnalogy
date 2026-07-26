"use client";

// Fixed header of the full-screen admin template studio (Section 19).

const TABS = [
  { id: "design", label: "Design" },
  { id: "fields", label: "Fields" },
  { id: "options", label: "Product Options" },
  { id: "preview", label: "Customer Preview" },
  { id: "mockups", label: "Mockups" },
  { id: "settings", label: "Settings" },
];

function IconButton({ label, onClick, disabled, children }: any) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid h-9 w-9 place-items-center rounded-lg text-white/65 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] disabled:opacity-25 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

type Props = {
  templateName: string;
  productName: string;
  statusChips: string[];
  saveStatusLabel: string;
  publicVersion?: string;
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
  publicVersion = "2",
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
    <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-x-3 border-b border-white/8 bg-[#303839] px-3 py-2 xl:h-16 xl:flex-nowrap xl:py-0 2xl:px-5">
      {/* Left: identity and status */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to Product"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white/65 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <span className="hidden h-6 w-px shrink-0 bg-white/12 md:block" aria-hidden />
        <div className="hidden min-w-0 md:block">
          <p className="truncate font-display text-[17px] leading-tight text-white">{templateName || "Untitled template"}</p>
          <p className="truncate text-[11px] leading-tight text-white/40">{productName}</p>
        </div>
        <div className="hidden items-center gap-1.5 xl:flex">
          <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white/70">
            V{publicVersion}
          </span>
          {statusChips.map((chip) => (
            <span
              key={chip}
              className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${
                chip === "Active" || chip === "Published"
                  ? "bg-emerald-400/15 text-emerald-300"
                  : chip === "Draft" || chip === "Inactive"
                    ? "bg-white/10 text-white/60"
                    : chip === "Unsaved"
                      ? "bg-[#D4AF37]/20 text-[#D4AF37]"
                      : "bg-white/10 text-white/55"
              }`}
            >
              {chip}
            </span>
          ))}
          {saveStatusLabel && (
            <span className="ml-0.5 text-[11px] font-medium text-white/35" aria-live="polite">
              {saveStatusLabel}
            </span>
          )}
        </div>
      </div>

      {/* Centre: section tabs as a segmented control */}
      <nav
        className="order-3 flex w-full shrink-0 items-center gap-0.5 overflow-x-auto rounded-lg bg-white/[0.06] p-1 no-scrollbar xl:order-none xl:w-auto"
        aria-label="Builder sections"
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-[12.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] lg:px-3.5 ${
                active
                  ? "bg-white/[0.14] font-bold text-white"
                  : "font-semibold text-white/50 hover:text-white/85"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {/* Right */}
      <div className="flex flex-1 items-center justify-end gap-1.5">
        <IconButton label="Undo (Ctrl+Z)" onClick={onUndo} disabled={!canUndo}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 14 4 9l5-5" />
            <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
          </svg>
        </IconButton>
        <IconButton label="Redo (Ctrl+Shift+Z)" onClick={onRedo} disabled={!canRedo}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m15 14 5-5-5-5" />
            <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
          </svg>
        </IconButton>
        <span className="mx-1 hidden h-6 w-px bg-white/12 sm:block" aria-hidden />
        {onSaveDraft && (
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={saving}
            className="hidden h-9 items-center rounded-lg px-3 text-xs font-semibold text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] disabled:opacity-40 sm:flex"
          >
            {saving ? "Saving…" : "Save Draft"}
          </button>
        )}
        <button
          type="button"
          onClick={() => onTabChange("preview")}
          className="hidden h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] md:flex"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          Preview
        </button>
        {onPublish && (
          <button
            type="button"
            onClick={onPublish}
            disabled={saving}
            className="flex h-9 shrink-0 items-center rounded-lg bg-[#D4AF37] px-4 text-xs font-bold text-[#303839] transition-colors hover:bg-[#e0c15d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-40"
          >
            {saving ? "Working…" : publishLabel}
          </button>
        )}
      </div>
    </header>
  );
}
