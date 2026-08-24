// Shared mapping for customizer_assets rows (elements library).

export function assetFromRow(
  row: any,
  urls: { url?: string; originalUrl?: string; editorUrl?: string; thumbnailUrl?: string; expiresAt?: string } = {},
) {
  return {
    id: row.id,
    categoryId: row.category_id || "",
    folderId: row.folder_id || "",
    title: row.title || "",
    displayName: row.title || "",
    originalFilename: row.original_filename || "",
    assetType: row.asset_type || "element",
    tags: Array.isArray(row.tags) ? row.tags : [],
    keywords: row.keywords || "",
    bucket: row.bucket,
    path: row.path,
    originalPath: row.path,
    editorPath: row.editor_path || row.path,
    thumbnailPath: row.thumbnail_path || row.editor_path || row.path,
    url: urls.editorUrl || urls.url || "",
    editorUrl: urls.editorUrl || urls.url || "",
    // Full-quality source, kept separate so the canvas can fall back to it when
    // an editor variant is missing or unusable.
    originalUrl: urls.originalUrl || urls.url || urls.editorUrl || "",
    thumbnailUrl: urls.thumbnailUrl || urls.editorUrl || urls.url || "",
    expiresAt: urls.expiresAt || "",
    mimeType: row.mime_type,
    fileSizeBytes: Number(row.file_size_bytes) || 0,
    width: Number(row.width) || 0,
    height: Number(row.height) || 0,
    tintable: Boolean(row.tintable),
    defaultColor: row.default_color || "",
    customerAvailable: Boolean(row.customer_available),
    adminAvailable: row.admin_available !== false,
    active: Boolean(row.active),
    archived: Boolean(row.archived),
    status: row.status || (row.archived ? "archived" : "ready"),
    checksum: row.checksum || "",
    usageCount: Number(row.usage_count) || 0,
    createdBy: row.created_by || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Provenance for externally imported assets (Iconify). Null/empty for
    // locally uploaded Husnalogy assets, which remain fully valid without it.
    // Captured at import time and never refreshed from upstream, so a placed
    // order keeps the licence terms that applied when it was purchased.
    sourceProvider: row.source_provider || "",
    sourceKey: row.source_key || "",
    sourceCollection: row.source_collection || "",
    sourceLicense: row.source_license || "",
    sourceLicenseUrl: row.source_license_url || "",
    sourceLicenseSpdx: row.source_license_spdx || "",
    sourceAuthor: row.source_author || "",
  };
}

export function folderFromRow(row: any) {
  return {
    id: row.id,
    name: row.name || "",
    parentId: row.parent_id || "",
    createdBy: row.created_by || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function categoryFromRow(row: any) {
  return {
    id: row.id,
    name: row.name || "",
    slug: row.slug || "",
    description: row.description || "",
    sortOrder: Number(row.sort_order) || 0,
    active: Boolean(row.active),
  };
}
