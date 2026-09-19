/**
 * The public origin of the site.
 *
 * Production runs `next start` bound to 0.0.0.0 behind Hostinger's reverse
 * proxy, so the Host the Node process sees can be an internal bind address
 * (0.0.0.0, localhost, 127.0.0.1). Building a redirect, callback or canonical
 * URL from that would send a customer to an address that does not exist, so
 * production always resolves to NEXT_PUBLIC_SITE_URL (or its www twin).
 *
 * Client-safe: only NEXT_PUBLIC_ values are read.
 */

const PRODUCTION_SITE_URL = "https://husnalogy.com";

const LOCAL_HOSTNAMES = new Set(["0.0.0.0", "localhost", "127.0.0.1", "[::1]", "::1"]);

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

/** NEXT_PUBLIC_SITE_URL normalized to a bare origin, or "" when unset/invalid. */
export function getConfiguredSiteUrl(): string {
  const raw = String(process.env.NEXT_PUBLIC_SITE_URL || "").trim();
  if (!raw) return "";
  try {
    return stripTrailingSlashes(new URL(raw).origin);
  } catch {
    return "";
  }
}

/** Canonical origin for metadata, sitemap, robots and absolute links. */
export function getSiteUrl(): string {
  return getConfiguredSiteUrl() || PRODUCTION_SITE_URL;
}

export function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTNAMES.has(String(hostname || "").toLowerCase());
}

/** The apex and www form of a hostname, so either is accepted as "ours". */
function hostVariants(host: string): Set<string> {
  const lower = host.toLowerCase();
  const apex = lower.startsWith("www.") ? lower.slice(4) : lower;
  return new Set([apex, `www.${apex}`]);
}

function firstHeaderValue(value: string | null): string {
  return String(value || "").split(",")[0].trim();
}

/**
 * The public origin a server route should redirect back to.
 *
 * In production the forwarded host is honoured only when it is the configured
 * site (apex or www) — so the session cookie set on that host stays usable —
 * and anything else (an internal bind address, a spoofed Host header) falls
 * back to NEXT_PUBLIC_SITE_URL. Development keeps following the request so
 * LAN and localhost testing work.
 */
export function resolveRequestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = firstHeaderValue(request.headers.get("x-forwarded-host")) || request.headers.get("host") || url.host;
  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  const protocol = forwardedProto ? `${forwardedProto}:` : url.protocol;
  const hostname = host.replace(/:\d+$/, "");
  const configured = getConfiguredSiteUrl();

  if (isProduction()) {
    const site = configured || PRODUCTION_SITE_URL;
    const siteHost = new URL(site).host;
    if (hostVariants(siteHost).has(host.toLowerCase())) {
      return `${new URL(site).protocol}//${host.toLowerCase()}`;
    }
    return site;
  }

  if (hostname !== "0.0.0.0") return `${protocol}//${host}`;

  // `next dev -H 0.0.0.0` is not a browsable address.
  return configured || `${protocol}//${host.replace("0.0.0.0", "localhost")}`;
}
