"use client";

// Elements panel (spec §14): browse, search, and insert Husnalogy library
// elements. Only shown when the template allows customer elements. Inserted
// elements become customer layers (movable/resizable/rotatable/deletable).

import { useEffect, useRef, useState } from "react";

export type LibraryElement = {
  id: string;
  title: string;
  url: string;
  width: number;
  height: number;
  tintable: boolean;
  defaultColor: string;
  categoryId: string;
};

type Category = { id: string; name: string };

type Props = {
  onInsertElement: (element: LibraryElement) => void;
  allowedElementIds?: string[];
};

export default function CustomerElementsPanel({ onInsertElement, allowedElementIds = [] }: Props) {
  const [elements, setElements] = useState<LibraryElement[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<LibraryElement[]>([]);
  const [favourites, setFavourites] = useState<LibraryElement[]>([]);
  const requestRef = useRef(0);

  useEffect(() => {
    try {
      setRecent(JSON.parse(window.localStorage.getItem("husnalogy-customizer-recent-elements") || "[]"));
      setFavourites(JSON.parse(window.localStorage.getItem("husnalogy-customizer-favourite-elements") || "[]"));
    } catch {
      // Private browsing/storage failures must never block the library.
    }
  }, []);

  const remember = (element: LibraryElement) => {
    setRecent((current) => {
      const next = [element, ...current.filter((entry) => entry.id !== element.id)].slice(0, 8);
      try { window.localStorage.setItem("husnalogy-customizer-recent-elements", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const toggleFavourite = (element: LibraryElement) => {
    setFavourites((current) => {
      const next = current.some((entry) => entry.id === element.id) ? current.filter((entry) => entry.id !== element.id) : [element, ...current];
      try { window.localStorage.setItem("husnalogy-customizer-favourite-elements", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const insert = (element: LibraryElement) => {
    remember(element);
    onInsertElement(element);
  };

  const elementCard = (element: LibraryElement) => {
    const favourite = favourites.some((entry) => entry.id === element.id);
    return (
      <div key={element.id} className="group relative aspect-square">
        <button
          type="button"
          draggable
          onDragStart={(event) => {
            remember(element);
            event.dataTransfer.effectAllowed = "copy";
            event.dataTransfer.setData("application/x-husnalogy-element", JSON.stringify(element));
          }}
          onClick={() => insert(element)}
          title={`Insert ${element.title}`}
          aria-label={`Insert ${element.title}`}
          className="h-full w-full overflow-hidden rounded-lg border border-[#303839]/10 bg-white p-2 transition hover:border-[#D4AF37] hover:bg-[#F8F6F1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37]"
        >
          <img src={element.url} alt={element.title} loading="lazy" draggable={false} className="h-full w-full object-contain transition group-hover:scale-105" />
        </button>
        <button type="button" aria-label={`${favourite ? "Remove" : "Add"} ${element.title} ${favourite ? "from" : "to"} favourites`} aria-pressed={favourite} onClick={() => toggleFavourite(element)} className={`absolute right-1 top-1 grid h-9 w-9 place-items-center rounded-full border border-[#303839]/10 shadow-sm ${favourite ? "bg-[#D4AF37] text-[#303839]" : "bg-white text-[#303839]/55 hover:text-[#D4AF37]"}`}>
          <span aria-hidden>{favourite ? "★" : "☆"}</span>
        </button>
      </div>
    );
  };

  useEffect(() => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ page: String(page), pageSize: allowedElementIds.length ? "200" : "30" });
    if (search.trim()) query.set("search", search.trim());
    if (category) query.set("category", category);

    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/customizer/elements?${query.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (requestRef.current !== requestId) return; // stale request
        if (!res.ok || data.ok === false) throw new Error(data?.error || "Could not load elements.");
        const incoming: LibraryElement[] = (data.elements || []).filter((element: LibraryElement) => !allowedElementIds.length || allowedElementIds.includes(element.id));
        setElements((current) => (page === 1 ? incoming : [...current, ...incoming]));
        setCategories(data.categories || []);
        setTotal(allowedElementIds.length ? incoming.length : Number(data.total) || 0);
      } catch (e: any) {
        if (requestRef.current === requestId) setError(e?.message || "Could not load elements.");
      } finally {
        if (requestRef.current === requestId) setLoading(false);
      }
    }, search ? 300 : 0);

    return () => window.clearTimeout(timer);
  }, [search, category, page, allowedElementIds]);

  const hasMore = elements.length < total;

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <label className="relative block">
        <span className="sr-only">Search elements</span>
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search elements…"
          className="w-full rounded-full border border-[#303839]/15 bg-white px-4 py-2 text-sm text-[#303839] outline-none placeholder:text-[#303839]/40 focus:border-[#303839]/40"
        />
      </label>

      {categories.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar" role="tablist" aria-label="Element categories">
          <button
            type="button"
            role="tab"
            aria-selected={!category}
            onClick={() => {
              setCategory("");
              setPage(1);
            }}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold transition ${
              !category ? "bg-[#303839] text-white" : "bg-[#F8F6F1] text-[#303839] hover:bg-[#ECE9E1]"
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={category === cat.id}
              onClick={() => {
                setCategory(cat.id);
                setPage(1);
              }}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold transition ${
                category === cat.id ? "bg-[#303839] text-white" : "bg-[#F8F6F1] text-[#303839] hover:bg-[#ECE9E1]"
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {!search && !category && favourites.length > 0 && (
        <section aria-labelledby="favourite-elements-title">
          <h3 id="favourite-elements-title" className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#303839]/50">Favourites</h3>
          <div className="grid grid-cols-3 gap-2">{favourites.filter((element) => !allowedElementIds.length || allowedElementIds.includes(element.id)).slice(0, 6).map(elementCard)}</div>
        </section>
      )}

      {!search && !category && recent.length > 0 && (
        <section aria-labelledby="recent-elements-title">
          <h3 id="recent-elements-title" className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#303839]/50">Recently used</h3>
          <div className="grid grid-cols-3 gap-2">{recent.filter((element) => !allowedElementIds.length || allowedElementIds.includes(element.id)).slice(0, 6).map(elementCard)}</div>
        </section>
      )}

      {error && (
        <p className="text-xs font-bold text-red-700" role="alert">
          {error}
        </p>
      )}

      {loading && page === 1 ? (
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 9 }).map((_, index) => (
            <div key={index} className="aspect-square animate-pulse rounded-lg bg-[#F8F6F1]" aria-hidden />
          ))}
        </div>
      ) : elements.length === 0 ? (
        <p className="text-sm text-[#303839]/55">No elements found{search ? ` for “${search}”` : ""}.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 overflow-y-auto">
          {elements.map(elementCard)}
        </div>
      )}

      {hasMore && !loading && (
        <button
          type="button"
          onClick={() => setPage((current) => current + 1)}
          className="rounded-full border border-[#303839]/15 px-4 py-1.5 text-xs font-bold text-[#303839] hover:bg-[#F8F6F1]"
        >
          Load more
        </button>
      )}
    </div>
  );
}
