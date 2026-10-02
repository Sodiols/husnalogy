"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ProductToolbar } from "@/app/components/product/product-toolbar";
import { formatCurrency } from "@/lib/currency";
import ExploreMoreTile from "@/app/components/explore-more-tile";
import ProductCard from "./ProductCard";

const SORT_OPTIONS = [
  ["", "Recommended"],
  ["newest", "Newest first"],
  ["featured", "Featured"],
  ["price-low", "Price: low to high"],
  ["price-high", "Price: high to low"],
];

const HIGHLIGHT_FILTERS = [
  ["featured", "Featured"],
  ["newest", "New"],
  ["bestSeller", "Best Seller"],
];

const PRICE_DOMAIN_MIN = 0;
const PRICE_DOMAIN_MAX = 2000;
const PRICE_STEP = 25;

const COLOR_SWATCHES = {
  white: "#ffffff",
  ivory: "#f6f1e4",
  cream: "#f1e9da",
  blush: "#e9cdc6",
  pink: "#dba2b0",
  rose: "#c97e8f",
  red: "#b23b4e",
  burgundy: "#7d2f3b",
  gold: "#E6E6E6",
  champagne: "#e4d3ac",
  tan: "#c9a37a",
  brown: "#8a6f4f",
  terracotta: "#c06a4a",
  green: "#7d8a6a",
  sage: "#a9b39a",
  blue: "#2f4d6e",
  navy: "#26354a",
  grey: "#9aa0a0",
  gray: "#9aa0a0",
  silver: "#cfd2d1",
  black: "#303839",
};

function swatchColor(name) {
  const key = String(name || "").toLowerCase().trim();
  return COLOR_SWATCHES[key] || "#d8cfc4";
}

function toQuery(values: any) {
  const sp = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== "" && value !== null && value !== undefined) sp.set(key, String(value));
  });
  const query = sp.toString();
  return query ? `?${query}` : "";
}

