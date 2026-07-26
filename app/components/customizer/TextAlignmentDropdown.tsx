"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

const HORIZONTAL = [
  { value: "left", label: "Align left", path: "M4 6h16M4 10h10M4 14h16M4 18h12" },
  { value: "center", label: "Align centre", path: "M4 6h16M7 10h10M4 14h16M6 18h12" },
  { value: "right", label: "Align right", path: "M4 6h16M10 10h10M4 14h16M8 18h12" },
] as const;

const VERTICAL = [
  { value: "top", label: "Align top", path: "M5 5h14M8 9h8v4H8z" },
  { value: "middle", label: "Align middle", path: "M5 12h14M8 8h8v8H8z" },
  { value: "bottom", label: "Align bottom", path: "M5 19h14M8 11h8v4H8z" },
] as const;

type Props = {
  horizontal: string;
  vertical: string;
  canHorizontal?: boolean;
  canVertical?: boolean;
  onHorizontalChange: (value: string) => void;
  onVerticalChange: (value: string) => void;
  className?: string;
};

function AlignIcon({ path, size = 16 }: { path: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}

export default function TextAlignmentDropdown({
  horizontal,
  vertical,
  canHorizontal = true,
  canVertical = true,
  onHorizontalChange,
  onVerticalChange,
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const currentIcon = HORIZONTAL.find((option) => option.value === horizontal) || HORIZONTAL[1];
  const mixed = horizontal === "mixed" || vertical === "mixed";

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 208;
      setPosition({
        left: Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12)),
        top: rect.bottom + 8,
      });
    };
    const onOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    place();
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("keydown", onEscape);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("keydown", onEscape);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const select = (kind: "horizontal" | "vertical", value: string) => {
    if (kind === "horizontal") onHorizontalChange(value);
    else onVerticalChange(value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const menu = open && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Text alignment"
          style={{ left: position.left, top: position.top }}
          className="fixed z-[190] w-52 rounded-xl border border-[#303839]/12 bg-white p-2 shadow-[0_18px_48px_rgba(48,56,57,0.2)]"
        >
          <div className="grid grid-cols-3 gap-1">
            {HORIZONTAL.map((option) => {
              const active = horizontal === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  aria-label={option.label}
                  title={option.label}
                  disabled={!canHorizontal}
                  onClick={() => select("horizontal", option.value)}
                  className={`grid h-11 cursor-pointer place-items-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] disabled:cursor-not-allowed disabled:opacity-30 ${
                    active ? "bg-[#F8F6F1] text-[#303839] ring-1 ring-[#D4AF37]/45" : "text-[#303839]/60 hover:bg-[#F8F6F1]"
                  }`}
                >
                  <AlignIcon path={option.path} />
                </button>
              );
            })}
            {VERTICAL.map((option) => {
              const active = vertical === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  aria-label={option.label}
                  title={option.label}
                  disabled={!canVertical}
                  onClick={() => select("vertical", option.value)}
                  className={`grid h-11 cursor-pointer place-items-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] disabled:cursor-not-allowed disabled:opacity-30 ${
                    active ? "bg-[#F8F6F1] text-[#303839] ring-1 ring-[#D4AF37]/45" : "text-[#303839]/60 hover:bg-[#F8F6F1]"
                  }`}
                >
                  <AlignIcon path={option.path} />
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={mixed ? "Text alignment: Mixed" : "Text alignment"}
        title={mixed ? "Mixed alignment" : "Text alignment"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={!canHorizontal && !canVertical}
        onClick={() => setOpen((current) => !current)}
        className={`flex h-10 min-w-12 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-lg text-[#303839]/70 transition-colors hover:bg-[#F8F6F1] hover:text-[#303839] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] disabled:cursor-not-allowed disabled:opacity-30 ${className}`}
      >
        <AlignIcon path={currentIcon.path} />
        {mixed && <span className="h-1.5 w-1.5 rounded-full bg-[#D4AF37]" aria-hidden />}
        <svg className={`transition-transform ${open ? "rotate-180" : ""}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {menu}
    </>
  );
}
