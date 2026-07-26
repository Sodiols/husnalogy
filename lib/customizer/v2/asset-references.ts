export const CUSTOMER_ASSET_BUCKET = "customer-uploads";
export const PRIVATE_ASSET_REFERENCE_VERSION = 1;

export type CustomerAssetReference = {
  version: 1;
  assetId: string;
  ownerId: string;
  bucket: string;
  storagePath: string;
  editorStoragePath?: string;
  thumbnailStoragePath?: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  width: number;
  height: number;
  checksum?: string;
  createdAt: string;
};

export type ResolvedPrivateAsset = {
  reference: CustomerAssetReference;
  signedUrl: string;
  expiresAt: string;
  variant: "original" | "editor" | "thumbnail";
};

const EPHEMERAL_KEYS = new Set(["url", "signedUrl", "thumbnailUrl"]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function isAllowedCustomerAssetPath(ownerId: string, bucket: string, path: string): boolean {
  const clean = text(path).replace(/\\/g, "/");
  return Boolean(ownerId) && bucket === CUSTOMER_ASSET_BUCKET && !clean.includes("..") && clean.startsWith(`${ownerId}/`);
}

export function normalizeCustomerAssetReference(
  value: any,
  fallbackOwnerId = "",
): CustomerAssetReference | null {
  if (!value || typeof value !== "object") return null;
  const source = value.assetReference && typeof value.assetReference === "object" ? value.assetReference : value;
  let ownerId = text(source.ownerId || source.userId || fallbackOwnerId);
  const bucket = text(source.bucket || value.bucket);
  const storagePath = text(
    source.storagePath || source.originalStoragePath || source.originalPath || value.originalPath || source.path || value.path,
  );
  if (!ownerId && storagePath.includes("/")) ownerId = storagePath.replace(/\\/g, "/").split("/")[0];
  const editorStoragePath = text(source.editorStoragePath || source.editorPath || value.editorPath || value.path);
  const thumbnailStoragePath = text(source.thumbnailStoragePath || source.thumbnailPath || value.thumbnailPath);
  if (!isAllowedCustomerAssetPath(ownerId, bucket, storagePath)) return null;
  if (editorStoragePath && !isAllowedCustomerAssetPath(ownerId, bucket, editorStoragePath)) return null;
  if (thumbnailStoragePath && !isAllowedCustomerAssetPath(ownerId, bucket, thumbnailStoragePath)) return null;
  return {
    version: PRIVATE_ASSET_REFERENCE_VERSION,
    assetId: text(source.assetId || source.id || value.assetId),
    ownerId,
    bucket,
    storagePath,
    ...(editorStoragePath ? { editorStoragePath } : {}),
    ...(thumbnailStoragePath ? { thumbnailStoragePath } : {}),
    originalFileName: text(source.originalFileName || source.fileName || source.name || value.name),
    mimeType: text(source.mimeType || source.type || value.type),
    fileSize: number(source.fileSize ?? source.fileSizeBytes ?? source.size ?? value.size),
    width: number(source.width ?? value.width),
    height: number(source.height ?? value.height),
    ...(text(source.checksum || value.checksum) ? { checksum: text(source.checksum || value.checksum) } : {}),
    createdAt: text(source.createdAt || value.createdAt) || new Date(0).toISOString(),
  };
}

export function permanentAssetValue(value: any, fallbackOwnerId = ""): any {
  const reference = normalizeCustomerAssetReference(value, fallbackOwnerId);
  if (!reference) return value;
  if (!value.assetReference && value.version === PRIVATE_ASSET_REFERENCE_VERSION && value.storagePath) {
    return reference;
  }
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value || {})) {
    if (EPHEMERAL_KEYS.has(key) || key === "src") continue;
    next[key] = child;
  }
  return {
    ...next,
    assetReference: reference,
    assetId: reference.assetId,
    ownerId: reference.ownerId,
    bucket: reference.bucket,
    path: reference.editorStoragePath || reference.storagePath,
    originalPath: reference.storagePath,
    thumbnailPath: reference.thumbnailStoragePath || "",
    name: reference.originalFileName,
    type: reference.mimeType,
    size: reference.fileSize,
    width: reference.width,
    height: reference.height,
    checksum: reference.checksum || "",
  };
}

export function stripEphemeralAssetUrls<T>(value: T, fallbackOwnerId = ""): T {
  const visit = (current: any): any => {
    if (Array.isArray(current)) return current.map(visit);
    if (!current || typeof current !== "object") return current;
    const permanent = permanentAssetValue(current, fallbackOwnerId);
    const source = permanent && typeof permanent === "object" ? permanent : current;
    return Object.fromEntries(Object.entries(source).map(([key, child]) => [key, visit(child)]));
  };
  return visit(value) as T;
}

export function collectCustomerAssetReferences(value: unknown, fallbackOwnerId = ""): CustomerAssetReference[] {
  const found = new Map<string, CustomerAssetReference>();
  const visit = (current: any) => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!current || typeof current !== "object") return;
    const reference = normalizeCustomerAssetReference(current, fallbackOwnerId);
    if (reference) found.set(reference.assetId || `${reference.bucket}:${reference.storagePath}`, reference);
    Object.values(current).forEach(visit);
  };
  visit(value);
  return [...found.values()];
}

export async function hydratePrivateAssetUrls<T>(
  value: T,
  resolver: (reference: CustomerAssetReference, variant: "original" | "editor" | "thumbnail") => Promise<ResolvedPrivateAsset>,
  options: { fallbackOwnerId?: string; variant?: "original" | "editor" | "thumbnail" } = {},
): Promise<T> {
  const cache = new Map<string, Promise<ResolvedPrivateAsset>>();
  const visit = async (current: any): Promise<any> => {
    if (Array.isArray(current)) return Promise.all(current.map(visit));
    if (!current || typeof current !== "object") return current;
    const isReferenceObject = !current.assetReference && current.version === PRIVATE_ASSET_REFERENCE_VERSION && current.storagePath;
    const reference = isReferenceObject ? null : normalizeCustomerAssetReference(current, options.fallbackOwnerId || "");
    let source = current;
    if (reference) {
      const variant = options.variant || "editor";
      const key = `${reference.assetId || reference.storagePath}:${variant}`;
      const pending = cache.get(key) || resolver(reference, variant);
      cache.set(key, pending);
      const resolved = await pending;
      source = {
        ...permanentAssetValue(current, reference.ownerId),
        url: resolved.signedUrl,
        signedUrl: resolved.signedUrl,
        src: resolved.signedUrl,
        expiresAt: resolved.expiresAt,
      };
    }
    return Object.fromEntries(await Promise.all(Object.entries(source).map(async ([key, child]) => [key, await visit(child)])));
  };
  return visit(value) as Promise<T>;
}

export function assetReferenceHashMaterial(value: unknown): unknown {
  const stripped = stripEphemeralAssetUrls(value);
  const stable = (current: any): any => {
    if (Array.isArray(current)) return current.map(stable);
    if (current && typeof current === "object") {
      return Object.fromEntries(
        Object.entries(current)
          .filter(([key]) => key !== "expiresAt" && key !== "generatedAt" && key !== "updatedAt")
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, stable(child)]),
      );
    }
    return current;
  };
  return stable(stripped);
}