export default function ProductBrowser({
  products = [],
  relatedCatalog = products,
  collections = [],
  options = {},
  params = {},
  count = 0,
  basePath = "/products",
}: any) {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const themes = options.styles || [];
  const occasions = options.occasions || [];
  const formats = options.productTypes || [];
  const colors = options.colors || [];

  const base = useMemo(
    () => ({
      q: params.q || "",
      sort: params.sort || "",
      category: params.category || "",
      subcategory: params.subcategory || "",
      collection: params.collection || "",
      style: params.style || "",
      occasion: params.occasion || "",
      productType: params.productType || "",
      color: params.color || "",
      minPrice: params.minPrice || "",
      maxPrice: params.maxPrice || "",
      featured: params.featured || "",
      newest: params.newest || "",
      bestSeller: params.bestSeller || "",
    }),
    [params]
  );

  const navigateWith = (updates) => {
    router.push(`${basePath}${toQuery({ ...base, ...updates })}`);
  };

  const activeCount = ["style", "occasion", "productType", "color", "minPrice", "maxPrice", "featured", "newest", "bestSeller"].filter(
    (key) => base[key]
  ).length;

  const [draft, setDraft] = useState(base);
  useEffect(() => {
    if (drawerOpen) setDraft(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerOpen]);

  const setDraftKey = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const toggleDraft = (key, value) =>
    setDraft((current) => ({ ...current, [key]: current[key] === value ? "" : value }));

  const applyFilters = () => {
    navigateWith({
      style: draft.style,
      occasion: draft.occasion,
      productType: draft.productType,
      color: draft.color,
      minPrice: draft.minPrice,
      maxPrice: draft.maxPrice,
      featured: draft.featured,
      newest: draft.newest,
      bestSeller: draft.bestSeller,
    });
    setDrawerOpen(false);
  };

  const clearAll = () => {
    setDrawerOpen(false);
    router.push(`${basePath}`);
  };

  const productRelations = useMemo(() => buildProductRelations(relatedCatalog, collections), [relatedCatalog, collections]);
  const gridClass = "grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4";
  // A short result list closes with an invitation to keep browsing rather than
  // leaving most of the row empty.
  const showExploreTile = products.length > 0 && products.length < 4;

  return (
    <>
      <ProductToolbar
        activeCount={activeCount}
        count={count}
        onFilterClick={() => setDrawerOpen(true)}
        sortValue={base.sort}
        sortOptions={SORT_OPTIONS}
        onSortChange={(sort) => navigateWith({ sort })}
      />

      {products.length > 0 && (
        <ul className={`mt-6 w-full max-w-full overflow-visible sm:mt-8 ${gridClass}`}>
          {products.map((product) => (
            <li key={product.id || product.slug} className="min-w-0">
              <ProductCard
                product={product}
                hasOtherStyles={productRelations.get(product.slug)?.hasOtherStyles}
                hasSuite={productRelations.get(product.slug)?.hasSuite}
              />
            </li>
          ))}
          {showExploreTile && (
            <li className="col-span-2 min-w-0 sm:col-span-1">
              <ExploreMoreTile />
            </li>
          )}
        </ul>
      )}

      {drawerOpen && (
        <>
          <button
            type="button"
            aria-label="Close filters"
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 z-[2800] bg-ink/40"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Product filters"
            className="fixed inset-x-0 bottom-0 z-[2801] flex max-h-[88vh] flex-col rounded-t-[10px] bg-white shadow-[var(--shadow-overlay)] sm:bottom-4 sm:left-auto sm:right-4 sm:top-4 sm:max-h-none sm:w-[min(430px,92vw)] sm:rounded-[10px]"
          >
            <div className="relative border-b border-line px-6 py-6">
              <span aria-hidden="true" className="absolute left-1/2 top-4 h-1.5 w-10 -translate-x-1/2 rounded-none bg-cream" />
              <div className="flex items-center justify-between">
                <h2 className="font-display text-[1.75rem] font-medium leading-none text-ink">Filters</h2>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close filters"
                  data-shape="round"
                  className="grid h-11 w-11 place-items-center rounded-full text-ink transition-colors hover:bg-cream"
                >
                  <CloseIcon />
                </button>
              </div>
            </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <FilterBlock icon={<ThemeIcon />} label="Theme">
            <ExpandableChips
              items={themes}
              value={draft.style}
              onPick={(value) => toggleDraft("style", value)}
              allLabel="All"
              onAll={() => setDraftKey("style", "")}
            />
          </FilterBlock>

          <FilterBlock icon={<SparkleIcon />} label="Highlights">
            <div className="flex flex-wrap gap-2">
              {HIGHLIGHT_FILTERS.map(([key, label]) => (
                <SoftChip
                  key={key}
                  active={draft[key] === "true"}
                  onClick={() => toggleDraft(key, "true")}
                >
                  {label}
                </SoftChip>
              ))}
            </div>
          </FilterBlock>

          {!!occasions.length && (
            <FilterBlock icon={<CalendarIcon />} label="Occasion">
              <ExpandableChips
                items={occasions}
                value={draft.occasion}
                onPick={(value) => toggleDraft("occasion", value)}
              />
            </FilterBlock>
          )}

          {!!formats.length && (
            <FilterBlock icon={<FormatIcon />} label="Format">
              <ExpandableChips
                items={formats}
                value={draft.productType}
                onPick={(value) => toggleDraft("productType", value)}
              />
            </FilterBlock>
          )}

          {!!colors.length && (
            <FilterBlock icon={<DropIcon />} label="Colour">
              <ColorSwatches colors={colors} value={draft.color} onPick={(value) => toggleDraft("color", value)} />
            </FilterBlock>
          )}

          <FilterBlock
            icon={<PriceIcon />}
            label="Price range"
            trailing={<PriceLabel min={draft.minPrice} max={draft.maxPrice} />}
          >
            <PriceRange
              valueMin={draft.minPrice}
              valueMax={draft.maxPrice}
              onMin={(value) => setDraftKey("minPrice", value)}
              onMax={(value) => setDraftKey("maxPrice", value)}
            />
          </FilterBlock>

        </div>

        <div className="flex gap-3 border-t border-line px-6 py-4">
          <button
            type="button"
            onClick={clearAll}
            className="btn btn-secondary flex-1"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={applyFilters}
            className="btn btn-primary flex-[1.4]"
          >
            Show results
          </button>
        </div>
          </aside>
        </>
      )}
    </>
  );
}

function normalizeGroup(value) {
  return String(value || "").trim().toLowerCase();
}

function getProductCollectionIds(product) {
  return Array.isArray(product?.collectionIds) ? product.collectionIds.filter(Boolean) : [];
}

function getSectionCollectionIds(product, section) {
  const sections = product?.collectionSections && typeof product.collectionSections === "object" ? product.collectionSections : {};
  return getProductCollectionIds(product).filter((collectionId) => sections[collectionId] === section);
}

function hasSharedCollection(collectionIds = [], collectionCounts) {
  return collectionIds.some((collectionId) => (collectionCounts.get(collectionId) || 0) > 1);
}

function buildProductRelations(products = [], collections = []) {
  const styleCounts = new Map();
  const suiteCounts = new Map();
  const collectionCounts = new Map();
  const childCollectionIds = new Set(
    collections
      .filter((collection) => collection?.parentCollectionId)
      .map((collection) => collection.id)
      .filter(Boolean)
  );
  const filterChildCollectionIds = (collectionIds = []) =>
    childCollectionIds.size ? collectionIds.filter((collectionId) => childCollectionIds.has(collectionId)) : collectionIds;

  products.forEach((product) => {
    const styleGroup = normalizeGroup(product.styleGroupId || product.styleGroup);
    const suiteGroup = normalizeGroup(product.suiteGroupId || product.suiteGroup);
    if (styleGroup) styleCounts.set(styleGroup, (styleCounts.get(styleGroup) || 0) + 1);
    if (suiteGroup) suiteCounts.set(suiteGroup, (suiteCounts.get(suiteGroup) || 0) + 1);
    getProductCollectionIds(product).forEach((collectionId) => {
      collectionCounts.set(collectionId, (collectionCounts.get(collectionId) || 0) + 1);
    });
  });

  return new Map(
    products.map((product) => {
      const styleGroup = normalizeGroup(product.styleGroupId || product.styleGroup);
      const suiteGroup = normalizeGroup(product.suiteGroupId || product.suiteGroup);
      const styleCollectionIds = filterChildCollectionIds(getSectionCollectionIds(product, "otherStyles"));
      const suiteCollectionIds = getSectionCollectionIds(product, "suite");
      return [
        product.slug,
        {
          hasOtherStyles: hasSharedCollection(styleCollectionIds, collectionCounts) || Boolean(styleGroup && styleCounts.get(styleGroup) > 1),
          hasSuite: hasSharedCollection(suiteCollectionIds, collectionCounts) || Boolean(suiteGroup && suiteCounts.get(suiteGroup) > 1),
        },
      ];
    })
  );
}

function ExpandableChips({ items, value, onPick, allLabel, onAll, limit = 4 }: any) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, limit);
  const hasMore = items.length > limit;

  return (
    <div className="flex flex-wrap gap-2">
      {allLabel && (
        <SoftChip active={!value} onClick={onAll}>
          {allLabel}
        </SoftChip>
      )}
      {visible.map((item) => (
        <SoftChip key={item} active={value === item} onClick={() => onPick(item)}>
          {item}
        </SoftChip>
      ))}
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-label={expanded ? "Show fewer" : "Show more"}
          data-shape="round"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-field bg-white text-ink transition-colors hover:border-ink/50"
        >
          {expanded ? <MinusIcon /> : <PlusIcon />}
        </button>
      )}
    </div>
  );
}

