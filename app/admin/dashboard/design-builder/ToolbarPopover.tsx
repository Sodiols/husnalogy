"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { planPopoverPlacement } from "@/lib/customizer/v2/text-toolbar";

type Props = {
  /** Accessible name of the menu. */
  label: string;
  /** Rendered inside the trigger button. */
  trigger: React.ReactNode;
  triggerClassName?: string;
  /** Applied instead of triggerClassName while the menu is open or active.
   *  Swapped rather than appended, because two competing arbitrary Tailwind
   *  background classes on one element resolve by stylesheet order, not by
   *  the order they appear in the attribute. */
  triggerActiveClassName?: string;
  triggerTitle?: string;
  disabled?: boolean;
  /** Preferred menu width in pixels; the menu is still clamped to the viewport. */
  menuWidth?: number;
  align?: "start" | "center" | "end";
  role?: "menu" | "dialog";
  active?: boolean;
  children: (close: () => void) => React.ReactNode;
  menuClassName?: string;
};

/**
 * One portalled popover used by every toolbar menu (font weight, colour,
 * alignment, layout, more).
 *
 * It exists because the toolbar is a bounded, non-scrolling strip: a menu
 * rendered inside it would be clipped. Portalling to the body plus explicit
 * viewport clamping (spec §20) keeps every menu reachable at any window size,
 * and `data-customizer-text-interaction` marks the whole portal as a safe
 * target so opening a menu never closes inline text editing (spec §22).
 */
export default function ToolbarPopover({
  label,
  trigger,
  triggerClassName = "",
  triggerActiveClassName,
  triggerTitle,
  disabled = false,
  menuWidth = 240,
  align = "start",
  role = "menu",
  active = false,
  children,
  menuClassName = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 320, placement: "below" as "below" | "above" });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => setMounted(true), []);

  const close = useCallback(
    (returnFocus = true) => {
      setOpen(false);
      if (returnFocus) triggerRef.current?.focus();
    },
    [],
  );

  const place = useCallback(() => {
    const anchor = triggerRef.current?.getBoundingClientRect();
    if (!anchor) return;
    const menu = menuRef.current;
    const height = menu ? Math.min(menu.scrollHeight + 4, 460) : 320;
    setPosition(
      planPopoverPlacement({
        anchor: { left: anchor.left, right: anchor.right, top: anchor.top, bottom: anchor.bottom },
        menu: { width: menuWidth, height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        align,
      }),
    );
  }, [align, menuWidth]);

  // Measure before paint so the menu never flashes in the wrong place.
  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    // The inspector and layers panel change the workspace width without a
    // window resize, so observe the trigger itself as well.
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(place) : null;
    if (triggerRef.current) observer?.observe(triggerRef.current);
    if (typeof document !== "undefined" && document.body) observer?.observe(document.body);

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer?.disconnect();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place, close]);

  // Roving focus: arrow keys move between enabled items, Home/End jump.
  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>("[data-toolbar-menu-item]:not([disabled])") || [],
    );
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
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
    open && mounted
      ? createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role={role}
            aria-label={label}
            data-customizer-text-interaction
            data-toolbar-popover
            onKeyDown={moveFocus}
            style={{ left: position.left, top: position.top, width: menuWidth, maxHeight: position.maxHeight }}
            className={`fixed z-[240] overflow-y-auto overscroll-contain rounded-xl border border-[#303839]/12 bg-white p-1.5 shadow-[0_18px_44px_rgba(48,56,57,0.18)] [scrollbar-color:rgba(48,56,57,0.22)_transparent] [scrollbar-width:thin] ${menuClassName}`}
          >
            {children(() => close())}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup={role === "dialog" ? "dialog" : "menu"}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={triggerTitle || label}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={(open || active) && triggerActiveClassName ? triggerActiveClassName : triggerClassName}
      >
        {trigger}
      </button>
      {menu}
    </>
  );
}

/** One row inside a ToolbarPopover. Keeps focus, disabled and hover states
 *  consistent across every toolbar menu. */
export function ToolbarMenuItem({
  label,
  hint,
  icon,
  active = false,
  disabled = false,
  danger = false,
  onSelect,
}: {
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-toolbar-menu-item
      role="menuitem"
      title={hint || label}
      aria-label={hint ? `${label}. ${hint}` : label}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={onSelect}
      className={`flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${
        disabled
          ? "cursor-not-allowed text-[#303839]/35"
          : danger
            ? "text-red-600 hover:bg-red-50"
            : active
              ? "bg-[#303839] text-white"
              : "text-[#303839] hover:bg-[#F4ECEC]"
      }`}
    >
      {icon ? <span className="grid h-5 w-5 shrink-0 place-items-center">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

/** Small uppercase section heading inside a popover. */
export function ToolbarMenuSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-1 pb-1 pt-1.5 first:pt-0.5">
      <p className="px-1.5 pb-1 text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#303839]/45">{title}</p>
      {children}
    </div>
  );
}
