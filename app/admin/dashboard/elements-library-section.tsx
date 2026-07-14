"use client";

// Admin Elements Library (spec §14): upload, categorize, tag, archive, and
// delete the decorative assets customers can insert in the customizer.

import { useEffect, useRef, useState } from "react";

type AssetRow = {
  id: string;
  categoryId: string;
  title: string;
  tags: string[];
  keywords: string;
  url: string;
  mimeType: string;
  width: number;
  height: number;
  tintable: boolean;
  defaultColor: string;
  customerAvailable: boolean;
  active: boolean;
  archived: boolean;
  createdAt: string;
};

type CategoryRow = { id: string; name: string; slug: string; active: boolean };

export default function ElementsLibrarySection({ onAction }: { onAction?: (message: string) => void }) {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [uploadForm, setUploadForm] = useState({ title: "", categoryId: "", tags: "", customerAvailable: true });
  const fileRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);

  const notify = (message: string) => onAction?.(message);

  const loadCategories = async () => {
    const res = await fetch("/api/admin/customizer/asset-categories");
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) setCategories(data.categories || []);
  };

  const loadAssets = async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ pageSize: "60" });
    if (search.trim()) query.set("search", search.trim());
    if (categoryFilter) query.set("category", categoryFilter);
    if (showArchived) query.set("archived", "1");
    try {
      const res = await fetch(`/api/admin/customizer/assets?${query.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (requestRef.current !== requestId) return;
      if (!res.ok || data.ok === false) throw new Error(data?.error || "Could not load elements.");
      setAssets(data.assets || []);
    } catch (e: any) {
      if (requestRef.current === requestId) setError(e?.message || "Could not load elements.");
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  };

  useEffect(() => {
    loadCategories();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(loadAssets, search ? 300 : 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, categoryFilter, showArchived]);

  const handleUpload = async (file?: File | null) => {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", uploadForm.title || file.name.replace(/\.[^.]+$/, ""));
      formData.append("categoryId", uploadForm.categoryId);
      formData.append("tags", uploadForm.tags);
      formData.append("customerAvailable", String(uploadForm.customerAvailable));
      const res = await fetch("/api/admin/customizer/assets", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data?.error || "Upload failed.");
      notify(`Element "${data.asset?.title || file.name}" uploaded.`);
      setUploadForm((current) => ({ ...current, title: "", tags: "" }));
      await loadAssets();
    } catch (e: any) {
      setError(e?.message || "Upload failed.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const patchAsset = async (asset: AssetRow, patch: Record<string, unknown>, successMessage: string) => {
    const res = await fetch(`/api/admin/customizer/assets/${encodeURIComponent(asset.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      setError(data?.error || "Update failed.");
      return;
    }
    notify(successMessage);
    setAssets((current) => current.map((item) => (item.id === asset.id ? { ...item, ...data.asset } : item)));
  };

  const deleteAsset = async (asset: AssetRow) => {
    if (!window.confirm(`Permanently delete "${asset.title}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/customizer/assets/${encodeURIComponent(asset.id)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      setError(data?.error || "Delete failed.");
      return;
    }
    notify(`Element "${asset.title}" deleted.`);
    setAssets((current) => current.filter((item) => item.id !== asset.id));
  };

  const createCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    const res = await fetch("/api/admin/customizer/asset-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      setError(data?.error || "Could not create the category.");
      return;
    }
    setNewCategoryName("");
    notify(`Category "${name}" created.`);
    await loadCategories();
  };

  return (
    <div className="grid gap-4">
      {/* Upload card */}
      <div className="rounded-xl border border-[#303839]/10 bg-white p-4">
        <h3 className="font-display text-lg text-[#303839]">Upload element</h3>
        <p className="mt-0.5 text-xs text-[#303839]/55">
          SVG, PNG, JPG, or WebP up to 10MB. SVGs are sanitized — scripts and external references are rejected.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input
            type="text"
            value={uploadForm.title}
            onChange={(e) => setUploadForm((c) => ({ ...c, title: e.target.value }))}
            placeholder="Title (defaults to filename)"
            aria-label="Element title"
            className="rounded-lg border border-[#303839]/15 px-3 py-2 text-sm outline-none focus:border-[#303839]/40"
          />
          <select
            value={uploadForm.categoryId}
            onChange={(e) => setUploadForm((c) => ({ ...c, categoryId: e.target.value }))}
            aria-label="Element category"
            className="rounded-lg border border-[#303839]/15 bg-white px-3 py-2 text-sm outline-none focus:border-[#303839]/40"
          >
            <option value="">No category</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={uploadForm.tags}
            onChange={(e) => setUploadForm((c) => ({ ...c, tags: e.target.value }))}
            placeholder="Tags (comma separated)"
            aria-label="Element tags"
            className="rounded-lg border border-[#303839]/15 px-3 py-2 text-sm outline-none focus:border-[#303839]/40"
          />
          <label className="flex items-center gap-2 text-sm text-[#303839]">
            <input
              type="checkbox"
              checked={uploadForm.customerAvailable}
              onChange={(e) => setUploadForm((c) => ({ ...c, customerAvailable: e.target.checked }))}
              className="accent-[#303839]"
            />
            Visible to customers
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="cursor-pointer rounded-full bg-[#303839] px-5 py-2 text-sm font-bold text-white hover:bg-[#1f2526]">
            {uploading ? "Uploading…" : "Choose file & upload"}
            <input
              ref={fileRef}
              type="file"
              accept="image/svg+xml,image/png,image/jpeg,image/webp"
              className="sr-only"
              disabled={uploading}
              onChange={(e) => handleUpload(e.target.files?.[0])}
            />
          </label>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createCategory()}
              placeholder="New category name"
              aria-label="New category name"
              className="rounded-lg border border-[#303839]/15 px-3 py-1.5 text-sm outline-none focus:border-[#303839]/40"
            />
            <button
              type="button"
              onClick={createCategory}
              className="rounded-full border border-[#303839]/20 px-4 py-1.5 text-sm font-bold text-[#303839] hover:bg-[#F8F6F1]"
            >
              Add category
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search elements…"
          aria-label="Search elements"
          className="w-64 rounded-full border border-[#303839]/15 bg-white px-4 py-2 text-sm outline-none focus:border-[#303839]/40"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label="Filter by category"
          className="rounded-full border border-[#303839]/15 bg-white px-3 py-2 text-sm outline-none focus:border-[#303839]/40"
        >
          <option value="">All categories</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-[#303839]/70">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-[#303839]" />
          Show archived
        </label>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700" role="alert">
          {error}
        </p>
      )}

      {/* Asset grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, index) => (
            <div key={index} className="aspect-square animate-pulse rounded-xl bg-[#F8F6F1]" aria-hidden />
          ))}
        </div>
      ) : assets.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#303839]/20 p-8 text-center text-sm text-[#303839]/55">
          No elements yet. Upload SVG or image assets above to build the Husnalogy elements library.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {assets.map((asset) => (
            <div key={asset.id} className={`rounded-xl border bg-white p-2 ${asset.archived ? "border-amber-300 opacity-70" : "border-[#303839]/10"}`}>
              <div className="grid aspect-square place-items-center overflow-hidden rounded-lg bg-[#F8F6F1] p-2">
                <img src={asset.url} alt={asset.title} loading="lazy" className="max-h-full max-w-full object-contain" />
              </div>
              <p className="mt-1.5 truncate text-xs font-bold text-[#303839]" title={asset.title}>
                {asset.title}
              </p>
              <p className="text-[10px] text-[#303839]/50">
                {asset.mimeType.replace("image/", "").toUpperCase()}
                {asset.width ? ` · ${asset.width}×${asset.height}` : ""}
                {asset.tintable ? " · tintable" : ""}
                {asset.archived ? " · archived" : !asset.active ? " · inactive" : ""}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => patchAsset(asset, { customerAvailable: !asset.customerAvailable }, asset.customerAvailable ? "Hidden from customers." : "Visible to customers.")}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${asset.customerAvailable ? "bg-[#303839] text-white" : "bg-[#F8F6F1] text-[#303839]"}`}
                  title={asset.customerAvailable ? "Click to hide from customers" : "Click to show to customers"}
                >
                  {asset.customerAvailable ? "Customer" : "Admin only"}
                </button>
                <button
                  type="button"
                  onClick={() => patchAsset(asset, { archived: !asset.archived }, asset.archived ? "Element restored." : "Element archived.")}
                  className="rounded-full bg-[#F8F6F1] px-2 py-0.5 text-[10px] font-bold text-[#303839] hover:bg-[#ECE9E1]"
                >
                  {asset.archived ? "Restore" : "Archive"}
                </button>
                {asset.archived && (
                  <button
                    type="button"
                    onClick={() => deleteAsset(asset)}
                    className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700 hover:bg-red-100"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
