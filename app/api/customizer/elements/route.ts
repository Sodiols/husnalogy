import { createServiceRoleClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/security/rate-limit";
import { categoryFromRow } from "@/lib/customizer/assets";
import { signAdminAssetRows } from "@/lib/customizer/server/admin-assets";

// GET /api/customizer/elements — the customer-facing elements library
// (spec §14): active, customer-available assets with search, category filter,
// and pagination. Storage is private; every response receives fresh signed
// editor/thumbnail URLs while the database retains permanent object paths.
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
    .eq("status", "ready")
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

  try {
    return Response.json({
      ok: true,
      elements: await signAdminAssetRows(supabase, data || []),
      categories: (categories || []).map(categoryFromRow),
      total: count || 0,
      page,
      pageSize,
    });
  } catch (signError) {
    console.error("Sign customer elements failed:", signError);
    return Response.json({ ok: false, error: "Elements could not be opened securely." }, { status: 500 });
  }
}
