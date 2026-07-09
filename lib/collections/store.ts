import { createId, nowIso } from "@/lib/core/id";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { cleanOptionalString, cleanString, normalizeBoolean } from "@/lib/validation";

function slugify(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function collectionFromRow(row: any = {}) {
  return {
    id: row.id,
    name: row.name || "",
    slug: row.slug || "",
    description: row.description || "",
    parentCollectionId: row.parent_collection_id || "",
    isTrendingWedding: Boolean(row.is_trending_wedding),
    isSuite: Boolean(row.is_suite),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

function normalizeCollection(input: any, existing: any = {}) {
  const now = nowIso();
  const name = cleanString(input.name ?? existing.name);

  return {
    id: existing.id || cleanString(input.id) || createId("collection"),
    name,
    slug: cleanString(input.slug ?? existing.slug).toLowerCase() || slugify(name),
    description: cleanOptionalString(input.description ?? existing.description),
    parentCollectionId: cleanOptionalString(input.parentCollectionId ?? input.parent_collection_id ?? existing.parentCollectionId),
    isTrendingWedding: normalizeBoolean(input.isTrendingWedding ?? input.is_trending_wedding ?? existing.isTrendingWedding),
    isSuite: normalizeBoolean(input.isSuite ?? input.is_suite ?? existing.isSuite),
    createdAt: existing.createdAt || input.createdAt || now,
    updatedAt: now,
  };
}

export async function getProductCollections() {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("product_collections")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw error;
  return (data || []).map(collectionFromRow);
}

export async function createProductCollection(input) {
  const collection = normalizeCollection(input);

  if (!collection.name) {
    return { ok: false, errors: { name: "Collection name is required." } };
  }

  const supabase = createServiceRoleClient();
  const { data: existing, error: readError } = await supabase
    .from("product_collections")
    .select("id")
    .eq("slug", collection.slug)
    .maybeSingle();

  if (readError) throw readError;
  if (existing) {
    return { ok: false, errors: { name: "A collection with this name already exists." } };
  }

  const { data, error } = await supabase
    .from("product_collections")
    .insert({
      id: collection.id,
      name: collection.name,
      slug: collection.slug,
      description: collection.description || null,
      parent_collection_id: collection.parentCollectionId || null,
      is_trending_wedding: collection.isTrendingWedding,
      is_suite: !collection.parentCollectionId && collection.isSuite,
      created_at: collection.createdAt,
      updated_at: collection.updatedAt,
    })
    .select("*")
    .single();

  if (error) throw error;
  return { ok: true, collection: collectionFromRow(data) };
}

export async function updateProductCollection(id, input) {
  const supabase = createServiceRoleClient();
  const { data: existingRow, error: readError } = await supabase
    .from("product_collections")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (readError) throw readError;
  if (!existingRow) return { ok: false, errors: { collection: "Collection not found." } };

  const existing = collectionFromRow(existingRow);
  const collection = normalizeCollection(input, existing);

  if (!collection.name) {
    return { ok: false, errors: { name: "Collection name is required." } };
  }

  if (collection.parentCollectionId && collection.parentCollectionId === id) {
    return { ok: false, errors: { parentCollectionId: "A collection cannot be its own parent." } };
  }

  const { data: duplicate, error: duplicateError } = await supabase
    .from("product_collections")
    .select("id")
    .eq("slug", collection.slug)
    .neq("id", id)
    .maybeSingle();

  if (duplicateError) throw duplicateError;
  if (duplicate) {
    return { ok: false, errors: { name: "A collection with this name already exists." } };
  }

  const { data, error } = await supabase
    .from("product_collections")
    .update({
      name: collection.name,
      slug: collection.slug,
      description: collection.description || null,
      parent_collection_id: collection.parentCollectionId || null,
      is_trending_wedding: collection.isTrendingWedding,
      is_suite: !collection.parentCollectionId && collection.isSuite,
      updated_at: collection.updatedAt,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return { ok: true, collection: collectionFromRow(data) };
}

export async function deleteProductCollection(id) {
  const supabase = createServiceRoleClient();
  const { error, count } = await supabase.from("product_collections").delete({ count: "exact" }).eq("id", id);

  if (error) throw error;
  if (!count) return { ok: false, errors: { collection: "Collection not found." } };

  return { ok: true };
}