function ColorSwatches({ colors, value, onPick, limit = 8 }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? colors : colors.slice(0, limit);
  const hasMore = colors.length > limit;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {visible.map((color) => {
        const selected = value === color;
        return (
          <button
            key={color}
            type="button"
            title={color}
            aria-label={color}
            onClick={() => onPick(color)}
            data-shape="round"
            aria-pressed={selected}
            className={`relative grid h-10 w-10 place-items-center rounded-full border transition ${
              selected ? "border-ink/60 ring-1 ring-ink ring-offset-2" : "border-field"
            }`}
            style={{ backgroundColor: swatchColor(color) }}
          >
            {selected && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="rounded-full bg-white text-ink">
                <path d="m5 12 4 4 10-10" />
              </svg>
            )}
          </button>
        );
      })}
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-label={expanded ? "Show fewer colours" : "Show more colours"}
          data-shape="round"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-field bg-white text-ink transition-colors hover:border-ink/50"
        >
          {expanded ? <MinusIcon /> : <PlusIcon />}
        </button>
      )}
    </div>
  );
}

function SoftChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-10 items-center gap-1.5 border px-3.5 text-[14px] font-medium capitalize transition-colors ${
        active ? "border-ink bg-ink text-white" : "border-field bg-white text-ink hover:border-ink/50"
      }`}
    >
      {active && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m5 12 4 4 10-10" />
        </svg>
      )}
      {children}
    </button>
  );
}

function FilterBlock({ icon, label, trailing, children }: any) {
  return (
    <div className="mb-7">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          <span className="text-[#303839]">{icon}</span>
          {label}
        </p>
        {trailing}
      </div>
      {children}
    </div>
  );
}

function PriceLabel({ min, max }) {
  const lo = min === "" || min == null ? PRICE_DOMAIN_MIN : Number(min);
  const hi = max === "" || max == null ? PRICE_DOMAIN_MAX : Number(max);
  return (
    <span className="text-[13px] font-medium text-muted">
      {formatCurrency(lo, "BDT")} – {formatCurrency(hi, "BDT")}
      {hi >= PRICE_DOMAIN_MAX ? "+" : ""}
    </span>
  );
}

function PriceRange({ valueMin, valueMax, onMin, onMax }) {
  const lo = valueMin === "" || valueMin == null ? PRICE_DOMAIN_MIN : Math.min(Number(valueMin), PRICE_DOMAIN_MAX);
  const hi = valueMax === "" || valueMax == null ? PRICE_DOMAIN_MAX : Math.min(Number(valueMax), PRICE_DOMAIN_MAX);
  const pct = (value) => ((value - PRICE_DOMAIN_MIN) / (PRICE_DOMAIN_MAX - PRICE_DOMAIN_MIN)) * 100;

  const thumb =
    "pointer-events-none absolute inset-0 h-6 w-full appearance-none bg-transparent " +
    "[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-none [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[#303839] [&::-webkit-slider-thumb]:shadow-[0_2px_6px_rgba(48,56,57,0.35)] " +
    "[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-none [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-[#303839]";

  return (
    <div className="relative h-6">
      <div className="absolute top-1/2 h-1.5 w-full -translate-y-1/2 rounded-none bg-[#303839]/10" />
      <div
        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-none bg-[#303839]"
        style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }}
      />
      <input
        type="range"
        min={PRICE_DOMAIN_MIN}
        max={PRICE_DOMAIN_MAX}
        step={PRICE_STEP}
        value={lo}
        aria-label="Minimum price"
        onChange={(event) => onMin(String(Math.min(Number(event.target.value), hi - PRICE_STEP)))}
        className={`${thumb} z-20`}
      />
      <input
        type="range"
        min={PRICE_DOMAIN_MIN}
        max={PRICE_DOMAIN_MAX}
        step={PRICE_STEP}
        value={hi}
        aria-label="Maximum price"
        onChange={(event) => onMax(String(Math.max(Number(event.target.value), lo + PRICE_STEP)))}
        className={`${thumb} z-30`}
      />
    </div>
  );
}

/* Icons */
const stroke: any = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="m6 6 12 12" />
      <path d="m18 6-12 12" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}
function MinusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M5 12h14" />
    </svg>
  );
}
function SparkleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M12 4v6m0 4v6m-8-8h6m4 0h6" />
    </svg>
  );
}
function ThemeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v16" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M4 10h16" />
    </svg>
  );
}
function FormatIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 7h6" />
      <path d="M9 11h6" />
    </svg>
  );
}
function DropIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M12 3s6 6.5 6 10.5a6 6 0 0 1-12 0C6 9.5 12 3 12 3Z" />
    </svg>
  );
}
function PriceIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M4 12V5h7l9 9-7 7-9-9Z" />
      <circle cx="8" cy="9" r="1.3" />
    </svg>
  );
}
