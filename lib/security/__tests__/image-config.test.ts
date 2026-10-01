import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Image optimization is an SSRF / cache-poisoning surface: only this
 * project's public catalogue buckets may be fetched, with no query strings,
 * no redirects, no SVG and no local network.
 */
describe("next.config.mjs image optimization", () => {
  afterEach(() => vi.unstubAllEnvs());

  async function load() {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcd1234.supabase.co");
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
    return (await import("../../../next.config.mjs")).default.images;
  }

  it("allows only this project's public catalogue buckets, without query strings", async () => {
    const images = await load();
    expect(images.remotePatterns).toEqual(
      ["product-images", "product-mockups", "site-assets"].map((bucket) => ({ protocol: "https", hostname: "abcd1234.supabase.co", port: "", pathname: `/storage/v1/object/public/${bucket}/**`, search: "" })),
    );
    const serialized = JSON.stringify(images.remotePatterns);
    for (const forbidden of ["customer-uploads", "order-production", "customizer-renders", "admin-assets", "customizer-elements", "/object/sign/", "*.supabase.co", "http:"]) expect(serialized).not.toContain(forbidden);
  });

  it("disables redirects, SVG and local-network fetches and bounds the source size", async () => {
    const images = await load();
    expect(images).toMatchObject({ maximumRedirects: 0, dangerouslyAllowSVG: false, dangerouslyAllowLocalIP: false, contentDispositionType: "attachment", maximumResponseBody: 16_000_000 });
    expect(images.contentSecurityPolicy).toContain("script-src 'none'");
    expect(images.contentSecurityPolicy).toContain("sandbox");
    expect(images.domains).toBeUndefined();
  });
});
