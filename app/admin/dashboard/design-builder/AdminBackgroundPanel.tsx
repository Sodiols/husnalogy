"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { BuilderAsset } from "./builder-utils";
import { useBackgroundUpload } from "./use-background-upload";
import BackgroundUploadStatus from "./BackgroundUploadStatus";
import { pageHasBackgroundImage } from "@/lib/customizer/v2/page-background";
import { useCanvasImageSource } from "@/app/components/customizer/canvas-image-source";
import {
  BACKGROUND_SWATCHES,
  NO_BACKGROUND_COLOR,
  designPalette,
  isNoBackgroundColor,
  normalizeHexInput,
} from "@/lib/customizer/v2/background-palette";
import { rememberRecentColor, useRecentColors } from "@/lib/customizer/v2/studio-recent-colors";

/**
 * Background of the page being edited: its image and its colour. Every
 * control changes the page's own background picture / `backgroundColor` through
 * the studio's page commands, so each change is one undo step, is saved with
 * the design, and draws identically in the studio, the customer editor and
 * the server render. Nothing here keeps a background of its own.
 *
 * Search looks through the asset library's BACKGROUND images (the same
 * library uploads land in); choosing one makes it this page's background.
 */

type Props = {
  template: any;
  activePage: string;
  /** The design as it was opened: the source of its original palette. */
  paletteSource?: any;
  onPatchPage: (pageId: string, patch: Record<string, unknown>) => void;
  /** Makes a library asset the page's background picture (one undo step). */
  onSetBackgroundImage: (pageId: string, asset: BuilderAsset) => void;
  /** Removes the page's background picture and every reference to it (one undo step). */
  onRemoveBackgroundImage: (pageId: string) => void;
  /** Adds the page's background layer, or selects it when there already is one. */
  onBackgroundLayer: () => void;
  hasBackgroundLayer: boolean;
};

const CHECKER =
  "repeating-conic-gradient(#d9d9d9 0% 25%, #ffffff 0% 50%) 50% / 10px 10px";

const OUTLINE_BUTTON =
  "inline-flex h-10 items-center justify-center rounded-full border-[1.5px] border-[#27307A] bg-white px-5 text-[14px] font-semibold text-[#27307A] transition-colors hover:bg-[#27307A]/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-45";

function Swatch({ color, label, selected, onPick }: { color: string; label: string; selected: boolean; onPick: () => void }) {
  const none = color === NO_BACKGROUND_COLOR;
  return (
    <button data-shape="round"
      type="button"
      aria-label={label}
      aria-pressed={selected}
      title={label}
      onClick={onPick}
      className={`h-9 w-9 shrink-0 rounded-full transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A] focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
        selected ? "ring-[1.5px] ring-[#27307A] ring-offset-2 ring-offset-white" : "border border-[#303839]/15"
      }`}
      style={{ background: none ? CHECKER : color }}
    />
  );
}

/** The page's background picture, through the canvas's resolver (never a stale or broken link). */
function BackgroundThumb({ page }: { page: any }) {
  const { href, status } = useCanvasImageSource(page.backgroundAssetId ? { assetId: page.backgroundAssetId } : null, String(page.backgroundImage || ""), 120);
  if (!href || status === "error") return null;
  // eslint-disable-next-line @next/next/no-img-element -- a resolved canvas asset URL
  return <img src={href} alt="" className="h-full w-full object-cover" />;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2.5">
      <h3 className="text-[14px] font-bold text-[#1f2425]">{title}</h3>
      {children}
    </section>
  );
}

