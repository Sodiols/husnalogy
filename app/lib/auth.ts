"use client";

import { getSafeRedirectPath as toSafePath, normalizeRole, resolvePostLoginPath } from "@/lib/auth/redirects";
import { getConfiguredSiteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/client";
import { clearCustomerCommerceData } from "./customer-lists";

function authError(message, code = "auth/error") {
  const error: any = new Error(message);
  error.code = code;
  return error;
}

function getOrigin() {
  // Redirect back to whichever domain the flow was started from, so the PKCE
  // verifier cookie and the resulting session stay on the same host (apex or
  // www). The exception is `next dev -H 0.0.0.0`, which reports the
  // unbrowsable bind address 0.0.0.0; NEXT_PUBLIC_SITE_URL is used there and
  // when window isn't available at all.
  const configured = getConfiguredSiteUrl();
  if (typeof window === "undefined") return configured;

  const { origin, hostname } = window.location;
  if (hostname !== "0.0.0.0") return origin;
  return configured || origin.replace("0.0.0.0", "localhost");
}

export function getSafeRedirectPath(value = "/") {
  return toSafePath(value);
}

/**
 * Where to send a user who just signed in with a password.
 *
 * Uses the same resolver as the OAuth callback (lib/auth/redirects.ts): admin →
 * /admin/dashboard, designer → /designer, customer → the requested storefront
 * page. The role is read from the user's own `profiles` row (RLS allows a user
 * to read only their own); a failed lookup routes as a customer. This is
 * routing only — every workspace re-checks the role on the server.
 */
export async function getPostLoginRedirectPath(user, next = "/") {
  if (!user?.id) return resolvePostLoginPath(null, next);

  try {
    const supabase = createClient();
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (error) throw error;
    return resolvePostLoginPath(normalizeRole(profile?.role), next);
  } catch (error) {
    console.warn("Could not resolve post-login role:", error?.message || error);
  }

  return resolvePostLoginPath(null, next);
}

export async function createUserWithEmailAndPassword(email, password, name) {
  const supabase = createClient();
  const fullName = String(name || "").trim();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
      },
      emailRedirectTo: `${getOrigin()}/auth/callback?next=/`,
    },
  });

  if (error) throw error;

  const user = data.user;

  if (user) {
    const { error: profileError } = await supabase.from("profiles").upsert({
      id: user.id,
      full_name: fullName || user.email?.split("@")[0] || "Husnalogy customer",
      email: String(user.email || email).toLowerCase(),
      role: "customer",
      avatar_url: user.user_metadata?.avatar_url || null,
      updated_at: new Date().toISOString(),
    });

    if (profileError) {
      console.warn("Supabase profile upsert skipped after signup:", profileError.message);
    }
  }

  return data;
}

export async function signInWithEmailAndPassword(email, password) {
  const supabase = createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function sendPasswordResetEmail(email) {
  const supabase = createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${getOrigin()}/auth/callback?next=/reset-password`,
  });
  if (error) throw error;
}

export async function updateUserPassword(password) {
  const supabase = createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

export async function signInWithGoogle(next = "/") {
  const supabase = createClient();
  const redirectTo = `${getOrigin()}/auth/callback?next=${encodeURIComponent(getSafeRedirectPath(next))}`;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      queryParams: {
        prompt: "select_account",
      },
    },
  });

  if (error) throw error;
  return data;
}

export async function logoutUser() {
  const supabase = createClient();
  clearCustomerCommerceData();
  const { error } = await supabase.auth.signOut();
  if (error) throw authError(error.message, error.code || "auth/sign-out-failed");
}
