/**
 * Deployment topology safety (Phases 15–16).
 *
 *  - Rate limiting: how TRUSTED_PROXY_HOPS turns X-Forwarded-For into the
 *    client address, and what an operator sees when verifying it.
 *  - Canonical host: the www / apex twin of NEXT_PUBLIC_SITE_URL permanently
 *    redirects to the canonical host, path and query intact.
 */
import { getRedirectUrl, unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getClientIp, rateLimit, rateLimitDiagnostics } from "@/lib/security/rate-limit";

const request = (forwardedFor?: string) => new Request("https://husnalogy.com/api/contact", { headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {} });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("client address behind trusted proxies", () => {
  it("one trusted proxy: the address the proxy appended, never the one the client typed", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    expect(getClientIp(request("6.6.6.6, 203.0.113.9"))).toBe("203.0.113.9");
    expect(getClientIp(request("203.0.113.9"))).toBe("203.0.113.9");
  });

  it("two trusted proxies (a CDN in front): the entry two from the right", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    expect(getClientIp(request("6.6.6.6, 203.0.113.9, 10.0.0.2"))).toBe("203.0.113.9");
  });

  it("a client cannot dodge its limit by inventing a new X-Forwarded-For per request", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    const limit = { name: `spoof-${Math.random()}`, limit: 3, windowMs: 60_000 };
    const statuses = Array.from({ length: 5 }, (_, index) => rateLimit(request(`198.51.100.${index}, 203.0.113.9`), limit)?.status ?? 200);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });

  it("garbage is never treated as an address; invalid hop settings fall back to 1", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    expect(getClientIp(request("<script>"))).toBe("unknown");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "99");
    expect(getClientIp(request("6.6.6.6, 203.0.113.9"))).toBe("203.0.113.9");
  });

  it("the operator readout states the hops, the chain, the resolved address and the limiter scope", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    expect(rateLimitDiagnostics(request("6.6.6.6, 203.0.113.9"))).toEqual({
      trustedProxyHops: 1,
      forwardedFor: ["6.6.6.6", "203.0.113.9"],
      resolvedClientIp: "203.0.113.9",
      distributed: false,
      scope: "Per Node process (in memory): each process counts on its own, and a restart resets the counts.",
    });
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
    expect(rateLimitDiagnostics(request("203.0.113.9")).distributed).toBe(true);
  });
});

describe("canonical host", () => {
  async function nextConfigFor(siteUrl: string) {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", siteUrl);
    const loaded = (await import("../../../next.config.mjs")) as any;
    return { config: loaded.default, canonicalHostRedirects: loaded.canonicalHostRedirects };
  }

  it("www.husnalogy.com permanently redirects to https://husnalogy.com, path and query intact", async () => {
    const { config } = await nextConfigFor("https://husnalogy.com");
    const response = await unstable_getResponseFromNextConfig({ url: "https://www.husnalogy.com/products/pearl-card?ref=ig", nextConfig: config });
    expect([301, 308]).toContain(response.status);
    expect(getRedirectUrl(response)).toBe("https://husnalogy.com/products/pearl-card?ref=ig");
  });

  it("the canonical host itself is never redirected", async () => {
    const { config } = await nextConfigFor("https://husnalogy.com");
    const response = await unstable_getResponseFromNextConfig({ url: "https://husnalogy.com/products", nextConfig: config });
    expect(getRedirectUrl(response)).toBeNull();
  });

  it("a www canonical site redirects the apex instead", async () => {
    const { canonicalHostRedirects } = await nextConfigFor("https://www.husnalogy.com");
    expect(canonicalHostRedirects("https://www.husnalogy.com")).toEqual([
      { source: "/:path*", has: [{ type: "host", value: "husnalogy.com" }], destination: "https://www.husnalogy.com/:path*", permanent: true },
    ]);
  });

  it("no redirect is invented for local or invalid site URLs", async () => {
    const { canonicalHostRedirects } = await nextConfigFor("https://husnalogy.com");
    for (const site of ["http://localhost:3000", "http://127.0.0.1:3000", "", "not a url"]) expect(canonicalHostRedirects(site), site).toEqual([]);
  });
});
