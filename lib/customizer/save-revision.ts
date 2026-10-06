/**
 * Stale-write protection for customization saves.
 *
 * A single editor can have two writes for the same design in flight: the
 * autosave queue's request and the keepalive request sent while the page is
 * being unloaded. They can reach the server in either order, and a retry can
 * arrive long after a newer save. Without a guard the older body simply wins
 * whichever request lands last.
 *
 * Every design save carries the editor's `clientRevision`, a number that only
 * moves forward for a design (it survives reloads through the recovery
 * snapshot). The server stores it in `render_data.clientRevision` and refuses a
 * body whose revision is LOWER than the stored one. Equal revisions are
 * accepted: they carry the same state, and a second tab that reopened the
 * design starts from the same number.
 *
 * The check and the write are made atomic with a compare-and-swap on
 * `updated_at`: the update only applies if the row is still the one the
 * revision was checked against. On a lost race the row is re-read and the
 * check runs again.
 */

export const MAX_CLIENT_REVISION = Number.MAX_SAFE_INTEGER;

/** A client-supplied revision, or null when absent or malformed. */
export function parseClientRevision(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed;
}

/** The revision stored on a row's render_data; 0 for rows saved before revisions existed. */
export function storedClientRevision(renderData: unknown): number {
  const value = (renderData as any)?.clientRevision;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

export type RevisionGuardedWrite<Row> =
  | { ok: true; row: Row }
  | { ok: false; reason: "stale"; storedRevision: number }
  | { ok: false; reason: "missing" }
  | { ok: false; reason: "locked" }
  | { ok: false; reason: "error"; error: unknown };

export type RevisionGuardStore<Row> = {
  /** Re-read the current row (owner-scoped). */
  read: () => Promise<{ row: Row | null; error: unknown }>;
  /**
   * Update `current` only if its `updated_at` is still the stored one (the
   * compare-and-swap). Resolves `row: null` when nothing matched (the row
   * changed, was locked, or was removed).
   */
  write: (current: Row) => Promise<{ row: Row | null; error: unknown }>;
  isLocked: (row: Row) => boolean;
  revision: (row: Row) => number;
};

/**
 * Apply a design write that carries `incomingRevision`, refusing it when the
 * stored row already holds a newer revision.
 */
export async function writeWithRevisionGuard<Row>(
  incomingRevision: number,
  initialRow: Row,
  store: RevisionGuardStore<Row>,
  maxAttempts = 3,
): Promise<RevisionGuardedWrite<Row>> {
  let row: Row | null = initialRow;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (!row) return { ok: false, reason: "missing" };
    if (store.isLocked(row)) return { ok: false, reason: "locked" };
    const storedRevision = store.revision(row);
    if (incomingRevision < storedRevision) return { ok: false, reason: "stale", storedRevision };

    const written = await store.write(row);
    if (written.error) return { ok: false, reason: "error", error: written.error };
    if (written.row) return { ok: true, row: written.row };

    // Nothing matched: another write landed between the read and this one.
    const reread = await store.read();
    if (reread.error) return { ok: false, reason: "error", error: reread.error };
    row = reread.row;
  }
  // Still contended after several rounds: report it as stale so the client
  // re-sends rather than silently overwriting a write it never saw.
  return { ok: false, reason: "stale", storedRevision: row ? store.revision(row) : 0 };
}
