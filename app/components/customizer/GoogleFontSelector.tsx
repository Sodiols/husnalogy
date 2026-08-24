"use client";

// Searchable Google Fonts selector — the single shared implementation used by
// the admin text toolbar, the customer text toolbar and the admin allowed-fonts
// setting (spec §6, §25).
//
// Performance (spec §8): results are capped and each visible row lazily loads
// only its own regular cut for the preview, via IntersectionObserver. Opening
// the dropdown never downloads the catalog's fonts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  rememberRecentFont,
  readRecentFonts,
  useSelectableFamilies,
  usePreviewFontLoader,
  type CatalogFamily,
} from "./useGoogleFonts";
import { normalizeAllowedCustomerFonts } from "@/lib/customizer/v2/google-fonts";

export const FONT_SELECTOR_VISIBLE_LIMIT = 60;

export function filterVisibleFontResults(
  families: CatalogFamily[],
  query: string,
  visibleLimit = FONT_SELECTOR_VISIBLE_LIMIT,
): CatalogFamily[] {
  const filtered = families.filter((entry) => matches(entry, query));
  if (query) {
    filtered.sort((a, b) => rank(a, query) - rank(b, query) || a.family.localeCompare(b.family));
  }
  return filtered.slice(0, visibleLimit);
}

type Props = {
  value: string;
  onChange: (family: string) => void;
  /** Empty = all Google Fonts (the existing Husnalogy template rule). */
  allowedFonts?: string[];
  disabled?: boolean;
  label?: string;
  className?: string;
  /** Compact trigger for the dense canvas toolbars. */
  compact?: boolean;
  /** Retry the currently selected face when the selector is reopened. */
  onOpen?: () => void;
};

function matches(entry: CatalogFamily, term: string): boolean {
  if (!term) return true;
  const needle = term.toLowerCase();
  return entry.family.toLowerCase().includes(needle) || entry.category.toLowerCase().includes(needle);
}

function rank(entry: CatalogFamily, term: string): number {
  if (!term) return 0;
  const name = entry.family.toLowerCase();
  const needle = term.toLowerCase();
  if (name === needle) return 0;
  if (name.startsWith(needle)) return 1;
  if (name.includes(needle)) return 2;
  return 3;
}

