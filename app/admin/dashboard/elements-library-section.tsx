"use client";

import { useEffect, useRef, useState } from "react";

type AssetRow = {
  id: string;
  categoryId: string;
  folderId: string;
  title: string;
  originalFilename: string;
  assetType: string;
  tags: string[];
  keywords: string;
  url: string;
  thumbnailUrl: string;
  mimeType: string;
  fileSizeBytes: number;
  width: number;
  height: number;
  tintable: boolean;
  defaultColor: string;
  customerAvailable: boolean;
  adminAvailable: boolean;
  active: boolean;
  archived: boolean;
  status: string;
  checksum: string;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
  // Provenance for externally imported graphics (Iconify). Empty for local
  // uploads, which remain fully valid without it.
  sourceProvider?: string;
  sourceKey?: string;
  sourceCollection?: string;
  sourceLicense?: string;
  sourceLicenseUrl?: string;
  sourceLicenseSpdx?: string;
  sourceAuthor?: string;
};

type CategoryRow = { id: string; name: string; slug: string; active: boolean };
type FolderRow = { id: string; name: string; parentId: string };

const ASSET_TYPES = ["image", "element", "svg", "frame", "background", "texture", "mockup", "overlay", "other"];
const inputClass = "min-h-11 rounded-xl border border-[#303839]/15 bg-white px-3 text-sm text-[#303839] outline-none transition focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20";

function uploadAsset(formData: FormData, onProgress: (progress: number) => void) {
  return new Promise<any>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/admin/customizer/assets");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let payload: any = {};
      try { payload = JSON.parse(xhr.responseText || "{}"); } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && payload.ok !== false) resolve(payload);
      else reject(new Error(payload.error || "Upload failed."));
    };
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.send(formData);
  });
}

