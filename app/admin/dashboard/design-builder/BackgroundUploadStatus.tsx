"use client";

import type { BackgroundUploadState } from "./use-background-upload";

/** Progress, processing and failure (with Retry) of a page-background upload. */
export default function BackgroundUploadStatus({
  state,
  onRetry,
  onDismiss,
}: {
  state: BackgroundUploadState;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  if (state.status === "idle") return null;
  if (state.status === "failed") {
    return (
      <div role="alert" data-background-upload="failed" data-failure-kind={state.failure.kind} className="grid gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-[12px] text-red-800">
        <p className="font-semibold leading-snug">
          {state.fileName ? <span className="break-all">{state.fileName}: </span> : null}
          {state.failure.message}
        </p>
        <p className="leading-snug text-red-800/80">The current background was not changed.</p>
        <div className="flex gap-3">
          {state.failure.retryable && (
            <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700">
              Retry
            </button>
          )}
          <button type="button" onClick={onDismiss} className="font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700">
            Dismiss
          </button>
        </div>
      </div>
    );
  }
  const processing = state.status === "processing";
  const progress = processing ? 100 : state.progress;
  return (
    <div role="status" aria-live="polite" data-background-upload={state.status} className="grid gap-1 text-[12px] text-[#303839]/75">
      <span className="truncate">{processing ? `Processing ${state.fileName}…` : `Uploading ${state.fileName}… ${progress}%`}</span>
      <span className="block h-1 overflow-hidden rounded-full bg-[#303839]/10" aria-hidden>
        <span className={`block h-full rounded-full bg-[#27307A] ${processing ? "animate-pulse" : ""}`} style={{ width: `${progress}%` }} />
      </span>
    </div>
  );
}
