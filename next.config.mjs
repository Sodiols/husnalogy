const isDev = process.env.NODE_ENV === "development";

/**
 * The Husnalogy Supabase project host (e.g. abcd1234.supabase.co), derived from
 * NEXT_PUBLIC_SUPABASE_URL so images, the CSP and storage URLs trust exactly
 * one project instead of every *.supabase.co tenant. NEXT_PUBLIC_ values are
 * inlined at build time, so this must be set wherever `npm run build` runs.
 */
function resolveSupabaseHost() {
  const raw = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw.replace(/\/rest\/v1\/?$/i, "")).host;
  } catch {
    return "";
  }
}

const supabaseHost = resolveSupabaseHost();

/**
 * ONE canonical production host. The site is served only on the host of
 * NEXT_PUBLIC_SITE_URL; its www / apex twin answers with a permanent redirect
 * to the same path and query on the canonical host. Mutation requests are
 * only accepted from the canonical origin (lib/security/same-origin), so
 * serving both hosts independently would break every form on the other one.
 */
export function canonicalHostRedirects(siteUrl = process.env.NEXT_PUBLIC_SITE_URL) {
  let site;
  try {
    site = new URL(String(siteUrl || "").trim());
  } catch {
    return [];
  }
  if (site.protocol !== "https:" || !site.hostname.includes(".") || /^[\d.]+$/.test(site.hostname) || site.hostname === "localhost") return [];
  const twin = site.hostname.startsWith("www.") ? site.hostname.slice(4) : `www.${site.hostname}`;
  return [
    {
      source: "/:path*",
      has: [{ type: "host", value: twin }],
      destination: `${site.origin}/:path*`,
      permanent: true,
    },
  ];
}
if (!supabaseHost && process.env.NODE_ENV === "production") {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL must be set (https://<project-ref>.supabase.co) when building for production. " +
      "It is inlined into the browser bundle and used to allow Supabase storage images.",
  );
}
// NEXT_PUBLIC_SITE_URL is inlined into canonical URLs, the sitemap, robots and
// auth redirects at build time, so a wrong value cannot be fixed at runtime.
if (process.env.NODE_ENV === "production") {
  let site = null;
  try {
    site = new URL(String(process.env.NEXT_PUBLIC_SITE_URL || "").trim());
  } catch {
    site = null;
  }
  if (!site || site.protocol !== "https:" || ["localhost", "127.0.0.1", "0.0.0.0"].includes(site.hostname)) {
    throw new Error(
      "NEXT_PUBLIC_SITE_URL must be the public https origin (https://husnalogy.com) when building for production. " +
        "It is inlined into canonical URLs, the sitemap and auth redirects at build time.",
    );
  }
}

// Development without Supabase configured keeps working against any project.
// In development the configured origin is used as-is, so a local stand-in
// (http://127.0.0.1:…, see e2e/customer-stub.ts) is reachable; production
// always requires https.
function devSupabaseOrigin() {
  try {
    return isDev ? new URL(String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/rest\/v1\/?$/i, "")).origin : "";
  } catch {
    return "";
  }
}
const localSupabaseOrigin = devSupabaseOrigin().startsWith("http://") ? devSupabaseOrigin() : "";
const supabaseSource = localSupabaseOrigin || (supabaseHost ? `https://${supabaseHost}` : "https://*.supabase.co");
const supabaseSocket = localSupabaseOrigin ? localSupabaseOrigin.replace(/^http/, "ws") : supabaseHost ? `wss://${supabaseHost}` : "wss://*.supabase.co";

// Next.js injects inline runtime scripts (the RSC payload) and Tailwind uses
// inline styles, so 'unsafe-inline' stays; 'unsafe-eval' is only needed by the
// dev bundler. RESIDUAL HARDENING ITEM (documented in HOSTINGER_DEPLOYMENT.md):
// a strict script-src needs per-request nonces, which force dynamic rendering
// of every page and the proxy on every HTML request; SRI hashes only cover
// external chunks, not the inline payload. Not done in this release.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://cdnjs.cloudflare.com https://fonts.gstatic.com",
  `connect-src 'self' ${supabaseSource} ${supabaseSocket}`,
  `media-src 'self' blob: ${supabaseSource}`,
  "object-src 'none'",
  // Husnalogy embeds no frames (sign-in is a full-page redirect).
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  // Isolates the browsing context from cross-origin windows it opens or is
  // opened by. Supabase OAuth uses full-page redirects (not popups), so this
  // does not affect sign-in.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
];

const immutableAssetHeaders = [
  { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
  { key: "X-Content-Type-Options", value: "nosniff" },
];

const noIndexHeaders = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Test infrastructure only: an isolated e2e server (stubbed Supabase, see
  // e2e/customer-stub.ts) builds into its own folder, so it can run while a
  // normal dev server holds `.next`. Never used by production builds.
  ...(process.env.NEXT_DIST_DIR && process.env.NODE_ENV !== "production" ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  allowedDevOrigins: ["192.168.0.206", "127.0.0.1"],
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  // Native/server-only packages the bundler must not try to chunk. resvg and
  // sharp ship platform-specific .node bindings used by the render pipeline.
  serverExternalPackages: ["@resvg/resvg-js", "sharp"],
  images: {
    formats: ["image/avif", "image/webp"],
    // Only the PUBLIC catalogue buckets of THIS project, without query strings.
    // Private buckets (customer uploads, production files, renders, admin
    // assets) and signed URLs can never be fetched or cached by the optimizer.
    remotePatterns: ["product-images", "product-mockups", "site-assets"].map((bucket) => ({
      protocol: "https",
      hostname: supabaseHost || "*.supabase.co",
      port: "",
      pathname: `/storage/v1/object/public/${bucket}/**`,
      search: "",
    })),
    // A trusted host must not bounce the optimizer elsewhere (redirect targets
    // are not re-checked against remotePatterns).
    maximumRedirects: 0,
    // Admin image uploads are capped at 15 MB.
    maximumResponseBody: 16_000_000,
    dangerouslyAllowLocalIP: false,
    // Explicit secure defaults: no SVG through the optimizer; a direct visit to
    // an optimized image downloads it, and it can never run script.
    dangerouslyAllowSVG: false,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/images/:path*",
        headers: immutableAssetHeaders,
      },
      {
        source: "/icons/:path*",
        headers: immutableAssetHeaders,
      },
      {
        source: "/Brand Kit/:path*",
        headers: immutableAssetHeaders,
      },
      // JSON and redirect responses cannot carry a robots meta tag.
      { source: "/api/:path*", headers: noIndexHeaders },
      { source: "/auth/:path*", headers: noIndexHeaders },
    ];
  },
  async redirects() {
    return [
      ...canonicalHostRedirects(),
      { source: "/best-seller", destination: "/products", permanent: true },
      { source: "/personalizations", destination: "/products", permanent: true },
      { source: "/homeandliving", destination: "/products", permanent: true },
    ];
  },
};

export default nextConfig;
