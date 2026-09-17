import CheckoutClient from "./checkout-client";
import { createClient } from "@/lib/supabase/server";
import { formatSupabaseUser } from "../lib/format-user";
import { logServerFailure } from "@/lib/core/server-errors";

export const metadata = {
  title: "Checkout",
  description: "Place your Husnalogy order request.",
};

async function getInitialUser() {
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
    logServerFailure("Could not resolve checkout auth state", error);
    return null;
  }
}

export default async function CheckoutPage() {
  const initialUser = await getInitialUser();

  return <CheckoutClient initialUser={initialUser} />;
}
