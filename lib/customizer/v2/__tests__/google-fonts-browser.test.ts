import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import {
  createGoogleFontLoader,
  GoogleFontLoadError,
  isBrowserSystemFont,
  type GoogleFontLoaderEnvironment,
} from "@/app/components/customizer/google-font-loader";
import {
  LEGACY_DEFAULT_CUSTOMER_FONTS,
  normalizeAllowedCustomerFonts,
} from "../google-fonts";
import {
  filterVisibleFontResults,
  FONT_SELECTOR_VISIBLE_LIMIT,
} from "@/app/components/customizer/GoogleFontSelector";
import { normalizeCustomizerTemplate } from "@/lib/customizer";

function environment(overrides: Partial<GoogleFontLoaderEnvironment> = {}): GoogleFontLoaderEnvironment {
  return {
    available: () => true,
    loadStylesheet: vi.fn().mockResolvedValue(undefined),
    loadFace: vi.fn().mockResolvedValue([{}]),
    fontsReady: vi.fn().mockResolvedValue(undefined),
    checkFace: vi.fn().mockReturnValue(true),
    notifyMetricsChanged: vi.fn(),
    ...overrides,
  };
}

describe("browser Google Font loading", () => {
  it("waits for the stylesheet before loading and confirming the face", async () => {
    let releaseStylesheet!: () => void;
    const stylesheetReady = new Promise<void>((resolve) => {
      releaseStylesheet = resolve;
    });
    const env = environment({ loadStylesheet: vi.fn(() => stylesheetReady) });
    const loader = createGoogleFontLoader(env);

    const pending = loader.ensureLoaded("Playfair Display", "700", "normal");
    await Promise.resolve();
    expect(env.loadFace).not.toHaveBeenCalled();

    releaseStylesheet();
    await pending;
    expect(env.loadFace).toHaveBeenCalledTimes(1);
    expect(env.checkFace).toHaveBeenCalledTimes(1);
    expect(loader.isLoaded("Playfair Display", "700", "normal")).toBe(true);
    expect(env.notifyMetricsChanged).toHaveBeenCalledTimes(1);
  });

  it("reuses the exact in-flight promise for concurrent duplicate requests", async () => {
    let releaseStylesheet!: () => void;
    const env = environment({
      loadStylesheet: vi.fn(() => new Promise<void>((resolve) => {
        releaseStylesheet = resolve;
      })),
    });
    const loader = createGoogleFontLoader(env);

    const first = loader.ensureLoaded("Montserrat", "400", "normal");
    const second = loader.ensureLoaded("Montserrat", "400", "normal");
    expect(second).toBe(first);
    expect(env.loadStylesheet).toHaveBeenCalledTimes(1);

    releaseStylesheet();
    await Promise.all([first, second]);
    expect(env.loadFace).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed stylesheet and succeeds on retry", async () => {
    const env = environment({
      loadStylesheet: vi.fn()
        .mockRejectedValueOnce(new Error("blocked"))
        .mockResolvedValueOnce(undefined),
    });
    const loader = createGoogleFontLoader(env);

    await expect(loader.ensureLoaded("Poppins", "400", "normal")).rejects.toMatchObject({
      code: "STYLESHEET_LOAD_FAILED",
    });
    expect(loader.isLoaded("Poppins", "400", "normal")).toBe(false);

    await expect(loader.ensureLoaded("Poppins", "400", "normal")).resolves.toBeUndefined();
    expect(loader.isLoaded("Poppins", "400", "normal")).toBe(true);
    expect(env.loadStylesheet).toHaveBeenCalledTimes(2);
  });

  it("does not cache a rejected document.fonts.load and allows retry", async () => {
    const env = environment({
      loadFace: vi.fn()
        .mockRejectedValueOnce(new Error("font file failed"))
        .mockResolvedValueOnce([{}]),
    });
    const loader = createGoogleFontLoader(env);

    await expect(loader.ensureLoaded("Great Vibes", "400", "normal")).rejects.toMatchObject({
      code: "FONT_FACE_LOAD_FAILED",
    });
    expect(loader.isLoaded("Great Vibes", "400", "normal")).toBe(false);

    await loader.ensureLoaded("Great Vibes", "400", "normal");
    expect(loader.isLoaded("Great Vibes", "400", "normal")).toBe(true);
  });

  it("requires both a returned FontFace and document.fonts.check confirmation", async () => {
    const noFaces = createGoogleFontLoader(environment({ loadFace: vi.fn().mockResolvedValue([]) }));
    await expect(noFaces.ensureLoaded("Bebas Neue")).rejects.toBeInstanceOf(GoogleFontLoadError);
    expect(noFaces.isLoaded("Bebas Neue")).toBe(false);

    const unchecked = createGoogleFontLoader(environment({ checkFace: vi.fn().mockReturnValue(false) }));
    await expect(unchecked.ensureLoaded("Pacifico")).rejects.toMatchObject({ code: "FONT_FACE_NOT_CONFIRMED" });
    expect(unchecked.isLoaded("Pacifico")).toBe(false);
  });

  it("does not send legacy system fonts to the Google CSS endpoint", async () => {
    const env = environment();
    const loader = createGoogleFontLoader(env);

    await expect(loader.ensureLoaded("Times New Roman", "300")).resolves.toBeUndefined();
    expect(loader.isLoaded("Times New Roman", "300")).toBe(true);
    expect(env.loadStylesheet).not.toHaveBeenCalled();
    expect(env.loadFace).not.toHaveBeenCalled();
    expect(isBrowserSystemFont(" Georgia ")).toBe(true);
    expect(isBrowserSystemFont("Playfair Display")).toBe(false);
  });
});

