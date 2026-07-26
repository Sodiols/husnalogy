"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ToolbarDropdownOption = {
  value: string;
  label: string;
  fontFamily?: string;
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
}: Props) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 280 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const selected = options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    if (!open) return;

    const placeMenu = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuWidth = Math.max(rect.width, previewFont ? 260 : 190);
      const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - menuWidth - 12));
      const top = rect.bottom + 8;
      setPosition({
        left,
        top,
        width: menuWidth,
        maxHeight: Math.max(160, Math.min(320, window.innerHeight - top - 12)),
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
      const selectedOption = menuRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
      (selectedOption || menuRef.current?.querySelector<HTMLElement>('[role="option"]'))?.focus();
    });
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);

    return () => {
      window.cancelAnimationFrame(focusSelected);
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [open, previewFont]);

  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') || []);
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
            onKeyDown={moveFocus}
            style={{
              left: position.left,
              top: position.top,
              width: position.width,
              maxHeight: position.maxHeight,
            }}
            className="fixed z-[190] overflow-y-auto rounded-2xl border border-[#303839]/12 bg-white p-2 shadow-[0_24px_60px_rgba(48,56,57,0.24)] [scrollbar-color:rgba(48,56,57,0.22)_transparent] [scrollbar-width:thin]"
          >
            <div className="flex items-center justify-between px-2 pb-2 pt-1">
              <span className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#303839]/50">
                {label}
              </span>
              <span className="rounded-full bg-[#F8F6F1] px-2 py-0.5 text-[9px] font-bold text-[#303839]/50">
                {options.length} choices
              </span>
            </div>
            <div className="grid gap-1">
              {options.map((option) => {
                const isSelected = !mixed && option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                      triggerRef.current?.focus();
                    }}
                    className={`flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${
                      isSelected
                        ? "bg-[#303839] text-white"
                        : "text-[#303839] hover:bg-[#F8F6F1]"
                    }`}
                  >
                    <span className="truncate font-semibold" style={{ fontFamily: option.fontFamily }}>
                      {option.label}
                    </span>
                    {isSelected && (
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
                    )}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={`grid h-11 shrink-0 grid-rows-[12px_26px] content-center px-1.5 ${width}`}>
      <span className="block text-[8px] font-extrabold uppercase tracking-[0.12em] text-[#303839]/45">
        {label}
      </span>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="flex h-7 min-w-0 cursor-pointer items-center justify-between gap-2 rounded-md px-1 text-left text-[13px] font-bold leading-7 text-[#303839] outline-none transition-colors hover:bg-[#F8F6F1] focus-visible:ring-2 focus-visible:ring-[#D4AF37] disabled:cursor-not-allowed disabled:opacity-40"
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
