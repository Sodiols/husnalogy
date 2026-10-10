"use client";

// Searchable Google Fonts selector — the single shared implementation used by
// the admin text toolbar, the customer text toolbar and the admin allowed-fonts
// setting (spec §6, §25).
//
// Performance (spec §8): results are capped and each visible row lazily loads
// only its own regular cut for the preview, via IntersectionObserver. Opening
// the dropdown never downloads the catalog's fonts.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  rememberRecentFont,
  readRecentFonts,
  useFontFavourites,
  useSelectableFamilies,
  usePreviewFontLoader,
  type CatalogFamily,
} from "./useGoogleFonts";
import { normalizeAllowedCustomerFonts } from "@/lib/customizer/v2/google-fonts";
import {
  FONT_CATEGORY_TABS,
  buildFontCategoryIndex,
  filterFamiliesByCategory,
  fontFamilyKey,
  type FontCategoryId,
} from "@/lib/customizer/v2/font-categories";

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
  /**
   * Offer the star that marks a font as a Husnalogy Favourite. Shown only when
   * the server also says the viewer is an administrator.
   */
  manageFavourites?: boolean;
  /**
   * Render the list in a fixed, body-level layer. Needed wherever the trigger
   * sits inside a scrolling strip (the admin toolbar scrolls sideways), which
   * would otherwise clip an absolutely positioned list.
   */
  portal?: boolean;
  /** A muted word before the family name on the trigger: "Font: Inter". */
  triggerPrefix?: string;
  /** Replaces the trigger's size and shape classes (border, height, padding, radius). */
  triggerClassName?: string;
  /**
   * Open the Fonts side panel instead of the floating list (the editors' text
   * toolbars). The trigger then only toggles that panel.
   */
  onOpenPanel?: () => void;
  /** Whether that side panel is open, for the trigger's expanded state. */
  panelOpen?: boolean;
};

