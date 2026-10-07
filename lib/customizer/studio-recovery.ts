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
 *
 * Every snapshot belongs to ONE studio account (admin or designer). Its id is
 * part of the key and stamped inside the snapshot, and a read returns it only
 * to that same account — on a shared browser one designer never receives
 * another's unsaved work, not even the shared "new product" slot.
 */

import type { EnumerableStorage, StorageLike } from "./recovery-store";
import { stripRuntimeAssetUrls } from "./v2/asset-identity";

/*
 * A snapshot never stores image CREDENTIALS. Signed Storage URLs expire within
 * the hour, and a recovery copy can be restored days later: a stored URL would
 * come back dead. Snapshots keep each picture's durable identity (asset id and
 * storage paths) only — on write, and again on read for snapshots written
 * before this rule — and the canvas's asset resolver signs fresh URLs from it.
 */

export const STUDIO_RECOVERY_PREFIX = "husnalogy_studio_draft";
/** Snapshots written before account scoping (`${prefix}:<product>`) are never read. */
const SCOPED_PREFIX = `${STUDIO_RECOVERY_PREFIX}:v2:`;
const ACTOR_ID = /^[A-Za-z0-9_-]{1,128}$/;

export type StudioRecoverySnapshot = {
  /** The studio account (admin or designer) whose unsaved work this is. */
  owner: string;
  /** The product the template belongs to; "" for a product not saved yet. */
  productId: string;
  productName: string;
  /** When the snapshot was written (ISO 8601). */
  savedAt: string;
  template: Record<string, unknown>;
};

/**
 * One key per studio account and product (`…:v2:<account>:product:<id>`, or
 * `…:new` for a product not saved yet); "" without a signed-in account, in
 * which case nothing is read or written.
 */
export function studioRecoveryKey(actorId: string | null | undefined, productId: string | null | undefined): string {
  const actor = String(actorId || "");
  if (!ACTOR_ID.test(actor)) return "";
  const product = String(productId || "");
  return `${SCOPED_PREFIX}${actor}:${product ? `product:${product}` : "new"}`;
}

const isObject = (value: unknown): value is Record<string, any> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * The stored snapshot, or null when there is none. Storage that cannot be read
 * (blocked, private mode) and a value that is not a snapshot both read as "no
 * recovery available" — there is nothing to restore from either.
 */
export function readStudioRecovery(storage: StorageLike | null, key: string, actorId: string): StudioRecoverySnapshot | null {
  if (!storage || !key || !actorId || !key.startsWith(`${SCOPED_PREFIX}${actorId}:`)) return null;
  let parsed: unknown;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(parsed) || !isObject(parsed.template) || !Array.isArray(parsed.template.layers)) return null;
  // The stamp, not just the key, decides: a value copied under another
  // account's key is still not that account's.
  if (parsed.owner !== actorId) return null;
  return {
    owner: actorId,
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
  actorId: string,
  snapshot: Omit<StudioRecoverySnapshot, "savedAt" | "owner"> & { savedAt?: string },
): boolean {
  if (!storage || !key || !actorId || !key.startsWith(`${SCOPED_PREFIX}${actorId}:`)) return false;
  try {
    storage.setItem(
      key,
      JSON.stringify({ ...snapshot, owner: actorId, template: stripRuntimeAssetUrls(snapshot.template), savedAt: snapshot.savedAt || new Date().toISOString() }),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearStudioRecovery(storage: (StorageLike & Pick<Storage, "removeItem">) | null, key: string): void {
  if (!storage || !key) return;
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

/**
 * Remove studio snapshots written before account scoping: they cannot be
 * attributed to an account, so they are never offered to anyone.
 */
export function purgeLegacyStudioRecovery(storage: EnumerableStorage | null): number {
  if (!storage) return 0;
  const legacy: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && key.startsWith(`${STUDIO_RECOVERY_PREFIX}:`) && !key.startsWith(SCOPED_PREFIX)) legacy.push(key);
    }
    legacy.forEach((key) => storage.removeItem(key));
  } catch {
    return 0;
  }
  return legacy.length;
}
