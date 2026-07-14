import { createServiceRoleClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/security/rate-limit";
import { assetFromRow, categoryFromRow } from "@/lib/customizer/assets";

// GET /api/customizer/elements — the customer-facing elements library
// (spec §14): active, customer-available assets with search, category filter,
// and pagination. Elements live in a public bucket, so URLs are stable.
export async function GET(request: Request) {
  const limited = rateLimit(request, { name: "customizer-elements", limit: 120, windowMs: 10 * 60 * 1000 });
  if (limited) return limited;

  const url = new URL(request.url);
  const search = (url.searchParams.get("search") || "").trim().slice(0, 120);
  const categoryId = (url.searchParams.get("category") || "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.max(1, Math.min(60, Number(url.searchParams.get("pageSize")) || 30));

  const supabase = createServiceRoleClient();

  let query = supabase
    .from("customizer_assets")
    .select("*", { count: "exact" })
    .eq("active", true)
    .eq("archived", false)
    .eq("customer_available", true)
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (categoryId) query = query.eq("category_id", categoryId);
  if (search) query = query.or(`title.ilike.%${search}%,keywords.ilike.%${search}%`);

  const [{ data, error, count }, { data: categories }] = await Promise.all([
    query,
    supabase.from("customizer_asset_categories").select("*").eq("active", true).order("sort_order"),
  ]);
  if (error) {
    console.error("List elements failed:", error);
    return Response.json({ ok: false, error: "Could not load elements." }, { status: 500 });
  }

  return Response.json({
    ok: true,
    elements: (data || []).map(assetFromRow),
    categories: (categories || []).map(categoryFromRow),
    total: count || 0,
    page,
    pageSize,
  });
}
