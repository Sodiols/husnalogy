"use client";

import { useEffect, useState } from "react";
import Hero from "../../components/hero";

// Admin → Home Hero. Manages the `hero_collections` records that drive the
// homepage "Wedding Suite" section. Self-contained: fetches its own data,
// handles validation, loading/empty/error states, and a live preview that
// reuses the real <Hero> component so what you see is what publishes.
//
// Images are NOT uploaded here — they come from a linked product collection:
// the collection's first child supplies the main image, the next three children
// supply the thumbnails (falling back to the collection's product images).

const EMPTY_FORM = {
  title: "The Wedding Suite",
  slug: "",
  seasonLabel: "Wedding Season 2026",
  collectionLabel: "NEW COLLECTION",
  headingLineOne: "The Wedding",
  headingLineTwo: "Suite",
  description:
    "Invitations, RSVP cards, menus and keepsakes, designed as one considered set and personalized with your names. Order the pieces you love, or take the whole suite.",
  sourceCollectionId: "",
  isActive: false,
  isFeatured: false,
};

export default function HeroCollectionSection({ onAction }: { onAction?: (message: string) => void }) {
  const [collections, setCollections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [productCollections, setProductCollections] = useState<any[]>([]);

  const [form, setForm] = useState<any>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [resolved, setResolved] = useState<any>(null);
  const [resolving, setResolving] = useState(false);
  const [showPreview, setShowPreview] = useState(true);

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/admin/hero-collections", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Hero collections could not be loaded.");
      setCollections(Array.isArray(data.collections) ? data.collections : []);
    } catch (err: any) {
      setLoadError(err?.message || "Hero collections could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  async function loadProductCollections() {
    try {
      const response = await fetch("/api/admin/collections", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (response.ok && Array.isArray(data.collections)) setProductCollections(data.collections);
    } catch {
      /* Non-fatal: the selector simply shows no collections. */
    }
  }

  useEffect(() => {
    load();
    loadProductCollections();
  }, []);

  // Resolve images whenever the chosen source collection changes.
  useEffect(() => {
    if (!formOpen || !form.sourceCollectionId) {
      setResolved(null);
      return;
    }
    let active = true;
    setResolving(true);
    (async () => {
      try {
        const response = await fetch(`/api/admin/hero-collections/resolve?collectionId=${encodeURIComponent(form.sourceCollectionId)}`, {
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        if (active) setResolved(response.ok ? data.resolved : null);
      } catch {
        if (active) setResolved(null);
      } finally {
        if (active) setResolving(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [form.sourceCollectionId, formOpen]);

  function setField(key: string, value: any) {
    setForm((current: any) => ({ ...current, [key]: value }));
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFieldErrors({});
    setError("");
    setResolved(null);
    setFormOpen(true);
  }

  function openEdit(collection: any) {
    setForm({ ...EMPTY_FORM, ...collection });
    setEditingId(collection.id);
    setFieldErrors({});
    setError("");
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setError("");
    setResolved(null);
  }

  // Client-side mirror of the server publish rules for immediate feedback.
  function validate(next: any) {
    const errors: Record<string, string> = {};
    if (!String(next.title || "").trim()) errors.title = "Collection title is required.";
    if (next.isActive) {
      if (!String(next.headingLineOne || "").trim() && !String(next.headingLineTwo || "").trim()) {
        errors.heading = "Add at least one heading line before publishing.";
      }
      if (!next.sourceCollectionId) errors.sourceCollectionId = "Select a source collection before publishing.";
    }
    return errors;
  }

  async function submit() {
    const errors = validate(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setError("Please fix the highlighted fields before saving.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const method = editingId ? "PATCH" : "POST";
      const payload = editingId ? { ...form, id: editingId } : form;
      const response = await fetch("/api/admin/hero-collections", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFieldErrors(data?.errors || {});
        throw new Error(data?.errors ? "Please fix the highlighted fields." : "Collection could not be saved.");
      }
      onAction?.(editingId ? "Hero collection updated." : "Hero collection created.");
      closeForm();
      await load();
    } catch (err: any) {
      setError(err?.message || "Collection could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function quickUpdate(collection: any, changes: any, successMessage: string) {
    try {
      const response = await fetch("/api/admin/hero-collections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...collection, ...changes, id: collection.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = data?.errors ? Object.values(data.errors)[0] : "Update failed.";
        setLoadError(String(message));
        return;
      }
      onAction?.(successMessage);
      await load();
    } catch {
      setLoadError("Update failed.");
    }
  }

  async function remove(collection: any) {
    if (typeof window !== "undefined" && !window.confirm(`Delete "${collection.title}"? This cannot be undone.`)) return;
    try {
      const response = await fetch("/api/admin/hero-collections", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: collection.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.errors?.collection || "Delete failed.");
      onAction?.("Hero collection deleted.");
      await load();
    } catch (err: any) {
      setLoadError(err?.message || "Delete failed.");
    }
  }

  const previewReady = Boolean(resolved?.mainImage);
  const previewCollection = previewReady
    ? {
        ...form,
        sourceCollectionName: resolved.collectionName,
        mainImage: resolved.mainImage,
        mainImageHref: resolved.mainImageHref,
        thumbnailOne: resolved.thumbnailOne,
        thumbnailOneHref: resolved.thumbnailOneHref,
        thumbnailTwo: resolved.thumbnailTwo,
        thumbnailTwoHref: resolved.thumbnailTwoHref,
        thumbnailThree: resolved.thumbnailThree,
        thumbnailThreeHref: resolved.thumbnailThreeHref,
        itemCount: resolved.itemCount,
        primaryButtonText: "Browse all collections",
        primaryButtonUrl: "/collections",
        secondaryLinkText: "Buy this collection",
        secondaryLinkUrl: resolved.collectionUrl,
      }
    : null;

  function collectionName(id: string) {
    return productCollections.find((c) => c.id === id)?.name || "";
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-body text-[1.5rem] font-semibold leading-none text-[#111111]">Home Hero Collection</h2>
          <p className="mt-2 max-w-2xl text-sm text-[#1F1F1F]/60">
            The homepage shows the collection that is both <strong>Active</strong> and <strong>Featured</strong>. Featuring
            a collection automatically unfeatures the previous one. Images, product links, item count and buttons are
            generated from the linked collection.
          </p>
        </div>
        {!formOpen && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center justify-center rounded-full bg-[#111111] px-5 py-3 text-sm font-bold text-white transition hover:bg-black"
          >
            Add Collection
          </button>
        )}
      </div>

      {loadError && (
        <p className="rounded-none border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{loadError}</p>
      )}

      {formOpen && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
          {/* FORM */}
          <div className="rounded-none border border-[#111111]/10 bg-white p-5 shadow-[0_18px_60px_-52px_rgba(0,0,0,0.7)] sm:p-6">
            <div className="mb-5 flex items-center justify-between border-b border-[#111111]/8 pb-4">
              <h3 className="font-body text-lg font-semibold text-[#111111]">
                {editingId ? "Edit collection" : "New collection"}
              </h3>
              <button type="button" onClick={closeForm} className="text-sm font-bold text-[#1F1F1F]/60 hover:text-[#1F1F1F]">
                Cancel
              </button>
            </div>

            {error && (
              <p className="mb-4 rounded-none border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                {error}
              </p>
            )}

            <div className="space-y-5">
              {/* Source collection — drives all imagery */}
              <div>
                <label className="block text-sm font-semibold text-[#1F1F1F]">
                  <span className="text-xs font-bold uppercase tracking-[0.1em] text-[#1F1F1F]/55">Source collection</span>
                  <select
                    value={form.sourceCollectionId || ""}
                    onChange={(event) => setField("sourceCollectionId", event.target.value)}
                    className="mt-1.5 h-11 w-full border border-[#1F1F1F]/12 bg-white px-3 text-sm font-semibold text-[#1F1F1F] outline-none transition hover:border-[#1F1F1F]/20 focus:border-[#1F1F1F]/40 focus:ring-2 focus:ring-[#1F1F1F]/10"
                  >
                    <option value="">Select a collection…</option>
                    {productCollections.map((collection) => (
                      <option key={collection.id} value={collection.id}>
                        {collection.name}
                        {collection.parentCollectionId ? " (sub-collection)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {fieldErrors.sourceCollectionId && (
                  <p className="mt-1 text-xs font-semibold text-red-700">{fieldErrors.sourceCollectionId}</p>
                )}
                <p className="mt-1.5 text-xs text-[#1F1F1F]/55">
                  The main image comes from this collection&apos;s 1st child collection, and the three thumbnails from
                  the 2nd, 3rd and 4th. Each image opens the exact product shown.
                </p>

                {form.sourceCollectionId && (
                  <div className="mt-3 rounded-none border border-[#1F1F1F]/10 bg-[#F8F8F8] p-3">
                    {resolving ? (
                      <p className="text-xs font-semibold text-[#1F1F1F]/55">Loading collection images…</p>
                    ) : resolved?.mainImage ? (
                      <>
                        <div className="flex items-stretch gap-2">
                          {/* eslint-disable @next/next/no-img-element */}
                          <img src={resolved.mainImage} alt="Main" className="h-20 w-20 shrink-0 border border-[#1F1F1F]/10 object-cover" />
                          <img src={resolved.thumbnailOne} alt="" className="h-20 w-16 border border-[#1F1F1F]/10 object-cover" />
                          <img src={resolved.thumbnailTwo} alt="" className="h-20 w-16 border border-[#1F1F1F]/10 object-cover" />
                          <img src={resolved.thumbnailThree} alt="" className="h-20 w-16 border border-[#1F1F1F]/10 object-cover" />
                          {/* eslint-enable @next/next/no-img-element */}
                        </div>
                        <p className="mt-2 text-xs text-[#1F1F1F]/55">
                          {resolved.childCount} child collection{resolved.childCount === 1 ? "" : "s"} ·{" "}
                          {resolved.productCount} product{resolved.productCount === 1 ? "" : "s"}
                          {" · "}{resolved.itemCount} item{resolved.itemCount === 1 ? "" : "s"} in the badge
                          {resolved.childCount < 4 && " · fewer than 4 children, so product images fill the rest"}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs font-semibold text-amber-700">
                        This collection has no images yet. Add child collections or products with images.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <FieldGroup label="Labels">
                <Field label="Season label" value={form.seasonLabel} onChange={(v) => setField("seasonLabel", v)} placeholder="Wedding Season 2026" />
                <Field label="Collection label" value={form.collectionLabel} onChange={(v) => setField("collectionLabel", v)} placeholder="NEW COLLECTION" />
              </FieldGroup>

              <FieldGroup label="Heading (two lines)">
                <Field label="Heading line one" value={form.headingLineOne} onChange={(v) => setField("headingLineOne", v)} placeholder="The Wedding" error={fieldErrors.heading} />
                <Field label="Heading line two" value={form.headingLineTwo} onChange={(v) => setField("headingLineTwo", v)} placeholder="Suite" />
              </FieldGroup>

              <TextAreaField label="Description" value={form.description} onChange={(v) => setField("description", v)} />

              <div className="border border-[#1F1F1F]/10 bg-[#F8F8F8] px-4 py-3 text-xs leading-5 text-[#1F1F1F]/60">
                Buttons are automatic: <strong className="text-[#1F1F1F]">Browse all collections</strong> opens the
                collections index, and <strong className="text-[#1F1F1F]">Buy this collection</strong> opens the selected collection.
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Toggle label="Active (published)" checked={form.isActive} onChange={(v) => setField("isActive", v)} />
                <Toggle label="Featured on homepage" checked={form.isFeatured} onChange={(v) => setField("isFeatured", v)} />
              </div>
              {fieldErrors.title && <p className="text-xs font-semibold text-red-700">{fieldErrors.title}</p>}

              <div className="flex flex-wrap items-center gap-3 border-t border-[#111111]/8 pt-5">
                <button
                  type="button"
                  onClick={submit}
                  disabled={saving}
                  className="inline-flex items-center justify-center rounded-full bg-[#111111] px-5 py-3 text-sm font-bold text-white transition hover:bg-black disabled:opacity-60"
                >
                  {saving ? "Saving..." : editingId ? "Save changes" : "Create collection"}
                </button>
                <button type="button" onClick={closeForm} className="text-sm font-bold text-[#1F1F1F]/60 hover:text-[#1F1F1F]">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => setShowPreview((v) => !v)}
                  className="ml-auto text-sm font-bold text-[#1F1F1F]/60 hover:text-[#1F1F1F] xl:hidden"
                >
                  {showPreview ? "Hide preview" : "Show preview"}
                </button>
              </div>
            </div>
          </div>

          {/* LIVE PREVIEW — renders the exact homepage component */}
          {showPreview && (
            <div className="rounded-none border border-[#111111]/10 bg-white p-4 shadow-[0_18px_60px_-52px_rgba(0,0,0,0.7)]">
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-[#1F1F1F]/55">Live preview</p>
              {previewReady ? (
                <div className="overflow-hidden rounded-none border border-[#111111]/8">
                  <Hero collection={previewCollection} />
                </div>
              ) : (
                <div className="grid h-64 place-items-center rounded-none border border-dashed border-[#111111]/15 bg-[#F8F6F1] px-6 text-center text-sm font-semibold text-[#1F1F1F]/50">
                  Select a source collection that has child collections or product images to preview the section.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* LIST */}
      {loading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-none border border-[#111111]/10 bg-[#F4F4F4]" />
          ))}
        </div>
      ) : collections.length === 0 && !formOpen ? (
        <div className="rounded-none border border-dashed border-[#111111]/15 bg-[#F8F8F8] p-8 text-center">
          <p className="text-sm font-semibold text-[#1F1F1F]/70">No hero collections yet.</p>
          <p className="mt-1 text-sm text-[#1F1F1F]/50">Create one, link a collection, and mark it Active + Featured to show it on the homepage.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {collections.map((collection) => {
            const live = collection.isActive && collection.isFeatured;
            return (
              <div
                key={collection.id}
                className={`flex flex-wrap items-center gap-4 rounded-none border p-4 ${live ? "border-[#111111]/30 bg-white" : "border-[#111111]/10 bg-[#F8F8F8]"}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-bold text-[#1F1F1F]">{collection.title || "Untitled"}</p>
                    <Badge active={collection.isActive}>{collection.isActive ? "Active" : "Draft"}</Badge>
                    {collection.isFeatured && <Badge active>Featured</Badge>}
                    {live && <Badge active>On homepage</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-[#1F1F1F]/55">
                    {collectionName(collection.sourceCollectionId) ? `From: ${collectionName(collection.sourceCollectionId)}` : "No source collection"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <SmallButton onClick={() => quickUpdate(collection, { isActive: !collection.isActive }, collection.isActive ? "Unpublished." : "Published.")}>
                    {collection.isActive ? "Unpublish" : "Publish"}
                  </SmallButton>
                  <SmallButton onClick={() => quickUpdate(collection, { isFeatured: !collection.isFeatured }, collection.isFeatured ? "Removed featured." : "Marked featured.")}>
                    {collection.isFeatured ? "Unfeature" : "Feature"}
                  </SmallButton>
                  <SmallButton onClick={() => openEdit(collection)}>Edit</SmallButton>
                  <SmallButton danger onClick={() => remove(collection)}>Delete</SmallButton>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FieldGroup({ label, children }: any) {
  return (
    <div>
      <p className="mb-2 text-sm font-bold text-[#1F1F1F]">{label}</p>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder = "", helper = "", error = "" }: any) {
  return (
    <label className="block text-sm font-semibold text-[#1F1F1F]">
      <span className="text-xs font-bold uppercase tracking-[0.1em] text-[#1F1F1F]/55">{label}</span>
      <input
        type={type}
        value={value ?? ""}
        onChange={(event) => onChange(type === "number" ? Number(event.target.value) : event.target.value)}
        placeholder={placeholder}
        className="mt-1.5 h-11 w-full rounded-none border border-[#1F1F1F]/12 bg-white px-3 text-sm font-semibold text-[#1F1F1F] outline-none transition hover:border-[#1F1F1F]/20 focus:border-[#1F1F1F]/40 focus:ring-2 focus:ring-[#1F1F1F]/10"
      />
      {error && <span className="mt-1 block text-xs font-semibold text-red-700">{error}</span>}
      {helper && !error && <span className="mt-1 block text-xs font-normal text-[#1F1F1F]/50">{helper}</span>}
    </label>
  );
}

function TextAreaField({ label, value, onChange }: any) {
  return (
    <label className="block text-sm font-semibold text-[#1F1F1F]">
      <span className="text-xs font-bold uppercase tracking-[0.1em] text-[#1F1F1F]/55">{label}</span>
      <textarea
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 min-h-24 w-full rounded-none border border-[#1F1F1F]/12 bg-white p-3 text-sm font-medium leading-6 text-[#1F1F1F] outline-none transition hover:border-[#1F1F1F]/20 focus:border-[#1F1F1F]/40 focus:ring-2 focus:ring-[#1F1F1F]/10"
      />
    </label>
  );
}

function Toggle({ label, checked, onChange }: any) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-none border border-[#1F1F1F]/10 bg-[#F8F8F8] px-4 py-3 text-sm">
      <span className="font-bold text-[#1F1F1F]">{label}</span>
      <button
        type="button"
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
        className={`h-7 w-12 shrink-0 rounded-none p-1 transition ${checked ? "bg-[#111111]" : "bg-[#1F1F1F]/14"}`}
      >
        <span className={`block h-5 w-5 rounded-none bg-white transition ${checked ? "translate-x-5" : ""}`} />
      </button>
    </div>
  );
}

function Badge({ active, children }: any) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${
        active ? "bg-[#111111] text-white" : "bg-[#1F1F1F]/10 text-[#1F1F1F]/70"
      }`}
    >
      {children}
    </span>
  );
}

function SmallButton({ children, onClick, danger = false }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
        danger
          ? "border-red-200 text-red-700 hover:bg-red-50"
          : "border-[#1F1F1F]/15 text-[#1F1F1F] hover:bg-[#E6E6E6]"
      }`}
    >
      {children}
    </button>
  );
}
