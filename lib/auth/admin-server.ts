import { createClient } from "@/lib/supabase/server";

export async function getCurrentAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id,email,full_name,role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "admin") return null;

  return {
    id: user.id,
    email: profile.email || user.email || "",
    name: profile.full_name || user.email?.split("@")[0] || "Admin",
    role: "admin",
  };
}

export async function requireAdmin() {
  const admin = await getCurrentAdmin();

  if (!admin) {
    return { ok: false, response: Response.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  }

  return { ok: true, admin };
}

