"use client";

import { useState } from "react";
import { libraryTileCandidates, libraryTileSourceKey, type LibraryTileAsset } from "@/lib/customizer/v2/library-thumbnail";

/**
 * One library picture, as a picker tile preview: the thumbnail, falling back
 * to the larger preview URLs the row carries; a loading placeholder until
 * one has drawn; and a quiet placeholder when none loads.
 *
 * The failure state belongs to the URLs it was reached with: when the panel
 * re-signs the row (new URLs), the tile starts over instead of staying broken.
 * Inserting never uses these URLs — the caller inserts the asset itself.
 */
export default function LibraryThumb({
  asset,
  className = "h-full w-full object-cover",
  onUnavailable,
}: {
  asset: LibraryTileAsset;
  className?: string;
  /** Every preview URL failed (expired, 403/404, undecodable): the panel may re-sign the row. */
  onUnavailable?: (assetId: string, sourceKey: string) => void;
}) {
  const sourceKey = libraryTileSourceKey(asset);
  const candidates = libraryTileCandidates(asset);
  // Keyed by the URLs: a refreshed row starts over automatically.
  const [attempt, setAttempt] = useState<{ key: string; index: number; loaded: boolean }>({ key: sourceKey, index: 0, loaded: false });
  const current = attempt.key === sourceKey ? attempt : { key: sourceKey, index: 0, loaded: false };
  const src = candidates[current.index] || "";

  if (!src) {
    return (
      <span className="grid h-full w-full place-items-center bg-[#F2F3F5] text-[#303839]/35" data-thumb-state="failed">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="4" y="4" width="16" height="16" rx="2" /><circle cx="9" cy="9" r="1.5" /><path d="m4 17 5-5 4 4 2.5-2.5L20 18" />
        </svg>
      </span>
    );
  }
  return (
    <span className="relative block h-full w-full" data-thumb-state={current.loaded ? "ready" : "loading"}>
      {!current.loaded && <span className="absolute inset-0 animate-pulse bg-[#F2F3F5]" aria-hidden />}
      {/* eslint-disable-next-line @next/next/no-img-element -- a signed library preview */}
      <img
        key={src}
        src={src}
        alt=""
        loading="lazy"
        draggable={false}
        onLoad={() => setAttempt({ key: sourceKey, index: current.index, loaded: true })}
        onError={() => {
          const next = current.index + 1;
          setAttempt({ key: sourceKey, index: next, loaded: false });
          if (next >= candidates.length) onUnavailable?.(asset.id, sourceKey);
        }}
        className={`${className} ${current.loaded ? "" : "opacity-0"}`}
      />
    </span>
  );
}
