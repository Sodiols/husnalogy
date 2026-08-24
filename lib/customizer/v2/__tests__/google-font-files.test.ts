import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeCatalog } from "../google-fonts";
import {
  FontFetchError,
  __resetFontFileCaches,
  ensureFontFile,
  fontCacheKey,
  isTrustedFontUrl,
  resolveFontsForStyles,
} from "../server/google-font-files";

const catalog = normalizeCatalog({
  items: [
    {
      family: "Playfair Display",
      variants: ["regular", "700"],
      category: "serif",
      subsets: ["latin"],
      version: "v30",
      files: {
        regular: "https://fonts.gstatic.com/s/playfairdisplay/v30/pd-400.ttf",
        "700": "https://fonts.gstatic.com/s/playfairdisplay/v30/pd-700.ttf",
      },
    },
  ],
});

beforeEach(() => {
  __resetFontFileCaches();
  vi.restoreAllMocks();
});

describe("SSRF protection", () => {
  it("accepts only https URLs on Google font hosts", () => {
    expect(isTrustedFontUrl("https://fonts.gstatic.com/s/inter/a.ttf")).toBe(true);
    expect(isTrustedFontUrl("https://fonts.googleapis.com/css2?family=Inter")).toBe(true);
  });

  it.each([
    ["plain http", "http://fonts.gstatic.com/s/inter/a.ttf"],
    ["an attacker host", "https://evil.example.com/payload.ttf"],
    ["a lookalike host", "https://fonts.gstatic.com.evil.com/a.ttf"],
    ["internal metadata", "http://169.254.169.254/latest/meta-data/"],
    ["localhost", "https://127.0.0.1:8080/a.ttf"],
    ["a file url", "file:///etc/passwd"],
    ["garbage", "not a url"],
    ["empty", ""],
  ])("rejects %s", (_label, url) => {
    expect(isTrustedFontUrl(url)).toBe(false);
  });

  it("refuses to download an untrusted URL even if one reaches the fetcher", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      ensureFontFile({
        family: "Evil",
        weight: "400",
        style: "normal",
        variantKey: "regular",
        url: "https://evil.example.com/payload.ttf",
      }),
    ).rejects.toBeInstanceOf(FontFetchError);
    // The guard must run BEFORE any network call happens.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("cache keys", () => {
  const base = {
    family: "Playfair Display",
    variantKey: "700",
    url: "https://fonts.gstatic.com/s/playfairdisplay/v30/pd-700.ttf",
  };

  it("is stable for identical input", () => {
    expect(fontCacheKey(base)).toBe(fontCacheKey({ ...base }));
  });

  it("differs by variant so two cuts never collide", () => {
    expect(fontCacheKey(base)).not.toBe(fontCacheKey({ ...base, variantKey: "regular" }));
  });

  it("differs by URL so a font version bump busts the cache", () => {
    const next = { ...base, url: "https://fonts.gstatic.com/s/playfairdisplay/v31/pd-700.ttf" };
    expect(fontCacheKey(base)).not.toBe(fontCacheKey(next));
  });

  it("differs by family even at the same variant", () => {
    expect(fontCacheKey(base)).not.toBe(fontCacheKey({ ...base, family: "Montserrat" }));
  });

  it("produces a filesystem-safe name", () => {
    expect(fontCacheKey(base)).toMatch(/^[a-z0-9.-]+$/);
    expect(fontCacheKey(base)).not.toContain("/");
    expect(fontCacheKey(base)).not.toContain("..");
  });
});

describe("resolving a document's fonts", () => {
  it("reports a missing family instead of substituting another typeface", async () => {
    const result = await resolveFontsForStyles(
      catalog,
      [{ fontFamily: "Not A Real Font", fontWeight: "400" }],
      { download: false },
    );
    expect(result.missingFamilies).toEqual(["Not A Real Font"]);
    expect(result.dependencies).toHaveLength(0);
  });

  it("resolves only the exact variants the document uses", async () => {
    const result = await resolveFontsForStyles(
      catalog,
      [
        { fontFamily: "Playfair Display", fontWeight: "700" },
        { fontFamily: "Playfair Display", fontWeight: "700" },
        { fontFamily: "Playfair Display", fontWeight: "400" },
      ],
      { download: false },
    );
    expect(result.missingFamilies).toEqual([]);
    expect(result.dependencies).toHaveLength(2);
    expect(result.dependencies.every((d) => d.url.startsWith("https://fonts.gstatic.com/"))).toBe(true);
  });

  it("downloads a variant once and reuses it for a concurrent request", async () => {
    const bytes = new Uint8Array(2048).fill(7);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(bytes, { status: 200 }) as any,
    );

    const dependency = {
      family: "Playfair Display",
      weight: "700",
      style: "normal" as const,
      variantKey: "700",
      // Unique URL per run so a previous run's disk cache cannot mask the test.
      url: `https://fonts.gstatic.com/s/playfairdisplay/test-${Date.now()}-${Math.random()}/pd-700.ttf`,
    };

    const [a, b] = await Promise.all([ensureFontFile(dependency), ensureFontFile(dependency)]);
    expect(a).toBe(b);
    // Two concurrent callers, exactly one download.
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // A third call after settling reuses the cache too.
    await ensureFontFile(dependency);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("raises a retryable FontFetchError when Google returns a failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 503 }) as any);
    await expect(
      ensureFontFile({
        family: "Playfair Display",
        weight: "400",
        style: "normal",
        variantKey: "regular",
        url: `https://fonts.gstatic.com/s/playfairdisplay/fail-${Date.now()}/pd-400.ttf`,
      }),
    ).rejects.toBeInstanceOf(FontFetchError);
  });

  it("rejects an empty font payload rather than caching a corrupt file", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array(0), { status: 200 }) as any);
    await expect(
      ensureFontFile({
        family: "Playfair Display",
        weight: "400",
        style: "normal",
        variantKey: "regular",
        url: `https://fonts.gstatic.com/s/playfairdisplay/empty-${Date.now()}/pd-400.ttf`,
      }),
    ).rejects.toBeInstanceOf(FontFetchError);
  });
});