describe("Google Fonts CSP", () => {
  it("allows only the required Google stylesheet and font hosts", () => {
    const config = readFileSync(join(process.cwd(), "next.config.mjs"), "utf8");
    const styleDirective = config.match(/"style-src[^\n]+/)?.[0] || "";
    const fontDirective = config.match(/"font-src[^\n]+/)?.[0] || "";

    expect(styleDirective).toContain("https://fonts.googleapis.com");
    expect(fontDirective).toContain("https://fonts.gstatic.com");
    expect(styleDirective).not.toMatch(/(?:^|\s)https:(?:\s|["'])/);
    expect(fontDirective).not.toMatch(/(?:^|\s)https:(?:\s|["'])/);
  });

  it("keeps browser catalog retries independent of the server catalog cache", () => {
    const client = readFileSync(join(process.cwd(), "app/components/customizer/useGoogleFonts.ts"), "utf8");
    expect(client).toContain('fetch("/api/customizer/fonts", { cache: "no-store" })');
    expect(client).not.toContain('fetch("/api/customizer/fonts", { cache: "force-cache" })');
  });
});

describe("legacy font permissions", () => {
  it("migrates only the exact retired six-font default to empty-means-all", () => {
    const legacyWithFormatting = [...LEGACY_DEFAULT_CUSTOMER_FONTS]
      .reverse()
      .map((family, index) => index % 2 ? ` ${family.toUpperCase()} ` : family);
    expect(normalizeAllowedCustomerFonts(legacyWithFormatting)).toEqual([]);
  });

  it("preserves a deliberate custom allowlist", () => {
    expect(normalizeAllowedCustomerFonts([" Playfair Display ", "Montserrat", "Great Vibes"])).toEqual([
      "Playfair Display",
      "Montserrat",
      "Great Vibes",
    ]);
  });

  it("applies the exact legacy migration while normalizing editable templates", () => {
    const migrated = normalizeCustomizerTemplate({
      pages: [{ id: "front", enabled: true }],
      settings: { allowedCustomerFonts: [...LEGACY_DEFAULT_CUSTOMER_FONTS] },
    });
    expect(migrated.settings.allowedCustomerFonts).toEqual([]);

    const restricted = normalizeCustomizerTemplate({
      pages: [{ id: "front", enabled: true }],
      settings: { allowedCustomerFonts: ["Playfair Display", "Montserrat"] },
    });
    expect(restricted.settings.allowedCustomerFonts).toEqual(["Playfair Display", "Montserrat"]);
  });
});

describe("selector search performance", () => {
  const catalog = Array.from({ length: 700 }, (_, index) => ({
    family: index === 650 ? "DM Serif Display" : `Fixture Font ${String(index).padStart(3, "0")}`,
    category: "serif",
    weights: ["400"],
    hasItalic: false,
  }));

  it("caps empty results without restricting search to the visible slice", () => {
    expect(filterVisibleFontResults(catalog, "")).toHaveLength(FONT_SELECTOR_VISIBLE_LIMIT);
    expect(filterVisibleFontResults(catalog, "DM Serif").map((entry) => entry.family)).toEqual([
      "DM Serif Display",
    ]);
  });
});
