// Shared mapping for customizer_assets rows (elements library).

export function assetFromRow(row: any) {
  return {
    id: row.id,
    categoryId: row.category_id || "",
    title: row.title || "",
    tags: Array.isArray(row.tags) ? row.tags : [],
    keywords: row.keywords || "",
    bucket: row.bucket,
    path: row.path,
    url: row.public_url || "",
    mimeType: row.mime_type,
    fileSizeBytes: Number(row.file_size_bytes) || 0,
    width: Number(row.width) || 0,
    height: Number(row.height) || 0,
    tintable: Boolean(row.tintable),
    defaultColor: row.default_color || "",
    customerAvailable: Boolean(row.customer_available),
    active: Boolean(row.active),
    archived: Boolean(row.archived),
    createdAt: row.created_at,
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
