import { createClient } from "@/lib/supabase/server";

export function getBearerToken(request) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

export async function getSupabaseUserFromRequest(request) {
  const supabase = await createClient();
  const bearerToken = getBearerToken(request);
  const result = bearerToken
    ? await supabase.auth.getUser(bearerToken)
    : await supabase.auth.getUser();

  const user = result.data?.user;
  if (!user || result.error) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name,email,role,avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  return {
    uid: user.id,
    id: user.id,
    email: String(user.email || profile?.email || "").toLowerCase(),
    name: profile?.full_name || user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || "Husnalogy customer",
    role: profile?.role || "customer",
    avatar_url: profile?.avatar_url || user.user_metadata?.avatar_url || null,
  };
}

