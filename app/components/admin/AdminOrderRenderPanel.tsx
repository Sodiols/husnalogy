"use client";

// Admin render monitoring for a personalized order (spec §11, §12, §32).
//
// Shows, per customized item, the frozen design snapshot and the live state of
// its production files, plus the recovery actions. Private storage paths never
// reach this component — the API returns short-lived signed URLs only.

import { useCallback, useEffect, useState } from "react";

type RenderJobState = {
  id?: string;
  status: string;
  attemptCount: number;
  errorCode?: string;
  errorMessage?: string;
  completedAt?: string;
  lastAttemptAt?: string;
};

type SnapshotRow = {
  id: string;
  orderItemId: string;
  customizationId: string;
  productTitle: string;
  quantity: number;
  templateVersion: number;
  templateVersionId: string;
  renderStatus: string;
  renderErrorCode: string;
  renderErrorMessage: string;
  renderAttemptCount: number;
  lastRenderAttemptAt: string;
  renderQueuedAt: string;
  manualReviewNote: string;
  integrityHash: string;
  integrityVerified: boolean | null;
  preflightStatus: string;
  preflightIssues: Array<{ severity?: string; code?: string; message?: string }>;
  printFiles: Record<string, { signedUrl?: string; format?: string; checksum?: string; available?: boolean }>;
  createdAt: string;
  render: { png: RenderJobState; pdf: RenderJobState };
};

const OK_STATUSES = new Set(["completed", "not_required"]);
const ATTENTION_STATUSES = new Set(["failed", "queue_failed", "attention_required"]);

function formatDateTime(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
}

