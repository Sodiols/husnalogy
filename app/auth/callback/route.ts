import { NextResponse } from "next/server";
import { getSafeRedirectPath as toSafePath, normalizeRole, resolvePostLoginPath } from "@/lib/auth/redirects";
import { resolveRequestOrigin } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

function getSafeRedirectPath(value: string | null) {
  return toSafePath(value || "/");
}

// A password-recovery link must always land on the reset form. It must never
// be re-pointed by the post-login role redirect below, or an admin clicking
// "forgot password" would be dropped on the dashboard and could never reach
// the form that changes their password.
function getRecoveryRedirectPath(next: string) {
  const safePath = getSafeRedirectPath(next);
  return safePath === "/" ? "/reset-password" : safePath;
}

async function getPostCallbackRedirectPath(supabase, next: string) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.id) return resolvePostLoginPath(null, next);

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (error) throw error;

    // One resolver for every sign-in path (lib/auth/redirects.ts), so OAuth
    // and email/password can never route the same account differently.
    return resolvePostLoginPath(normalizeRole(profile?.role), next);
  } catch (error) {
    console.warn("Could not resolve post-login role:", error?.message || error);
  }

  // A role that could not be read is treated as a customer: never a workspace.
  return resolvePostLoginPath(null, next);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  // Never the internal bind address the Node server sees behind the proxy.
  const origin = resolveRequestOrigin(request);
  const code = url.searchParams.get("code");
  // Supabase delivers a recovery/confirmation link in one of three shapes
  // depending on the project's email template and auth flow: a PKCE `code`, a
  // `token_hash` + `type` pair ({{ .TokenHash }} templates), or implicit-flow
  // tokens in the URL hash. All three must work, because the template lives in
  // the Supabase dashboard and this code cannot see which one is configured.
  const tokenHash = url.searchParams.get("token_hash");
  const otpType = url.searchParams.get("type");
  const nextParam = url.searchParams.get("next");
  const next = getSafeRedirectPath(nextParam);
  // The PKCE shape carries only `?code=`, with no `type`, so the recovery
  // target set by sendPasswordResetEmail() is the other reliable signal.
  const isRecovery = otpType === "recovery" || next.startsWith("/reset-password");

  // A failed recovery is sent back to the request form, not the login form —
  // the user has no working password, so "log in instead" is a dead end.
  const failurePath = isRecovery ? "/forgot-password" : "/login";
  const fail = (message: string) =>
    NextResponse.redirect(
      new URL(`${failurePath}?error=${encodeURIComponent(message)}`, origin)
    );

  const providerError =
    url.searchParams.get("error_description") || url.searchParams.get("error");

  if (providerError) return fail(providerError);

  if (!code && !tokenHash) {
    // Implicit-flow links deliver tokens via a URL hash fragment, which this
    // route handler (and every server) never sees — browsers don't send
    // fragments over the wire. Hand off to a client page that can read
    // window.location.hash; the browser preserves the fragment across this
    // redirect since the Location header has none.
    const finishUrl = new URL("/auth/callback/finish", origin);
    if (nextParam) finishUrl.searchParams.set("next", nextParam);
    if (otpType) finishUrl.searchParams.set("type", otpType);
    return NextResponse.redirect(finishUrl);
  }

  const supabase = await createClient();

  const { error } = tokenHash
    ? await supabase.auth.verifyOtp({
        type: (otpType || "recovery") as any,
        token_hash: tokenHash,
      })
    : await supabase.auth.exchangeCodeForSession(code as string);

  if (error) return fail(error.message);

  const redirectPath = isRecovery
    ? getRecoveryRedirectPath(next)
    : await getPostCallbackRedirectPath(supabase, next);

  return NextResponse.redirect(new URL(redirectPath, origin));
}
