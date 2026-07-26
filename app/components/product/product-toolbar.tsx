"use client";

import { useEffect, useRef, useState } from "react";

export function ProductToolbar({
  activeCount = 0,
  count = 0,
  countLabel = "Designs",
  onFilterClick,
  sortValue = "",
  sortOptions = [],
  onSortChange,
}) {
  return (
    <FilterControlBar>
      <div className="flex min-w-0 flex-none items-center md:flex-1">
        <button
          type="button"
          onClick={onFilterClick}
          className="inline-flex h-10 w-[82px] shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#E6E6E6] text-[12px] font-bold text-[#303839] outline-none transition hover:bg-[#E6E6E6] focus-visible:ring-2 focus-visible:ring-[#303839]/20 sm:h-11 sm:w-auto sm:gap-2 sm:px-5 sm:text-[13px]"
        >
          <FilterIcon />
          <span>Filter</span>
          {activeCount > 0 && (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#303839] px-1 text-[10px] font-bold text-[#E6E6E6]">
              {activeCount}
            </span>
          )}
        </button>
      </div>

      <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 sm:flex-none sm:gap-3">
        <ProductCount count={count} label={countLabel} />
        <SortDropdown value={sortValue} options={sortOptions} onChange={onSortChange} />
      </div>
    </FilterControlBar>
  );
}

export function FilterControlBar({ children, className = "" }) {
  return (
    <div
      className={`relative z-[70] mt-4 max-w-full rounded-none border border-[#303839]/10 bg-white p-2 sm:mt-5 sm:p-3 ${className}`}
    >
      <div className="flex w-full max-w-full items-center gap-2 sm:gap-3">{children}</div>
    </div>
  );
}

export function ProductCount({ count, label = "Designs" }) {
  return (
    <span className="hidden h-10 shrink-0 items-center rounded-none bg-[#E6E6E6] px-2.5 text-[11px] font-semibold text-[#303839]/78 md:inline-flex sm:h-11 sm:px-4 sm:text-[13px]">
      <span className="font-bold text-[#303839]">{count}</span>
      <span className="ml-1 hidden min-[450px]:inline sm:inline">{label}</span>
    </span>
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
      className="w-[82px] sm:w-auto sm:min-w-[178px]"
      buttonClassName="h-10 px-3 sm:h-11 sm:px-4"
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
        className={`inline-flex h-11 w-full items-center justify-between gap-2 rounded-full bg-[#E6E6E6] px-3.5 text-[12px] font-bold text-[#303839] outline-none transition hover:bg-[#E6E6E6] focus-visible:ring-2 focus-visible:ring-[#303839]/20 disabled:cursor-not-allowed disabled:opacity-55 sm:px-4 sm:text-[13px] ${buttonClassName}`}
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
        <ChevronIcon className={`h-4 w-4 shrink-0 text-[#303839]/55 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-[130] mt-2 w-56 max-w-[calc(100vw-2rem)] rounded-none border border-[#303839]/10 bg-white p-1.5 text-[#303839] shadow-[0_24px_60px_rgba(48,56,57,0.16)]"
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
                className={`flex w-full items-center justify-between gap-3 rounded-none px-3.5 py-2.5 text-left text-sm font-semibold transition ${
                  active ? "bg-[#303839] text-[#E6E6E6]" : "text-[#303839]/78 hover:bg-[#E6E6E6] hover:text-[#303839]"
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
