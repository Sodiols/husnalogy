"use client";

import { useRef, type ReactNode } from "react";
import type { TextPlacementPreset } from "@/lib/customizer/v2/text-editing";

/**
 * The list of text styles shown by both Add Text panels — the studio's
 * (AdminTextToolPanel) and the customer customizer's (CustomerAddTextPanel) —
 * so the two always look and behave the same. Each row previews its own style:
 * the label is drawn in the size and face that style adds to the card.
 */

export type TextStyleItem = {
  id: TextPlacementPreset;
  label: string;
  description: string;
};

// How each preset's label is drawn, echoing what lands on the card.
const PREVIEW: Record<string, string> = {
  text: "text-[16px] font-semibold leading-tight",
  heading: "font-display text-[26px] font-medium leading-none",
  subheading: "font-display text-[19px] italic leading-tight",
  body: "text-[13.5px] leading-snug",
};

export function TextStyleList({
  items,
  selected,
  onSelect,
}: {
  items: TextStyleItem[];
  selected: TextPlacementPreset;
  onSelect: (preset: TextPlacementPreset) => void;
}) {
  // A press on a style captures the pointer and the style is applied on
  // release. Pressing ends any text being edited on the canvas (its editor
  // closes on any outside press); an empty text it had just added is then
  // discarded and the controls above this list disappear, so the list jumps
  // before the release. Without capture the release landed elsewhere, no click
  // fired, and the chosen style was silently lost.
  const pressRef = useRef<{ pointerId: number; x: number; y: number; id: TextPlacementPreset } | null>(null);
  const handledRef = useRef(false);
  return (
    <div className="grid gap-2" data-text-style-list>
      {items.map((item) => {
        const active = item.id === selected;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            onPointerDown={(event) => {
              if (!event.isPrimary || event.button !== 0) return;
              event.currentTarget.setPointerCapture?.(event.pointerId);
              pressRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, id: item.id };
            }}
            onPointerUp={(event) => {
              const press = pressRef.current;
              pressRef.current = null;
              if (!press || press.pointerId !== event.pointerId) return;
              // A drag (e.g. a touch scroll) is not a choice.
              if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) return;
              handledRef.current = true;
              onSelect(press.id);
            }}
            onPointerCancel={() => {
              pressRef.current = null;
            }}
            onClick={() => {
              // Already applied on release; keyboard (Enter/Space) arrives here only.
              if (handledRef.current) {
                handledRef.current = false;
                return;
              }
              onSelect(item.id);
            }}
            className={`group flex min-h-[68px] w-full cursor-pointer items-center gap-3 rounded-[10px] border bg-white px-3.5 py-3 text-left transition-[background-color,border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
              active
                ? "border-[#D4AF37] shadow-[0_0_0_1px_#D4AF37] bg-[#D4AF37]/[0.06]"
                : "border-[#303839]/12 hover:border-[#303839]/35 hover:bg-[#F8F6F1]"
            }`}
          >
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[#1f2425] ${PREVIEW[item.id] || PREVIEW.text}`}>{item.label}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[12px] leading-snug text-[#303839]/70">{item.description}</span>
                {active && (
                  <span className="rounded-full bg-[#D4AF37]/20 px-2 py-px text-[11px] font-semibold text-[#1f2425]">Last used</span>
                )}
              </span>
            </span>
            <span
              aria-hidden
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#303839]/15 text-[#303839] transition-colors duration-200 group-hover:border-[#303839] group-hover:bg-[#303839] group-hover:text-white"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A quiet one-line tip under the list (replaces the old dark note). */
export function TextStyleTip({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 rounded-[10px] bg-[#F8F6F1] px-3 py-2.5 text-[12.5px] leading-snug text-[#303839]/80">
      <svg className="mt-px shrink-0 text-[#303839]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
      </svg>
      <span>{children}</span>
    </p>
  );
}
