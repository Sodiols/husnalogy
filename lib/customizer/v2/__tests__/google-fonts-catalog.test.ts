import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GoogleFontsConfigError,
  GoogleFontsUnavailableError,
  __resetFontCatalogCache,
  __seedFontCatalogCache,
  getFontCatalog,
  getFontCatalogSafe,
  isGoogleFontsConfigured,
} from "../server/google-fonts-catalog";
import { normalizeCatalog } from "../google-fonts";

const PAYLOAD = {
  items: [
    {
      family: "Inter",
      variants: ["regular", "700"],
      category: "sans-serif",
      subsets: ["latin"],
      version: "v13",
      files: {
        regular: "https://fonts.gstatic.com/s/inter/v13/inter-400.ttf",
        "700": "https://fonts.gstatic.com/s/inter/v13/inter-700.ttf",
      },
    },
  ],
};

const originalKey = process.env.GOOGLE_FONTS_API_KEY;

beforeEach(() => {
  __resetFontCatalogCache();
  vi.restoreAllMocks();
  process.env.GOOGLE_FONTS_API_KEY = "test-key-never-real";
});

afterEach(() => {
  __resetFontCatalogCache();
  if (originalKey === undefined) delete process.env.GOOGLE_FONTS_API_KEY;
  else process.env.GOOGLE_FONTS_API_KEY = originalKey;
});

describe("configuration", () => {
  it("reports whether the server key is present", () => {
    expect(isGoogleFontsConfigured()).toBe(true);
    delete process.env.GOOGLE_FONTS_API_KEY;
    expect(isGoogleFontsConfigured()).toBe(false);
  });

  it("raises a controlled configuration error rather than crashing when the key is missing", async () => {
    delete process.env.GOOGLE_FONTS_API_KEY;
    await expect(getFontCatalog()).rejects.toBeInstanceOf(GoogleFontsConfigError);
  });
});

describe("fetching and caching", () => {
  it("fetches once and serves the cached catalog afterwards", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(PAYLOAD) as any);

    const first = await getFontCatalog();
    const second = await getFontCatalog();

    expect(first.map((f) => f.family)).toEqual(["Inter"]);
    expect(second).toEqual(first);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("sends the API key only in a header and never puts it in the URL or catalog", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(PAYLOAD) as any);
    const catalog = await getFontCatalog();

    const requestedUrl = String(fetchSpy.mock.calls[0]?.[0]);
    const requestOptions = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(requestedUrl).not.toContain("test-key-never-real");
    expect(requestedUrl).not.toContain("key=");
    expect(requestOptions.headers).toEqual({ "x-goog-api-key": "test-key-never-real" });
    expect(requestOptions.cache).toBe("no-store");
    expect(JSON.stringify(catalog)).not.toContain("test-key-never-real");
  });

  it("collapses concurrent refreshes into a single upstream request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(Response.json(PAYLOAD) as any), 20)) as any,
    );

    const [a, b, c] = await Promise.all([getFontCatalog(), getFontCatalog(), getFontCatalog()]);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("graceful degradation", () => {
  it("keeps serving a cached catalog when Google is failing", async () => {
    __seedFontCatalogCache(normalizeCatalog(PAYLOAD), Date.now() - 48 * 60 * 60 * 1000); // stale
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const catalog = await getFontCatalog();
    expect(catalog.map((f) => f.family)).toEqual(["Inter"]);
  });

  it("keeps serving a cached catalog when Google returns an HTTP error", async () => {
    __seedFontCatalogCache(normalizeCatalog(PAYLOAD), Date.now() - 48 * 60 * 60 * 1000);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("upstream boom", { status: 500 }) as any);

    const catalog = await getFontCatalog();
    expect(catalog).toHaveLength(1);
  });

  it("raises an unavailable error when there is no cache to fall back to", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    await expect(getFontCatalog()).rejects.toBeInstanceOf(GoogleFontsUnavailableError);
  });

  it("treats an empty upstream catalog as unavailable rather than wiping the font list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ items: [] }) as any);
    await expect(getFontCatalog()).rejects.toBeInstanceOf(GoogleFontsUnavailableError);
  });

  it("getFontCatalogSafe never throws, so validation paths cannot crash a request", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    await expect(getFontCatalogSafe()).resolves.toEqual([]);
  });

  it("getFontCatalogSafe still returns the cached catalog during an outage", async () => {
    __seedFontCatalogCache(normalizeCatalog(PAYLOAD), Date.now() - 48 * 60 * 60 * 1000);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    await expect(getFontCatalogSafe()).resolves.toHaveLength(1);
  });
});
