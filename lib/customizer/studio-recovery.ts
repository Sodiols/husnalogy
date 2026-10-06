/**
 * Crash-safe local recovery for the admin Design Studio.
 *
 * The studio saves its template draft to the server on Save Draft, on Publish
 * and — for a product that already exists — by autosave. None of those can be
 * the only copy of the newest edit: a refresh, a closed tab or a crashed
 * browser can land between "the admin changed something" and "the server
 * confirmed it", and a NEW product has no server row to autosave into at all.
 * This store keeps the newest unsaved template in the browser so that window
 * is covered.
 *
 * A snapshot exists only while the studio holds changes the server has not
 * confirmed; a confirmed save removes it. Restoring is always the admin's
 * choice — the studio offers it, it never silently replaces the saved draft.
 */

import type { StorageLike } from "./recovery-store";
import { stripRuntimeAssetUrls } from "./v2/asset-identity";

/*
 * A snapshot never stores image CREDENTIALS. Signed Storage URLs expire within
 * the hour, and a recovery copy can be restored days later: a stored URL would
 * come back dead. Snapshots keep each picture's durable identity (asset id and
 * storage paths) only — on write, and again on read for snapshots written
 * before this rule — and the canvas's asset resolver signs fresh URLs from it.
 */

export const STUDIO_RECOVERY_PREFIX = "husnalogy_studio_draft";

export type StudioRecoverySnapshot = {
  /** The product the template belongs to; "" for a product not saved yet. */
  productId: string;
  productName: string;
  /** When the snapshot was written (ISO 8601). */
  savedAt: string;
  template: Record<string, unknown>;
};

/** One key per product; every not-yet-saved product shares the "new" slot. */
export function studioRecoveryKey(productId: string | null | undefined): string {
  return `${STUDIO_RECOVERY_PREFIX}:${String(productId || "") || "new"}`;
}

const isObject = (value: unknown): value is Record<string, any> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * The stored snapshot, or null when there is none. Storage that cannot be read
 * (blocked, private mode) and a value that is not a snapshot both read as "no
 * recovery available" — there is nothing to restore from either.
 */
export function readStudioRecovery(storage: StorageLike | null, key: string): StudioRecoverySnapshot | null {
  if (!storage) return null;
  let parsed: unknown;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(parsed) || !isObject(parsed.template) || !Array.isArray(parsed.template.layers)) return null;
  return {
    productId: String(parsed.productId || ""),
    productName: String(parsed.productName || ""),
    savedAt: String(parsed.savedAt || ""),
    template: stripRuntimeAssetUrls(parsed.template),
  };
}

/** Write the snapshot. Returns false when the browser refused it (quota, blocked storage). */
export function writeStudioRecovery(
  storage: StorageLike | null,
  key: string,
  snapshot: Omit<StudioRecoverySnapshot, "savedAt"> & { savedAt?: string },
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      key,
      JSON.stringify({ ...snapshot, template: stripRuntimeAssetUrls(snapshot.template), savedAt: snapshot.savedAt || new Date().toISOString() }),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearStudioRecovery(storage: (StorageLike & Pick<Storage, "removeItem">) | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Storage that cannot be written holds no snapshot to clear.
  }
}

/**
 * Whether a snapshot holds something the studio does not already show — the
 * only case in which restoring it is worth offering. Compared on the stored
 * JSON form, which is exactly what a restore would put back.
 */
export function studioRecoveryDiffers(snapshot: StudioRecoverySnapshot | null, template: unknown): boolean {
  if (!snapshot) return false;
  // Credentials are not content: a design that differs only by fresher URLs is the same design.
  return JSON.stringify(stripRuntimeAssetUrls(snapshot.template)) !== JSON.stringify(stripRuntimeAssetUrls(template ?? null));
}
