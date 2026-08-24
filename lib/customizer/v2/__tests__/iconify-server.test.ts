import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeCollections } from "../iconify";
import {
  IconifyUnavailableError,
  MAX_SVG_BYTES,
  __resetIconifyCaches,
  __searchCacheSize,
  __seedIconifyCollections,
  fetchIconSvg,
  getCollections,
  iconifyBaseUrl,
  searchIcons,
} from "../server/iconify";

const COLLECTIONS = normalizeCollections({
  mdi: { name: "Material Design Icons", license: { spdx: "Apache-2.0" }, author: { name: "Pictogrammers" } },
  ph: { name: "Phosphor", license: { spdx: "MIT" } },
  noto: { name: "Noto Emoji", license: { spdx: "CC-BY-4.0" } },
});

const originalBase = process.env.ICONIFY_API_BASE_URL;

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }) as any;
}

beforeEach(() => {
  __resetIconifyCaches();
  vi.restoreAllMocks();
  delete process.env.ICONIFY_API_BASE_URL;
});

afterEach(() => {
  __resetIconifyCaches();
  if (originalBase === undefined) delete process.env.ICONIFY_API_BASE_URL;
  else process.env.ICONIFY_API_BASE_URL = originalBase;
});

describe("provider configuration", () => {
  it("defaults to the public Iconify API and needs no key", () => {
    expect(iconifyBaseUrl()).toBe("https://api.iconify.design");
  });

  it("can be repointed at a self-hosted instance by configuration alone", () => {
    process.env.ICONIFY_API_BASE_URL = "https://icons.husnalogy.com";
    expect(iconifyBaseUrl()).toBe("https://icons.husnalogy.com");
  });

  it("normalizes a configured value down to its origin", () => {
    process.env.ICONIFY_API_BASE_URL = "https://icons.husnalogy.com/some/path?x=1";
    expect(iconifyBaseUrl()).toBe("https://icons.husnalogy.com");
  });

  it("falls back to the default when the configured value is unusable", () => {
    for (const bad of ["not a url", "javascript:alert(1)", "file:///etc/passwd"]) {
      process.env.ICONIFY_API_BASE_URL = bad;
      expect(iconifyBaseUrl()).toBe("https://api.iconify.design");
    }
  });

  it("never reads an API key from the environment", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("lib/customizer/v2/server/iconify.ts", "utf8"),
    );
    expect(source).not.toContain("ICONIFY_API_KEY");
    expect(source).not.toMatch(/api[_-]?key/i);
  });
});

describe("collections", () => {
  it("fetches once and caches", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ mdi: { name: "MDI", license: { spdx: "MIT" } } }));
    await getCollections();
    await getCollections();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("serves a cached copy through an upstream outage", async () => {
    __seedIconifyCollections(COLLECTIONS, Date.now() - 48 * 60 * 60 * 1000);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const collections = await getCollections();
    expect(collections.get("mdi")?.name).toBe("Material Design Icons");
  });

  it("raises unavailable when there is nothing cached", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    await expect(getCollections()).rejects.toBeInstanceOf(IconifyUnavailableError);
  });

  it("treats an empty collections payload as unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}));
    await expect(getCollections()).rejects.toBeInstanceOf(IconifyUnavailableError);
  });
});

