"use client";

import { useEffect, useRef, useState } from "react";

export function ProductToolbar({
  activeCount = 0,
  count = 0,
  countLabel = "",
  onFilterClick,
  sortValue = "",
  sortOptions = [],
  onSortChange,
}) {
  return (
    <FilterControlBar>
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onFilterClick}
          aria-haspopup="dialog"
          className="btn btn-secondary btn-sm shrink-0"
        >
          <FilterIcon />
          <span>Filter</span>
          {activeCount > 0 && (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-ink px-1 text-[11px] font-semibold text-white">
              <span className="sr-only">Active filters: </span>
              {activeCount}
            </span>
          )}
        </button>
        <ProductCount count={count} label={countLabel} />
      </div>

      <div className="ml-auto flex min-w-0 items-center justify-end">
        <SortDropdown value={sortValue} options={sortOptions} onChange={onSortChange} />
      </div>
    </FilterControlBar>
  );
}

export function FilterControlBar({ children, className = "" }) {
  return (
    <div
      className={`relative z-[70] mt-8 max-w-full border-y border-line py-3 ${className}`}
    >
      <div className="flex w-full max-w-full items-center gap-2 sm:gap-3">{children}</div>
    </div>
  );
}

export function ProductCount({ count, label = "" }) {
  const noun = label || (count === 1 ? "design" : "designs");
  return (
    <p className="shrink-0 text-[14px] text-muted" aria-live="polite">
      <span className="font-semibold text-ink">{count}</span> {noun}
    </p>
  );
}

export function SortDropdown({ value = "", options = [], onChange, disabled = false, label = "Sort" }) {
  return (
    <PillDropdown
      value={value}
      options={options}
      onChange={onChange}
      disabled={disabled}
      label={label}
      compactLabelOnMobile
      className="w-auto sm:min-w-[200px]"
      buttonClassName="min-h-10 h-10 px-3 sm:px-4"
    />
  );
}

export function PillDropdown({
  value = "",
  options = [],
  onChange,
  disabled = false,
  label = "Select",
  placeholder = "Select",
  compactLabelOnMobile = false,
  className = "",
  buttonClassName = "",
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const items = normalizeOptions(options);
  const selected = items.find((item) => item.value === String(value ?? "")) || items[0];

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative shrink-0 ${open ? "z-[120]" : "z-10"} ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${selected?.label || placeholder}`}
        onClick={() => !disabled && setOpen((current) => !current)}
        className={`inline-flex h-11 w-full items-center justify-between gap-2 border border-field bg-white px-3.5 text-[14px] font-medium text-ink transition-colors hover:border-ink/50 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4 ${buttonClassName}`}
      >
        {compactLabelOnMobile ? (
          <>
            <span className="truncate sm:hidden">{label}</span>
            <span className="hidden truncate sm:inline">
              {label}: <span className="font-semibold">{selected?.label || placeholder}</span>
            </span>
          </>
        ) : (
          <span className="truncate">{selected?.label || placeholder}</span>
        )}
        <ChevronIcon className={`h-4 w-4 shrink-0 text-ink transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-[130] mt-2 w-56 max-w-[calc(100vw-2rem)] rounded-[10px] border border-line bg-white p-1.5 text-ink shadow-[var(--shadow-overlay)]"
        >
          {items.map((item) => {
            const active = item.value === String(value ?? "");
            return (
              <button
                key={item.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange?.(item.value);
                  setOpen(false);
                }}
                className={`flex min-h-11 w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-[14px] transition-colors ${
                  active ? "bg-cream font-semibold text-ink" : "font-medium text-ink hover:bg-cream"
                }`}
              >
                <span className="truncate">{item.label}</span>
                {active && <CheckIcon />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function normalizeOptions(options) {
  return options.map((option) =>
    Array.isArray(option)
      ? { value: String(option[0]), label: String(option[1]) }
      : typeof option === "string" || typeof option === "number"
        ? { value: String(option), label: String(option) }
        : { value: String(option.value ?? ""), label: option.label ?? String(option.value ?? "") }
  );
}

const stroke: any = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

function FilterIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M4 6h16" />
      <path d="M7 12h10" />
      <path d="M10 18h4" />
    </svg>
  );
}

function ChevronIcon({ className = "" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" {...stroke} aria-hidden="true" className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} aria-hidden="true" className="shrink-0">
      <path d="m5 12 4 4 10-10" />
    </svg>
  );
}
