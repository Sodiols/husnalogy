"use client";

// Right-click menu for the customer canvas (spec §20, §32).
//
// The menu model comes from `buildCustomerContextMenu`, which already dropped
// every action the customer may not take — this component only renders and
// handles focus. It is a real menu for assistive technology: role="menu" with
// role="menuitem" children, roving focus driven by the arrow keys, Home/End,
// Escape to close, and focus returned to whatever opened it.
//
// Position is clamped to the viewport so a right click near an edge still shows
// the whole menu rather than pushing it off screen.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  flattenContextMenu,
  formatShortcut,
  type ContextMenuActionId,
  type ContextMenuItem,
} from "@/lib/customizer/v2/context-menu";

const EDGE_PADDING = 8;

type Props = {
  groups: ContextMenuItem[][];
  /** Viewport coordinates of the originating pointer event. */
  x: number;
  y: number;
  onAction: (id: ContextMenuActionId) => void;
  onClose: () => void;
};

export default function CustomerCanvasContextMenu({ groups, x, y, onAction, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [position, setPosition] = useState({ left: x, top: y });
  const [activeIndex, setActiveIndex] = useState(0);
  const items = flattenContextMenu(groups);
  const isMac =
    typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || "");

  // Measure after paint so the menu can be nudged back inside the viewport
  // before the user sees it in the wrong place.
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - EDGE_PADDING;
    const maxTop = window.innerHeight - rect.height - EDGE_PADDING;
    setPosition({
      left: Math.max(EDGE_PADDING, Math.min(x, Math.max(EDGE_PADDING, maxLeft))),
      top: Math.max(EDGE_PADDING, Math.min(y, Math.max(EDGE_PADDING, maxTop))),
    });
  }, [x, y, items.length]);

  useEffect(() => {
    itemRefs.current[activeIndex]?.focus();
  }, [activeIndex]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    // Capture phase: close before the canvas treats the press as a new gesture.
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  if (!items.length) return null;

  const move = (delta: number) => {
    setActiveIndex((current) => (current + delta + items.length) % items.length);
  };

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(items.length - 1);
    }
  };

  let index = -1;
  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Object actions"
      onKeyDown={onMenuKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      className="fixed z-[70] min-w-[208px] overflow-hidden rounded-xl border border-[#303839]/12 bg-white py-1 shadow-[0_18px_50px_rgba(48,56,57,0.18)]"
      style={{ left: position.left, top: position.top }}
    >
      {groups.map((group, groupIndex) => (
        <div
          key={groupIndex}
          role="group"
          className={groupIndex > 0 ? "mt-1 border-t border-[#303839]/8 pt-1" : undefined}
        >
          {group.map((item) => {
            index += 1;
            const itemIndex = index;
            const accelerator = formatShortcut(item.shortcut, isMac);
            return (
              <button
                key={item.id}
                ref={(element) => {
                  itemRefs.current[itemIndex] = element;
                }}
                type="button"
                role="menuitem"
                tabIndex={itemIndex === activeIndex ? 0 : -1}
                onMouseEnter={() => setActiveIndex(itemIndex)}
                onClick={() => {
                  onAction(item.id);
                  onClose();
                }}
                className={`flex w-full items-center justify-between gap-6 px-3 py-2 text-left text-xs font-bold transition-colors focus:outline-none ${
                  item.danger
                    ? "text-red-700 hover:bg-red-50 focus-visible:bg-red-50"
                    : "text-[#303839] hover:bg-[#303839]/6 focus-visible:bg-[#303839]/6"
                }`}
              >
                <span>{item.label}</span>
                {accelerator && (
                  <span aria-hidden className="text-[10px] font-semibold text-[#303839]/40">
                    {accelerator}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