/** One result row; loads its own preview face only once actually on screen. */
function FontRow({
  entry,
  selected,
  active,
  onPick,
  onVisible,
  rowRef,
}: {
  entry: CatalogFamily;
  selected: boolean;
  active: boolean;
  onPick: () => void;
  onVisible: (family: string) => void;
  rowRef?: (node: HTMLButtonElement | null) => void;
}) {
  const localRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const node = localRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      onVisible(entry.family);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const observed of entries) {
          if (observed.isIntersecting) {
            onVisible(entry.family);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: "80px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [entry.family, onVisible]);

  return (
    <button
      ref={(node) => {
        localRef.current = node;
        rowRef?.(node);
      }}
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onPick}
      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors ${
        active ? "bg-[#F4ECEC]" : "hover:bg-[#F8F6F1]"
      } ${selected ? "font-bold" : ""}`}
    >
      <span
        className="min-w-0 flex-1 truncate text-[15px] leading-6 text-[#303839]"
        // The preview renders in the family itself once its face has loaded.
        style={{ fontFamily: `"${entry.family}", ${entry.category === "serif" ? "serif" : "sans-serif"}` }}
      >
        {entry.family}
      </span>
      {selected && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[#D4AF37]" aria-hidden>
          <path d="m5 12 5 5 9-11" />
        </svg>
      )}
    </button>
  );
}

export default function GoogleFontSelector({
  value,
  onChange,
  allowedFonts,
  disabled = false,
  label = "Font family",
  className = "",
  compact = false,
  onOpen,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const { families, loading, error, retry } = useSelectableFamilies(allowedFonts);
  const hasRestrictedAllowlist = normalizeAllowedCustomerFonts(allowedFonts).length > 0;
  const loadPreview = usePreviewFontLoader();

  const toggleOpen = useCallback(() => {
    if (disabled) return;
    if (!open) {
      if (error) retry();
      onOpen?.();
    }
    setOpen((current) => !current);
  }, [disabled, error, onOpen, open, retry]);

  useEffect(() => {
    if (open) setRecent(readRecentFonts());
  }, [open]);

  // Recently-used never widens what the template permits (spec §26).
  const recentAvailable = useMemo(() => {
    if (query) return [];
    const available = new Map(families.map((entry) => [entry.family, entry]));
    return recent.map((family) => available.get(family)).filter(Boolean) as CatalogFamily[];
  }, [recent, families, query]);

  const results = useMemo(() => {
    return filterVisibleFontResults(families, query);
  }, [families, query]);

  // One flat list keeps keyboard navigation simple across both sections.
  const navigable = useMemo(() => [...recentAvailable, ...results], [recentAvailable, results]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  // Keep the keyboard-active row in view.
  useEffect(() => {
    if (!open) return;
    rowRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const pick = useCallback(
    (family: string) => {
      onChange(family);
      rememberRecentFont(family);
      setOpen(false);
      setQuery("");
    },
    [onChange],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, navigable.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const chosen = navigable[activeIndex];
      if (chosen) pick(chosen.family);
    }
  };

  const triggerLabel = value || "Select a font";

  return (
    <div ref={containerRef} className={`relative shrink-0 ${className}`} data-customizer-text-interaction>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={toggleOpen}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border border-[#303839]/12 bg-white text-left text-[#303839] transition-colors hover:border-[#303839]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] disabled:cursor-not-allowed disabled:opacity-45 ${
          compact ? "h-9 px-2.5 text-xs" : "h-10 px-3 text-sm"
        }`}
      >
        <span className="min-w-0 flex-1 truncate font-semibold" style={{ fontFamily: value ? `"${value}", sans-serif` : undefined }}>
          {triggerLabel}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-0 z-[2500] mt-1 w-[min(300px,80vw)] overflow-hidden rounded-xl border border-[#303839]/12 bg-white shadow-[0_18px_44px_rgba(48,56,57,0.18)]"
          role="listbox"
          aria-label={label}
        >
          <div className="border-b border-[#303839]/8 p-2">
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search Google Fonts…"
              aria-label="Search Google Fonts"
              className="h-9 w-full rounded-lg border border-[#303839]/12 bg-[#F8F6F1] px-3 text-sm text-[#303839] outline-none focus:border-[#D4AF37] focus:bg-white focus:ring-2 focus:ring-[#D4AF37]/20"
            />
            {!loading && !error && (
              <p className="px-1 pt-1.5 text-[10px] font-semibold text-[#303839]/45">
                Search all {families.length.toLocaleString()} {hasRestrictedAllowlist ? "allowed fonts" : "Google Fonts"}
              </p>
            )}
          </div>

          <div ref={listRef} className="max-h-[260px] overflow-y-auto overscroll-contain" onKeyDown={onKeyDown}>
            {loading && (
              <p className="px-3 py-6 text-center text-xs text-[#303839]/55">Loading Google Fonts…</p>
            )}

            {!loading && error && (
              <div className="px-3 py-5 text-center">
                <p className="text-xs text-[#303839]/60">{error}</p>
                <button
                  type="button"
                  onClick={retry}
                  className="mt-3 rounded-lg border border-[#303839]/15 px-3 py-1.5 text-xs font-bold text-[#303839] hover:bg-[#F8F6F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
                >
                  Retry
                </button>
              </div>
            )}

            {!loading && !error && !navigable.length && (
              <p className="px-3 py-6 text-center text-xs text-[#303839]/55">
                {query ? `No fonts match “${query}”.` : "No fonts are available for this design."}
              </p>
            )}

            {!loading && !error && recentAvailable.length > 0 && (
              <>
                <p className="px-3 pb-1 pt-2 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#303839]/40">
                  Recently used
                </p>
                {recentAvailable.map((entry, index) => (
                  <FontRow
                    key={`recent-${entry.family}`}
                    entry={entry}
                    selected={entry.family === value}
                    active={activeIndex === index}
                    onPick={() => pick(entry.family)}
                    onVisible={loadPreview}
                    rowRef={(node) => {
                      rowRefs.current[index] = node;
                    }}
                  />
                ))}
                <div className="my-1 h-px bg-[#303839]/8" />
              </>
            )}

            {!loading && !error && results.length > 0 && (
              <>
                <p className="px-3 pb-1 pt-2 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#303839]/40">
                  {query ? "Results" : "Popular"}
                </p>
                {results.map((entry, index) => {
                  const navIndex = recentAvailable.length + index;
                  return (
                    <FontRow
                      key={entry.family}
                      entry={entry}
                      selected={entry.family === value}
                      active={activeIndex === navIndex}
                      onPick={() => pick(entry.family)}
                      onVisible={loadPreview}
                      rowRef={(node) => {
                        rowRefs.current[navIndex] = node;
                      }}
                    />
                  );
                })}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