describe("search", () => {
  beforeEach(() => {
    __seedIconifyCollections(COLLECTIONS);
  });

  it("builds the upstream URL from the configured origin and encoded params", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ icons: ["mdi:heart"], total: 1 }));
    await searchIcons({ query: "heart & soul", page: 1, pageSize: 10 });

    const requested = new URL(String(spy.mock.calls[0][0]));
    expect(requested.origin).toBe("https://api.iconify.design");
    expect(requested.pathname).toBe("/search");
    expect(requested.searchParams.get("query")).toBe("heart & soul");
  });

  it("applies the license policy — attribution collections never reach customers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ icons: ["mdi:heart", "noto:red-heart", "ph:flower"], total: 3 }),
    );
    const { results } = await searchIcons({ query: "heart", page: 1, pageSize: 20 });
    expect(results.map((r) => r.key)).toEqual(["mdi:heart", "ph:flower"]);
  });

  it("gives admins the blocked entries with a verdict", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ icons: ["noto:red-heart"], total: 1 }));
    const { results } = await searchIcons({ query: "heart", page: 1, pageSize: 20, audience: "admin" });
    expect(results[0].licenseVerdict).toBe("requires-attribution");
  });

  it("caches repeated queries instead of re-calling Iconify", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ icons: ["mdi:heart"], total: 1 }));
    await searchIcons({ query: "heart", page: 1, pageSize: 10 });
    await searchIcons({ query: "heart", page: 1, pageSize: 10 });
    await searchIcons({ query: "heart", page: 1, pageSize: 10 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("treats a different page or audience as a separate cache entry", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ icons: ["mdi:heart"], total: 40 }));
    await searchIcons({ query: "heart", page: 1, pageSize: 10 });
    await searchIcons({ query: "heart", page: 2, pageSize: 10 });
    await searchIcons({ query: "heart", page: 1, pageSize: 10, audience: "admin" });
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("bounds the cache so a hostile query stream cannot grow memory forever", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ icons: ["mdi:heart"], total: 1 }));
    for (let index = 0; index < 400; index += 1) {
      await searchIcons({ query: `term-${index}`, page: 1, pageSize: 10 });
    }
    expect(__searchCacheSize()).toBeLessThanOrEqual(300);
  });

  it("never returns more than the requested page size", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ icons: Array.from({ length: 60 }, (_, i) => `mdi:icon-${i}`), total: 60 }),
    );
    const { results } = await searchIcons({ query: "icon", page: 1, pageSize: 12 });
    expect(results).toHaveLength(12);
  });

  it("surfaces an upstream failure as IconifyUnavailableError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }) as any);
    await expect(searchIcons({ query: "heart", page: 1, pageSize: 10 })).rejects.toBeInstanceOf(IconifyUnavailableError);
  });

  it("passes an abort signal so an upstream hang cannot stall the request", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ icons: [], total: 0 }));
    await searchIcons({ query: "heart", page: 1, pageSize: 10 });
    expect((spy.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});

describe("icon SVG fetch", () => {
  beforeEach(() => {
    __seedIconifyCollections(COLLECTIONS);
  });

  it("constructs the upstream path from validated identity parts only", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<svg viewBox='0 0 24 24'><path d='M0 0'/></svg>", { status: 200 }) as any,
    );
    await fetchIconSvg("mdi:heart-outline");

    const requested = new URL(String(spy.mock.calls[0][0]));
    expect(requested.origin).toBe("https://api.iconify.design");
    expect(requested.pathname).toBe("/mdi/heart-outline.svg");
  });

  it.each([
    "https://evil.example.com/x.svg",
    "javascript:alert(1)",
    "mdi/../../etc/passwd",
    "<svg onload=alert(1)>",
    "",
  ])("refuses to fetch for the invalid identity %s", async (bad) => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(fetchIconSvg(bad)).rejects.toThrow(/invalid icon identity/i);
    // The guard runs before any network call.
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects an oversized SVG by declared content-length", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<svg></svg>", { status: 200, headers: { "content-length": String(MAX_SVG_BYTES + 1) } }) as any,
    );
    await expect(fetchIconSvg("mdi:heart")).rejects.toThrow(/too large/i);
  });

  it("rejects an oversized SVG that lies about its length", async () => {
    const huge = `<svg>${"x".repeat(MAX_SVG_BYTES + 10)}</svg>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(huge, { status: 200 }) as any);
    await expect(fetchIconSvg("mdi:heart")).rejects.toThrow(/too large/i);
  });

  it("rejects a response that is not SVG markup", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("404 not found", { status: 200 }) as any);
    await expect(fetchIconSvg("mdi:nope")).rejects.toThrow(/no longer available/i);
  });

  it("rejects an empty body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("   ", { status: 200 }) as any);
    await expect(fetchIconSvg("mdi:heart")).rejects.toThrow(/could not be downloaded/i);
  });

  it("surfaces an upstream error as IconifyUnavailableError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 502 }) as any);
    await expect(fetchIconSvg("mdi:heart")).rejects.toBeInstanceOf(IconifyUnavailableError);
  });

  it("returns the raw SVG for the caller to sanitize", async () => {
    const svg = "<svg viewBox='0 0 24 24'><path d='M1 1'/></svg>";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(svg, { status: 200 }) as any);
    const fetched = await fetchIconSvg("mdi:heart");
    expect(fetched.key).toBe("mdi:heart");
    expect(fetched.svg).toBe(svg);
    expect(fetched.bytes).toBeGreaterThan(0);
  });
});
