import { createClient } from "@/lib/supabase/server";
import {
  customizationFromRow,
  customizationUpdateRow,
} from "@/lib/customizer/customizations";

async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// GET /api/customizations/[id] — RLS scopes this to the owner (or admin).
export async function GET(_request: Request, { params }: any) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const { data, error } = await supabase.from("product_customizations").select("*").eq("id", id).maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return Response.json({ ok: false, error: "Not found." }, { status: 404 });

  return Response.json({ ok: true, customization: customizationFromRow(data) });
}

// PATCH /api/customizations/[id] — update your own customization. RLS blocks
// updates to rows that are not yours.
export async function PATCH(request: Request, { params }: any) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const row = customizationUpdateRow(body);

  const { data, error } = await supabase
    .from("product_customizations")
    .update(row)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return Response.json({ ok: false, error: "Not found." }, { status: 404 });

  return Response.json({ ok: true, customization: customizationFromRow(data) });
}

export async function DELETE(_request: Request, { params }: any) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return Response.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const { error } = await supabase.from("product_customizations").delete().eq("id", id);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