const PANEL_WIDTH = 300;

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
  favourite,
  onToggleFavourite,
}: {
  entry: CatalogFamily;
  selected: boolean;
  active: boolean;
  onPick: () => void;
  onVisible: (family: string) => void;
  rowRef?: (node: HTMLButtonElement | null) => void;
  favourite: boolean;
  /** Present only for a viewer who may change Favourite Fonts. */
  onToggleFavourite?: () => void;
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
    <div className={`flex items-center transition-colors ${active ? "bg-[#F8F6F1]" : "hover:bg-cream"}`}>
      <button
        ref={(node) => {
          localRef.current = node;
          rowRef?.(node);
        }}
        type="button"
        role="option"
        aria-selected={selected}
        onClick={onPick}
        className={`flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2 text-left ${selected ? "font-bold" : ""}`}
      >
        <span
          className="min-w-0 flex-1 truncate text-[15px] leading-6 text-[#303839]"
          // The preview renders in the family itself once its face has loaded.
          style={{ fontFamily: `"${entry.family}", ${entry.category === "serif" ? "serif" : "sans-serif"}` }}
        >
          {entry.family}
        </span>
        {selected && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[#303839]" aria-hidden>
            <path d="m5 12 5 5 9-11" />
          </svg>
        )}
      </button>
      {onToggleFavourite && (
        <button
          type="button"
          aria-pressed={favourite}
          aria-label={favourite ? `Remove ${entry.family} from Favourite Fonts` : `Add ${entry.family} to Favourite Fonts`}
          title={favourite ? "Remove from Favourite Fonts" : "Add to Favourite Fonts"}
          onClick={onToggleFavourite}
          className={`mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] ${favourite ? "text-[#D4AF37]" : "text-[#303839]/30 hover:text-[#303839]/60"}`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill={favourite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
            <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" />
          </svg>
        </button>
      )}
    </div>
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
  manageFavourites = false,
  portal = false,
  triggerPrefix,
  triggerClassName,
  onOpenPanel,
  panelOpen = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [panelPosition, setPanelPosition] = useState({ left: 0, top: 0, maxHeight: 420 });
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [category, setCategory] = useState<FontCategoryId>("all");
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const [tabScroll, setTabScroll] = useState({ left: false, right: false });
  const updateTabScroll = useCallback(() => {
    const row = tabsRef.current;
    if (!row) return;
    const next = { left: row.scrollLeft > 2, right: row.scrollLeft + row.clientWidth < row.scrollWidth - 2 };
    setTabScroll((current) => (current.left === next.left && current.right === next.right ? current : next));
  }, []);
  const scrollTabs = (direction: 1 | -1) => {
    const row = tabsRef.current;
    if (row) row.scrollBy({ left: direction * Math.max(120, row.clientWidth * 0.7), behavior: "smooth" });
  };
  const [favouriteError, setFavouriteError] = useState("");

  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // `families` is already narrowed to what this design PERMITS. Every category
  // below - Favourite Fonts included - filters within it, so a category can
  // never offer a font the template does not allow.
  const { families, loading, error, retry } = useSelectableFamilies(allowedFonts);
  const hasRestrictedAllowlist = normalizeAllowedCustomerFonts(allowedFonts).length > 0;
  const loadPreview = usePreviewFontLoader();
  const { favourites, canManage, toggle } = useFontFavourites();
  const showStars = manageFavourites && canManage;
  // Classified once per catalog, not on every keystroke of a search.
  const categoryIndex = useMemo(() => buildFontCategoryIndex(families), [families]);
  const inCategory = useMemo(
    () => filterFamiliesByCategory(families, category, categoryIndex, favourites),
    [families, category, categoryIndex, favourites],
  );
  const categoryLabel = FONT_CATEGORY_TABS.find((tab) => tab.id === category)?.label || "";

  const toggleFavourite = useCallback(
    async (family: string) => {
      setFavouriteError("");
      const failure = await toggle(family, !favourites.has(fontFamilyKey(family)));
      if (failure) setFavouriteError(failure);
    },
    [favourites, toggle],
  );

  const toggleOpen = useCallback(() => {
    if (disabled) return;
    if (onOpenPanel) {
      if (!panelOpen) onOpen?.();
      onOpenPanel();
      return;
    }
    if (!open) {
      if (error) retry();
      onOpen?.();
    }
    setOpen((current) => !current);
  }, [disabled, error, onOpen, onOpenPanel, open, panelOpen, retry]);

  useEffect(() => {
    if (open) setRecent(readRecentFonts());
  }, [open]);

  // Recently-used never widens what the template permits (spec §26).
  const recentAvailable = useMemo(() => {
    if (query || category !== "all") return [];
    const available = new Map(families.map((entry) => [entry.family, entry]));
    return recent.map((family) => available.get(family)).filter(Boolean) as CatalogFamily[];
  }, [recent, families, query, category]);

  const results = useMemo(() => {
    return filterVisibleFontResults(inCategory, query);
  }, [inCategory, query]);

  // One flat list keeps keyboard navigation simple across both sections.
  const navigable = useMemo(() => [...recentAvailable, ...results], [recentAvailable, results]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open, category]);

  // Portalled list: placed under the trigger, kept inside the viewport, and
  // re-placed when anything scrolls (the toolbar strip included).
  const placePanel = useCallback(() => {
    const anchor = triggerRef.current?.getBoundingClientRect();
    if (!anchor) return;
    const width = Math.min(PANEL_WIDTH, window.innerWidth * 0.8);
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
    const top = anchor.bottom + 4;
    setPanelPosition({ left, top, maxHeight: Math.max(220, window.innerHeight - top - 12) });
  }, []);
  useLayoutEffect(() => {
    if (!open || !portal) return;
    placePanel();
    window.addEventListener("resize", placePanel);
    window.addEventListener("scroll", placePanel, true);
    return () => {
      window.removeEventListener("resize", placePanel);
      window.removeEventListener("scroll", placePanel, true);
    };
  }, [open, portal, placePanel]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!containerRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  // Show the scroll arrows only while there is somewhere to scroll to.
  useEffect(() => {
    if (!open) return;
    updateTabScroll();
    const row = tabsRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateTabScroll);
    observer.observe(row);
    return () => observer.disconnect();
  }, [open, updateTabScroll]);

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
  const renderPanel = (panel: React.ReactElement) =>
    portal && typeof document !== "undefined" ? createPortal(panel, document.body) : panel;

  return (
    <div ref={containerRef} className={`relative shrink-0 ${className}`} data-customizer-text-interaction>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup={onOpenPanel ? undefined : "listbox"}
        aria-expanded={onOpenPanel ? panelOpen : open}
        aria-label={label}
        onClick={toggleOpen}
        className={`flex w-full items-center justify-between gap-2 bg-white text-left text-[#303839] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-45 ${
          triggerClassName ?? `rounded-lg border border-[#303839]/12 hover:border-[#303839]/25 ${compact ? "h-9 px-2.5 text-xs" : "h-10 px-3 text-sm"}`
        }`}
      >
        <span className="flex min-w-0 flex-1 items-baseline gap-1">
          {triggerPrefix && <span className="shrink-0 font-medium text-[#303839]/55">{triggerPrefix}</span>}
          <span className="min-w-0 truncate font-semibold" style={{ fontFamily: value ? `"${value}", sans-serif` : undefined }}>
            {triggerLabel}
          </span>
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && renderPanel(
        <div
          ref={panelRef}
          data-customizer-text-interaction
          className={`${portal ? "fixed flex flex-col" : "absolute left-0 mt-1"} z-[2500] w-[min(300px,80vw)] overflow-hidden rounded-xl border border-[#303839]/12 bg-white shadow-[0_18px_44px_rgba(48,56,57,0.18)]`}
          style={portal ? { left: panelPosition.left, top: panelPosition.top, maxHeight: panelPosition.maxHeight } : undefined}
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
              className="h-9 w-full rounded-lg border border-[#303839]/12 bg-cream px-3 text-sm text-[#303839] outline-none focus:border-[#303839]/60 focus:bg-white focus:ring-2 focus:ring-[#303839]/15"
            />
            {/* The category row scrolls sideways: a visible scrollbar, arrow
                buttons while more tabs are off-screen, and the mouse wheel. */}
            <div className="relative mt-2">
              {tabScroll.left && (
                <button
                  type="button"
                  aria-label="Scroll font categories left"
                  onClick={() => scrollTabs(-1)}
                  className="absolute left-0 top-0 z-10 grid h-[26px] w-7 place-items-center rounded-full border border-[#303839]/12 bg-white text-[#303839] shadow-sm hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839]"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 6-6 6 6 6" /></svg>
                </button>
              )}
              <div
                ref={tabsRef}
                role="tablist"
                aria-label="Font categories"
                onScroll={updateTabScroll}
                onWheel={(event) => {
                  const row = tabsRef.current;
                  if (!row || row.scrollWidth <= row.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
                  row.scrollLeft += event.deltaY;
                }}
                className={`flex gap-1 overflow-x-auto pb-1.5 [scrollbar-color:rgba(48,56,57,0.28)_transparent] [scrollbar-width:thin] ${tabScroll.left ? "pl-8" : ""} ${tabScroll.right ? "pr-8" : ""}`}
              >
                {FONT_CATEGORY_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={category === tab.id}
                    onClick={(event) => {
                      setCategory(tab.id);
                      event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
                    }}
                    className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] ${
                      category === tab.id
                        ? "border-[#303839] bg-[#303839] text-white"
                        : "border-[#303839]/12 bg-white text-[#303839]/70 hover:border-[#303839]/30 hover:text-[#303839]"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              {tabScroll.right && (
                <button
                  type="button"
                  aria-label="Scroll font categories right"
                  onClick={() => scrollTabs(1)}
                  className="absolute right-0 top-0 z-10 grid h-[26px] w-7 place-items-center rounded-full border border-[#303839]/12 bg-white text-[#303839] shadow-sm hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839]"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
                </button>
              )}
            </div>
            {!loading && !error && (
              <p className="px-1 pt-1.5 text-[10px] font-semibold text-[#303839]/45">
                {category === "all"
                  ? `Search all ${families.length.toLocaleString()} ${hasRestrictedAllowlist ? "allowed fonts" : "Google Fonts"}`
                  : `${inCategory.length.toLocaleString()} in ${categoryLabel}${hasRestrictedAllowlist ? " allowed in this design" : ""}`}
              </p>
            )}
            {favouriteError && (
              <p role="alert" className="px-1 pt-1 text-[10px] font-bold text-red-700">{favouriteError}</p>
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
                  className="mt-3 rounded-lg border border-[#303839]/15 px-3 py-1.5 text-xs font-bold text-[#303839] hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#303839] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                >
                  Retry
                </button>
              </div>
            )}

            {!loading && !error && !navigable.length && (
              <p className="px-3 py-6 text-center text-xs text-[#303839]/55">
                {query
                  ? `No fonts match “${query}”.`
                  : category === "favourites"
                    ? hasRestrictedAllowlist
                      ? "None of the Favourite Fonts are allowed in this design."
                      : "No Favourite Fonts yet."
                    : category !== "all"
                      ? "No fonts in this category are available for this design."
                      : "No fonts are available for this design."}
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
                    favourite={favourites.has(fontFamilyKey(entry.family))}
                    onToggleFavourite={showStars ? () => void toggleFavourite(entry.family) : undefined}
                  />
                ))}
                <div className="my-1 h-px bg-[#303839]/8" />
              </>
            )}

            {!loading && !error && results.length > 0 && (
              <>
                <p className="px-3 pb-1 pt-2 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#303839]/40">
                  {query ? "Results" : category === "all" ? "Popular" : categoryLabel}
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
                      favourite={favourites.has(fontFamilyKey(entry.family))}
                      onToggleFavourite={showStars ? () => void toggleFavourite(entry.family) : undefined}
                    />
                  );
                })}
              </>
            )}
          </div>
        </div>,
      )}
    </div>
  );
}
