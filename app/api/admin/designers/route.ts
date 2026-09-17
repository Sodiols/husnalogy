import { requireAdmin } from "@/lib/auth/admin-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { logServerFailure } from "@/lib/core/server-errors";

/**
 * GET /api/admin/designers
 *
 * The designers an admin may assign work to. Admin-only: this is a list of
 * staff accounts, and a designer has no reason to enumerate their colleagues.
 *
 * Returns only what the review queue and the assignment control need — id, name
 * and email — never the whole profile row.
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("id,full_name,email")
      .eq("role", "designer")
      .order("full_name", { ascending: true });
    if (error) throw error;

    return Response.json({
      ok: true,
      designers: (data || []).map((row) => ({
        id: row.id,
        name: row.full_name || "",
        email: row.email || "",
      })),
    });
  } catch (error) {
    logServerFailure("Could not load designers", error);
    return Response.json({ ok: false, error: "Designers could not be loaded." }, { status: 500 });
  }
}
