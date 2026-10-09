// Draft revision checks shared by draft saves and publication.
//
// The working draft (`product_customizer_templates`) is edited from more than
// one place: two tabs, an admin and a designer, the product form and the
// Design Studio. Each editor remembers the draft's `updated_at` as it last saw
// it and sends it back with its next save. A save made against an older
// revision is refused instead of silently replacing work it never saw.

/**
 * True when the stored draft is still the exact revision the caller saved.
 * Timestamps are compared as instants, so formatting differences between the
 * database and the JSON response cannot cause a false mismatch.
 */
export function draftMatchesExpectedRevision(draftUpdatedAt: unknown, expectedUpdatedAt: unknown): boolean {
  if (!expectedUpdatedAt) return true;
  const instant = (value: unknown): string | null => {
    const text = String(value || "");
    const ms = Date.parse(text);
    if (!Number.isFinite(ms)) return null;
    // Postgres keeps microseconds; Date.parse keeps milliseconds. Compare the
    // full fraction so two saves inside one millisecond still differ.
    const fraction = (text.match(/\.(\d+)/)?.[1] || "").padEnd(6, "0").slice(0, 6);
    return `${Math.floor(ms / 1000)}.${fraction}`;
  };
  const draft = instant(draftUpdatedAt);
  return draft !== null && draft === instant(expectedUpdatedAt);
}

/** A client-supplied draft revision, or null when absent or malformed. */
export function parseExpectedDraftRevision(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, 64);
  return text && Number.isFinite(Date.parse(text)) ? text : null;
}

export const DRAFT_CONFLICT_MESSAGE =
  "This design was changed in another tab or by another person after you opened it.";

/** Thrown by a draft save whose expected revision is no longer the stored one. */
export class DraftConflictError extends Error {
  readonly conflict = true;
  constructor() {
    super(DRAFT_CONFLICT_MESSAGE);
    this.name = "DraftConflictError";
  }
}
