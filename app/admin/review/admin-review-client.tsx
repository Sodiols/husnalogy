"use client";

/**
 * Admin review queue.
 *
 * Every action here is a request to an endpoint that re-decides the permission
 * server side — this screen is the workflow's front door, never its authority.
 * Publishing in particular reuses the existing endpoints unchanged, so the
 * immutable-version architecture is untouched:
 *
 *   Publish design   POST /api/admin/customizer/templates/[id]/publish
 *   Publish product  POST /api/admin/products/[id]/workflow { action: "publish" }
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { WORKFLOW_LABELS, type WorkflowState } from "@/lib/products/workflow-states";

type ReviewProduct = {
  id: string;
  title: string;
  slug: string;
  thumbnail?: string;
  price?: number;
  category?: string;
  workflowState?: WorkflowState;
  reviewNote?: string | null;
  submittedAt?: string | null;
  createdBy?: string | null;
  assignedDesignerId?: string | null;
};

const QUEUES: Array<{ value: WorkflowState | "all"; label: string }> = [
  { value: "in_review", label: "Awaiting review" },
  { value: "needs_revision", label: "With the designer" },
  { value: "approved", label: "Approved" },
  { value: "published", label: "Published" },
  { value: "all", label: "All" },
];

export default function AdminReviewClient() {
  const [products, setProducts] = useState<ReviewProduct[]>([]);
  const [designers, setDesigners] = useState<Record<string, string>>({});
  const [queue, setQueue] = useState<WorkflowState | "all">("in_review");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/products", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data?.error || "Could not load products.");
      setProducts(Array.isArray(data.products) ? data.products : []);
    } catch (loadError: any) {
      setError(loadError?.message || "Could not load products.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Designer names for the queue. Best-effort: the queue is still usable if the
  // lookup is unavailable, it just shows the raw id.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/admin/designers", { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (cancelled || !response.ok || data.ok === false) return;
        const map: Record<string, string> = {};
        for (const person of data.designers || []) map[person.id] = person.name || person.email || person.id;
        setDesigners(map);
      } catch {
        /* names are cosmetic */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(
    () =>
      queue === "all"
        ? products
        : products.filter((product) => (product.workflowState || "draft") === queue),
    [products, queue],
  );

  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const product of products) {
      const state = product.workflowState || "draft";
      result[state] = (result[state] || 0) + 1;
    }
    return result;
  }, [products]);

  const act = useCallback(
    async (product: ReviewProduct, action: string, note?: string) => {
      setBusy(`${product.id}:${action}`);
      setError("");
      setNotice("");
      try {
        const response = await fetch(`/api/admin/products/${encodeURIComponent(product.id)}/workflow`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, note }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) throw new Error(data?.error || "That action could not be completed.");
        setNotice(`${product.title}: ${WORKFLOW_LABELS[data.workflowState as WorkflowState] || data.workflowState}.`);
        await load();
      } catch (actionError: any) {
        setError(actionError?.message || "That action could not be completed.");
      } finally {
        setBusy("");
      }
    },
    [load],
  );

  const publishDesign = useCallback(
    async (product: ReviewProduct) => {
      setBusy(`${product.id}:design`);
      setError("");
      setNotice("");
      try {
        const response = await fetch(
          `/api/admin/customizer/templates/${encodeURIComponent(product.id)}/publish`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) {
          // Publishing runs the document validator; surface its reasons rather
          // than a generic failure so the admin knows what to send back.
          const reasons = Array.isArray(data?.errors) ? data.errors.join(" ") : data?.error;
          throw new Error(reasons || "The design could not be published.");
        }
        setNotice(`Design published as version ${data?.version?.display ?? "?"}.`);
      } catch (publishError: any) {
        setError(publishError?.message || "The design could not be published.");
      } finally {
        setBusy("");
      }
    },
    [],
  );

  return (
    <main className="min-h-screen bg-[#F8F6F1] px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-[1200px]">
        <header className="flex flex-col gap-3 border-b border-[#303839]/10 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-3xl text-[#303839]">Review queue</h1>
            <p className="mt-1 text-sm text-[#303839]/70">Designer submissions waiting on you.</p>
          </div>
          <a href="/admin/dashboard" className="text-sm font-bold text-[#303839] underline">
            ← Admin dashboard
          </a>
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

        <nav aria-label="Review queues" className="mt-6 flex flex-wrap gap-2">
          {QUEUES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setQueue(option.value)}
              aria-pressed={queue === option.value}
              className={`rounded-full border px-4 py-2 text-xs font-extrabold transition ${
                queue === option.value
                  ? "border-[#303839] bg-[#303839] text-white"
                  : "border-[#303839]/15 bg-white text-[#303839] hover:bg-[#F1EEE7]"
              }`}
            >
              {option.label}
              {option.value !== "all" && counts[option.value] ? ` (${counts[option.value]})` : ""}
            </button>
          ))}
        </nav>

        <section className="mt-6 space-y-4">
          {loading ? (
            <p className="py-16 text-center text-sm text-[#303839]/60">Loading…</p>
          ) : !visible.length ? (
            <div className="rounded-[12px] border border-[#303839]/12 bg-white p-12 text-center">
              <p className="text-base font-extrabold text-[#303839]">Nothing here right now.</p>
            </div>
          ) : (
            visible.map((product) => {
              const state = (product.workflowState || "draft") as WorkflowState;
              const owner = product.assignedDesignerId || product.createdBy || "";
              const isBusy = busy.startsWith(`${product.id}:`);
              return (
                <article
                  key={product.id}
                  className="rounded-[12px] border border-[#303839]/12 bg-white p-5"
                >
                  <div className="flex flex-col gap-4 sm:flex-row">
                    <div className="h-28 w-28 shrink-0 overflow-hidden rounded-[8px] bg-[#F1EEE7]">
                      {product.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.thumbnail} alt="" className="h-full w-full object-cover" />
                      ) : null}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-extrabold text-[#303839]">{product.title || "Untitled"}</h2>
                        <span className="rounded-full bg-[#F4F4F4] px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-[#555]">
                          {WORKFLOW_LABELS[state] || state}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[#303839]/70">
                        Designer: {owner ? designers[owner] || owner : "—"}
                        {product.category ? ` · ${product.category}` : ""}
                        {product.submittedAt ? ` · submitted ${new Date(product.submittedAt).toLocaleString()}` : ""}
                      </p>

                      {product.reviewNote ? (
                        <p className="mt-2 rounded-[8px] bg-[#FDE8E8] p-2 text-xs text-[#8C1F1F]">
                          Last note: {product.reviewNote}
                        </p>
                      ) : null}

                      <div className="mt-3 flex flex-wrap gap-3 text-xs font-bold">
                        <a href={`/products/${product.slug}`} target="_blank" rel="noreferrer" className="underline">
                          Preview product page
                        </a>
                        <a
                          href={`/products/${product.slug}/personalize`}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                        >
                          Preview published customizer
                        </a>
                      </div>

                      {state === "in_review" || state === "approved" ? (
                        <div className="mt-4 space-y-3">
                          <textarea
                            value={noteDraft[product.id] || ""}
                            onChange={(event) =>
                              setNoteDraft((current) => ({ ...current, [product.id]: event.target.value }))
                            }
                            placeholder="What should the designer change? (sent with Request revision)"
                            rows={2}
                            className="w-full rounded-[8px] border border-[#303839]/20 p-2 text-sm"
                          />
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => act(product, "request_revision", noteDraft[product.id] || "")}
                              className="rounded-[8px] border border-[#8C1F1F]/30 px-4 py-2 text-xs font-extrabold text-[#8C1F1F] transition hover:bg-[#FDE8E8] disabled:opacity-50"
                            >
                              Request revision
                            </button>
                            {state === "in_review" ? (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => act(product, "approve", noteDraft[product.id] || "")}
                                className="rounded-[8px] border border-[#1B5E20]/30 px-4 py-2 text-xs font-extrabold text-[#1B5E20] transition hover:bg-[#E6F4EA] disabled:opacity-50"
                              >
                                Approve
                              </button>
                            ) : null}
                            {state === "approved" ? (
                              <>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => publishDesign(product)}
                                  className="rounded-[8px] border border-[#303839]/25 px-4 py-2 text-xs font-extrabold text-[#303839] transition hover:bg-[#F1EEE7] disabled:opacity-50"
                                >
                                  Publish design version
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => act(product, "publish")}
                                  className="rounded-[8px] bg-[#303839] px-4 py-2 text-xs font-extrabold text-white transition hover:bg-[#1f2526] disabled:opacity-50"
                                >
                                  Publish product
                                </button>
                              </>
                            ) : null}
                          </div>
                          {state === "approved" ? (
                            <p className="text-[11px] text-[#303839]/60">
                              Publish the design version first — customers only ever receive published versions, so a
                              product published without one has nothing to personalize.
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      {state === "published" ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => publishDesign(product)}
                            className="rounded-[8px] border border-[#303839]/25 px-4 py-2 text-xs font-extrabold text-[#303839] transition hover:bg-[#F1EEE7] disabled:opacity-50"
                          >
                            Publish updated design version
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => act(product, "request_revision", noteDraft[product.id] || "")}
                            className="rounded-[8px] border border-[#8C1F1F]/30 px-4 py-2 text-xs font-extrabold text-[#8C1F1F] transition hover:bg-[#FDE8E8] disabled:opacity-50"
                          >
                            Send back to designer
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}
