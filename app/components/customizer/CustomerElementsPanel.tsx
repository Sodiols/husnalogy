"use client";

// Elements panel (spec §28). Sections:
//
//   Dynamic Shapes  → NATIVE Husnalogy ShapeLayers (never Iconify)
//   Graphics        → Husnalogy library + Iconify discovery/import
//   Text            → NATIVE editable text presets (Google Fonts engine)
//   Borders / Lines → NATIVE LineLayers + decorative SVG assets
//   Recently Used / Favourites
//
// Iconify is a discovery source only. Selecting an online result calls the
// Husnalogy import endpoint, which stores a permanent sanitized copy; the
// canvas only ever receives an ordinary Husnalogy asset (spec §39).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GRAPHIC_CATEGORIES, remoteElementIdentity } from "@/lib/customizer/v2/iconify";
import { isValidQRValue } from "@/lib/customizer/v2/qr";

export type LibraryElement = {
  id: string;
  title: string;
  url: string;
  width: number;
  height: number;
  tintable: boolean;
  defaultColor: string;
  categoryId: string;
  bucket?: string;
  originalPath?: string;
  editorPath?: string;
  thumbnailPath?: string;
  originalFilename?: string;
};

/** A not-yet-imported Iconify search result. Never inserted directly. */
type RemoteGraphic = {
  key: string;
  title: string;
  collectionName: string;
};

type Category = { id: string; name: string };

/** Internal panel navigation — one panel, no routes (spec §33). */
export type ElementsView = "home" | "graphics" | "text" | "borders" | "shapes" | "frames";

type Props = {
  onInsertElement: (element: LibraryElement) => void;
  /** Closes the panel and returns to the workspace (spec §5). */
  onClose?: () => void;
  allowedElementIds?: string[];
  adminMode?: boolean;
  /** Native inserters — these keep shapes, lines and text as real objects. */
  onAddShape?: (shape: string) => void;
  onAddLine?: (lineStyle: string) => void;
  onAddTextPreset?: (preset: "heading" | "subheading" | "body", text: string) => void;
  onAddFrame?: (maskShape: string) => void;
  onAddQRCode?: (value: string) => void;
  allowShapes?: boolean;
  allowLines?: boolean;
  allowText?: boolean;
  allowFrames?: boolean;
  allowQRCode?: boolean;
  allowedShapes?: string[];
  allowedFrameMasks?: string[];
};

type ShapeChoice = { id: string; label: string; render: React.ReactNode };

/**
 * Every entry maps to a REAL supported shape kind — no decorative buttons
 * that the shape engine cannot actually create (spec §29).
 *
 * "Dynamic Shapes" is the common four; "Shapes" carries the rest, so the two
 * sections in the panel never offer the same thing twice.
 */
const DYNAMIC_SHAPES: ShapeChoice[] = [
  { id: "rectangle", label: "Square", render: <rect x="3" y="3" width="18" height="18" rx="1" /> },
  { id: "rounded-rectangle", label: "Rounded square", render: <rect x="3" y="3" width="18" height="18" rx="5" /> },
  { id: "circle", label: "Circle", render: <circle cx="12" cy="12" r="9" /> },
  { id: "triangle", label: "Triangle", render: <path d="M12 3 21.5 20.5h-19Z" /> },
];

const MORE_SHAPES: ShapeChoice[] = [
  { id: "arch", label: "Arch", render: <path d="M4 21V10a8 8 0 0 1 16 0v11Z" /> },
  { id: "oval", label: "Oval", render: <ellipse cx="12" cy="12" rx="9.5" ry="6.5" /> },
  { id: "polygon", label: "Polygon", render: <path d="M12 2.5 21.5 9.4 17.9 20.6H6.1L2.5 9.4Z" /> },
];

/** Frame mask previews — a photo-shaped swatch, matching the canvas mask. */
const FRAME_MASKS: Array<{ id: string; label: string; clip: React.ReactNode }> = [
  { id: "rectangle", label: "Square frame", clip: <rect x="0" y="0" width="48" height="48" /> },
  { id: "rounded", label: "Rounded frame", clip: <rect x="0" y="0" width="48" height="48" rx="8" /> },
  { id: "circle", label: "Circle frame", clip: <circle cx="24" cy="24" r="24" /> },
  { id: "arch-top", label: "Arch frame", clip: <path d="M0 48V20a24 24 0 0 1 48 0v28Z" /> },
  { id: "oval", label: "Oval frame", clip: <ellipse cx="24" cy="24" rx="20" ry="24" /> },
  { id: "arch", label: "Full arch frame", clip: <path d="M0 48V24a24 24 0 0 1 48 0v24Z" /> },
];

