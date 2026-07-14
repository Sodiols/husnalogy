import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  CUSTOMER_ASSET_BUCKET,
  collectCustomerAssetReferences,
  hydratePrivateAssetUrls,
  isAllowedCustomerAssetPath,
  normalizeCustomerAssetReference,
  type CustomerAssetReference,
  type ResolvedPrivateAsset,
} from "@/lib/customizer/v2/asset-references";
import { RenderError } from "@/lib/customizer/v2/server/render";

export type PrivateAssetActor = {
  userId?: string;
  administrator?: boolean;
  productionWorker?: boolean;
};

type AssetVariant = "original" | "editor" | "thumbnail";

const SIGNED_URL_TTL_SECONDS = 60 * 60;
const CACHE_TTL_MS = 4 * 60 * 1000;
const signedUrlCache = new Map<string, { value: ResolvedPrivateAsset; cachedAt: number }>();

export function canActorAccessAsset(ownerId: string, actor: PrivateAssetActor): boolean {
  return Boolean(actor.administrator || actor.productionWorker || (actor.userId && actor.userId === ownerId));
}

export function assetRowToReference(row: any): CustomerAssetReference {
  return {
    version: 1,
    assetId: String(row.id || ""),
    ownerId: String(row.user_id || ""),
    bucket: String(row.bucket || CUSTOMER_ASSET_BUCKET),
    storagePath: String(row.path || ""),
    ...(row.editor_path ? { editorStoragePath: String(row.editor_path) } : {}),
    ...(row.thumbnail_path ? { thumbnailStoragePath: String(row.thumbnail_path) } : {}),
    originalFileName: String(row.file_name || ""),
    mimeType: String(row.mime_type || ""),
    fileSize: Number(row.size_bytes) || 0,
    width: Number(row.width) || 0,
    height: Number(row.height) || 0,
    ...(row.checksum ? { checksum: String(row.checksum) } : {}),
    createdAt: String(row.created_at || new Date(0).toISOString()),
  };
}

async function queryAssetRow(supabase: any, reference: CustomerAssetReference, actor: PrivateAssetActor): Promise<any | null> {
  const select = "id,user_id,bucket,path,editor_path,thumbnail_path,file_name,mime_type,size_bytes,width,height,checksum,status,created_at";
  const query = async (column: string, value: string) => {
    let builder = supabase.from("customer_asset_library").select(select).eq(column, value).eq("status", "ready");
    if (!actor.administrator && !actor.productionWorker && actor.userId) builder = builder.eq("user_id", actor.userId);
    const { data, error } = await builder.maybeSingle();
    if (error) throw new RenderError("ASSET_REFERENCE_INVALID", "The customer asset record could not be verified.");
    return data || null;
  };

  if (reference.assetId) {
    const byId = await query("id", reference.assetId);
    if (byId) return byId;
  }
  for (const [column, path] of [
    ["path", reference.storagePath],
    ["editor_path", reference.editorStoragePath || reference.storagePath],
    ["thumbnail_path", reference.thumbnailStoragePath || ""],
  ] as const) {
    if (!path) continue;
    const row = await query(column, path);
    if (row) return row;
  }

  // Compatibility for uploads created before customer_asset_library existed.
  let legacy = supabase
    .from("customer_uploads")
    .select("id,user_id,bucket,path,file_name,mime_type,size_bytes,metadata,created_at")
    .eq("bucket", reference.bucket)
    .eq("path", reference.storagePath);
  if (!actor.administrator && !actor.productionWorker && actor.userId) legacy = legacy.eq("user_id", actor.userId);
  const { data: oldRow, error: legacyError } = await legacy.maybeSingle();
  if (legacyError) throw new RenderError("ASSET_REFERENCE_INVALID", "The legacy customer asset record could not be verified.");
  if (!oldRow) return null;
  return {
    ...oldRow,
    editor_path: oldRow.path,
    thumbnail_path: oldRow.path,
    width: Number(oldRow.metadata?.width) || reference.width,
    height: Number(oldRow.metadata?.height) || reference.height,
    checksum: oldRow.metadata?.checksum || reference.checksum || null,
    status: "ready",
  };
}