function StatusPill({ status }: { status: string }) {
  const attention = ATTENTION_STATUSES.has(status);
  const done = OK_STATUSES.has(status);
  // Never colour alone: the label always carries the meaning (spec §48).
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] ${
        attention
          ? "border border-red-300 bg-red-50 text-red-800"
          : done
            ? "border border-[#D6D8D8] bg-[#FAF7F7] text-[#303839]"
            : "border border-[#E9E4E1] bg-white text-[#596061]"
      }`}
    >
      {attention ? "⚠ " : done ? "✓ " : "• "}
      {status.replace(/_/g, " ")}
    </span>
  );
}

export default function AdminOrderRenderPanel({ orderId }: { orderId: string }) {
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/customizer/orders/${encodeURIComponent(orderId)}/snapshots?document=1`,
        { cache: "no-store" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data?.error || "Could not load design data.");
      setSnapshots(data.snapshots || []);
    } catch (loadError: any) {
      setError(loadError?.message || "Could not load design data.");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async (label: string, body: Record<string, unknown>) => {
    setBusyAction(label);
    setError("");
    try {
      const response = await fetch("/api/admin/customizer/render/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data?.error || "The action did not complete.");
      await load();
    } catch (actionError: any) {
      setError(actionError?.message || "The action did not complete.");
    } finally {
      setBusyAction("");
    }
  };

  if (!snapshots.length && !loading && !error) return null;

  const attentionCount = snapshots.filter(
    (snapshot) => ATTENTION_STATUSES.has(snapshot.renderStatus) || snapshot.integrityVerified === false,
  ).length;

  return (
    <section className="rounded-none border border-[#E9E4E1] bg-white p-4" aria-label="Production files">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-bold text-[#303839]">Production files</p>
          <p className="mt-1 text-xs text-[#596061]">
            The exact frozen design the customer approved, and the state of its print files.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {attentionCount > 0 && (
            <span className="rounded-full border border-red-300 bg-red-50 px-3 py-1 text-[11px] font-bold text-red-800">
              ⚠ {attentionCount} need attention
            </span>
          )}
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-full border border-[#D6D8D8] px-4 py-2 text-xs font-bold text-[#303839] transition hover:bg-[#FAF7F7] disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-none border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-800" role="alert">
          {error}
        </p>
      )}

      <div className="mt-4 grid gap-4">
        {snapshots.map((snapshot) => {
          const files = Object.entries(snapshot.printFiles || {});
          return (
            <article key={snapshot.id} className="rounded-none border border-[#E9E4E1] p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-bold text-[#303839]">{snapshot.productTitle || "Personalized item"}</p>
                  <p className="mt-1 text-xs text-[#596061]">
                    Qty {snapshot.quantity} · Template v{snapshot.templateVersion} · Snapshot {formatDateTime(snapshot.createdAt)}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-[#596061]">design {snapshot.customizationId}</p>
                </div>
                <StatusPill status={snapshot.renderStatus} />
              </div>

              {snapshot.integrityVerified === false && (
                <p className="mt-3 border border-red-300 bg-red-50 p-2 text-xs font-bold text-red-800" role="alert">
                  ⚠ This snapshot no longer matches its integrity hash. Do not send it to production — investigate before printing.
                </p>
              )}

              <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-[#596061]">Preflight</dt>
                  <dd className="font-semibold text-[#303839]">
                    {snapshot.preflightStatus}
                    {snapshot.preflightIssues.length ? ` · ${snapshot.preflightIssues.length} issue(s)` : ""}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-[#596061]">Integrity</dt>
                  <dd className="font-semibold text-[#303839]">
                    {snapshot.integrityVerified === null ? "not checked" : snapshot.integrityVerified ? "verified" : "MISMATCH"}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-[#596061]">PNG</dt>
                  <dd className="font-semibold text-[#303839]">
                    {snapshot.render.png.status} · {snapshot.render.png.attemptCount} attempt(s)
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-[#596061]">PDF</dt>
                  <dd className="font-semibold text-[#303839]">
                    {snapshot.render.pdf.status} · {snapshot.render.pdf.attemptCount} attempt(s)
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-[#596061]">Last attempt</dt>
                  <dd className="font-semibold text-[#303839]">{formatDateTime(snapshot.lastRenderAttemptAt)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-[#596061]">Queued</dt>
                  <dd className="font-semibold text-[#303839]">{formatDateTime(snapshot.renderQueuedAt)}</dd>
                </div>
              </dl>

              {(snapshot.renderErrorCode || snapshot.render.png.errorCode || snapshot.render.pdf.errorCode) && (
                <p className="mt-2 break-words border border-[#E9E4E1] bg-[#FAF7F7] p-2 font-mono text-[11px] text-[#596061]">
                  {snapshot.renderErrorCode || snapshot.render.png.errorCode || snapshot.render.pdf.errorCode}
                  {": "}
                  {snapshot.renderErrorMessage || snapshot.render.png.errorMessage || snapshot.render.pdf.errorMessage}
                </p>
              )}

              {!!snapshot.preflightIssues.length && (
                <ul className="mt-2 list-disc pl-5 text-xs text-[#596061]">
                  {snapshot.preflightIssues.slice(0, 6).map((issue, index) => (
                    <li key={`${issue.code}-${index}`}>
                      <span className="font-bold">{issue.severity === "error" ? "Error" : "Warning"}:</span> {issue.message}
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {files.map(([pageId, file]) => (
                  <a
                    key={pageId}
                    href={file.signedUrl || "#"}
                    target="_blank"
                    rel="noreferrer"
                    aria-disabled={!file.signedUrl}
                    className={`rounded-full border px-3 py-2 text-xs font-bold ${
                      file.signedUrl
                        ? "border-[#303839] text-[#303839] hover:bg-[#FAF7F7]"
                        : "pointer-events-none border-[#E9E4E1] text-[#596061] opacity-60"
                    }`}
                  >
                    Download {pageId} ({file.format || "file"})
                  </a>
                ))}

                <button
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={() => runAction(`retry-${snapshot.id}`, { snapshotId: snapshot.id })}
                  className="rounded-full bg-[#303839] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#414b4c] disabled:opacity-50"
                >
                  {busyAction === `retry-${snapshot.id}` ? "Retrying…" : "Retry render"}
                </button>
                <button
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={() => runAction(`png-${snapshot.id}`, { snapshotId: snapshot.id, jobTypes: ["print_png"] })}
                  className="rounded-full border border-[#D6D8D8] px-4 py-2 text-xs font-bold text-[#303839] transition hover:bg-[#FAF7F7] disabled:opacity-50"
                >
                  Queue PNG
                </button>
                <button
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={() => runAction(`pdf-${snapshot.id}`, { snapshotId: snapshot.id, jobTypes: ["print_pdf"] })}
                  className="rounded-full border border-[#D6D8D8] px-4 py-2 text-xs font-bold text-[#303839] transition hover:bg-[#FAF7F7] disabled:opacity-50"
                >
                  Queue PDF
                </button>
                <button
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={() => runAction(`review-${snapshot.id}`, { snapshotId: snapshot.id, markForReview: true })}
                  className="rounded-full border border-[#D4AF37] px-4 py-2 text-xs font-bold text-[#303839] transition hover:bg-[#FAF7F7] disabled:opacity-50"
                >
                  Mark for manual review
                </button>
              </div>

              {snapshot.manualReviewNote && (
                <p className="mt-2 text-xs text-[#596061]">Review note: {snapshot.manualReviewNote}</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
