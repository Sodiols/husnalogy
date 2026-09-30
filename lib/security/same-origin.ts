/**
 * CSRF defence for cookie-authenticated, state-changing API routes.
 *
 * Supabase session cookies are SameSite=Lax, and JSON endpoints require an
 * `application/json` body that a cross-site HTML form cannot produce, so a
 * classic CSRF POST already fails. This is the explicit second layer: a
 * browser always attaches `Origin` (and `Sec-Fetch-Site`) to a cross-site
 * mutation, and a request from anywhere but Husnalogy's own origin is refused
 * before any work is done. Requests without those headers (server-to-server,
 * curl) are not CSRF vectors — they cannot carry the victim's cookies.
 */

function allowedOrigins(request: Request): Set<string> {
  const origins = new Set<string>();
  const site = String(process.env.NEXT_PUBLIC_SITE_URL || "").trim();
  try {
    if (site) origins.add(new URL(site).origin);
  } catch {
    // Invalid values are reported by the production env validation at boot.
  }
  if (process.env.NODE_ENV !== "production") {
    // Local development and the Playwright web server.
    try {
      origins.add(new URL(request.url).origin);
    } catch {
      // ignore
    }
    const host = request.headers.get("host");
    if (host) {
      origins.add(`http://${host}`);
      origins.add(`https://${host}`);
    }
  }
  return origins;
}

export function rejectCrossSiteRequest(request: Request): Response | null {
  const fetchSite = (request.headers.get("sec-fetch-site") || "").toLowerCase();
  if (fetchSite === "cross-site") {
    return Response.json({ ok: false, error: "Cross-site requests are not allowed." }, { status: 403 });
  }
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins(request).has(origin)) {
    return Response.json({ ok: false, error: "Cross-site requests are not allowed." }, { status: 403 });
  }
  return null;
}
