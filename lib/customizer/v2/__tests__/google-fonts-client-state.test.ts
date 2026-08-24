import { describe, expect, it } from "vitest";
import {
  catalogStateReducer,
  classifyCatalogResponseError,
  parseClientCatalogPayload,
  type CatalogFamily,
} from "@/app/components/customizer/useGoogleFonts";

const families: CatalogFamily[] = [
  { family: "Inter", category: "sans-serif", weights: ["400", "700"], hasItalic: true },
  { family: "Playfair Display", category: "serif", weights: ["400"], hasItalic: false },
];

describe("Google Fonts client catalog state", () => {
  it("clears a previous unavailable error when a retry succeeds", () => {
    const failed = catalogStateReducer(
      { families: [], loading: true, error: "", errorCode: null },
      { type: "error", code: "GOOGLE_FONTS_UNAVAILABLE" },
    );
    expect(failed.error).toBe("Google Fonts are temporarily unavailable.");

    const recovered = catalogStateReducer(failed, { type: "success", families });
    expect(recovered).toEqual({ families, loading: false, error: "", errorCode: null });
  });

  it("clears stale errors as soon as a retry begins", () => {
    const retrying = catalogStateReducer(
      {
        families: [],
        loading: false,
        error: "Google Fonts are temporarily unavailable.",
        errorCode: "GOOGLE_FONTS_UNAVAILABLE",
      },
      { type: "loading" },
    );
    expect(retrying).toMatchObject({ loading: true, error: "", errorCode: null });
  });

  it("distinguishes configuration, availability, and invalid-response failures", () => {
    expect(classifyCatalogResponseError(false, { code: "GOOGLE_FONTS_NOT_CONFIGURED" })).toBe(
      "GOOGLE_FONTS_NOT_CONFIGURED",
    );
    expect(classifyCatalogResponseError(false, { code: "GOOGLE_FONTS_UNAVAILABLE" })).toBe(
      "GOOGLE_FONTS_UNAVAILABLE",
    );
    expect(classifyCatalogResponseError(true, { ok: true, families: "not-an-array" })).toBe(
      "INVALID_API_RESPONSE",
    );
  });

  it("accepts only the complete sanitized client response shape", () => {
    const valid = { ok: true, total: families.length, defaultFamily: "Inter", families };
    expect(parseClientCatalogPayload(valid)).toEqual(families);
    expect(parseClientCatalogPayload({ ...valid, total: 1951 })).toBeNull();
    expect(parseClientCatalogPayload({ ...valid, families: [{ family: "Broken" }] })).toBeNull();
    expect(parseClientCatalogPayload({ ...valid, ok: false })).toBeNull();
  });
});
