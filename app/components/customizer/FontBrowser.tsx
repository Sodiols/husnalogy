"use client";

/**
 * The Fonts side panel, shared by the Design Studio and the customer
 * customizer. The toolbar's "Font:" trigger opens it in the left panel slot,
 * beside Uploads, Elements and Layers, instead of a floating list.
 *
 * Top (sticky): a search pill and the category chips, which wrap rather than
 * scroll sideways. Below: the fonts already used in this design, the fonts
 * this person used recently, then the chosen category — each row drawn in its
 * own face. The catalog, categories, favourites and recent fonts are the same
 * hooks the dropdown selector uses (GoogleFontSelector), so both agree.
 *
 * Performance (spec §8): results are capped (with "Show more") and each row
 * lazily loads only its own preview cut, via IntersectionObserver.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ensureGoogleFontLoaded,
  readRecentFonts,
  rememberRecentFont,
  reportGoogleFontLoadFailure,
  useFontFavourites,
  usePreviewFontLoader,
  useSelectableFamilies,
  type CatalogFamily,
} from "./useGoogleFonts";
import { filterVisibleFontResults, FONT_SELECTOR_VISIBLE_LIMIT } from "./GoogleFontSelector";
import { normalizeAllowedCustomerFonts } from "@/lib/customizer/v2/google-fonts";
import { FONT_CATEGORY_TABS, buildFontCategoryIndex, filterFamiliesByCategory, fontFamilyKey, type FontCategoryId } from "@/lib/customizer/v2/font-categories";
import { nearestSupportedWeight } from "@/lib/customizer/v2/text-toolbar";

/**
 * The style change for a new family: the weight snaps to the nearest cut the
 * family really has and italic is dropped when it has none — one patch, so it
 * is one undo step (as in the toolbar).
 */
export function buildFontFamilyPatch(family: string, entry: CatalogFamily | undefined, style: { fontWeight?: unknown; fontStyle?: unknown } = {}) {
  const currentWeight = String(style.fontWeight || "400");
  const italic = style.fontStyle === "italic";
  const weights = entry?.weights?.length ? entry.weights : ["400", "700"];
  const snapped = nearestSupportedWeight(weights, currentWeight);
  const patch: Record<string, unknown> = { fontFamily: family };
  if (snapped !== currentWeight) patch.fontWeight = snapped;
  if (italic && entry && !entry.hasItalic) patch.fontStyle = "normal";
  void ensureGoogleFontLoaded(family, snapped, italic && entry?.hasItalic ? "italic" : "normal").catch(reportGoogleFontLoadFailure);
  return patch;
}

type Tone = "studio" | "brand";
const ACCENT: Record<Tone, { ring: string; chipOn: string; searchButton: string; searchFocus: string }> = {
  // The studio's navy, as in its Background search and outline buttons.
  studio: { ring: "focus-visible:ring-[#27307A]", chipOn: "border-[#27307A] shadow-[0_0_0_1px_#27307A]", searchButton: "bg-[#27307A]", searchFocus: "focus-within:border-[#27307A]" },
  // The Husnalogy ink for the customer customizer.
  brand: { ring: "focus-visible:ring-[#303839]", chipOn: "border-[#303839] shadow-[0_0_0_1px_#303839]", searchButton: "bg-[#303839]", searchFocus: "focus-within:border-[#303839]" },
};

type Props = {
  /** The family of the selected text, or "" when nothing (or a mix) is selected. */
  value: string;
  /** Apply a family; absent while no text the viewer may restyle is selected. */
  onPick?: (family: string, entry: CatalogFamily | undefined) => void;
  /** Close the panel (Escape in the search box). */
  onClose?: () => void;
  /** Empty = all Google Fonts (the existing Husnalogy template rule). */
  allowedFonts?: string[];
  /** Families already used in this design, shown first. */
  designFonts?: string[];
  /** Offer the Favourite Fonts star (administrators only; the server confirms). */
  manageFavourites?: boolean;
  /** Accessible name of the results list (matches the toolbar trigger). */
  label?: string;
  tone?: Tone;
};

