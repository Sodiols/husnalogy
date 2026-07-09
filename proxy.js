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
    const destination = profile?.role === "admin" ? "/admin/dashboard" : "/account";
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

    if (!user) {
      if (pathname.startsWith("/api/admin")) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }

      return notFoundPage(request);
    }

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();

    if (profile?.role !== "admin") {
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
