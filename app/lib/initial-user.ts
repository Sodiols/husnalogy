import { createClient } from "@/lib/supabase/server";
import { logServerFailure } from "@/lib/core/server-errors";
import { formatSupabaseUser } from "./format-user";

/**
 * The signed-in user as the SERVER sees it, for client pages that call
 * `useAuth(initialUser)`: the server HTML then renders the same signed-in
 * state the browser starts from, instead of a loading state that React has to
 * throw away during hydration.
 */
export async function getInitialUser() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return null;

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name,email,role,avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    return formatSupabaseUser(user, profile);
  } catch (error) {
    logServerFailure("Could not resolve server-side auth state", error);
    return null;
  }
}