/** One font row, drawn in its own face once that face has loaded. */
function FontRow({
  entry,
  selected,
  active,
  option,
  disabled,
  onPick,
  onVisible,
  rowRef,
  favourite,
  onToggleFavourite,
  ring,
}: {
  entry: CatalogFamily;
  selected: boolean;
  active: boolean;
  /** Rows of the results list are listbox options; the shortcut sections are plain buttons. */
  option: boolean;
  disabled: boolean;
  onPick: () => void;
  onVisible: (family: string) => void;
  rowRef?: (node: HTMLButtonElement | null) => void;
  favourite: boolean;
  onToggleFavourite?: () => void;
  ring: string;
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
        if (entries.some((observed) => observed.isIntersecting)) {
          onVisible(entry.family);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [entry.family, onVisible]);

  return (
    <div className={`group flex min-w-0 items-center rounded-lg transition-colors ${selected ? "bg-[#F3F1EC]" : active ? "bg-[#F8F6F1]" : "hover:bg-[#F8F6F1]"}`}>
      <button
        ref={(node) => {
          localRef.current = node;
          rowRef?.(node);
        }}
        type="button"
        role={option ? "option" : undefined}
        aria-selected={option ? selected : undefined}
        aria-pressed={option ? undefined : selected}
        disabled={disabled}
        onClick={onPick}
        title={entry.family}
        className={`flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset ${ring} disabled:cursor-default`}
      >
        <span
          className="min-w-0 flex-1 truncate text-[20px] leading-7 text-[#1f2425]"
          style={{ fontFamily: `"${entry.family}", ${entry.category === "serif" ? "serif" : "sans-serif"}` }}
        >
          {entry.family}
        </span>
        {selected && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[#1f2425]" aria-hidden>
            <path d="m5 12 5 5 9-11" />
          </svg>
        )}
      </button>
      {onToggleFavourite && (
        <button
          type="button"
          data-shape="round"
          aria-pressed={favourite}
          aria-label={favourite ? `Remove ${entry.family} from Favourite Fonts` : `Add ${entry.family} to Favourite Fonts`}
          title={favourite ? "Remove from Favourite Fonts" : "Add to Favourite Fonts"}
          onClick={onToggleFavourite}
          className={`mr-1 grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 ${ring} ${favourite ? "text-[#D4AF37]" : "text-[#303839]/30 hover:text-[#303839]/60"}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill={favourite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
            <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" />
          </svg>
        </button>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="px-1 pb-1.5 pt-1 text-[14px] font-bold text-[#1f2425]">{children}</p>;
}

export default function FontBrowser({
  value,
  onPick,
  onClose,
  allowedFonts,
  designFonts = [],
  manageFavourites = false,
  label = "Font family",
  tone = "brand",
}: Props) {
  const accent = ACCENT[tone];
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FontCategoryId>("all");
  const [limit, setLimit] = useState(FONT_SELECTOR_VISIBLE_LIMIT);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const [favouriteError, setFavouriteError] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // `families` is already narrowed to what this design PERMITS; every section
  // and category filters within it, so nothing offers a font it does not allow.
  const { families, loading, error, retry } = useSelectableFamilies(allowedFonts);
  const restricted = normalizeAllowedCustomerFonts(allowedFonts).length > 0;
  const loadPreview = usePreviewFontLoader();
  const { favourites, canManage, toggle } = useFontFavourites();
  const showStars = manageFavourites && canManage;
  const categoryIndex = useMemo(() => buildFontCategoryIndex(families), [families]);
  const inCategory = useMemo(() => filterFamiliesByCategory(families, category, categoryIndex, favourites), [families, category, categoryIndex, favourites]);
  const categoryLabel = FONT_CATEGORY_TABS.find((tab) => tab.id === category)?.label || "";
  const byFamily = useMemo(() => new Map(families.map((entry) => [entry.family.toLowerCase(), entry])), [families]);

  useEffect(() => {
    setRecent(readRecentFonts());
    // Open with the search ready, as the dropdown did.
    searchRef.current?.focus();
  }, []);
  useEffect(() => {
    setLimit(FONT_SELECTOR_VISIBLE_LIMIT);
    setActiveIndex(-1);
  }, [query, category]);

  // The shortcut sections show only on the unfiltered "All Fonts" view.
  const browsing = !query && category === "all";
  const inDesign = useMemo(() => {
    if (!browsing) return [];
    const seen = new Set<string>();
    return designFonts
      .map((family) => byFamily.get(String(family || "").toLowerCase()))
      .filter((entry): entry is CatalogFamily => Boolean(entry) && !seen.has(entry!.family) && Boolean(seen.add(entry!.family)));
  }, [browsing, designFonts, byFamily]);
  const recentAvailable = useMemo(() => {
    if (!browsing) return [];
    const shown = new Set(inDesign.map((entry) => entry.family));
    return recent.map((family) => byFamily.get(family.toLowerCase())).filter((entry): entry is CatalogFamily => Boolean(entry) && !shown.has(entry!.family)).slice(0, 5);
  }, [browsing, recent, byFamily, inDesign]);
  const allResults = useMemo(() => filterVisibleFontResults(inCategory, query, Number.POSITIVE_INFINITY), [inCategory, query]);
  const results = allResults.slice(0, limit);
  const navigable = useMemo(() => [...inDesign, ...recentAvailable, ...results], [inDesign, recentAvailable, results]);

  useEffect(() => {
    if (activeIndex >= 0) rowRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const pick = useCallback(
    (entry: CatalogFamily) => {
      if (!onPick) return;
      onPick(entry.family, entry);
      rememberRecentFont(entry.family);
    },
    [onPick],
  );

  const toggleFavourite = useCallback(
    async (family: string) => {
      setFavouriteError("");
      const failure = await toggle(family, !favourites.has(fontFamilyKey(family)));
      if (failure) setFavouriteError(failure);
    },
    [favourites, toggle],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      // Closing the panel must not also clear the canvas selection.
      event.preventDefault();
      event.stopPropagation();
      onClose?.();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, navigable.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const chosen = navigable[Math.max(0, activeIndex)];
      if (chosen) pick(chosen);
    }
  };

  const row = (entry: CatalogFamily, index: number, option: boolean, keyPrefix: string) => (
    <FontRow
      key={`${keyPrefix}-${entry.family}`}
      entry={entry}
      selected={Boolean(value) && entry.family.toLowerCase() === value.toLowerCase()}
      active={activeIndex === index}
      option={option}
      disabled={!onPick}
      onPick={() => pick(entry)}
      onVisible={loadPreview}
      rowRef={(node) => {
        rowRefs.current[index] = node;
      }}
      favourite={favourites.has(fontFamilyKey(entry.family))}
      onToggleFavourite={showStars ? () => void toggleFavourite(entry.family) : undefined}
      ring={accent.ring}
    />
  );

  return (
    <section aria-label="Fonts" data-font-browser data-customizer-text-interaction className="min-w-0 pb-4" onKeyDown={onKeyDown}>
      {/* Search and categories stay in reach while the list scrolls. */}
      <div className="sticky top-0 z-10 grid gap-3 bg-white px-4 pb-3 pt-1">
        <div className={`flex h-11 min-w-0 items-center rounded-full border border-[#303839]/25 bg-white pl-4 pr-1 ${accent.searchFocus}`}>
          <input
            ref={searchRef}
            // A text field, like the dropdown picker's: the same role for
            // assistive tech, and no native clear button fighting the pill.
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try searching “Great Vibes”"
            aria-label="Search Google Fonts"
            className="input-bare h-full w-0 min-w-0 flex-1 border-0 bg-transparent p-0 text-[14px] text-[#1f2425] outline-none placeholder:text-[#303839]/55 [&::-webkit-search-cancel-button]:hidden"
          />
          <span aria-hidden className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-white ${accent.searchButton}`}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>
          </span>
        </div>

        <div role="tablist" aria-label="Font categories" className="flex flex-wrap gap-2">
          {FONT_CATEGORY_TABS.map((tab) => {
            const on = category === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                data-shape="round"
                aria-selected={on}
                onClick={() => setCategory(tab.id)}
                className={`h-9 shrink-0 cursor-pointer whitespace-nowrap rounded-full border bg-white px-3.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${accent.ring} ${
                  on ? `${accent.chipOn} font-semibold text-[#1f2425]` : "border-[#303839]/20 font-medium text-[#303839]/80 hover:border-[#303839]/45 hover:text-[#1f2425]"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {!loading && !error && (
          <p className="px-1 text-[12px] text-[#303839]/60" aria-live="polite">
            {category === "all" && !query
              ? `${families.length.toLocaleString()} ${restricted ? "fonts allowed in this design" : "Google Fonts"}`
              : `${allResults.length.toLocaleString()} ${query ? "matching" : "in"} ${categoryLabel}${restricted ? " · allowed in this design" : ""}`}
          </p>
        )}
        {!onPick && (
          <p className="rounded-lg bg-[#F8F6F1] px-3 py-2 text-[12.5px] leading-snug text-[#303839]/80">Select a text box on the card to change its font.</p>
        )}
        {favouriteError && (
          <p role="alert" className="px-1 text-[12px] font-semibold text-red-700">{favouriteError}</p>
        )}
      </div>

      <div className="grid min-w-0 gap-3 px-3">
        {loading && <p className="px-1 py-6 text-center text-[13px] text-[#303839]/60">Loading Google Fonts…</p>}

        {!loading && error && (
          <div className="px-1 py-5 text-center">
            <p className="text-[13px] text-[#303839]/70">{error}</p>
            <button
              type="button"
              data-shape="round"
              onClick={retry}
              className={`mt-3 h-9 cursor-pointer rounded-full border-[1.5px] border-[#303839] px-4 text-[13px] font-semibold text-[#303839] hover:bg-[#F8F6F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${accent.ring}`}
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && inDesign.length > 0 && (
          <div>
            <SectionTitle>Fonts in this design</SectionTitle>
            <div className="grid gap-0.5">{inDesign.map((entry, index) => row(entry, index, false, "design"))}</div>
          </div>
        )}

        {!loading && !error && recentAvailable.length > 0 && (
          <div className={inDesign.length ? "border-t border-[#303839]/10 pt-3" : ""}>
            <SectionTitle>Recently used</SectionTitle>
            <div className="grid gap-0.5">{recentAvailable.map((entry, index) => row(entry, inDesign.length + index, false, "recent"))}</div>
          </div>
        )}

        {!loading && !error && (
          <div className={inDesign.length || recentAvailable.length ? "border-t border-[#303839]/10 pt-3" : ""}>
            {results.length > 0 && <SectionTitle>{query ? "Results" : category === "all" ? "Popular" : categoryLabel}</SectionTitle>}
            <div role="listbox" aria-label={label} className="grid gap-0.5">
              {results.map((entry, index) => row(entry, inDesign.length + recentAvailable.length + index, true, "result"))}
            </div>
            {!results.length && (
              <p className="px-1 py-6 text-center text-[13px] text-[#303839]/60">
                {query
                  ? `No fonts match “${query}”.`
                  : category === "favourites"
                    ? restricted
                      ? "None of the Favourite Fonts are allowed in this design."
                      : "No Favourite Fonts yet."
                    : category !== "all"
                      ? "No fonts in this category are available for this design."
                      : "No fonts are available for this design."}
              </p>
            )}
            {allResults.length > results.length && (
              <button
                type="button"
                data-shape="round"
                onClick={() => setLimit((current) => current + FONT_SELECTOR_VISIBLE_LIMIT)}
                className={`mx-auto mt-3 flex h-10 cursor-pointer items-center rounded-full border-[1.5px] border-[#303839] bg-white px-5 text-[13px] font-semibold text-[#303839] transition-colors hover:bg-[#F8F6F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${accent.ring}`}
              >
                Show more fonts
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