export async function resolvePrivateAssetUrl(options: {
  reference: CustomerAssetReference | Record<string, unknown>;
  actor: PrivateAssetActor;
  variant?: AssetVariant;
  ttlSeconds?: number;
  supabase?: any;
}): Promise<ResolvedPrivateAsset> {
  const reference = normalizeCustomerAssetReference(options.reference, options.actor.userId || "");
  if (!reference || reference.bucket !== CUSTOMER_ASSET_BUCKET) {
    throw new RenderError("ASSET_REFERENCE_INVALID", "The customer asset reference is invalid.");
  }
  if (!canActorAccessAsset(reference.ownerId, options.actor)) {
    throw new RenderError("ASSET_ACCESS_DENIED", "You do not have access to this customer asset.");
  }
  const variant = options.variant || "editor";
  const cacheKey = `${options.actor.userId || "service"}:${options.actor.administrator ? "admin" : "user"}:${reference.assetId || reference.storagePath}:${variant}`;
  const cached = signedUrlCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.value;

  const supabase = options.supabase || createServiceRoleClient();
  const row = await queryAssetRow(supabase, reference, options.actor);
  if (!row) throw new RenderError("ASSET_NOT_FOUND", "The customer asset no longer exists.");
  const trustedReference = assetRowToReference(row);
  if (!canActorAccessAsset(trustedReference.ownerId, options.actor)) {
    throw new RenderError("ASSET_ACCESS_DENIED", "You do not have access to this customer asset.");
  }
  if (!isAllowedCustomerAssetPath(trustedReference.ownerId, trustedReference.bucket, trustedReference.storagePath)) {
    throw new RenderError("ASSET_REFERENCE_INVALID", "The stored customer asset path is invalid.");
  }
  const path = variant === "thumbnail"
    ? trustedReference.thumbnailStoragePath || trustedReference.editorStoragePath || trustedReference.storagePath
    : variant === "editor"
      ? trustedReference.editorStoragePath || trustedReference.storagePath
      : trustedReference.storagePath;
  if (!isAllowedCustomerAssetPath(trustedReference.ownerId, trustedReference.bucket, path)) {
    throw new RenderError("ASSET_REFERENCE_INVALID", "The requested customer asset variant is invalid.");
  }
  const ttlSeconds = Math.max(60, Math.min(SIGNED_URL_TTL_SECONDS, Number(options.ttlSeconds) || SIGNED_URL_TTL_SECONDS));
  const { data, error } = await supabase.storage.from(trustedReference.bucket).createSignedUrl(path, ttlSeconds);
  if (error || !data?.signedUrl) throw new RenderError("ASSET_SIGNING_FAILED", "The customer asset could not be opened securely.");
  const value: ResolvedPrivateAsset = {
    reference: trustedReference,
    signedUrl: data.signedUrl,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    variant,
  };
  signedUrlCache.set(cacheKey, { value, cachedAt: Date.now() });
  return value;
}

export async function resolvePrivateAssetsForDelivery<T>(
  value: T,
  actor: PrivateAssetActor,
  variant: AssetVariant = "editor",
  supabase: any = createServiceRoleClient(),
): Promise<T> {
  return hydratePrivateAssetUrls(
    value,
    (reference, requestedVariant) => resolvePrivateAssetUrl({ reference, actor, variant: requestedVariant, supabase }),
    { fallbackOwnerId: actor.userId || "", variant },
  );
}

export async function validatePrivateAssetOwnership(value: unknown, userId: string): Promise<void> {
  const references = collectCustomerAssetReferences(value, userId);
  const supabase = createServiceRoleClient();
  for (const reference of references) {
    const row = await queryAssetRow(supabase, reference, { userId });
    if (!row || String(row.user_id) !== userId) {
      throw new RenderError("ASSET_ACCESS_DENIED", "An uploaded photo does not belong to this account.");
    }
  }
}

export function clearPrivateAssetUrlCache(): void {
  signedUrlCache.clear();
}
