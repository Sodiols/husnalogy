export function formatSupabaseUser(user, profile: any = null) {
  if (!user) return null;

  const metadata = user.user_metadata || {};
  const fullName =
    profile?.full_name ||
    metadata.full_name ||
    metadata.name ||
    user.email?.split("@")[0] ||
    "User";

  return {
    uid: user.id,
    id: user.id,
    name: fullName,
    email: user.email || profile?.email || "",
    photoURL: profile?.avatar_url || metadata.avatar_url || metadata.picture || "",
    role: profile?.role || "customer",
  };
}