const LINES: Array<{ id: string; label: string; dash: string }> = [
  { id: "solid", label: "Solid line", dash: "" },
  { id: "dashed", label: "Dashed line", dash: "6 4" },
  { id: "dotted", label: "Dotted line", dash: "1 5" },
];

const TEXT_PRESETS: Array<{ id: "heading" | "subheading" | "body"; label: string; text: string }> = [
  { id: "heading", label: "Thank You", text: "Thank You" },
  { id: "heading", label: "Love", text: "Love" },
  { id: "heading", label: "Just Married", text: "Just Married" },
  { id: "subheading", label: "Mr & Mrs", text: "Mr & Mrs" },
  { id: "subheading", label: "Merry Christmas", text: "Merry Christmas" },
  { id: "subheading", label: "Happy Birthday", text: "Happy Birthday" },
];

const SEARCH_DEBOUNCE_MS = 300;
const REMOTE_PAGE_SIZE = 48;

function readIds(key: string): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed.map((item) => String(typeof item === "string" ? item : item?.id || "")).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeIds(key: string, ids: string[]) {
  try { window.localStorage.setItem(key, JSON.stringify(ids)); } catch { /* private browsing */ }
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  const id = `elements-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section aria-labelledby={id}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 id={id} className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#303839]/50">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function CustomerElementsPanel({
  onInsertElement,
  onClose,
  allowedElementIds = [],
  adminMode = false,
  onAddShape,
  onAddLine,
  onAddTextPreset,
  onAddFrame,
  onAddQRCode,
  allowShapes = false,
  allowLines = false,
  allowText = false,
  allowFrames = false,
  allowQRCode = false,
  allowedShapes = [],
  allowedFrameMasks = [],
}: Props) {
  const [elements, setElements] = useState<LibraryElement[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [favourites, setFavourites] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [retryFile, setRetryFile] = useState<File | null>(null);
  const [view, setView] = useState<ElementsView>("home");
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [showAllFavourites, setShowAllFavourites] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrValue, setQrValue] = useState("");

  // Iconify discovery state — deliberately separate from the local library so
  // an Iconify outage can never take the local library down (spec §10).
  const [remote, setRemote] = useState<RemoteGraphic[]>([]);
  const [remotePage, setRemotePage] = useState(1);
  const [remoteHasMore, setRemoteHasMore] = useState(false);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState("");
  const [importing, setImporting] = useState<Record<string, boolean>>({});
  const [importError, setImportError] = useState("");

  const requestRef = useRef(0);
  const remoteRequestRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  // An explicit template allowlist means the customer may only use those exact
  // permanent assets — online discovery must not become a bypass (spec §46).
  const restrictedToAllowlist = allowedElementIds.length > 0 && !adminMode;
  const canDiscoverOnline = !restrictedToAllowlist;

  useEffect(() => {
    setRecent(readIds("husnalogy-customizer-recent-elements"));
    setFavourites(readIds("husnalogy-customizer-favourite-elements"));
  }, []);

  /* ---------------------------------------------------------- debounce -- */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
      setRemotePage(1);
    }, search ? SEARCH_DEBOUNCE_MS : 0);
    return () => window.clearTimeout(timer);
  }, [search]);

  /* ------------------------------------------------- local element load -- */
  useEffect(() => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ page: String(page), pageSize: allowedElementIds.length ? "200" : "30" });
    if (debouncedSearch) query.set("search", debouncedSearch);
    if (category) query.set("category", category);

    (async () => {
      try {
        const res = await fetch(`${adminMode ? "/api/admin/customizer/assets" : "/api/customizer/elements"}?${query}`);
        const data = await res.json().catch(() => ({}));
        if (requestRef.current !== requestId) return; // stale
        if (!res.ok || data.ok === false) throw new Error(data?.error || "Could not load elements.");
        const incoming: LibraryElement[] = (data.elements || data.assets || []).filter(
          (element: LibraryElement) => !allowedElementIds.length || allowedElementIds.includes(element.id),
        );
        setElements((current) => (page === 1 ? incoming : [...current, ...incoming]));
        setCategories(data.categories || []);
        setTotal(allowedElementIds.length ? incoming.length : Number(data.total) || 0);
      } catch (e: any) {
        if (requestRef.current === requestId) setError(e?.message || "Could not load elements.");
      } finally {
        if (requestRef.current === requestId) setLoading(false);
      }
    })();
  }, [debouncedSearch, category, page, allowedElementIds, adminMode]);

  /* ------------------------------------------------ iconify discovery -- */
  useEffect(() => {
    if (!canDiscoverOnline || !debouncedSearch) {
      setRemote([]);
      setRemoteError("");
      setRemoteHasMore(false);
      return;
    }
    const requestId = ++remoteRequestRef.current;
    setRemoteLoading(true);
    setRemoteError("");

    (async () => {
      try {
        const query = new URLSearchParams({ q: debouncedSearch, page: String(remotePage), pageSize: String(REMOTE_PAGE_SIZE) });
        const res = await fetch(`/api/customizer/iconify/search?${query}`);
        const data = await res.json().catch(() => ({}));
        if (remoteRequestRef.current !== requestId) return; // stale
        if (!res.ok || data.ok === false) throw new Error(data?.error || "Online graphics are temporarily unavailable.");
        const incoming: RemoteGraphic[] = (data.results || []).map((item: any) => ({
          key: String(item.key),
          title: String(item.title || item.key),
          collectionName: String(item.collectionName || ""),
        }));
        setRemote((current) => (remotePage === 1 ? incoming : [...current, ...incoming]));
        setRemoteHasMore(Boolean(data.hasMore));
      } catch (e: any) {
        if (remoteRequestRef.current === requestId) {
          setRemote([]);
          setRemoteError(e?.message || "Online graphics are temporarily unavailable.");
        }
      } finally {
        if (remoteRequestRef.current === requestId) setRemoteLoading(false);
      }
    })();
  }, [debouncedSearch, remotePage, canDiscoverOnline]);

  /* ------------------------------------------------------------ actions -- */
  const remember = useCallback((id: string) => {
    setRecent((current) => {
      const next = [id, ...current.filter((item) => item !== id)].slice(0, 12);
      writeIds("husnalogy-customizer-recent-elements", next);
      return next;
    });
  }, []);

  const toggleFavourite = useCallback((id: string) => {
    setFavourites((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [id, ...current];
      writeIds("husnalogy-customizer-favourite-elements", next);
      return next;
    });
  }, []);

  const insert = useCallback((element: LibraryElement) => {
    remember(element.id);
    onInsertElement(element);
  }, [onInsertElement, remember]);

  /**
   * Import an Iconify result, then insert the PERMANENT Husnalogy asset the
   * server returns. The temporary preview is never inserted (spec §39).
   */
  const importAndInsert = useCallback(async (graphic: RemoteGraphic) => {
    if (importing[graphic.key]) return;
    setImporting((current) => ({ ...current, [graphic.key]: true }));
    setImportError("");
    try {
      const res = await fetch("/api/customizer/iconify/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ icon: graphic.key }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false || !data.asset) {
        throw new Error(data?.error || "This graphic could not be added.");
      }
      // From here it is an ordinary Husnalogy asset.
      setElements((current) => [data.asset, ...current.filter((item) => item.id !== data.asset.id)]);
      insert(data.asset);
    } catch (e: any) {
      // No broken layer is created — the card simply becomes retryable.
      setImportError(e?.message || "This graphic could not be added.");
    } finally {
      setImporting((current) => {
        const next = { ...current };
        delete next[graphic.key];
        return next;
      });
    }
  }, [importing, insert]);

  const uploadAdminElement = (file?: File | null) => {
    if (!adminMode || !file) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadError("");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", file.name.replace(/\.[^.]+$/, ""));
    formData.append("assetType", file.type === "image/svg+xml" ? "svg" : "element");
    formData.append("categoryId", category);
    formData.append("customerAvailable", "false");
    formData.append("adminAvailable", "true");

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/admin/customizer/assets");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let payload: any = {};
      try { payload = JSON.parse(xhr.responseText || "{}"); } catch { /* non-JSON error body */ }
      if (xhr.status >= 200 && xhr.status < 300 && payload.ok !== false && payload.asset) {
        setElements((current) => [payload.asset, ...current.filter((element) => element.id !== payload.asset.id)]);
        setTotal((current) => Math.max(current + (payload.duplicate ? 0 : 1), 1));
        setRetryFile(null);
      } else {
        setRetryFile(file);
        setUploadError(payload.error || "Upload failed.");
      }
      setUploading(false);
    };
    xhr.onerror = () => {
      setRetryFile(file);
      setUploadError("Upload failed. Check your connection and retry.");
      setUploading(false);
    };
    xhr.send(formData);
  };

  /* -------------------------------------------------------------- cards -- */
  const elementCard = (element: LibraryElement) => {
    const favourite = favourites.includes(element.id);
    return (
      <div key={element.id} className="group relative aspect-square">
        <button
          type="button"
          draggable
          onDragStart={(event) => {
            remember(element.id);
            event.dataTransfer.effectAllowed = "copy";
            event.dataTransfer.setData("application/x-husnalogy-element", JSON.stringify(element));
          }}
          onClick={() => insert(element)}
          title={`Insert ${element.title}`}
          aria-label={`Insert ${element.title}`}
          className="h-full w-full overflow-hidden rounded-lg border border-[#303839]/10 bg-white p-2 transition hover:border-[#D4AF37] hover:bg-[#303839]/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37]"
        >
          <img src={element.url} alt={element.title} loading="lazy" draggable={false} className="h-full w-full object-contain transition group-hover:scale-105" />
        </button>
        <button
          type="button"
          aria-label={`${favourite ? "Remove" : "Add"} ${element.title} ${favourite ? "from" : "to"} favourites`}
          aria-pressed={favourite}
          onClick={() => toggleFavourite(element.id)}
          className={`absolute right-1 top-1 grid h-9 w-9 place-items-center rounded-full border border-[#303839]/10 shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37] ${favourite ? "bg-[#D4AF37] text-[#303839]" : "bg-white text-[#303839]/55 hover:text-[#D4AF37]"}`}
        >
          <span aria-hidden>{favourite ? "★" : "☆"}</span>
        </button>
      </div>
    );
  };

  const remoteCard = (graphic: RemoteGraphic) => {
    const identity = remoteElementIdentity(graphic.key);
    const favourite = favourites.includes(identity);
    const busy = Boolean(importing[graphic.key]);
    return (
      <div key={graphic.key} className="group relative aspect-square">
        <button
          type="button"
          onClick={() => importAndInsert(graphic)}
          disabled={busy}
          title={`Add ${graphic.title}`}
          aria-label={`Add ${graphic.title}${graphic.collectionName ? ` from ${graphic.collectionName}` : ""}`}
          aria-busy={busy}
          className="h-full w-full overflow-hidden rounded-lg border border-[#303839]/10 bg-white p-2 transition hover:border-[#D4AF37] hover:bg-[#303839]/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37] disabled:cursor-progress"
        >
          {busy ? (
            <span className="grid h-full w-full place-items-center text-[10px] font-bold text-[#303839]/55">Adding…</span>
          ) : (
            <img
              // Same-origin sanitized preview — never a raw upstream URL.
              src={`/api/customizer/iconify/preview?icon=${encodeURIComponent(graphic.key)}`}
              alt={graphic.title}
              loading="lazy"
              draggable={false}
              className="h-full w-full object-contain transition group-hover:scale-105"
            />
          )}
        </button>
        <button
          type="button"
          aria-label={`${favourite ? "Remove" : "Add"} ${graphic.title} ${favourite ? "from" : "to"} favourites`}
          aria-pressed={favourite}
          onClick={() => toggleFavourite(identity)}
          className={`absolute right-1 top-1 grid h-9 w-9 place-items-center rounded-full border border-[#303839]/10 shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37] ${favourite ? "bg-[#D4AF37] text-[#303839]" : "bg-white text-[#303839]/55 hover:text-[#D4AF37]"}`}
        >
          <span aria-hidden>{favourite ? "★" : "☆"}</span>
        </button>
      </div>
    );
  };

  /**
   * Recently used and Favourites are short lists, not libraries, so they expand
   * in place (3 -> 12) rather than opening a subview of their own.
   */
  const showMore = (count: number, open: boolean, toggle: (next: boolean) => void) =>
    count > 3 ? (
      <button
        type="button"
        onClick={() => toggle(!open)}
        aria-expanded={open}
        className="rounded px-1 py-0.5 text-[11px] font-semibold text-[#303839]/60 underline underline-offset-2 transition hover:text-[#303839] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37]"
      >
        {open ? "See less" : "See more"}
      </button>
    ) : null;

  /** "See more" opens a focused subview inside this same panel (spec §33). */
  const seeMore = (target: ElementsView) => (
    <button
      type="button"
      onClick={() => setView(target)}
      aria-label={`See more ${target}`}
      className="rounded px-1 py-0.5 text-[11px] font-semibold text-[#303839]/60 underline underline-offset-2 transition hover:text-[#303839] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37]"
    >
      See more
    </button>
  );


  const qrValid = isValidQRValue(qrValue);

  const permitShape = useCallback(
    (id: string) => !allowedShapes.length || allowedShapes.includes(id),
    [allowedShapes],
  );
  const visibleShapes = useMemo(() => DYNAMIC_SHAPES.filter((shape) => permitShape(shape.id)), [permitShape]);
  const visibleMoreShapes = useMemo(() => MORE_SHAPES.filter((shape) => permitShape(shape.id)), [permitShape]);
  const visibleFrames = useMemo(
    () => FRAME_MASKS.filter((frame) => !allowedFrameMasks.length || allowedFrameMasks.includes(frame.id)),
    [allowedFrameMasks],
  );

  const byId = useMemo(() => new Map(elements.map((element) => [element.id, element])), [elements]);
  const permitted = (element: LibraryElement) => !allowedElementIds.length || allowedElementIds.includes(element.id);
  const favouriteElements = favourites.map((id) => byId.get(id)).filter((e): e is LibraryElement => Boolean(e) && permitted(e!));
  const recentElements = recent.map((id) => byId.get(id)).filter((e): e is LibraryElement => Boolean(e) && permitted(e!));

  const searching = Boolean(debouncedSearch);
  const hasMoreLocal = elements.length < total;

  const VIEW_TITLES: Record<ElementsView, string> = {
    home: "Elements",
    graphics: "Graphics",
    text: "Text",
    borders: "Borders / Lines",
    shapes: "Shapes",
    frames: "Frames",
  };

  const onHome = view === "home";

  return (
    // Header + search stay put; only the section list scrolls (spec §20).
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-[#303839]/8 px-4 pb-3 pt-4">
        <div className="mb-3 flex items-center gap-2">
          {!onHome && (
            <button
              type="button"
              onClick={() => setView("home")}
              aria-label="Back to Elements"
              className="-ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#303839]/60 transition hover:bg-[#303839]/5 hover:text-[#303839] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37]"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
            </button>
          )}
          <h2 className="min-w-0 flex-1 truncate font-display text-[22px] leading-tight text-[#303839]">{VIEW_TITLES[view]}</h2>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Elements"
              className="-mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#303839]/55 transition hover:bg-[#303839]/5 hover:text-[#303839] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37]"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          )}
        </div>

        <label className="relative block">
          <span className="sr-only">Search for elements</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search for elements"
            aria-label="Search for elements"
            className="h-11 w-full rounded-full border border-[#303839]/15 bg-white pl-4 pr-12 text-sm text-[#303839] outline-none placeholder:text-[#303839]/40 focus:border-[#303839]/40"
          />
          <span aria-hidden className="pointer-events-none absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-[#303839] text-white">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          </span>
        </label>

        {searching && (
          <button
            type="button"
            onClick={() => { setSearch(""); setView("home"); }}
            className="mt-2 text-[11px] font-semibold text-[#303839]/60 underline underline-offset-2 transition hover:text-[#303839]"
          >
            Clear search
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4 [scrollbar-width:thin]">
      {adminMode && (
        <div className="rounded-xl border border-[#D4AF37]/35 bg-white p-2.5">
          <div className="flex items-center gap-2">
            <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()} className="min-h-11 flex-1 rounded-lg bg-[#303839] px-3 text-xs font-extrabold text-white transition hover:bg-[#434c4d] disabled:cursor-not-allowed disabled:opacity-50">
              {uploading ? `Uploading ${uploadProgress}%` : "Upload to library"}
            </button>
            {retryFile && !uploading && <button type="button" onClick={() => uploadAdminElement(retryFile)} className="min-h-11 rounded-lg border border-red-200 bg-white px-3 text-xs font-bold text-red-700">Retry</button>}
          </div>
          {uploading && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white" aria-label={`Upload ${uploadProgress}% complete`}><span className="block h-full rounded-full bg-[#D4AF37] transition-[width]" style={{ width: `${uploadProgress}%` }} /></div>}
          {uploadError && <p role="alert" className="mt-1.5 text-xs font-bold text-red-700">{uploadError}</p>}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" onChange={(event) => { uploadAdminElement(event.target.files?.[0]); event.target.value = ""; }} />
        </div>
      )}

      {/* ---------------------------------------------- Dynamic Shapes -- */}
      {onHome && allowShapes && onAddShape && visibleShapes.length > 0 && !searching && (
        <Section title="Dynamic Shapes">
          <div className="grid grid-cols-4 gap-2">
            {visibleShapes.map((shape) => (
              <button
                key={shape.id}
                type="button"
                onClick={() => onAddShape(shape.id)}
                aria-label={`Add ${shape.label}`}
                title={`Add ${shape.label}`}
                className="grid aspect-square place-items-center rounded-lg bg-[#E6E6E6] text-[#B9B9B9] transition hover:bg-[#DCDCDC] hover:text-[#A9A9A9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37]"
              >
                <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor" aria-hidden>{shape.render}</svg>
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* ----------------------------------------------------- Graphics -- */}
      <Section
        title="Graphics"
        action={!searching ? seeMore("graphics") : undefined}
      >
        {!searching && canDiscoverOnline && (
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 no-scrollbar" role="list" aria-label="Graphic categories">
            {GRAPHIC_CATEGORIES.slice(0, 8).map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="listitem"
                onClick={() => setSearch(entry.query)}
                className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-bold text-[#303839] transition hover:bg-[#ECE9E1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37]"
              >
                {entry.label}
              </button>
            ))}
          </div>
        )}

        {categories.length > 0 && !searching && (
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 no-scrollbar" role="tablist" aria-label="Library categories">
            <button type="button" role="tab" aria-selected={!category} onClick={() => { setCategory(""); setPage(1); }} className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold transition ${!category ? "bg-[#303839] text-white" : "bg-white text-[#303839] hover:bg-[#ECE9E1]"}`}>All</button>
            {categories.map((cat) => (
              <button key={cat.id} type="button" role="tab" aria-selected={category === cat.id} onClick={() => { setCategory(cat.id); setPage(1); }} className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold transition ${category === cat.id ? "bg-[#303839] text-white" : "bg-white text-[#303839] hover:bg-[#ECE9E1]"}`}>{cat.name}</button>
            ))}
          </div>
        )}

        {error && <p role="alert" className="mb-2 text-xs font-bold text-red-700">{error}</p>}

        {loading && page === 1 ? (
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 6 }).map((_, index) => <div key={index} className="aspect-square animate-pulse rounded-lg bg-white" aria-hidden />)}
          </div>
        ) : elements.length === 0 && !searching ? (
          <p className="text-sm text-[#303839]/55">No graphics in the library yet.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {(searching ? elements : elements.slice(0, 6)).map(elementCard)}
          </div>
        )}

        {hasMoreLocal && searching && !loading && (
          <button type="button" onClick={() => setPage((current) => current + 1)} className="mt-2 w-full rounded-full border border-[#303839]/15 px-4 py-1.5 text-xs font-bold text-[#303839] hover:bg-[#303839]/5">
            Load more library graphics
          </button>
        )}
      </Section>

      {/* --------------------------------------- Iconify online results -- */}
      {searching && canDiscoverOnline && (
        <Section title="Online graphics">
          {importError && <p role="alert" className="mb-2 text-xs font-bold text-red-700">{importError}</p>}

          {remoteError ? (
            // Isolated failure: everything above still works (spec §10).
            <p className="text-sm text-[#303839]/55">{remoteError}</p>
          ) : remoteLoading && remotePage === 1 ? (
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 6 }).map((_, index) => <div key={index} className="aspect-square animate-pulse rounded-lg bg-white" aria-hidden />)}
            </div>
          ) : remote.length === 0 ? (
            <p className="text-sm text-[#303839]/55">No online graphics match “{debouncedSearch}”.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">{remote.map(remoteCard)}</div>
              {remoteHasMore && !remoteLoading && (
                <button type="button" onClick={() => setRemotePage((current) => current + 1)} className="mt-2 w-full rounded-full border border-[#303839]/15 px-4 py-1.5 text-xs font-bold text-[#303839] hover:bg-[#303839]/5">
                  Load more
                </button>
              )}
            </>
          )}
        </Section>
      )}

      {/* --------------------------------------------------------- Text -- */}
      {onHome && allowText && onAddTextPreset && !searching && (
        <Section title="Text" action={seeMore("text")}>
          <div className="grid gap-1.5">
            {TEXT_PRESETS.slice(0, 3).map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => onAddTextPreset(preset.id, preset.text)}
                aria-label={`Add text: ${preset.label}`}
                className="rounded-lg border border-[#303839]/10 bg-white px-3 py-2 text-left text-sm font-semibold text-[#303839] transition hover:border-[#D4AF37] hover:bg-[#303839]/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37]"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* ----------------------------------------------- Borders / Lines -- */}
      {onHome && allowLines && onAddLine && !searching && (
        <Section title="Borders / Lines" action={seeMore("borders")}>
          <div className="grid gap-1.5">
            {LINES.map((line) => (
              <button
                key={line.id}
                type="button"
                onClick={() => onAddLine(line.id)}
                aria-label={`Add ${line.label}`}
                className="flex items-center rounded-lg border border-[#303839]/10 bg-white px-3 py-2.5 transition hover:border-[#D4AF37] hover:bg-[#303839]/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37]"
              >
                <svg viewBox="0 0 100 4" className="h-1 w-full" aria-hidden preserveAspectRatio="none">
                  <line x1="0" y1="2" x2="100" y2="2" stroke="#303839" strokeWidth="2" strokeDasharray={line.dash || undefined} strokeLinecap="round" />
                </svg>
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* --------------------------------------------------------- Shapes -- */}
      {onHome && allowShapes && onAddShape && visibleMoreShapes.length > 0 && !searching && (
        <Section title="Shapes" action={seeMore("shapes")}>
          <div className="grid grid-cols-4 gap-2">
            {visibleMoreShapes.slice(0, 4).map((shape) => (
              <button
                key={shape.id}
                type="button"
                onClick={() => onAddShape(shape.id)}
                aria-label={`Add ${shape.label}`}
                title={`Add ${shape.label}`}
                className="grid aspect-square place-items-center rounded-lg bg-[#E6E6E6] text-[#B9B9B9] transition hover:bg-[#DCDCDC] hover:text-[#A9A9A9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37]"
              >
                <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor" aria-hidden>{shape.render}</svg>
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* --------------------------------------------------------- Frames -- */}
      {onHome && allowFrames && onAddFrame && visibleFrames.length > 0 && !searching && (
        <Section title="Frames" action={seeMore("frames")}>
          <div className="grid grid-cols-4 gap-2">
            {visibleFrames.slice(0, 4).map((frame) => {
              const clipId = `frame-clip-${frame.id}`;
              return (
                <button
                  key={frame.id}
                  type="button"
                  onClick={() => onAddFrame(frame.id)}
                  aria-label={`Add ${frame.label}`}
                  title={`Add ${frame.label}`}
                  className="aspect-square overflow-hidden rounded-lg transition hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37]"
                >
                  {/* A photo-shaped swatch in the frame's own mask, so the
                      customer sees the actual crop the frame will apply. */}
                  <svg viewBox="0 0 48 48" className="h-full w-full" aria-hidden>
                    <defs><clipPath id={clipId}>{frame.clip}</clipPath></defs>
                    <g clipPath={`url(#${clipId})`}>
                      <rect width="48" height="48" fill="#D9F2F6" />
                      <path d="M0 34c8-10 14-4 22-10s18 2 26-4v28H0Z" fill="#BFE6C8" />
                      <path d="M0 41c10-8 18-2 26-7s14 1 22-3v17H0Z" fill="#A9DCB6" />
                    </g>
                  </svg>
                </button>
              );
            })}
          </div>
        </Section>
      )}

      {/* -------------------------------------------------------- QR Code -- */}
      {onHome && allowQRCode && onAddQRCode && !searching && (
        <Section title="QR Code">
          {qrOpen ? (
            <div className="grid gap-2">
              <label className="grid gap-1 text-xs font-bold text-[#303839]">
                <span>Destination URL</span>
                <input
                  type="url"
                  value={qrValue}
                  onChange={(event) => setQrValue(event.target.value)}
                  placeholder="https://example.com"
                  aria-label="QR code destination URL"
                  aria-invalid={Boolean(qrValue) && !qrValid}
                  className="h-11 rounded-lg border border-[#303839]/15 px-3 text-sm font-medium outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
                />
              </label>
              {Boolean(qrValue) && !qrValid && (
                <p role="alert" className="text-xs font-semibold text-red-700">Enter a valid http, https, email, or telephone destination.</p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!qrValid}
                  onClick={() => { onAddQRCode(qrValue); setQrOpen(false); }}
                  className="min-h-11 flex-1 rounded-full bg-[#303839] px-4 text-sm font-bold text-white transition hover:bg-[#414b4c] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  Add QR code
                </button>
                <button
                  type="button"
                  onClick={() => setQrOpen(false)}
                  className="min-h-11 rounded-full border border-[#303839]/15 px-4 text-sm font-bold text-[#303839] transition hover:bg-[#303839]/5"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setQrOpen(true)}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-[#303839]/20 bg-white text-sm font-bold text-[#303839] transition hover:border-[#D4AF37] hover:bg-[#303839]/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37]"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                <path d="M14 14h3v3h-3zM19 14h2v7h-7v-2" />
              </svg>
              Add QR Code
            </button>
          )}
        </Section>
      )}

      {/* --------------------------------------- Recently used / Favourites -- */}
      {onHome && !searching && recentElements.length > 0 && (
        <Section title="Recently used" action={showMore(recentElements.length, showAllRecent, setShowAllRecent)}>
          <div className="grid grid-cols-3 gap-2">{recentElements.slice(0, showAllRecent ? 12 : 3).map(elementCard)}</div>
        </Section>
      )}

      {onHome && !searching && favouriteElements.length > 0 && (
        <Section title="Favourites" action={showMore(favouriteElements.length, showAllFavourites, setShowAllFavourites)}>
          <div className="grid grid-cols-3 gap-2">{favouriteElements.slice(0, showAllFavourites ? 12 : 3).map(elementCard)}</div>
        </Section>
      )}

      {/* ============================ focused subviews (spec §9, §33) ==== */}

      {view === "graphics" && !searching && (
        <div className="grid grid-cols-3 gap-2">
          {elements.length === 0 && !loading && <p className="col-span-3 text-sm text-[#303839]/55">No graphics in the library yet. Use search to find more.</p>}
          {elements.map(elementCard)}
          {hasMoreLocal && !loading && (
            <button type="button" onClick={() => setPage((current) => current + 1)} className="col-span-3 rounded-full border border-[#303839]/15 px-4 py-2 text-xs font-bold text-[#303839] hover:bg-[#303839]/5">
              Load more
            </button>
          )}
        </div>
      )}

      {view === "text" && onAddTextPreset && (
        <div className="grid gap-1.5">
          {TEXT_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => onAddTextPreset(preset.id, preset.text)}
              aria-label={`Add text: ${preset.label}`}
              className="rounded-lg border border-[#303839]/10 bg-white px-3 py-2.5 text-left text-sm font-semibold text-[#303839] transition hover:border-[#D4AF37] hover:bg-[#303839]/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37]"
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}

      {view === "borders" && onAddLine && (
        <div className="grid gap-1.5">
          {LINES.map((line) => (
            <button
              key={line.id}
              type="button"
              onClick={() => onAddLine(line.id)}
              aria-label={`Add ${line.label}`}
              className="flex items-center rounded-lg border border-[#303839]/10 bg-white px-3 py-3 transition hover:border-[#D4AF37] hover:bg-[#303839]/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37]"
            >
              <svg viewBox="0 0 100 4" className="h-1 w-full" aria-hidden preserveAspectRatio="none">
                <line x1="0" y1="2" x2="100" y2="2" stroke="#303839" strokeWidth="2" strokeDasharray={line.dash || undefined} strokeLinecap="round" />
              </svg>
            </button>
          ))}
          {/* Decorative dividers are permanent SVG assets, not lines. */}
          {canDiscoverOnline && (
            <button
              type="button"
              onClick={() => { setSearch("divider"); }}
              className="mt-1 rounded-lg border border-dashed border-[#303839]/20 px-3 py-2.5 text-xs font-semibold text-[#303839]/70 transition hover:border-[#D4AF37] hover:text-[#303839] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37]"
            >
              Browse decorative dividers &amp; ornaments
            </button>
          )}
        </div>
      )}

      {view === "shapes" && onAddShape && (
        <div className="grid grid-cols-4 gap-2">
          {[...visibleShapes, ...visibleMoreShapes].map((shape) => (
            <button
              key={shape.id}
              type="button"
              onClick={() => onAddShape(shape.id)}
              aria-label={`Add ${shape.label}`}
              title={`Add ${shape.label}`}
              className="grid aspect-square place-items-center rounded-lg bg-[#E6E6E6] text-[#B9B9B9] transition hover:bg-[#DCDCDC] hover:text-[#A9A9A9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37]"
            >
              <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor" aria-hidden>{shape.render}</svg>
            </button>
          ))}
        </div>
      )}

      {view === "frames" && onAddFrame && (
        <div className="grid grid-cols-4 gap-2">
          {visibleFrames.map((frame) => {
            const clipId = `frame-more-${frame.id}`;
            return (
              <button
                key={frame.id}
                type="button"
                onClick={() => onAddFrame(frame.id)}
                aria-label={`Add ${frame.label}`}
                title={`Add ${frame.label}`}
                className="aspect-square overflow-hidden rounded-lg transition hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37]"
              >
                <svg viewBox="0 0 48 48" className="h-full w-full" aria-hidden>
                  <defs><clipPath id={clipId}>{frame.clip}</clipPath></defs>
                  <g clipPath={`url(#${clipId})`}>
                    <rect width="48" height="48" fill="#D9F2F6" />
                    <path d="M0 34c8-10 14-4 22-10s18 2 26-4v28H0Z" fill="#BFE6C8" />
                    <path d="M0 41c10-8 18-2 26-7s14 1 22-3v17H0Z" fill="#A9DCB6" />
                  </g>
                </svg>
              </button>
            );
          })}
        </div>
      )}

      </div>
    </div>
  );
}
