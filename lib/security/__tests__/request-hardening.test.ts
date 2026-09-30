import { afterEach, describe, expect, it } from "vitest";
import { getClientIp, rateLimit } from "@/lib/security/rate-limit";
import { BodyTooLargeError, readBodyBytes, readJsonBody, InvalidJsonError } from "@/lib/http/read-body";
import { serializeJsonLd } from "@/lib/security/json-ld";
import { rejectCrossSiteRequest } from "@/lib/security/same-origin";
import { orderFromRow, safeMediaUrl } from "@/lib/orders/order-view";

const request = (headers: Record<string, string>, init: RequestInit = {}) => new Request("https://husnalogy.com/api/x", { method: "POST", headers, ...init });

afterEach(() => {
  delete process.env.TRUSTED_PROXY_HOPS;
});

describe("client IP for rate limiting cannot be spoofed", () => {
  it("uses the address the trusted proxy appended, not the client's own claim", () => {
    expect(getClientIp(request({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(getClientIp(request({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("ignores client-controlled x-real-ip / cf-connecting-ip", () => {
    expect(getClientIp(request({ "x-real-ip": "9.9.9.9", "cf-connecting-ip": "8.8.8.8" }))).toBe("unknown");
  });

  it("honours a configured number of proxy hops", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    expect(getClientIp(request({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
  });

  it("rejects garbage in the forwarded chain", () => {
    expect(getClientIp(request({ "x-forwarded-for": "evil<script>" }))).toBe("unknown");
  });

  it("a spoofed leftmost address does not reset the limit", () => {
    const limit = { name: `spoof-test-${Date.now()}`, limit: 2, windowMs: 60_000 };
    const hit = (spoof: string) => rateLimit(request({ "x-forwarded-for": `${spoof}, 203.0.113.50` }), limit);
    expect(hit("1.1.1.1")).toBeNull();
    expect(hit("2.2.2.2")).toBeNull();
    expect(hit("3.3.3.3")?.status).toBe(429);
  });

  it("keys per account when an identity is supplied", () => {
    const limit = { name: `identity-test-${Date.now()}`, limit: 1, windowMs: 60_000 };
    expect(rateLimit(request({}), { ...limit, identity: "user-1" })).toBeNull();
    expect(rateLimit(request({}), { ...limit, identity: "user-2" })).toBeNull();
    expect(rateLimit(request({}), { ...limit, identity: "user-1" })?.status).toBe(429);
  });
});

describe("request bodies are bounded while streaming", () => {
  const streamOf = (bytes: number) =>
    new ReadableStream({
      start(controller) {
        let sent = 0;
        while (sent < bytes) {
          const size = Math.min(16_384, bytes - sent);
          controller.enqueue(new Uint8Array(size));
          sent += size;
        }
        controller.close();
      },
    });

  it("refuses a declared oversized body without reading it", async () => {
    await expect(readBodyBytes(request({ "content-length": "999999" }, { body: "x" }), 1024)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("refuses an oversized chunked body that omits Content-Length", async () => {
    const chunked = new Request("https://husnalogy.com/api/x", { method: "POST", body: streamOf(200_000), duplex: "half" } as RequestInit);
    await expect(readBodyBytes(chunked, 64 * 1024)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("parses valid JSON and rejects invalid JSON or the wrong content type", async () => {
    expect(await readJsonBody(request({ "content-type": "application/json" }, { body: '{"a":1}' }), 1024)).toEqual({ a: 1 });
    await expect(readJsonBody(request({ "content-type": "application/json" }, { body: "{nope" }), 1024)).rejects.toBeInstanceOf(InvalidJsonError);
    await expect(readJsonBody(request({ "content-type": "text/plain" }, { body: '{"a":1}' }), 1024)).rejects.toBeInstanceOf(InvalidJsonError);
  });
});

describe("cross-site mutation requests are refused", () => {
  it("allows same-origin and header-less (non-browser) requests", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://husnalogy.com";
    expect(rejectCrossSiteRequest(request({ origin: "https://husnalogy.com", "sec-fetch-site": "same-origin" }))).toBeNull();
    expect(rejectCrossSiteRequest(request({}))).toBeNull();
  });

  it("refuses a foreign Origin or a cross-site fetch", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://husnalogy.com";
    expect(rejectCrossSiteRequest(request({ origin: "https://evil.example" }))?.status).toBe(403);
    expect(rejectCrossSiteRequest(request({ "sec-fetch-site": "cross-site" }))?.status).toBe(403);
  });
});

describe("output encoding", () => {
  it("JSON-LD cannot close its script tag", () => {
    const html = serializeJsonLd({ name: "</script><script>alert(1)</script>", note: "a & b > c" });
    expect(html).not.toContain("</script>");
    expect(html).not.toContain("<");
    expect(JSON.parse(html)).toEqual({ name: "</script><script>alert(1)</script>", note: "a & b > c" });
  });

  it("legacy order media URLs are limited to same-origin paths and the project's storage", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcd.supabase.co";
    expect(safeMediaUrl("javascript:alert(1)")).toBe("");
    expect(safeMediaUrl("data:text/html,<script>")).toBe("");
    expect(safeMediaUrl("https://evil.example/pixel.png")).toBe("");
    expect(safeMediaUrl("//evil.example/x")).toBe("");
    expect(safeMediaUrl("/images/card.png")).toBe("/images/card.png");
    expect(safeMediaUrl("https://abcd.supabase.co/storage/v1/object/sign/x?token=1")).toContain("abcd.supabase.co");

    const order = orderFromRow({
      id: "o",
      order_items: [
        {
          id: "i",
          product_image: "https://evil.example/x.png",
          metadata: { previewImages: { front: "javascript:alert(1)" } },
          uploaded_files: { photo: { signedUrl: "https://evil.example/steal", name: "p.jpg" } },
          customization_values: { names: "A & B" },
        },
      ],
    });
    expect(order.items[0].image).toBe("");
    expect(order.items[0].previewImages).toEqual({ front: "" });
    expect((order.items[0].uploadedFiles as any).photo).toEqual({ signedUrl: "", name: "p.jpg" });
    expect(order.items[0].customizationValues).toEqual({ names: "A & B" });
  });
});

describe("post-login redirects stay on this site", () => {
  it.each([
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["/" + String.fromCharCode(92) + "evil.example", "/"],
    ["/x" + String.fromCharCode(92) + "..", "/"],
    ["/\t/evil.example", "/"],
    ["/\n/evil.example", "/"],
    ["/%09/evil.example", "/%09/evil.example"],
    ["javascript:alert(1)", "/"],
    ["/login?next=/admin", "/"],
    ["/orders?page=2#top", "/orders?page=2#top"],
    ["/products/pearl", "/products/pearl"],
  ])("%s → %s", async (input, expected) => {
    const { getSafeRedirectPath } = await import("@/lib/auth/redirects");
    expect(getSafeRedirectPath(input)).toBe(expected);
  });
});
