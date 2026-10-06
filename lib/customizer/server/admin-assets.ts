import { assetFromRow } from "@/lib/customizer/assets";
import {
  ADMIN_ASSET_BUCKET,
  adminAssetIdentity,
  permanentAdminReference,
  stripAdminAssetUrls as stripSharedAdminAssetUrls,
} from "@/lib/customizer/v2/asset-identity";

export { ADMIN_ASSET_BUCKET } from "@/lib/customizer/v2/asset-identity";
export const ADMIN_ASSET_URL_TTL_SECONDS = 60 * 60;

/** Before a template is stored: the shared rule, so the browser's recovery copy strips the same fields. */
export const stripAdminAssetUrls = stripSharedAdminAssetUrls;

/**
 * Who a signed asset URL is for. The full-resolution ORIGINAL of a Husnalogy
 * library asset is proprietary source material: the studio (admin/designer
 * builder) may receive it, a customer-facing page receives only the
 * editor-optimized derivative and the thumbnail.
 */
export type AdminAssetAudience = "studio" | "customer";

export async function signAdminAssetRow(
  supabase: any,
  row: any,
  ttlSeconds = ADMIN_ASSET_URL_TTL_SECONDS,
  audience: AdminAssetAudience = "studio",
) {
  const bucket = row.bucket || ADMIN_ASSET_BUCKET;
  const editorPath = row.editor_path || row.path;
  const thumbnailPath = row.thumbnail_path || editorPath;
  const [original, editor, thumbnail] = await Promise.all([
    audience === "studio" || editorPath === row.path
      ? supabase.storage.from(bucket).createSignedUrl(row.path, ttlSeconds)
      : Promise.resolve({ data: null }),
    supabase.storage.from(bucket).createSignedUrl(editorPath, ttlSeconds),
    supabase.storage.from(bucket).createSignedUrl(thumbnailPath, ttlSeconds),
  ]);
  // The original is the fallback for both variants: it is always full quality,
  // whereas falling back to the 480px thumbnail would render a blurry canvas.
  const originalUrl = original.data?.signedUrl || "";
  const editorUrl = editor.data?.signedUrl || originalUrl;
  if (!editorUrl) throw new Error("Could not sign administrator asset.");
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  return assetFromRow(row, {
    url: originalUrl,
    originalUrl,
    editorUrl,
    thumbnailUrl: thumbnail.data?.signedUrl || editorUrl,
    expiresAt,
  });
}

export async function signAdminAssetRows(
  supabase: any,
  rows: any[],
  ttlSeconds = ADMIN_ASSET_URL_TTL_SECONDS,
  audience: AdminAssetAudience = "studio",
) {
  return Promise.all((rows || []).map((row) => signAdminAssetRow(supabase, row, ttlSeconds, audience)));
}

export async function hydrateAdminAssetUrls<T>(
  value: T,
  supabase: any,
  ttlSeconds = ADMIN_ASSET_URL_TTL_SECONDS,
  audience: AdminAssetAudience = "studio",
  productionOriginal = false,
): Promise<T> {
  const ids = new Set<string>();
  const collect = (current: any) => {
    if (Array.isArray(current)) return current.forEach(collect);
    if (!current || typeof current !== "object") return;
    const assetId = adminAssetIdentity(current)?.id || "";
    if (permanentAdminReference(current) && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(assetId)) ids.add(assetId);
    Object.values(current).forEach(collect);
  };
  collect(value);
  if (!ids.size) return value;

  const { data, error } = await supabase
    .from("customizer_assets")
    .select("*")
    .in("id", [...ids])
    .in("status", ["ready", "archived"]);
  if (error) { if (productionOriginal) throw error; return value; }
  if (!data?.length) { if (productionOriginal) throw new Error("Production library asset unavailable."); return value; }
  if (productionOriginal && data.length !== ids.size) throw new Error("Production library asset unavailable.");

  const signed = await signAdminAssetRows(supabase, data, ttlSeconds, audience);
  const byId = new Map(signed.map((asset: any) => [String(asset.id), asset]));
  const visit = (current: any): any => {
    if (Array.isArray(current)) return current.map(visit);
    if (!current || typeof current !== "object") return current;
    const identity = adminAssetIdentity(current);
    const asset: any = identity ? byId.get(identity.id) : null;
    const displayUrl = productionOriginal ? asset?.originalUrl : asset?.editorUrl;
    if (asset && !displayUrl) throw new Error("Production library original unavailable.");
    const displayKey = identity?.key === "baseImageAssetId"
      ? "baseImageUrl"
      : identity?.key === "imageAssetId"
        ? "image"
        : identity?.key === "backgroundAssetId"
          ? "backgroundImage"
          : identity?.key === "placeholderAssetId"
            ? "placeholderImage"
          : "src";
    const next = asset
      ? {
          ...current,
          assetId: asset.id,
          bucket: asset.bucket,
          ...(audience === "studio" ? { path: asset.originalPath, originalPath: asset.originalPath } : {}),
          editorPath: asset.editorPath,
          thumbnailPath: asset.thumbnailPath,
          src: displayUrl,
          url: displayUrl,
          // Carried so the canvas can retry at full quality if the editor
          // variant turns out to be unusable, without touching the thumbnail.
          originalUrl: asset.originalUrl,
          thumbnailUrl: asset.thumbnailUrl,
          expiresAt: asset.expiresAt,
          [displayKey]: displayUrl,
          ...(identity?.key === "backgroundAssetId" ? { thumbnail: asset.thumbnailUrl } : {}),
        }
      : current;
    return Object.fromEntries(Object.entries(next).map(([key, child]) => [key, visit(child)]));
  };
  return visit(value) as T;
}

export async function getAdminAssetUsage(supabase: any, asset: { id: string; path: string }) {
  const { data, error } = await supabase.rpc("customizer_asset_usage", {
    p_asset_id: asset.id,
    p_path: asset.path || "",
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}
