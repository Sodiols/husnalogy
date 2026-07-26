import { assetFromRow } from "@/lib/customizer/assets";

export const ADMIN_ASSET_BUCKET = "customizer-elements";
export const ADMIN_ASSET_URL_TTL_SECONDS = 60 * 60;

const EPHEMERAL_ASSET_KEYS = new Set(["url", "src", "image", "backgroundImage", "placeholderImage", "thumbnail", "baseImageUrl", "signedUrl", "editorUrl", "thumbnailUrl", "expiresAt"]);

function adminAssetIdentity(value: any): { key: string; id: string } | null {
  if (!value || typeof value !== "object") return null;
  const entry = Object.entries(value).find(([key, id]) => (key === "assetId" || key.endsWith("AssetId")) && typeof id === "string" && id);
  return entry ? { key: entry[0], id: String(entry[1]) } : null;
}

function permanentAdminReference(value: any): boolean {
  const identity = adminAssetIdentity(value);
  return Boolean(
    identity
      && (value.bucket === ADMIN_ASSET_BUCKET || value.originalPath || value.editorPath || value.thumbnailPath || identity.key !== "assetId" || !value.ownerId),
  );
}

export function stripAdminAssetUrls<T>(value: T): T {
  const visit = (current: any): any => {
    if (Array.isArray(current)) return current.map(visit);
    if (!current || typeof current !== "object") return current;
    const adminAsset = permanentAdminReference(current);
    return Object.fromEntries(
      Object.entries(current)
        .filter(([key]) => !adminAsset || !EPHEMERAL_ASSET_KEYS.has(key))
        .map(([key, child]) => [key, visit(child)]),
    );
  };
  return visit(value) as T;
}

export async function signAdminAssetRow(supabase: any, row: any, ttlSeconds = ADMIN_ASSET_URL_TTL_SECONDS) {
  const bucket = row.bucket || ADMIN_ASSET_BUCKET;
  const editorPath = row.editor_path || row.path;
  const thumbnailPath = row.thumbnail_path || editorPath;
  const [original, editor, thumbnail] = await Promise.all([
    supabase.storage.from(bucket).createSignedUrl(row.path, ttlSeconds),
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

export async function signAdminAssetRows(supabase: any, rows: any[], ttlSeconds = ADMIN_ASSET_URL_TTL_SECONDS) {
  return Promise.all((rows || []).map((row) => signAdminAssetRow(supabase, row, ttlSeconds)));
}

export async function hydrateAdminAssetUrls<T>(value: T, supabase: any, ttlSeconds = ADMIN_ASSET_URL_TTL_SECONDS): Promise<T> {
  const ids = new Set<string>();
  const collect = (current: any) => {
    if (Array.isArray(current)) return current.forEach(collect);
    if (!current || typeof current !== "object") return;
    const assetId = adminAssetIdentity(current)?.id || "";
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(assetId)) ids.add(assetId);
    Object.values(current).forEach(collect);
  };
  collect(value);
  if (!ids.size) return value;

  const { data, error } = await supabase
    .from("customizer_assets")
    .select("*")
    .in("id", [...ids])
    .in("status", ["ready", "archived"]);
  if (error || !data?.length) return value;

  const signed = await signAdminAssetRows(supabase, data, ttlSeconds);
  const byId = new Map(signed.map((asset: any) => [String(asset.id), asset]));
  const visit = (current: any): any => {
    if (Array.isArray(current)) return current.map(visit);
    if (!current || typeof current !== "object") return current;
    const identity = adminAssetIdentity(current);
    const asset: any = identity ? byId.get(identity.id) : null;
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
          path: asset.originalPath,
          originalPath: asset.originalPath,
          editorPath: asset.editorPath,
          thumbnailPath: asset.thumbnailPath,
          src: asset.editorUrl,
          url: asset.editorUrl,
          thumbnailUrl: asset.thumbnailUrl,
          expiresAt: asset.expiresAt,
          [displayKey]: asset.editorUrl,
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
