import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PROTECTED_PREFIXES = [
  "/account",
  "/account/orders",
  "/account/wishlist",
  "/profile",
  "/orders",
  "/favorites",
  "/saved-addresses",
  "/cart",
  "/checkout",
];

const ADMIN_PREFIXES = [
  "/admin",
  "/admin/products",
  "/admin/orders",
  "/admin/customers",
  "/admin/reviews",
  "/api/admin",
];

// The render worker endpoint authenticates itself with a Bearer CRON_SECRET
// (Vercel Cron) or x-render-secret, and never carries a Supabase session. The
// proxy must not answer 401 before the route can validate that secret. Only the
// short-circuit is skipped — the route still validates the secret with a
// timing-safe compare and fails closed on a wrong or missing one.
const WORKER_PATHS = new Set(["/api/admin/customizer/render/process"]);

/**
 * Paths under /api/admin that the DESIGN STUDIO legitimately uses.
 *
 * The proxy is a coarse gate: it answers "is this person allowed anywhere near
 * this area" before the route runs. Because it matched every /api/admin path and
 * demanded `role === "admin"`, a designer was rejected here and the per-route
 * capability guards were never reached — the API changes alone did nothing.
 *
 * This is an ALLOWLIST, deliberately: adding a new admin route keeps the strict
 * default, and only a path named here is reachable by a designer. The real
 * decision still belongs to the route handler, which checks the capability AND
 * (for anything product-scoped) re-reads ownership from the database. Nothing
 * here grants access on its own.
 *
 * Publishing, orders, settings, users, backups and permanent deletion are
 * absent, and must stay absent.
 */
const STUDIO_API_PREFIXES = [
  "/api/admin/products",            // create/list/update + the workflow endpoint
  "/api/admin/uploads",             // product images, mockups, videos
  "/api/admin/collections",         // read-only picker data for the product form
  "/api/admin/customizer/assets",
  "/api/admin/customizer/asset-categories",
  "/api/admin/customizer/asset-folders",
  "/api/admin/customizer/feature-flags",
  "/api/admin/customizer/mockups",
  "/api/admin/customizer/templates",
];

/**
 * Paths a designer must NEVER reach, even though they sit under a studio
 * prefix. Checked first, so the allowlist above cannot accidentally open them.
 */
const STUDIO_API_DENY = [
  "/publish",                       // design + mockup publishing is admin-only
  "/permanent-delete",
];

function isStudioApiPath(pathname) {
  if (STUDIO_API_DENY.some((segment) => pathname.endsWith(segment))) return false;
  return STUDIO_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function carriesWorkerCredential(request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ") || Boolean(request.headers.get("x-render-secret"));
}

function isPathMatch(pathname, prefixes) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function safeNextPath(request) {
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function notFoundPage(request) {
  return NextResponse.rewrite(new URL("/404", request.url), { status: 404 });
}

function normalizeSupabaseUrl(value) {
  return String(value || "").replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/g, "");
}

function getSupabasePublicKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ""
  );
}

export async function proxy(request) {
  let response = NextResponse.next({ request });
  const supabaseUrl = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseKey = getSupabasePublicKey();

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      {
        ok: false,
        error: "Supabase auth is not configured.",
        required: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
      },
      { status: 500 }
    );
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { pathname } = request.nextUrl;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if ((pathname === "/login" || pathname === "/signup") && user) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    const destination =
      profile?.role === "admin" ? "/admin/dashboard" : profile?.role === "designer" ? "/designer" : "/account";
    return NextResponse.redirect(new URL(destination, request.url));
  }

  if (isPathMatch(pathname, PROTECTED_PREFIXES) && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", safeNextPath(request));
    return NextResponse.redirect(url);
  }

  if (isPathMatch(pathname, ADMIN_PREFIXES)) {
    if (pathname === "/admin/login") {
      return notFoundPage(request);
    }

    if (WORKER_PATHS.has(pathname) && carriesWorkerCredential(request)) {
      return response;
    }

    if (!user) {
      if (pathname.startsWith("/api/admin")) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }

      return notFoundPage(request);
    }

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    const role = profile?.role;

    if (role !== "admin") {
      // A designer may pass this gate for the studio APIs only. The route then
      // performs the real check: capability, and ownership of the product.
      if (role === "designer" && isStudioApiPath(pathname)) {
        return response;
      }

      if (pathname.startsWith("/api/admin")) {
        return NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 });
      }
      return notFoundPage(request);
    }
  }

  if (pathname === "/admin") {
    return NextResponse.redirect(new URL("/admin/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/login",
    "/signup",
    "/account/:path*",
    "/profile",
    "/orders",
    "/favorites",
    "/saved-addresses",
    "/cart",
    "/checkout",
    "/admin/:path*",
    "/api/admin/:path*",
  ],
};
