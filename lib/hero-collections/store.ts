import { createId, nowIso } from "@/lib/core/id";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { cleanOptionalString, cleanString, normalizeBoolean } from "@/lib/validation";
import { getCollectionSuite } from "@/lib/collections";
import { getProductCollections } from "@/lib/collections/store";

// The homepage "Wedding Suite" hero is a single, fully admin-managed record.
// Every field the front-end renders lives on this table so nothing is
// hardcoded in the component. See supabase/migrations/hero_collections.sql.

function slugify(value: string) {
  return cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toInteger(value: any, fallback = 0) {
  const num = Math.trunc(Number(value));
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}

// Map a raw database row into the camelCase shape the app/admin use.
export function heroCollectionFromRow(row: any = {}) {
  return {
    id: row.id,
    title: row.title || "",
    slug: row.slug || "",
    seasonLabel: row.season_label || "",
    collectionLabel: row.collection_label || "",
    headingLineOne: row.heading_line_one || "",
    headingLineTwo: row.heading_line_two || "",
    description: row.description || "",
    primaryButtonText: row.primary_button_text || "",
    primaryButtonUrl: row.primary_button_url || "",
    secondaryLinkText: row.secondary_link_text || "",
    secondaryLinkUrl: row.secondary_link_url || "",
    mainImage: row.main_image || "",
    thumbnailOne: row.thumbnail_one || "",
    thumbnailTwo: row.thumbnail_two || "",
    thumbnailThree: row.thumbnail_three || "",
    sourceCollectionId: row.source_collection_id || "",
    itemCount: toInteger(row.item_count, 0),
    isActive: Boolean(row.is_active),
    isFeatured: Boolean(row.is_featured),
    displayOrder: toInteger(row.display_order, 0),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

// Normalize + validate admin input. `existing` carries the current values on
// edit so partial updates keep untouched fields.
function normalizeHeroCollection(input: any = {}, existing: any = {}) {
  const now = nowIso();
  const title = cleanString(input.title ?? existing.title);
  const collection = {
    id: existing.id || cleanString(input.id) || createId("hero"),
    title,
    slug: slugify(cleanString(input.slug ?? existing.slug)) || slugify(title),
    seasonLabel: cleanOptionalString(input.seasonLabel ?? existing.seasonLabel),
    collectionLabel: cleanOptionalString(input.collectionLabel ?? existing.collectionLabel),
    headingLineOne: cleanOptionalString(input.headingLineOne ?? existing.headingLineOne),
    headingLineTwo: cleanOptionalString(input.headingLineTwo ?? existing.headingLineTwo),
    description: cleanOptionalString(input.description ?? existing.description),
    primaryButtonText: cleanOptionalString(input.primaryButtonText ?? existing.primaryButtonText),
    primaryButtonUrl: cleanOptionalString(input.primaryButtonUrl ?? existing.primaryButtonUrl),
    secondaryLinkText: cleanOptionalString(input.secondaryLinkText ?? existing.secondaryLinkText),
    secondaryLinkUrl: cleanOptionalString(input.secondaryLinkUrl ?? existing.secondaryLinkUrl),
    mainImage: cleanOptionalString(input.mainImage ?? existing.mainImage),
    thumbnailOne: cleanOptionalString(input.thumbnailOne ?? existing.thumbnailOne),
    thumbnailTwo: cleanOptionalString(input.thumbnailTwo ?? existing.thumbnailTwo),
    thumbnailThree: cleanOptionalString(input.thumbnailThree ?? existing.thumbnailThree),
    sourceCollectionId: cleanOptionalString(input.sourceCollectionId ?? existing.sourceCollectionId),
    itemCount: toInteger(input.itemCount ?? existing.itemCount, 0),
    isActive: normalizeBoolean(input.isActive ?? existing.isActive),
    isFeatured: normalizeBoolean(input.isFeatured ?? existing.isFeatured),
    displayOrder: toInteger(input.displayOrder ?? existing.displayOrder, 0),
    createdAt: existing.createdAt || input.createdAt || now,
    updatedAt: now,
  };

  return collection;
}

// Publishing rules that mirror the front-end contract: an active record must be
// renderable (heading + all three images) so the homepage never shows a broken
// gallery.
function validateHeroCollection(collection: any) {
  const errors: Record<string, string> = {};

  if (!collection.title) errors.title = "Collection title is required.";

  if (collection.isActive) {
    if (!collection.headingLineOne && !collection.headingLineTwo) {
      errors.heading = "Add at least one heading line before publishing.";
    }
    if (!collection.sourceCollectionId) {
      errors.sourceCollectionId = "Select a source collection before publishing.";
    }
  }

  return errors;
}

function toRow(collection: any) {
  return {
    id: collection.id,
    title: collection.title,
    slug: collection.slug,
    season_label: collection.seasonLabel,
    collection_label: collection.collectionLabel,
    heading_line_one: collection.headingLineOne,
    heading_line_two: collection.headingLineTwo,
    description: collection.description,
    primary_button_text: collection.primaryButtonText,
    primary_button_url: collection.primaryButtonUrl,
    secondary_link_text: collection.secondaryLinkText,
    secondary_link_url: collection.secondaryLinkUrl,
    main_image: collection.mainImage,
    thumbnail_one: collection.thumbnailOne,
    thumbnail_two: collection.thumbnailTwo,
    thumbnail_three: collection.thumbnailThree,
    source_collection_id: collection.sourceCollectionId,
    item_count: collection.itemCount,
    is_active: collection.isActive,
    is_featured: collection.isFeatured,
    display_order: collection.displayOrder,
    created_at: collection.createdAt,
    updated_at: collection.updatedAt,
  };
}

export async function getHeroCollections() {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("hero_collections")
    .select("*")
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data || []).map(heroCollectionFromRow);
}

export async function createHeroCollection(input: any) {
  const collection = normalizeHeroCollection(input);
  const errors = validateHeroCollection(collection);
  if (Object.keys(errors).length) return { ok: false, errors };

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("hero_collections")
    .insert(toRow(collection))
    .select("*")
    .single();

  if (error) throw error;
  return { ok: true, collection: heroCollectionFromRow(data) };
}

export async function updateHeroCollection(id: string, input: any) {
  const supabase = createServiceRoleClient();
  const { data: existingRow, error: readError } = await supabase
    .from("hero_collections")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (readError) throw readError;
  if (!existingRow) return { ok: false, errors: { collection: "Collection not found." } };

  const existing = heroCollectionFromRow(existingRow);
  const collection = normalizeHeroCollection(input, existing);
  const errors = validateHeroCollection(collection);
  if (Object.keys(errors).length) return { ok: false, errors };

  const { created_at, id: _ignoredId, ...updates } = toRow(collection);
  const { data, error } = await supabase
    .from("hero_collections")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return { ok: true, collection: heroCollectionFromRow(data) };
}

export async function deleteHeroCollection(id: string) {
  const supabase = createServiceRoleClient();
  const { error, count } = await supabase
    .from("hero_collections")
    .delete({ count: "exact" })
    .eq("id", id);

  if (error) throw error;
  if (!count) return { ok: false, errors: { collection: "Collection not found." } };

  return { ok: true };
}

function firstProductImage(product: any = {}) {
  return (
    product.thumbnail ||
    (Array.isArray(product.images) && product.images[0]) ||
    (Array.isArray(product.mockups) && product.mockups[0]) ||
    ""
  );
}

// Resolve the images for a hero record from a real product collection: the
// first child collection supplies the main image, and the next three children
// supply the thumbnails. When a collection has fewer than four children we fall
// back to the collection's own product images so the gallery is always full.
export async function resolveHeroImages(sourceCollectionId: string) {
  if (!sourceCollectionId) return null;

  const collections = await getProductCollections();
  const collection = collections.find((item) => item.id === sourceCollectionId);
  if (!collection) return null;

  const suite = await getCollectionSuite(collection.slug);
  if (!suite) return null;

  const children = Array.isArray(suite.subCollections) ? suite.subCollections : [];
  const childImages = children.map((child: any) => firstProductImage((child.products || [])[0] || {}));
  const productImages = (Array.isArray(suite.products) ? suite.products : []).map(firstProductImage);

  // Child images first (in order), then product images, de-duplicated.
  const images: string[] = [];
  for (const image of [...childImages, ...productImages]) {
    if (image && !images.includes(image)) images.push(image);
  }

  return {
    collectionId: collection.id,
    collectionName: collection.name,
    collectionSlug: collection.slug,
    images,
    childCount: children.length,
    productCount: Array.isArray(suite.products) ? suite.products.length : 0,
  };
}

// The homepage renders the active, featured record with the lowest display
// order, with its images resolved from the linked product collection. Returns
// null when nothing qualifies (or the collection yields no images) so the
// section hides gracefully.
export async function getFeaturedHeroCollection() {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("hero_collections")
    .select("*")
    .eq("is_active", true)
    .eq("is_featured", true)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const collection = heroCollectionFromRow(data);
  const resolved = await resolveHeroImages(collection.sourceCollectionId);
  if (!resolved || !resolved.images.length) return null;

  // Never emit an empty image src (next/image would throw): pad the four slots
  // by cycling through whatever images the collection provides.
  const pool = resolved.images;
  const pick = (index: number) => pool[index] || pool[index % pool.length] || pool[0];

  return {
    ...collection,
    sourceCollectionName: resolved.collectionName,
    sourceCollectionSlug: resolved.collectionSlug,
    mainImage: pool[0],
    thumbnailOne: pick(1),
    thumbnailTwo: pick(2),
    thumbnailThree: pick(3),
  };
}
