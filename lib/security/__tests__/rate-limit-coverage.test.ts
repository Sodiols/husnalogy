import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Wiring contract: pins rate limiting on the endpoints identified as the
// most important abuse/cost surfaces (order creation, contact, Ask Logy,
// uploads, customizer save/render). A regression here (someone removing the
// call while refactoring a route) should fail CI, not ship silently.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const guarded = [
  "app/api/order-requests/route.ts",
  "app/api/contact/route.ts",
  "app/api/ask-logy/route.ts",
  "app/api/customizer/upload/route.ts",
  "app/api/customizations/route.ts",
  "app/api/customizations/[id]/route.ts",
  "app/api/customizer/render/route.ts",
  "app/api/customizer/render/[jobId]/route.ts",
  "app/api/customizer/preflight/route.ts",
];

// The highest-value / most expensive endpoints use the distributed limiter
// (globally exact when Upstash is configured, falling back to in-memory);
// the rest use the per-instance limiter directly.
const distributed = [
  "app/api/order-requests/route.ts",
  "app/api/contact/route.ts",
  "app/api/ask-logy/route.ts",
  "app/api/customizer/upload/route.ts",
  "app/api/customizer/render/route.ts",
];

describe("rate limiting covers the priority abuse surfaces", () => {
  it.each(guarded)("%s is rate limited", (path) => {
    const source = read(path);
    expect(source).toContain('from "@/lib/security/rate-limit"');
    expect(source).toMatch(/rateLimit(Distributed)?\(request/);
  });

  it.each(distributed)("%s uses the distributed limiter and awaits it", (path) => {
    const source = read(path);
    expect(source).toContain("rateLimitDistributed");
    // Forgetting the await would make the limiter a no-op (a Promise is
    // always truthy in the caller's `if (limited)` check would 429 everyone,
    // and without the check it never limits at all).
    expect(source).toMatch(/await rateLimitDistributed\(request/);
  });
});

describe("rate limiter fails safe", () => {
  const source = read("lib/security/rate-limit.ts");

  it("keys buckets per endpoint name and client IP, not globally", () => {
    expect(source).toContain("`${name}:${getClientIp(request)}`");
  });

  it("returns 429 with Retry-After once the limit is exceeded", () => {
    expect(source).toContain("status: 429");
    expect(source).toContain("Retry-After");
  });

  it("only uses the distributed backend when both credentials are configured", () => {
    expect(source).toContain("process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN");
    expect(source).toContain("if (!isDistributedRateLimitConfigured()) {");
  });

  it("never exposes the Redis credentials to client code", () => {
    expect(source).not.toContain("NEXT_PUBLIC_UPSTASH");
  });

  it("falls back to the in-memory limiter instead of taking checkout down when Redis is unreachable", () => {
    const catchIndex = source.indexOf("} catch (error) {");
    const catchBody = source.slice(catchIndex, source.indexOf("\n}", catchIndex));
    expect(catchBody).toContain("rateLimit(request, { name, limit, windowMs })");
    expect(catchBody).toContain("falling back to the in-memory limiter");
  });

  it("bounds the Redis call so a hung dependency cannot stall a request", () => {
    expect(source).toContain("AbortSignal.timeout(");
  });

  it("always sets a TTL on the Redis counter so a key cannot leak forever", () => {
    expect(source).toContain('["EXPIRE", key, String(windowSeconds), "NX"]');
  });
});