export default function AdminBackgroundPanel({
  template,
  activePage,
  paletteSource,
  onPatchPage,
  onSetBackgroundImage,
  onRemoveBackgroundImage,
  onBackgroundLayer,
  hasBackgroundLayer,
}: Props) {
  const page = (template?.pages || []).find((entry: any) => entry.id === activePage) || null;
  const input = useRef<HTMLInputElement>(null);
  const colourInput = useRef<HTMLInputElement>(null);
  const upload = useBackgroundUpload(onSetBackgroundImage);
  const [error, setError] = useState("");
  const [imageOpen, setImageOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BuilderAsset[] | null>(null);
  const [searching, setSearching] = useState(false);
  const recent = useRecentColors();
  // The original palette is read once from the design as opened, so picking
  // a colour never reshuffles it.
  const [palette] = useState(() => designPalette(paletteSource || template, 6));
  const color = String(page?.backgroundColor || "");
  const current = normalizeHexInput(color);
  const noColour = isNoBackgroundColor(color);
  const [hexDraft, setHexDraft] = useState((current || "#ffffff").toUpperCase());
  useEffect(() => setHexDraft((current || "#ffffff").toUpperCase()), [current]);

  const pageId = page?.id;
  const applyColour = (next: string) => {
    if (!pageId) return;
    const hex = next === NO_BACKGROUND_COLOR ? NO_BACKGROUND_COLOR : normalizeHexInput(next);
    if (hex === null) return;
    if ((hex || "") === (color ? normalizeHexInput(color) || color : "")) return;
    onPatchPage(pageId, { backgroundColor: hex });
    if (hex) rememberRecentColor(hex);
  };

  // The native picker reports every drag step as `input`; only its final
  // `change` is applied, so one pick is one undo step.
  useEffect(() => {
    const element = colourInput.current;
    if (!element) return;
    const onChange = () => applyColour(element.value);
    element.addEventListener("change", onChange);
    return () => element.removeEventListener("change", onChange);
  });

  // Search: the library's background images, by title, filename or keyword.
  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults(null);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ type: "background", search: term, page: "1", pageSize: "24" });
      fetch(`/api/admin/customizer/assets?${params}`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.json().catch(() => ({})).then((payload) => ({ response, payload })))
        .then(({ response, payload }) => {
          if (!response.ok || payload.ok === false) throw new Error(payload.error || "Could not search backgrounds.");
          setResults((payload.assets || []).filter((asset: any) => asset.adminAvailable !== false && !asset.archived && (asset.status || "ready") === "ready"));
          setError("");
        })
        .catch((caught) => {
          if (caught?.name === "AbortError") return;
          setResults([]);
          setError(caught?.message || "Could not search backgrounds.");
        })
        .finally(() => setSearching(false));
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  if (!page) return null;

  const setImage = (asset: BuilderAsset) => onSetBackgroundImage(page.id, asset);
  const hasImage = pageHasBackgroundImage(page);
  // An upload started from this panel for another page reports there, not here.
  const uploadState = upload.state.status !== "idle" && upload.state.pageId === page.id ? upload.state : { status: "idle" as const };
  const pickWithEyedropper = async () => {
    const Dropper = (window as any).EyeDropper;
    if (!Dropper) {
      // No screen eyedropper in this browser: the system colour picker instead.
      colourInput.current?.click();
      return;
    }
    try {
      const result = await new Dropper().open();
      applyColour(result?.sRGBHex);
    } catch {
      // Cancelled with Escape: nothing to apply.
    }
  };

  // One column that may shrink to the panel: content never widens it past its
  // slot (a 1280px-wide window leaves it about 250px).
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 px-4 pb-6 pt-1" data-admin-background-panel>
      <p className="-mb-3 text-[12.5px] text-[#303839]/60">
        Background of <span className="font-semibold text-[#1f2425]">{page.label || "this page"}</span>
      </p>

      {/* Search: the library's background images. */}
      <div className="grid gap-3">
        <form
          role="search"
          onSubmit={(event) => event.preventDefault()}
          className="flex h-11 items-center rounded-full border border-[#303839]/25 bg-white pl-4 pr-1 focus-within:border-[#27307A]"
        >
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search for backgrounds"
            aria-label="Search for backgrounds"
            className="w-0 min-w-0 flex-1 bg-transparent text-[14px] text-[#1f2425] outline-none placeholder:text-[#303839]/55 [&::-webkit-search-cancel-button]:hidden"
          />
          <button data-shape="round" type="submit" aria-label="Search" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#27307A] text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A] focus-visible:ring-offset-2">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>
          </button>
        </form>
        {query.trim() && (
          <div data-background-results aria-live="polite">
            {searching && !results ? (
              <p className="text-[13px] text-[#303839]/55">Searching…</p>
            ) : results && results.length ? (
              <div className="grid grid-cols-3 gap-2">
                {results.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => setImage(asset)}
                    aria-label={`Use ${asset.title} as the background`}
                    className="aspect-[5/7] overflow-hidden rounded-lg border border-[#303839]/12 bg-[#F2F3F5] hover:border-[#27307A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- a library thumbnail */}
                    <img src={asset.thumbnailUrl || asset.editorUrl || asset.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[13px] leading-snug text-[#303839]/55">No background images match “{query.trim()}”. Upload one below and it joins the library.</p>
            )}
          </div>
        )}
      </div>

      {/* Background image */}
      <section className="grid gap-3">
        <button
          type="button"
          aria-expanded={imageOpen}
          onClick={() => setImageOpen((open) => !open)}
          className="flex items-center justify-between text-left text-[14px] font-bold text-[#1f2425] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A] focus-visible:ring-offset-2"
        >
          Background Image
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={imageOpen ? "" : "-rotate-90"}><path d="m6 9 6 6 6-6" /></svg>
        </button>
        {imageOpen && (
          <div className="grid gap-2">
            <div className="flex items-center gap-4">
              <span
                data-background-image-tile
                className="grid h-[46px] w-[46px] shrink-0 place-items-center overflow-hidden rounded-md border border-[#303839]/20 bg-[#F7F7F8] text-[#1f2425]"
              >
                {hasImage ? (
                  <BackgroundThumb page={page} />
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M4 18 9 12l3.5 3.5L15 13l3 3" /><path d="M4 18h12" /><circle cx="15.5" cy="7.5" r="1.5" /><path d="M19 15v6M16 18h6" />
                  </svg>
                )}
              </span>
              <button data-shape="round" type="button" className={OUTLINE_BUTTON} disabled={upload.busy} onClick={() => input.current?.click()}>
                {upload.busy ? "Uploading…" : hasImage ? "Replace Image" : "Upload Image"}
              </button>
            </div>
            {hasImage && (
              <button
                type="button"
                onClick={() => onRemoveBackgroundImage(page.id)}
                className="justify-self-start text-[13px] font-semibold text-[#27307A] underline underline-offset-2"
              >
                Remove background image
              </button>
            )}
            <BackgroundUploadStatus state={uploadState} onRetry={upload.retry} onDismiss={upload.dismiss} />
          </div>
        )}
        {error && <p role="alert" className="text-[12px] font-semibold text-red-700">{error}</p>}
      </section>

      {/* Background colour */}
      <Section title="Background color">
        <div className="flex items-center gap-4">
          <span
            data-background-color-tile
            title={noColour ? "No colour — the card's paper white" : current || ""}
            className="h-[46px] w-[46px] shrink-0 rounded-md border border-[#303839]/20"
            style={{ backgroundColor: current || "#ffffff" }}
          />
          <button data-shape="round" type="button" className={OUTLINE_BUTTON} disabled={noColour} onClick={() => applyColour(NO_BACKGROUND_COLOR)}>
            Remove
          </button>
        </div>
      </Section>

      {palette.length > 0 && (
        <Section title="Original color palette">
          <div className="flex flex-wrap gap-2.5" data-background-palette>
            {palette.map((hex) => (
              <Swatch key={hex} color={hex} label={`Original colour ${hex}`} selected={current === hex} onPick={() => applyColour(hex)} />
            ))}
          </div>
        </Section>
      )}

      {recent.length > 0 && (
        <Section title="Recent colors">
          <div className="flex flex-wrap gap-2.5" data-background-recent>
            {recent.slice(0, 6).map((hex) => (
              <Swatch key={hex} color={hex} label={`Recent colour ${hex}`} selected={current === hex} onPick={() => applyColour(hex)} />
            ))}
          </div>
        </Section>
      )}

      <Section title="Custom color">
        <div className="flex items-center gap-3">
          <button data-shape="round"
            type="button"
            onClick={() => void pickWithEyedropper()}
            aria-label="Pick a colour"
            title="Pick a colour from the screen"
            className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full border-[1.5px] border-[#27307A] text-[#27307A] hover:bg-[#27307A]/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27307A] focus-visible:ring-offset-2"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m14.5 5.5 4 4" /><path d="M17.8 3.2a2 2 0 0 1 2.9 2.9l-2.2 2.2-2.9-2.9Z" /><path d="m15.6 6.7-9.4 9.4-1.2 4 4-1.2 9.4-9.4" />
            </svg>
          </button>
          <input
            type="text"
            value={hexDraft}
            aria-label="Custom background colour (hex)"
            spellCheck={false}
            maxLength={7}
            onChange={(event) => setHexDraft(event.target.value.toUpperCase())}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              const hex = normalizeHexInput(hexDraft);
              if (hex) applyColour(hex);
              else setHexDraft((current || "#ffffff").toUpperCase());
            }}
            onBlur={() => {
              const hex = normalizeHexInput(hexDraft);
              if (hex) applyColour(hex);
              else setHexDraft((current || "#ffffff").toUpperCase());
            }}
            aria-invalid={!normalizeHexInput(hexDraft)}
            className="h-[46px] w-0 min-w-0 flex-1 rounded-md border border-[#303839]/25 bg-white px-3 text-center text-[14px] tabular-nums text-[#1f2425] outline-none focus:border-[#27307A] aria-[invalid=true]:border-red-500"
          />
          <input ref={colourInput} type="color" value={current || "#ffffff"} onChange={() => undefined} tabIndex={-1} aria-hidden className="sr-only" />
        </div>
      </Section>

      <Section title="Swatches">
        <div className="flex flex-wrap gap-2.5" data-background-swatches>
          <Swatch color={NO_BACKGROUND_COLOR} label="No colour" selected={noColour} onPick={() => applyColour(NO_BACKGROUND_COLOR)} />
          {BACKGROUND_SWATCHES.filter((hex) => hex !== "#ffffff").map((hex) => (
            <Swatch key={hex} color={hex} label={`Colour ${hex}`} selected={current === hex} onPick={() => applyColour(hex)} />
          ))}
        </div>
      </Section>

      <section className="grid gap-1.5 border-t border-[#303839]/10 pt-4">
        <button data-shape="round" type="button" className={`${OUTLINE_BUTTON} w-full`} onClick={onBackgroundLayer}>
          {hasBackgroundLayer ? "Select background layer" : "Add background layer"}
        </button>
        <p className="text-[12px] leading-snug text-[#303839]/55">A full-bleed layer behind everything else, with its own colour, image and filters.</p>
      </section>

      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-label="Background image file"
        onChange={(event) => {
          void upload.start(event.target.files?.[0], page.id);
          event.target.value = "";
        }}
      />
    </div>
  );
}
