"use client";

// Browser-side copy/screenshot deterrence for the CUSTOMER customizer only
// (never applied to the admin builder). A browser cannot fully prevent OS-level
// screenshots, external cameras, or every recording tool — this implements the
// strongest practical in-browser deterrence without breaking editing,
// accessibility, or SVG rendering.

import { useEffect, useRef, useState } from "react";

const PRINT_SCREEN_COVER_MS = 1600;

function isEditableTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export default function useCustomizerProtection(enabled = true) {
  const [covered, setCovered] = useState(false);
  const coverTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const coverBriefly = () => {
      setCovered(true);
      if (coverTimer.current) window.clearTimeout(coverTimer.current);
      coverTimer.current = window.setTimeout(() => setCovered(false), PRINT_SCREEN_COVER_MS);
    };

    const onContextMenu = (event: MouseEvent) => {
      // Keep native context menus inside form controls (spell-check etc.).
      if (isEditableTarget(event.target)) return;
      const el = event.target as HTMLElement | null;
      if (el && el.closest("[data-customizer-protected]")) event.preventDefault();
    };

    const onDragStart = (event: DragEvent) => {
      const el = event.target as HTMLElement | null;
      if (el && el.closest("[data-customizer-protected]")) event.preventDefault();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const key = String(event.key || "").toLowerCase();
      const mod = event.ctrlKey || event.metaKey;
      // Print / save page / view source. Never block plain typing or
      // accessibility navigation.
      if (mod && (key === "p" || key === "s" || key === "u")) {
        event.preventDefault();
        if (key === "p") coverBriefly();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      // PrintScreen usually only reports on keyup, and only in some browsers.
      if (event.key === "PrintScreen") {
        coverBriefly();
        // Best effort: overwrite the clipboard image with an empty string.
        try {
          navigator.clipboard?.writeText("");
        } catch {
          // Clipboard access may be denied — the visual cover still applies.
        }
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") setCovered(true);
      else setCovered(false);
    };
    const onBlur = () => setCovered(true);
    const onFocus = () => setCovered(false);
    const onBeforePrint = () => setCovered(true);
    const onAfterPrint = () => setCovered(false);

    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("dragstart", onDragStart);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);

    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("dragstart", onDragStart);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
      if (coverTimer.current) window.clearTimeout(coverTimer.current);
    };
  }, [enabled]);

  return { covered };
}
