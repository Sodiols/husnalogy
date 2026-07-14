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
};

export default function CustomerElementsPanel({ onInsertElement }: Props) {
  const [elements, setElements] = useState<LibraryElement[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ page: String(page), pageSize: "30" });
    if (search.trim()) query.set("search", search.trim());
    if (category) query.set("category", category);

    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/customizer/elements?${query.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (requestRef.current !== requestId) return; // stale request
        if (!res.ok || data.ok === false) throw new Error(data?.error || "Could not load elements.");
        const incoming: LibraryElement[] = data.elements || [];
        setElements((current) => (page === 1 ? incoming : [...current, ...incoming]));
        setCategories(data.categories || []);
        setTotal(Number(data.total) || 0);
      } catch (e: any) {
        if (requestRef.current === requestId) setError(e?.message || "Could not load elements.");
      } finally {
        if (requestRef.current === requestId) setLoading(false);
      }
    }, search ? 300 : 0);

    return () => window.clearTimeout(timer);
  }, [search, category, page]);

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
          {elements.map((element) => (
            <button
              key={element.id}
              type="button"
              onClick={() => onInsertElement(element)}
              title={`Insert ${element.title}`}
              aria-label={`Insert ${element.title}`}
              className="group aspect-square overflow-hidden rounded-lg border border-[#303839]/10 bg-white p-2 transition hover:border-[#D4AF37] hover:bg-[#F8F6F1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37]"
            >
              <img
                src={element.url}
                alt={element.title}
                loading="lazy"
                draggable={false}
                className="h-full w-full object-contain transition group-hover:scale-105"
              />
            </button>
          ))}
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
