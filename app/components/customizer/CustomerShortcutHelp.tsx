"use client";

import { useEffect, useRef } from "react";

const shortcuts = [
  ["Undo / redo", "Ctrl or Cmd + Z / Shift + Z"],
  ["Copy / paste", "Ctrl or Cmd + C / V"],
  ["Duplicate", "Ctrl or Cmd + D"],
  ["Select all", "Ctrl or Cmd + A"],
  ["Group / ungroup", "Ctrl or Cmd + G / Shift + G"],
  ["Bring forward / front", "] / Shift + ]"],
  ["Send backward / back", "[ / Shift + ["],
  ["Move / larger move", "Arrow / Shift + Arrow"],
  ["Enter / exit group", "Enter / Escape"],
  ["Delete selection", "Delete or Backspace"],
];

export default function CustomerShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[180] grid place-items-center bg-[#303839]/45 p-4" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="shortcut-help-title" className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-white/40 bg-white p-5 shadow-[0_28px_90px_rgba(48,56,57,0.28)] sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#D4AF37]">Work faster</p><h2 id="shortcut-help-title" className="mt-1 font-display text-3xl text-[#303839]">Keyboard shortcuts</h2><p className="mt-2 text-sm leading-6 text-[#303839]/55">Shortcuts pause while you type in a field.</p></div>
          <button ref={closeRef} type="button" onClick={onClose} className="min-h-11 rounded-xl border border-[#303839]/12 px-4 text-xs font-extrabold text-[#303839] hover:bg-[#F8F6F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]">Close</button>
        </div>
        <dl className="mt-6 grid gap-2 sm:grid-cols-2">
          {shortcuts.map(([label, keys]) => <div key={label} className="rounded-2xl bg-[#F8F6F1] p-4"><dt className="text-xs font-extrabold text-[#303839]">{label}</dt><dd className="mt-2 text-[11px] font-semibold leading-5 text-[#303839]/55">{keys}</dd></div>)}
        </dl>
      </section>
    </div>
  );
}