export default function ElementsLibrarySection({ onAction }: { onAction?: (message: string) => void }) {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [folderFilter, setFolderFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [mimeFilter, setMimeFilter] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [usage, setUsage] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [retryFile, setRetryFile] = useState<File | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editDraft, setEditDraft] = useState({ title: "", categoryId: "", folderId: "", tags: "", keywords: "", assetType: "element", customerAvailable: false, adminAvailable: true });
  const [uploadForm, setUploadForm] = useState({ title: "", categoryId: "", folderId: "", tags: "", keywords: "", assetType: "element", customerAvailable: false, adminAvailable: true });
  const fileRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);

  const notify = (message: string) => onAction?.(message);

  const loadAssets = async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ pageSize: "100", includeUnavailable: "1" });
    if (search.trim()) query.set("search", search.trim());
    if (categoryFilter) query.set("category", categoryFilter);
    if (folderFilter) query.set("folder", folderFilter);
    if (typeFilter) query.set("type", typeFilter);
    if (mimeFilter) query.set("mime", mimeFilter);
    if (showArchived) query.set("archived", "1");
    try {
      const response = await fetch(`/api/admin/customizer/assets?${query}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (requestRef.current !== requestId) return;
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "Could not load assets.");
      setAssets(payload.assets || []);
      setCategories(payload.categories || []);
      setFolders(payload.folders || []);
    } catch (caught: any) {
      if (requestRef.current === requestId) setError(caught?.message || "Could not load assets.");
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(loadAssets, search ? 300 : 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, categoryFilter, folderFilter, typeFilter, mimeFilter, showArchived]);

  const handleUpload = async (file?: File | null) => {
    if (!file) return;
    setUploading(true);
    setProgress(0);
    setError("");
    setUsage([]);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", uploadForm.title || file.name.replace(/\.[^.]+$/, ""));
      formData.append("categoryId", uploadForm.categoryId);
      formData.append("folderId", uploadForm.folderId);
      formData.append("tags", uploadForm.tags);
      formData.append("keywords", uploadForm.keywords);
      formData.append("assetType", uploadForm.assetType);
      formData.append("customerAvailable", String(uploadForm.customerAvailable));
      formData.append("adminAvailable", String(uploadForm.adminAvailable));
      const payload = await uploadAsset(formData, setProgress);
      const asset = payload.asset as AssetRow;
      setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
      setRetryFile(null);
      setUploadForm((current) => ({ ...current, title: "", tags: "", keywords: "" }));
      notify(payload.duplicate ? payload.message || "Duplicate asset detected; the existing asset was reused." : `Asset “${asset.title}” uploaded.`);
    } catch (caught: any) {
      setRetryFile(file);
      setError(caught?.message || "Upload failed.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const patchAsset = async (asset: AssetRow, patch: Record<string, unknown>, successMessage: string) => {
    setError("");
    const response = await fetch(`/api/admin/customizer/assets/${encodeURIComponent(asset.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      setError(payload.error || "Update failed.");
      return false;
    }
    setAssets((current) => current.map((item) => (item.id === asset.id ? payload.asset : item)));
    notify(successMessage);
    return true;
  };

  const startEditing = (asset: AssetRow) => {
    setEditingId(asset.id);
    setEditDraft({ title: asset.title, categoryId: asset.categoryId, folderId: asset.folderId, tags: asset.tags.join(", "), keywords: asset.keywords, assetType: asset.assetType, customerAvailable: asset.customerAvailable, adminAvailable: asset.adminAvailable });
  };

  const saveEditing = async (asset: AssetRow) => {
    const saved = await patchAsset(asset, { ...editDraft, tags: editDraft.tags.split(",").map((tag) => tag.trim()).filter(Boolean) }, `Asset “${editDraft.title}” updated.`);
    if (saved) setEditingId("");
  };

  const previewAsset = async (asset: AssetRow) => {
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    const response = await fetch(`/api/admin/customizer/assets/${encodeURIComponent(asset.id)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.asset?.url) {
      popup?.close();
      setError(payload.error || "Could not refresh the secure preview URL.");
      return;
    }
    setAssets((current) => current.map((item) => item.id === asset.id ? payload.asset : item));
    if (popup) popup.location.href = payload.asset.url;
  };

  const deleteAsset = async (asset: AssetRow) => {
    if (!window.confirm(`Permanently delete “${asset.title}”? This cannot be undone.`)) return;
    setUsage([]);
    const response = await fetch(`/api/admin/customizer/assets/${encodeURIComponent(asset.id)}`, { method: "DELETE" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      setError(payload.error || "Delete failed.");
      setUsage(payload.usage || []);
      return;
    }
    notify(`Asset “${asset.title}” deleted.`);
    setAssets((current) => current.filter((item) => item.id !== asset.id));
  };

  const createCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    const response = await fetch("/api/admin/customizer/asset-categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) return setError(payload.error || "Could not create the category.");
    setCategories((current) => [...current, payload.category].sort((a, b) => a.name.localeCompare(b.name)));
    setNewCategoryName("");
  };

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    const response = await fetch("/api/admin/customizer/asset-folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) return setError(payload.error || "Could not create the folder.");
    setFolders((current) => [...current, payload.folder].sort((a, b) => a.name.localeCompare(b.name)));
    setNewFolderName("");
  };

  return (
    <div className="grid gap-4">
      <section className="rounded-2xl border border-[#303839]/10 bg-white p-4">
        <h3 className="font-display text-lg text-[#303839]">Upload permanent asset</h3>
        <p className="mt-0.5 text-xs text-[#303839]/55">Private Supabase Storage · original, editor, and thumbnail variants · SVG sanitization · duplicate checksum detection.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <input value={uploadForm.title} onChange={(event) => setUploadForm((current) => ({ ...current, title: event.target.value }))} placeholder="Display name" aria-label="Asset display name" className={inputClass} />
          <select value={uploadForm.assetType} onChange={(event) => setUploadForm((current) => ({ ...current, assetType: event.target.value }))} aria-label="Asset type" className={inputClass}>{ASSET_TYPES.map((type) => <option key={type} value={type}>{type[0].toUpperCase() + type.slice(1)}</option>)}</select>
          <select value={uploadForm.categoryId} onChange={(event) => setUploadForm((current) => ({ ...current, categoryId: event.target.value }))} aria-label="Asset category" className={inputClass}><option value="">No category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
          <select value={uploadForm.folderId} onChange={(event) => setUploadForm((current) => ({ ...current, folderId: event.target.value }))} aria-label="Asset folder" className={inputClass}><option value="">Unfiled</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select>
          <input value={uploadForm.tags} onChange={(event) => setUploadForm((current) => ({ ...current, tags: event.target.value }))} placeholder="Tags, comma separated" aria-label="Asset tags" className={inputClass} />
          <input value={uploadForm.keywords} onChange={(event) => setUploadForm((current) => ({ ...current, keywords: event.target.value }))} placeholder="Search keywords" aria-label="Asset search keywords" className={inputClass} />
          <label className="flex min-h-11 items-center gap-2 rounded-xl bg-[#F8F6F1] px-3 text-sm font-semibold"><input type="checkbox" checked={uploadForm.customerAvailable} onChange={(event) => setUploadForm((current) => ({ ...current, customerAvailable: event.target.checked }))} className="h-4 w-4 accent-[#303839]" />Customer available</label>
          <label className="flex min-h-11 items-center gap-2 rounded-xl bg-[#F8F6F1] px-3 text-sm font-semibold"><input type="checkbox" checked={uploadForm.adminAvailable} onChange={(event) => setUploadForm((current) => ({ ...current, adminAvailable: event.target.checked }))} className="h-4 w-4 accent-[#303839]" />Administrator available</label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="min-h-11 cursor-pointer rounded-full bg-[#303839] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#1f2526] focus-within:ring-2 focus-within:ring-[#D4AF37]">
            {uploading ? `Uploading ${progress}%` : "Choose file & upload"}
            <input ref={fileRef} type="file" accept="image/svg+xml,image/png,image/jpeg,image/webp" className="sr-only" disabled={uploading} onChange={(event) => handleUpload(event.target.files?.[0])} />
          </label>
          {uploading && <div className="h-2 w-48 overflow-hidden rounded-full bg-[#F8F6F1]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span className="block h-full bg-[#D4AF37] transition-[width]" style={{ width: `${progress}%` }} /></div>}
          {retryFile && !uploading && <button type="button" onClick={() => handleUpload(retryFile)} className="min-h-11 rounded-full border border-red-200 px-4 text-sm font-bold text-red-700 hover:bg-red-50">Retry {retryFile.name}</button>}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="flex gap-2"><input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && createCategory()} placeholder="New category" aria-label="New category name" className={`${inputClass} min-w-0 flex-1`} /><button type="button" onClick={createCategory} className="min-h-11 rounded-xl border border-[#303839]/15 px-3 text-xs font-bold hover:bg-[#F8F6F1]">Add category</button></div>
          <div className="flex gap-2"><input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && createFolder()} placeholder="New folder" aria-label="New folder name" className={`${inputClass} min-w-0 flex-1`} /><button type="button" onClick={createFolder} className="min-h-11 rounded-xl border border-[#303839]/15 px-3 text-xs font-bold hover:bg-[#F8F6F1]">Add folder</button></div>
        </div>
      </section>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search assets…" aria-label="Search assets" className={inputClass} />
        <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filter by category" className={inputClass}><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
        <select value={folderFilter} onChange={(event) => setFolderFilter(event.target.value)} aria-label="Filter by folder" className={inputClass}><option value="">All folders</option><option value="unfiled">Unfiled</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select>
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Filter by file type" className={inputClass}><option value="">All file types</option>{ASSET_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select>
        <select value={mimeFilter} onChange={(event) => setMimeFilter(event.target.value)} aria-label="Filter by file format" className={inputClass}><option value="">All file formats</option><option value="image/png">PNG</option><option value="image/jpeg">JPG / JPEG</option><option value="image/webp">WebP</option><option value="image/svg+xml">SVG</option></select>
        <label className="flex min-h-11 items-center gap-2 rounded-xl bg-white px-3 text-sm font-semibold"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} className="h-4 w-4 accent-[#303839]" />Show archived</label>
      </div>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700" role="alert">{error}</p>}
      {usage.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-extrabold text-amber-900">Asset is currently used by:</p><ul className="mt-1 list-disc pl-5 text-xs text-amber-900">{usage.map((item, index) => <li key={`${item.type}-${item.id}-${index}`}>{item.label || item.type} · {item.id}</li>)}</ul></div>}

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{Array.from({ length: 10 }).map((_, index) => <div key={index} className="aspect-square animate-pulse rounded-2xl bg-[#F8F6F1]" aria-hidden />)}</div>
      ) : assets.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[#303839]/20 p-8 text-center text-sm text-[#303839]/55">No matching administrator assets.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {assets.map((asset) => (
            <article key={asset.id} className={`rounded-2xl border bg-white p-3 ${asset.archived ? "border-amber-300" : "border-[#303839]/10"}`}>
              <button type="button" onClick={() => previewAsset(asset)} className="grid aspect-[4/3] w-full cursor-zoom-in place-items-center overflow-hidden rounded-xl bg-[#F8F6F1] p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]" aria-label={`Preview ${asset.title}`}>
                <img src={asset.thumbnailUrl || asset.url} alt={asset.title} loading="lazy" className="max-h-full max-w-full object-contain" />
              </button>
              <div className="mt-2 flex items-start justify-between gap-2"><div className="min-w-0"><h4 className="truncate text-sm font-extrabold" title={asset.title}>{asset.title}</h4><p className="truncate text-[10px] text-[#303839]/50" title={asset.originalFilename}>{asset.originalFilename}</p></div><span className={`rounded-full px-2 py-1 text-[9px] font-extrabold ${asset.archived ? "bg-amber-100 text-amber-900" : "bg-emerald-50 text-emerald-800"}`}>{asset.status}</span></div>
              <p className="mt-1 text-[10px] text-[#303839]/55">{asset.assetType} · {String(asset.mimeType || "unknown").replace("image/", "").toUpperCase()} · {asset.width || 0}×{asset.height || 0} · {(asset.fileSizeBytes / 1024).toFixed(0)}KB</p>

              {/* Provenance for an externally imported graphic (spec §26).
                  Recorded at import time, so it stays accurate even if the
                  upstream collection later changes its licence. Admin-only —
                  customers never see these technical details. */}
              {asset.sourceProvider && (
                <dl className="mt-2 grid gap-0.5 rounded-lg bg-[#F8F6F1] p-2 text-[10px] leading-4 text-[#303839]/70">
                  <div className="flex gap-1"><dt className="font-bold">Source</dt><dd className="truncate">{asset.sourceProvider}{asset.sourceKey ? ` · ${asset.sourceKey}` : ""}</dd></div>
                  {asset.sourceCollection && <div className="flex gap-1"><dt className="font-bold">Collection</dt><dd className="truncate">{asset.sourceCollection}</dd></div>}
                  {asset.sourceAuthor && <div className="flex gap-1"><dt className="font-bold">Author</dt><dd className="truncate">{asset.sourceAuthor}</dd></div>}
                  <div className="flex gap-1">
                    <dt className="font-bold">License</dt>
                    <dd className="truncate">
                      {asset.sourceLicenseUrl
                        ? <a href={asset.sourceLicenseUrl} target="_blank" rel="noopener noreferrer" className="underline">{asset.sourceLicenseSpdx || asset.sourceLicense || "View"}</a>
                        : (asset.sourceLicenseSpdx || asset.sourceLicense || "Unknown")}
                    </dd>
                  </div>
                  <div className="flex gap-1">
                    <dt className="font-bold">Customer use</dt>
                    <dd>{asset.customerAvailable ? "Permitted" : "Withheld by licence policy"}</dd>
                  </div>
                </dl>
              )}

              {editingId === asset.id ? (
                <div className="mt-3 grid gap-2 rounded-xl bg-[#F8F6F1] p-2">
                  <input value={editDraft.title} onChange={(event) => setEditDraft((current) => ({ ...current, title: event.target.value }))} aria-label="Edit display name" className={inputClass} />
                  <div className="grid grid-cols-2 gap-2"><select value={editDraft.assetType} onChange={(event) => setEditDraft((current) => ({ ...current, assetType: event.target.value }))} aria-label="Edit asset type" className={inputClass}>{ASSET_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select><select value={editDraft.categoryId} onChange={(event) => setEditDraft((current) => ({ ...current, categoryId: event.target.value }))} aria-label="Edit category" className={inputClass}><option value="">No category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
                  <select value={editDraft.folderId} onChange={(event) => setEditDraft((current) => ({ ...current, folderId: event.target.value }))} aria-label="Move to folder" className={inputClass}><option value="">Unfiled</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select>
                  <input value={editDraft.tags} onChange={(event) => setEditDraft((current) => ({ ...current, tags: event.target.value }))} placeholder="Tags" aria-label="Edit tags" className={inputClass} />
                  <input value={editDraft.keywords} onChange={(event) => setEditDraft((current) => ({ ...current, keywords: event.target.value }))} placeholder="Search keywords" aria-label="Edit search keywords" className={inputClass} />
                  <div className="flex flex-wrap gap-3 px-1"><label className="flex items-center gap-1.5 text-xs font-bold"><input type="checkbox" checked={editDraft.customerAvailable} onChange={(event) => setEditDraft((current) => ({ ...current, customerAvailable: event.target.checked }))} />Customer</label><label className="flex items-center gap-1.5 text-xs font-bold"><input type="checkbox" checked={editDraft.adminAvailable} onChange={(event) => setEditDraft((current) => ({ ...current, adminAvailable: event.target.checked }))} />Administrator</label></div>
                  <div className="flex gap-2"><button type="button" onClick={() => saveEditing(asset)} className="min-h-10 flex-1 rounded-xl bg-[#303839] text-xs font-bold text-white">Save</button><button type="button" onClick={() => setEditingId("")} className="min-h-10 flex-1 rounded-xl border border-[#303839]/15 text-xs font-bold">Cancel</button></div>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => startEditing(asset)} className="min-h-10 rounded-xl bg-[#F8F6F1] px-3 text-[10px] font-extrabold hover:bg-[#ECE9E1]">Edit</button>
                  <button type="button" onClick={() => previewAsset(asset)} className="min-h-10 rounded-xl bg-[#F8F6F1] px-3 text-[10px] font-extrabold hover:bg-[#ECE9E1]">Preview</button>
                  <button type="button" onClick={() => patchAsset(asset, { archived: !asset.archived }, asset.archived ? "Asset restored." : "Asset archived.")} className="min-h-10 rounded-xl bg-[#F8F6F1] px-3 text-[10px] font-extrabold hover:bg-[#ECE9E1]">{asset.archived ? "Restore" : "Archive"}</button>
                  {asset.archived && <button type="button" onClick={() => deleteAsset(asset)} aria-label={`Delete ${asset.title} permanently`} className="grid h-10 w-10 place-items-center rounded-xl text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg></button>}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
