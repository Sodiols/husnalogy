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

  it("no X-Forwarded-For at all: unknown (one shared bucket), never a guess", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    expect(getClientIp(request())).toBe("unknown");
    expect(getClientIp(request(" , ,"))).toBe("unknown");
  });

  it("a chain SHORTER than the configured hops fails safe: unknown, never the client-typed leftmost entry", () => {
    // Two proxies each append, so a real request always carries >= 2 entries.
    // One entry means a proxy was bypassed or the setting is wrong — and that
    // one entry may be whatever the client typed.
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    expect(getClientIp(request("6.6.6.6"))).toBe("unknown");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "3");
    expect(getClientIp(request("6.6.6.6, 203.0.113.9"))).toBe("unknown");
    expect(getClientIp(request("6.6.6.6, 203.0.113.9, 10.0.0.2"))).toBe("6.6.6.6");
  });

  it("multi-hop: the configured hops pick the entry the outermost trusted proxy appended", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "3");
    expect(getClientIp(request("1.1.1.1, 2.2.2.2, 203.0.113.9, 10.0.0.2, 10.0.0.3"))).toBe("203.0.113.9");
  });

  it("a spoofed leftmost entry is ignored whatever it claims to be", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    for (const spoof of ["127.0.0.1", "::1", "10.0.0.1", "unknown", "203.0.113.9, 198.51.100.1"]) {
      expect(getClientIp(request(`${spoof}, 192.0.2.44`))).toBe("192.0.2.44");
    }
  });

  it("IPv4: only real dotted quads", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    expect(getClientIp(request("192.0.2.1"))).toBe("192.0.2.1");
    expect(getClientIp(request("999.1.1.1"))).toBe("unknown");
    expect(getClientIp(request("1.2.3"))).toBe("unknown");
    expect(getClientIp(request("..."))).toBe("unknown");
  });

  it("IPv6: compressed, full and IPv4-mapped forms; one canonical case", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    expect(getClientIp(request("6.6.6.6, 2001:db8::1"))).toBe("2001:db8::1");
    expect(getClientIp(request("2001:DB8::1"))).toBe("2001:db8::1");
    expect(getClientIp(request("2001:0db8:0000:0000:0000:0000:0000:0001"))).toBe("2001:0db8:0000:0000:0000:0000:0000:0001");
    expect(getClientIp(request("::ffff:192.0.2.1"))).toBe("::ffff:192.0.2.1");
    expect(getClientIp(request("2001:db8::1::2"))).toBe("unknown");
    expect(getClientIp(request(":::"))).toBe("unknown");
  });

  it("a port the proxy appended is not part of the address (a new source port is not a new client)", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    expect(getClientIp(request("192.0.2.1:51234"))).toBe("192.0.2.1");
    expect(getClientIp(request("[2001:db8::1]:443"))).toBe("2001:db8::1");
    const limit = { name: `port-${Math.random()}`, limit: 2, windowMs: 60_000 };
    const statuses = [1, 2, 3].map((port) => rateLimit(request(`192.0.2.1:${50000 + port}`), limit)?.status ?? 200);
    expect(statuses).toEqual([200, 200, 429]);
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
