"use client";

/**
 * The designer workspace.
 *
 * Three things only: see my work, make a product, edit a product. The product
 * editor and the Design Builder are the SAME components the admin uses
 * (`ProductUploadForm` mounts `AdminDesignBuilder` internally), so there is one
 * product editor in the codebase and designs cannot drift between the two
 * surfaces. What differs is the set of actions offered — and every one of those
 * is re-checked on the server.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import ProductUploadForm from "@/app/admin/dashboard/product-upload-form";
import { WORKFLOW_LABELS, designerMayEdit, type WorkflowState } from "@/lib/products/workflow-states";

type DesignerProduct = {
  id: string;
  title: string;
  slug: string;
  thumbnail?: string;
  workflowState?: WorkflowState;
  reviewNote?: string | null;
  submittedAt?: string | null;
  updatedAt?: string | null;
};

const FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "needs_revision", label: "Needs revision" },
  { value: "in_review", label: "In review" },
  { value: "approved", label: "Approved" },
  { value: "published", label: "Published" },
];

/** Colour by state so the queue is readable at a glance. */
const STATE_STYLES: Record<string, string> = {
  draft: "bg-[#F4F4F4] text-[#555]",
  in_review: "bg-[#FFF4D6] text-[#7A5B00]",
  needs_revision: "bg-[#FDE8E8] text-[#8C1F1F]",
  approved: "bg-[#E6F4EA] text-[#1B5E20]",
  published: "bg-[#303839] text-white",
  archived: "bg-[#EEE] text-[#888]",
};

