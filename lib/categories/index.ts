import { createId, nowIso } from "@/lib/core/id";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { cleanOptionalString, cleanString, isValidSlug } from "@/lib/validation";

const CATEGORY_STATUSES = new Set(["draft", "active", "hidden"]);

function slugify(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function categoryFromRow(row: any = {}) {
  return {
    id: row.id,
    name: row.name || "",
    slug: row.slug || "",
    description: row.description || "",
    parentCategory: row.parent_category || "",
    status: row.status || "active",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

function normalizeCategory(input: any, existing: any = {}) {
  const now = nowIso();
  const name = cleanString(input.name ?? existing.name);
  const slug = cleanString(input.slug ?? existing.slug).toLowerCase() || slugify(name);
  const status = CATEGORY_STATUSES.has(input.status) ? input.status : existing.status || "active";

  return {
    id: existing.id || cleanString(input.id) || createId("category"),
    name,
    slug,
    description: cleanOptionalString(input.description ?? existing.description),
    parentCategory: cleanOptionalString(input.parentCategory ?? input.parent_category ?? existing.parentCategory),
    status,
    createdAt: existing.createdAt || input.createdAt || now,
    updatedAt: now,
  };
}

function validateCategory(category: any) {
  const errors: any = {};
  if (!category.name) errors.name = "Category name is required.";
  if (!category.slug) errors.slug = "Category slug is required.";
  if (category.slug && !isValidSlug(category.slug)) {
    errors.slug = "Use lowercase letters, numbers and single hyphens only.";
  }
  return errors;
}

function toCategoryRow(category) {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description || null,
    parent_category: category.parentCategory || null,
    status: category.status,
    created_at: category.createdAt,
    updated_at: category.updatedAt,
  };
}

export async function getCategories(includeInactive = false) {
  const supabase = createServiceRoleClient();
  let query = supabase.from("categories").select("*").order("name", { ascending: true });

  if (!includeInactive) query = query.eq("status", "active");

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map(categoryFromRow);
}

async function assertUniqueSlug(slug, idToIgnore = null) {
  const supabase = createServiceRoleClient();
  let query = supabase.from("categories").select("id").eq("slug", slug).limit(1);
  if (idToIgnore) query = query.neq("id", idToIgnore);

  const { data, error } = await query;
  if (error) throw error;

  return !data?.length;
}

export async function createCategory(input) {
  const category = normalizeCategory(input);
  const errors = validateCategory(category);

  if (Object.keys(errors).length) return { ok: false, errors };
  if (!(await assertUniqueSlug(category.slug))) {
    return { ok: false, errors: { slug: "This slug already exists." } };
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("categories")
    .insert(toCategoryRow(category))
    .select("*")
    .single();

  if (error) throw error;
  return { ok: true, category: categoryFromRow(data) };
}

export async function updateCategory(id, input) {
  const categories = await getCategories(true);
  const existing = categories.find((category) => category.id === id);

  if (!existing) {
    return { ok: false, errors: { category: "Category not found." } };
  }

  const category = normalizeCategory(input, existing);
  const errors = validateCategory(category);

  if (Object.keys(errors).length) return { ok: false, errors };
  if (!(await assertUniqueSlug(category.slug, id))) {
    return { ok: false, errors: { slug: "This slug already exists." } };
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("categories")
    .update(toCategoryRow(category))
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (!data) return { ok: false, errors: { category: "Category not found." } };

  return { ok: true, category: categoryFromRow(data) };
}

export async function deleteCategory(id) {
  const supabase = createServiceRoleClient();
  const { error, count } = await supabase.from("categories").delete({ count: "exact" }).eq("id", id);

  if (error) throw error;
  if (!count) return { ok: false, errors: { category: "Category not found." } };

  return { ok: true };
}
