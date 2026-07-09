"use client";

import { createClient } from "@/lib/supabase/client";
import { clearCustomerCommerceData } from "./customer-lists";

function authError(message, code = "auth/error") {
  const error: any = new Error(message);
  error.code = code;
  return error;
}

function getOrigin() {
  // Always redirect back to whichever domain the flow was started from —
  // localhost, a Vercel preview URL, or a custom domain — instead of a single
  // hardcoded origin, so auth works no matter which domain the app is
  // deployed to. The only exception is `next dev -H 0.0.0.0`, which reports
  // window.location as the unbrowsable bind address 0.0.0.0 instead of
  // localhost; NEXT_PUBLIC_SITE_URL is used as a fallback there and when
  // window isn't available at all.
  if (typeof window === "undefined") {
    const configured = process.env.NEXT_PUBLIC_SITE_URL;
    return configured ? configured.replace(/\/+$/, "") : "";
  }

  const { origin, hostname } = window.location;
  if (hostname !== "0.0.0.0") return origin;

  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  return configured ? configured.replace(/\/+$/, "") : origin.replace("0.0.0.0", "localhost");
}

export function getSafeRedirectPath(value = "/") {
  const next = String(value || "/");
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  if (next.startsWith("/login") || next.startsWith("/signup")) return "/";
  return next;
}

export async function getPostLoginRedirectPath(user, next = "/") {
  const safePath = getSafeRedirectPath(next);

  if (!user?.id) {
    return safePath.startsWith("/admin") ? "/" : safePath;
  }

  try {
    const supabase = createClient();
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (error) throw error;

    if (profile?.role === "admin") {
      return safePath.startsWith("/admin") ? safePath : "/admin/dashboard";
    }
  } catch (error) {
    console.warn("Could not resolve post-login role:", error?.message || error);
  }

  return safePath.startsWith("/admin") ? "/" : safePath;
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
