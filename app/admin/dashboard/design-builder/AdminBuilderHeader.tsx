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
      className="grid h-9 w-9 place-items-center rounded-full text-white/75 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] disabled:opacity-35 disabled:hover:bg-transparent"
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
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-[#D4AF37]/25 bg-[#303839] px-3 shadow-[0_8px_24px_rgba(48,56,57,0.16)] 2xl:h-16 2xl:px-5">
      {/* Left */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/20 px-3 py-1.5 text-xs font-bold text-white transition hover:border-white/35 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back to Product
        </button>
        <div className="hidden min-w-0 md:block">
          <p className="truncate text-sm font-bold text-white">{templateName || "Untitled template"}</p>
          <p className="truncate text-[11px] text-white/50">{productName}</p>
        </div>
        <div className="hidden items-center gap-1 xl:flex">
          {statusChips.map((chip) => (
            <span
              key={chip}
              className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${
                chip === "Active" || chip === "Published"
                  ? "bg-white/12 text-white"
                  : chip === "Draft" || chip === "Inactive"
                    ? "bg-[#F8F6F1] text-[#303839]/75"
                    : chip === "Unsaved"
                      ? "bg-[#D4AF37] text-[#303839]"
                      : "bg-white/10 text-white/65"
              }`}
            >
              {chip}
            </span>
          ))}
        </div>
        {saveStatusLabel && (
          <span className="hidden text-[11px] font-bold text-white/50 xl:inline" aria-live="polite">
            {saveStatusLabel}
          </span>
        )}
      </div>

      {/* Centre tabs */}
      <nav className="flex h-full shrink-0 items-stretch overflow-x-auto no-scrollbar" aria-label="Builder sections">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              aria-current={active ? "page" : undefined}
              className={`relative whitespace-nowrap px-3 text-[13px] transition lg:px-4 ${
                active ? "font-bold text-white" : "font-semibold text-white/55 hover:text-white"
              }`}
            >
              {t.label}
              <span aria-hidden className={`absolute inset-x-3 bottom-0 h-[2px] ${active ? "bg-[#D4AF37]" : "bg-transparent"}`} />
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
        <span className="mx-0.5 hidden h-5 w-px bg-white/15 sm:block" aria-hidden />
        {onSaveDraft && (
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={saving}
            className="hidden rounded-full border border-white/20 px-3.5 py-1.5 text-xs font-bold text-white transition hover:border-white/35 hover:bg-white/10 disabled:opacity-50 sm:block"
          >
            {saving ? "Saving…" : "Save Draft"}
          </button>
        )}
        <button
          type="button"
          onClick={() => onTabChange("preview")}
          className="hidden rounded-full border border-white/20 px-3.5 py-1.5 text-xs font-bold text-white transition hover:border-white/35 hover:bg-white/10 md:block"
        >
          Preview as Customer
        </button>
        {onPublish && (
          <button
            type="button"
            onClick={onPublish}
            disabled={saving}
            className="rounded-full bg-[#D4AF37] px-4 py-2 text-xs font-bold text-[#303839] shadow-[0_6px_18px_rgba(212,175,55,0.18)] transition hover:bg-[#e0c15d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50"
          >
            {saving ? "Working…" : publishLabel}
          </button>
        )}
      </div>
    </header>
  );
}
