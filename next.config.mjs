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
const supabaseSource = supabaseHost ? `https://${supabaseHost}` : "https://*.supabase.co";
const supabaseSocket = supabaseHost ? `wss://${supabaseHost}` : "wss://*.supabase.co";

// Next.js injects inline runtime scripts and Tailwind uses inline styles, so
// 'unsafe-inline' stays; 'unsafe-eval' is only needed by the dev bundler.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://cdnjs.cloudflare.com https://fonts.gstatic.com",
  `connect-src 'self' ${supabaseSource} ${supabaseSocket}`,
  `media-src 'self' blob: ${supabaseSource}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
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

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["192.168.0.206", "127.0.0.1"],
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  // Native/server-only packages the bundler must not try to chunk. resvg and
  // sharp ship platform-specific .node bindings used by the render pipeline.
  serverExternalPackages: ["@resvg/resvg-js", "sharp"],
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      // Storage objects of THIS project only (public buckets and signed URLs).
      { protocol: "https", hostname: supabaseHost || "*.supabase.co", pathname: "/storage/v1/**" },
    ],
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
    ];
  },
  async redirects() {
    return [
      { source: "/best-seller", destination: "/products", permanent: true },
      { source: "/personalizations", destination: "/products", permanent: true },
      { source: "/homeandliving", destination: "/products", permanent: true },
    ];
  },
};

export default nextConfig;
