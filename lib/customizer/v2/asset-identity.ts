// Durable image identity vs. runtime access credentials.
//
// A signed Storage URL is NOT an image's identity: it expires (an hour by
// default) and a design must outlive it by months. The identity of a picture
// is what never changes —
//
//   library asset  (Husnalogy's own `customizer_assets` table):
//                  assetId + storage paths
//   customer upload (`customer_asset_library`):
//                  assetReference { ownerId, bucket, storagePath, … }
//
// — and a signed URL is only a runtime credential derived from it. This module
// is shared by the server (stripping before save, hydration on read) and the
// browser (recovery snapshots, the runtime asset resolver), so both sides agree
// on which objects carry a durable identity and which fields are credentials.

import { normalizeCustomerAssetReference, stripEphemeralAssetUrls, type CustomerAssetReference } from "./asset-references";

export const ADMIN_ASSET_BUCKET = "customizer-elements";

/** Runtime-only fields of a library asset: credentials and values derived from them. */
export const EPHEMERAL_ASSET_KEYS = new Set([
  "url",
  "src",
  "image",
  "backgroundImage",
  "placeholderImage",
  "thumbnail",
  "baseImageUrl",
  "signedUrl",
  "editorUrl",
  "originalUrl",
  "thumbnailUrl",
  "expiresAt",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The id key (`assetId`, `baseImageAssetId`, …) and value of an object that names a library asset. */
export function adminAssetIdentity(value: unknown): { key: string; id: string } | null {
  if (!value || typeof value !== "object") return null;
  const entry = Object.entries(value as Record<string, unknown>).find(
    ([key, id]) => (key === "assetId" || key.endsWith("AssetId")) && typeof id === "string" && id,
  );
  return entry ? { key: entry[0], id: String(entry[1]) } : null;
}

/** Whether an object is a reference to a permanent library asset (rather than a customer upload). */
export function permanentAdminReference(value: unknown): boolean {
  const identity = adminAssetIdentity(value);
  if (!identity) return false;
  const record = value as Record<string, unknown>;
  return Boolean(
    record.bucket === ADMIN_ASSET_BUCKET ||
      record.originalPath ||
      record.editorPath ||
      record.thumbnailPath ||
      identity.key !== "assetId" ||
      !record.ownerId,
  );
}

/**
 * The same document without any library-asset credential. Applied before a
 * template is stored (server) and before a recovery snapshot is written
 * (browser), so a stored design never depends on a URL that will expire.
 */
export function stripAdminAssetUrls<T>(value: T): T {
  const visit = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(visit);
    if (!current || typeof current !== "object") return current;
    const adminAsset = permanentAdminReference(current);
    return Object.fromEntries(
      Object.entries(current as Record<string, unknown>)
        .filter(([key]) => !adminAsset || !EPHEMERAL_ASSET_KEYS.has(key))
        .map(([key, child]) => [key, visit(child)]),
    );
  };
  return visit(value) as T;
}

/** Every runtime credential removed — library assets and customer uploads alike. */
export function stripRuntimeAssetUrls<T>(value: T): T {
  return stripEphemeralAssetUrls(stripAdminAssetUrls(value));
}

export type AssetIdentity =
  | { kind: "library"; key: string; assetId: string }
  | { kind: "customer"; key: string; reference: CustomerAssetReference };

/**
 * The durable identity behind an image source object (a layer, a field value),
 * or null when it has none — a data URL, an external URL, or a legacy record
 * saved before assets had identities. Customer uploads are recognised first:
 * their reference is owner-scoped and checked by its own path rules.
 */
export function assetIdentityOf(value: unknown): AssetIdentity | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, any>;
  const hasCustomerShape = Boolean(record.assetReference || record.ownerId || record.bucket === "customer-uploads");
  if (hasCustomerShape) {
    const reference = normalizeCustomerAssetReference(record);
    if (reference) return { kind: "customer", key: `customer:${reference.assetId || reference.storagePath}`, reference };
  }
  const identity = adminAssetIdentity(record);
  if (identity && identity.key === "assetId" && UUID.test(identity.id) && permanentAdminReference(record)) {
    return { kind: "library", key: `library:${identity.id}`, assetId: identity.id };
  }
  return null;
}

/**
 * When a Supabase signed URL stops working, read from its own token (a JWT
 * whose `exp` claim is the expiry), so the expiry is known even for a URL that
 * arrived without metadata — a recovery copy, an old render. Null when the URL
 * is not a signed Storage URL.
 */
export function signedUrlExpiry(url: unknown): number | null {
  if (typeof url !== "string" || !url.includes("token=")) return null;
  try {
    const token = new URL(url, "http://local").searchParams.get("token") || "";
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const json = typeof atob === "function" ? atob(padded) : Buffer.from(padded, "base64").toString("utf8");
    const exp = Number(JSON.parse(json)?.exp);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
  } catch {
    return null;
  }
}
