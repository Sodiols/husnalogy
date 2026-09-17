import { NextResponse } from "next/server";
import { homePathForRole, isForbiddenWorkspacePath, normalizeRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

function getSafeRedirectPath(value: string | null) {
  const next = String(value || "/");
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  if (next.startsWith("/login") || next.startsWith("/signup")) return "/";
  return next;
}

function getOrigin(request: Request, url: URL) {
  // Always redirect back to whichever domain/deployment the flow was started
  // from — localhost, a Vercel preview URL, or a custom domain — instead of a
  // single hardcoded origin, so auth works no matter where the app is
  // deployed. Behind Vercel's proxy, x-forwarded-host/proto reflect the
  // public request; url.host/protocol are the reliable local fallback.
  // Mirrors getOrigin() in app/lib/auth.ts.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = forwardedHost || request.headers.get("host") || url.host;
  const protocol = forwardedProto ? `${forwardedProto}:` : url.protocol;

  if (!host.startsWith("0.0.0.0")) return `${protocol}//${host}`;

  // `next dev -H 0.0.0.0` binds to all interfaces, which isn't a real
  // browsable address; fall back to the configured site URL, then localhost.
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  return `${protocol}//${host.replace("0.0.0.0", "localhost")}`;
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
  const safePath = getSafeRedirectPath(next);

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.id) return safePath.startsWith("/admin") ? "/" : safePath;

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (error) throw error;

    // Each role lands in the workspace that exists for it. A designer sent to
    // /admin/dashboard would get a 404, which is exactly what used to happen.
    // The mapping lives in the capability layer, not here.
    const role = normalizeRole(profile?.role);
    const home = homePathForRole(role);
    if (home !== "/") {
      // Honour an explicit `next` only when the role may actually open it.
      return isForbiddenWorkspacePath(role, safePath) ? home : safePath === "/" ? home : safePath;
    }
  } catch (error) {
    console.warn("Could not resolve post-login role:", error?.message || error);
  }

  // Customers (and anyone whose role could not be read) never land in /admin.
  return safePath.startsWith("/admin") || safePath.startsWith("/designer") ? "/" : safePath;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = getOrigin(request, url);
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
