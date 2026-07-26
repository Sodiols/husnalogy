import { requireAdmin } from "@/lib/auth/admin-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { categoryFromRow } from "@/lib/customizer/assets";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// GET /api/admin/customizer/asset-categories — list all categories.
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("customizer_asset_categories")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) return Response.json({ ok: false, error: "Could not load categories." }, { status: 500 });
  return Response.json({ ok: true, categories: (data || []).map(categoryFromRow) });
}

// POST /api/admin/customizer/asset-categories — create a category.
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim().slice(0, 120);
  if (!name) return Response.json({ ok: false, error: "Category name is required." }, { status: 400 });

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("customizer_asset_categories")
    .insert({
      name,
      slug: slugify(String(body.slug || name)),
      description: String(body.description || "").trim().slice(0, 500) || null,
      sort_order: Number(body.sortOrder) || 0,
      active: body.active !== false,
    })
    .select("*")
    .single();
  if (error) {
    const message = /duplicate/i.test(error.message) ? "A category with this slug already exists." : "Could not create the category.";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
  return Response.json({ ok: true, category: categoryFromRow(data) }, { status: 201 });
}
