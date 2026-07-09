import { createClient } from "@/lib/supabase/server";
import {
  customizationFromRow,
  customizationInsertRow,
  customizationUpdateRow,
} from "@/lib/customizer/customizations";

// GET /api/customizations — list customizations visible to the caller.
// RLS restricts this to the caller's own rows (or all rows for admins).
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const productId = url.searchParams.get("productId");
  const templateId = url.searchParams.get("templateId");
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") || 50)));

  let query = supabase.from("product_customizations").select("*").order("updated_at", { ascending: false });
  if (status) query = query.eq("status", status);
  if (productId) query = query.eq("product_id", productId);
  if (templateId) query = query.eq("template_id", templateId);
  query = query.limit(limit);

  const { data, error } = await query;
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  return Response.json({ ok: true, customizations: (data || []).map(customizationFromRow) });
}

// POST /api/customizations — create (or save a draft of) a customization.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const requestedId = String(body.customizationId || body.id || "").trim();

  if (requestedId && !requestedId.startsWith("local_")) {
    const { data, error } = await supabase
      .from("product_customizations")
      .update(customizationUpdateRow(body))
      .eq("id", requestedId)
      .select("*")
      .maybeSingle();
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    if (data) return Response.json({ ok: true, customization: customizationFromRow(data) });
  }

  const row = customizationInsertRow(user.id, body);

  const { data, error } = await supabase.from("product_customizations").insert(row).select("*").single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  return Response.json({ ok: true, customization: customizationFromRow(data) });
}