export default function DesignerWorkspaceClient({
  designer,
}: {
  designer: { id: string; name: string; email: string };
}) {
  const [products, setProducts] = useState<DesignerProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<any>(null);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // The server scopes this to the designer's own and assigned products;
      // there is no client-side filter to forget.
      const response = await fetch("/api/admin/products", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(data?.error || "Your products could not be loaded.");
      }
      setProducts(Array.isArray(data.products) ? data.products : []);
    } catch (loadError: any) {
      setError(loadError?.message || "Your products could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () => (filter ? products.filter((product) => (product.workflowState || "draft") === filter) : products),
    [products, filter],
  );

  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const product of products) {
      const state = product.workflowState || "draft";
      result[state] = (result[state] || 0) + 1;
    }
    return result;
  }, [products]);

  const openProduct = (product: DesignerProduct | null) => {
    setNotice("");
    setEditing(product);
    setFormOpen(true);
  };

  const submitForReview = useCallback(
    async (productId: string) => {
      if (!productId) return;
      try {
        const response = await fetch(`/api/admin/products/${encodeURIComponent(productId)}/workflow`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "submit" }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) {
          throw new Error(data?.error || "This product could not be submitted.");
        }
        setNotice("Submitted for review. An administrator will take a look.");
        setFormOpen(false);
        setEditing(null);
        await load();
      } catch (submitError: any) {
        setError(submitError?.message || "This product could not be submitted.");
      }
    },
    [load],
  );

  if (formOpen) {
    const state = (editing?.workflowState || "draft") as WorkflowState;
    const locked = Boolean(editing) && !designerMayEdit(state);
    return (
      <main className="min-h-screen bg-[#F8F6F1] px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-[1400px]">
          <button
            type="button"
            onClick={() => {
              setFormOpen(false);
              setEditing(null);
              void load();
            }}
            className="mb-4 text-sm font-bold text-[#303839] underline"
          >
            ← Back to my products
          </button>

          {editing?.reviewNote ? (
            <div className="mb-4 rounded-[10px] border border-[#8C1F1F]/25 bg-[#FDE8E8] p-4">
              <p className="text-sm font-extrabold text-[#8C1F1F]">Changes requested by an administrator</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-[#5A1414]">{editing.reviewNote}</p>
            </div>
          ) : null}

          {locked ? (
            <div className="rounded-[10px] border border-[#303839]/15 bg-white p-6 text-center">
              <p className="text-base font-extrabold text-[#303839]">
                {state === "in_review" ? "This product is currently under review." : "This product is no longer editable."}
              </p>
              <p className="mt-2 text-sm text-[#303839]/70">
                {state === "in_review"
                  ? "An administrator is reviewing it. You will be able to edit it again if they request changes."
                  : "An administrator has approved or published it. Ask them to return it for revision if it needs changes."}
              </p>
            </div>
          ) : (
            <ProductUploadForm
              key={editing?.id || "new-product"}
              product={editing}
              mode="designer"
              onSubmitForReview={submitForReview}
              onSaved={async (saved: any, message: string) => {
                setNotice(message || "Saved.");
                // Keep the editor open on the saved product so a newly created
                // draft can be designed and submitted without reopening it.
                if (saved?.id) setEditing(saved);
                await load();
              }}
              onClose={() => {
                setFormOpen(false);
                setEditing(null);
                void load();
              }}
            />
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#F8F6F1] px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-[1200px]">
        <header className="flex flex-col gap-3 border-b border-[#303839]/10 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-3xl text-[#303839]">Designer workspace</h1>
            <p className="mt-1 text-sm text-[#303839]/70">
              Signed in as {designer.name} · {designer.email}
            </p>
          </div>
          <button
            type="button"
            onClick={() => openProduct(null)}
            className="rounded-[10px] bg-[#303839] px-5 py-3 text-sm font-extrabold text-white transition hover:bg-[#1f2526]"
          >
            Create product
          </button>
        </header>

        {notice ? (
          <p className="mt-4 rounded-[10px] border border-[#1B5E20]/20 bg-[#E6F4EA] px-4 py-3 text-sm font-bold text-[#1B5E20]">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-[10px] border border-[#8C1F1F]/25 bg-[#FDE8E8] px-4 py-3 text-sm font-bold text-[#8C1F1F]">
            {error}
          </p>
        ) : null}

        <nav aria-label="Filter my products" className="mt-6 flex flex-wrap gap-2">
          {FILTERS.map((option) => (
            <button
              key={option.value || "all"}
              type="button"
              onClick={() => setFilter(option.value)}
              aria-pressed={filter === option.value}
              className={`rounded-full border px-4 py-2 text-xs font-extrabold transition ${
                filter === option.value
                  ? "border-[#303839] bg-[#303839] text-white"
                  : "border-[#303839]/15 bg-white text-[#303839] hover:bg-[#F1EEE7]"
              }`}
            >
              {option.label}
              {option.value && counts[option.value] ? ` (${counts[option.value]})` : ""}
            </button>
          ))}
        </nav>

        <section className="mt-6">
          {loading ? (
            <p className="py-16 text-center text-sm text-[#303839]/60">Loading your products…</p>
          ) : !visible.length ? (
            <div className="rounded-[12px] border border-[#303839]/12 bg-white p-12 text-center">
              <p className="text-base font-extrabold text-[#303839]">
                {products.length ? "Nothing in this view." : "You have not created a product yet."}
              </p>
              <p className="mt-2 text-sm text-[#303839]/70">
                {products.length
                  ? "Try another filter."
                  : "Create a product, design it, then submit it for review."}
              </p>
            </div>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((product) => {
                const state = (product.workflowState || "draft") as WorkflowState;
                const editable = designerMayEdit(state);
                return (
                  <li
                    key={product.id}
                    className="flex flex-col overflow-hidden rounded-[12px] border border-[#303839]/12 bg-white"
                  >
                    <div className="aspect-[4/3] w-full overflow-hidden bg-[#F1EEE7]">
                      {product.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.thumbnail} alt="" className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                    <div className="flex flex-1 flex-col gap-3 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-extrabold text-[#303839]">{product.title || "Untitled"}</p>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide ${
                            STATE_STYLES[state] || STATE_STYLES.draft
                          }`}
                        >
                          {WORKFLOW_LABELS[state] || state}
                        </span>
                      </div>

                      {state === "needs_revision" && product.reviewNote ? (
                        <p className="line-clamp-3 rounded-[8px] bg-[#FDE8E8] p-2 text-xs text-[#8C1F1F]">
                          {product.reviewNote}
                        </p>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => openProduct(product)}
                        className="mt-auto rounded-[8px] border border-[#303839]/20 px-4 py-2 text-xs font-extrabold text-[#303839] transition hover:bg-[#F1EEE7]"
                      >
                        {editable ? "Edit & design" : "View"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
