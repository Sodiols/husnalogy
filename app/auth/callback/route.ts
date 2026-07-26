import { NextResponse } from "next/server";
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

    if (profile?.role === "admin") {
      return safePath.startsWith("/admin") ? safePath : "/admin/dashboard";
    }
  } catch (error) {
    console.warn("Could not resolve post-login role:", error?.message || error);
  }

  return safePath.startsWith("/admin") ? "/" : safePath;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = getOrigin(request, url);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next");
  const next = getSafeRedirectPath(nextParam);

  const providerError =
    url.searchParams.get("error_description") || url.searchParams.get("error");

  if (providerError) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(providerError)}`, origin)
    );
  }

  if (!code) {
    // Magic-link/recovery emails can still deliver tokens via a URL hash
    // fragment, which this route handler (and every server) never sees —
    // browsers don't send fragments over the wire. Hand off to a client page
    // that can read window.location.hash; the browser preserves the
    // fragment across this redirect since the Location header has none.
    const finishUrl = new URL("/auth/callback/finish", origin);
    if (nextParam) finishUrl.searchParams.set("next", nextParam);
    return NextResponse.redirect(finishUrl);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, origin)
    );
  }

  const redirectPath = await getPostCallbackRedirectPath(supabase, next);
  return NextResponse.redirect(new URL(redirectPath, origin));
}
