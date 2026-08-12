"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { planPopoverPlacement } from "@/lib/customizer/v2/text-toolbar";

export type ToolbarDropdownOption = {
  value: string;
  label: string;
  fontFamily?: string;
  /** Rendered but not selectable — used for font weights a family has no cut for. */
  disabled?: boolean;
  /** Secondary text on the right of the row (e.g. "not in this font"). */
  note?: string;
};

type Props = {
  label: string;
  value: string;
  mixed?: boolean;
  onChange: (value: string) => void;
  options: ToolbarDropdownOption[];
  width?: string;
  previewFont?: boolean;
  disabled?: boolean;
  /** Hide the small caption above the trigger (compact toolbar densities). */
  hideLabel?: boolean;
  /** Override the trigger box classes; the caption row is dropped with it. */
  className?: string;
  triggerClassName?: string;
  /** Force the search field on or off. Defaults to on above 8 options. */
  searchable?: boolean;
  menuWidth?: number;
};

export default function ToolbarDropdown({
  label,
  value,
  mixed = false,
  onChange,
  options,
  width = "w-32",
  previewFont = false,
  disabled = false,
  hideLabel = false,
  className,
  triggerClassName,
  searchable,
  menuWidth,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 280 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const selected = options.find((option) => option.value === value) || options[0];
  const showSearch = searchable ?? options.length > 8;

  const visibleOptions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;

    const placeMenu = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const resolvedWidth = Math.max(menuWidth ?? 0, rect.width, previewFont ? 240 : 190);
      const height = menuRef.current ? Math.min(menuRef.current.scrollHeight + 4, 340) : 300;
      const placement = planPopoverPlacement({
        anchor: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        menu: { width: resolvedWidth, height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      });
      setPosition({
        left: placement.left,
        top: placement.top,
        width: resolvedWidth,
        maxHeight: placement.maxHeight,
      });
    };

    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    placeMenu();
    const focusSelected = window.requestAnimationFrame(() => {
      placeMenu();
      if (showSearch) {
        searchRef.current?.focus();
        return;
      }
      const selectedOption = menuRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
      (selectedOption || menuRef.current?.querySelector<HTMLElement>('[role="option"]'))?.focus();
    });
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(placeMenu) : null;
    if (triggerRef.current) observer?.observe(triggerRef.current);
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);

    return () => {
      window.cancelAnimationFrame(focusSelected);
      observer?.disconnect();
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [open, previewFont, showSearch, menuWidth]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not([disabled])') || []);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? Math.min(items.length - 1, current + 1)
            : Math.max(0, current - 1);
    items[next]?.focus();
  };

  const menu =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="listbox"
            aria-label={label}
            // Marks the portalled menu as part of the toolbar so choosing a
            // value never counts as an outside click on the inline text editor.
            data-customizer-text-interaction
            data-toolbar-popover
            onKeyDown={moveFocus}
            style={{
              left: position.left,
              top: position.top,
              width: position.width,
              maxHeight: position.maxHeight,
            }}
            className="fixed z-[240] overflow-y-auto overscroll-contain rounded-2xl border border-[#303839]/12 bg-white p-2 shadow-[0_24px_60px_rgba(48,56,57,0.24)] [scrollbar-color:rgba(48,56,57,0.22)_transparent] [scrollbar-width:thin]"
          >
            <div className="flex items-center justify-between px-2 pb-2 pt-1">
              <span className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#303839]/50">
                {label}
              </span>
              <span className="rounded-full bg-[#F8F6F1] px-2 py-0.5 text-[9px] font-bold text-[#303839]/50">
                {options.length} choices
              </span>
            </div>
            {showSearch && (
              <input
                ref={searchRef}
                type="text"
                value={query}
                aria-label={`Search ${label}`}
                placeholder="Search…"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowDown") return;
                  event.preventDefault();
                  menuRef.current?.querySelector<HTMLElement>('[role="option"]:not([disabled])')?.focus();
                }}
                className="mb-2 h-9 w-full rounded-lg border border-[#303839]/12 bg-[#F8F6F1]/60 px-2.5 text-[13px] font-semibold text-[#303839] outline-none placeholder:text-[#303839]/35 focus:border-[#D4AF37] focus:bg-white focus-visible:ring-2 focus-visible:ring-[#D4AF37]/25"
              />
            )}
            <div className="grid gap-1">
              {visibleOptions.map((option) => {
                const isSelected = !mixed && option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={Boolean(option.disabled)}
                    disabled={Boolean(option.disabled)}
                    title={option.disabled ? `${option.label} — ${option.note || "not available for this font"}` : option.label}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                      triggerRef.current?.focus();
                    }}
                    className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${
                      option.disabled
                        ? "cursor-not-allowed text-[#303839]/35"
                        : isSelected
                          ? "cursor-pointer bg-[#303839] text-white"
                          : "cursor-pointer text-[#303839] hover:bg-[#F8F6F1]"
                    }`}
                  >
                    <span className="truncate font-semibold" style={{ fontFamily: option.fontFamily }}>
                      {option.label}
                    </span>
                    {option.disabled ? (
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.08em] text-[#303839]/35">
                        {option.note || "N/A"}
                      </span>
                    ) : isSelected ? (
                      <svg
                        className="shrink-0 text-[#D4AF37]"
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="m5 12 4 4L19 6" />
                      </svg>
                    ) : null}
                  </button>
                );
              })}
              {!visibleOptions.length && (
                <p className="px-3 py-4 text-center text-[12px] font-semibold text-[#303839]/45">No match</p>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      className={
        className ??
        (hideLabel
          ? `grid h-9 shrink-0 content-center px-1 ${width}`
          : `grid h-11 shrink-0 grid-rows-[12px_26px] content-center px-1.5 ${width}`)
      }
    >
      {!hideLabel && (
        <span className="block text-[8px] font-extrabold uppercase tracking-[0.12em] text-[#303839]/45">
          {label}
        </span>
      )}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={mixed ? `${label}: Mixed` : `${label}: ${selected?.label || value}`}
        title={mixed ? `${label}: Mixed` : `${label}: ${selected?.label || value}`}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={
          triggerClassName ??
          "flex h-7 min-w-0 cursor-pointer items-center justify-between gap-2 rounded-md px-1 text-left text-[13px] font-bold leading-7 text-[#303839] outline-none transition-colors hover:bg-[#F8F6F1] focus-visible:ring-2 focus-visible:ring-[#D4AF37] disabled:cursor-not-allowed disabled:opacity-40"
        }
      >
        <span
          className="truncate"
          style={{ fontFamily: previewFont && !mixed ? selected?.fontFamily : undefined }}
        >
          {mixed ? "Mixed" : selected?.label || value}
        </span>
        <svg
          className={`shrink-0 text-[#303839]/45 transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {menu}
    </div>
  );
}
