"use client";

// Shared Google Fonts client for BOTH the admin design builder and the
// customer customizer (spec §25: one component, one hook, one loader).
//
// Two responsibilities:
//   1. fetch the sanitized catalog once per page and cache it in memory
//   2. load individual font files on demand — never the whole library
//
// Performance contract (spec §7/§29): opening the customizer loads NO font
// files. A family's file is requested only when it is used by the design,
// selected, or actually visible in the dropdown.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  browserGoogleFontLoader,
  googleFontLoadErrorCode,
  subscribeGoogleFontMetrics,
  type GoogleFontStyle,
} from "./google-font-loader";
import { normalizeAllowedCustomerFonts } from "@/lib/customizer/v2/google-fonts";

export type CatalogFamily = {
  family: string;
  category: string;
  weights: string[];
  hasItalic: boolean;
};

export type CatalogState = {
  families: CatalogFamily[];
  loading: boolean;
  /** A user-safe message. Never a raw upstream/API error. */
  error: string;
  /** Safe machine-readable reason for diagnostics and retry handling. */
  errorCode: CatalogErrorCode | null;
  retry: () => void;
};

export type CatalogErrorCode =
  | "GOOGLE_FONTS_NOT_CONFIGURED"
  | "GOOGLE_FONTS_UNAVAILABLE"
  | "INVALID_API_RESPONSE"
  | "NETWORK_FAILURE";

type CatalogLoadState = Omit<CatalogState, "retry">;
type CatalogAction =
  | { type: "loading" }
  | { type: "success"; families: CatalogFamily[] }
  | { type: "error"; code: CatalogErrorCode };

/* --------------------------------------------------------------- catalog -- */

let catalogPromise: Promise<CatalogFamily[]> | null = null;
let catalogCache: CatalogFamily[] | null = null;

const UNAVAILABLE_MESSAGE = "Google Fonts are temporarily unavailable.";

class FontCatalogRequestError extends Error {
  constructor(readonly code: CatalogErrorCode) {
    super(code);
    this.name = "FontCatalogRequestError";
  }
}

function isCatalogFamily(value: unknown): value is CatalogFamily {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<CatalogFamily>;
  return (
    typeof entry.family === "string" &&
    entry.family.trim().length > 0 &&
    typeof entry.category === "string" &&
    Array.isArray(entry.weights) &&
    entry.weights.every((weight) => typeof weight === "string") &&
    typeof entry.hasItalic === "boolean"
  );
}

/** Validate the complete sanitized API response before it enters UI state. */
export function parseClientCatalogPayload(payload: unknown): CatalogFamily[] | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as {
    ok?: unknown;
    total?: unknown;
    defaultFamily?: unknown;
    families?: unknown;
  };
  if (candidate.ok !== true || !Array.isArray(candidate.families)) return null;
  if (typeof candidate.total !== "number" || !Number.isSafeInteger(candidate.total) || candidate.total < 1) return null;
  if (candidate.families.length !== candidate.total) return null;
  if (typeof candidate.defaultFamily !== "string" || !candidate.defaultFamily.trim()) return null;
  if (!candidate.families.every(isCatalogFamily)) return null;
  return candidate.families;
}

/** Pure state transition used by the hook and regression tests. */
export function catalogStateReducer(state: CatalogLoadState, action: CatalogAction): CatalogLoadState {
  if (action.type === "loading") {
    return { ...state, loading: true, error: "", errorCode: null };
  }
  if (action.type === "success") {
    return { families: action.families, loading: false, error: "", errorCode: null };
  }
  return {
    families: [],
    loading: false,
    error: UNAVAILABLE_MESSAGE,
    errorCode: action.code,
  };
}

export function classifyCatalogResponseError(responseOk: boolean, payload: unknown): CatalogErrorCode {
  if (payload && typeof payload === "object") {
    const code = (payload as { code?: unknown }).code;
    if (code === "GOOGLE_FONTS_NOT_CONFIGURED" || code === "GOOGLE_FONTS_UNAVAILABLE") return code;
  }
  return responseOk ? "INVALID_API_RESPONSE" : "GOOGLE_FONTS_UNAVAILABLE";
}

async function fetchCatalog(): Promise<CatalogFamily[]> {
  if (catalogCache) return catalogCache;
  if (!catalogPromise) {
    catalogPromise = (async () => {
      // The trusted server catalog owns long-lived caching. The browser must
      // not pin a previous 503 or malformed response and block a later retry.
      const response = await fetch("/api/customizer/fonts", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      const families = parseClientCatalogPayload(payload);
      if (!response.ok || !families) {
        throw new FontCatalogRequestError(classifyCatalogResponseError(response.ok, payload));
      }
      catalogCache = families;
      return catalogCache;
    })().catch((error) => {
      // Allow a later retry rather than caching the failure forever.
      catalogPromise = null;
      throw error;
    });
  }
  return catalogPromise;
}

/** The Google Fonts catalog, fetched once per page load. */
export function useFontCatalog(): CatalogState {
  const [state, dispatch] = useReducer(catalogStateReducer, undefined, (): CatalogLoadState => ({
    families: catalogCache || [],
    loading: !catalogCache,
    error: "",
    errorCode: null,
  }));
  const [requestVersion, setRequestVersion] = useState(0);

  const retry = useCallback(() => {
    setRequestVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (catalogCache) {
      dispatch({ type: "success", families: catalogCache });
      return;
    }
    let cancelled = false;
    dispatch({ type: "loading" });

    fetchCatalog()
      .then((families) => {
        if (!cancelled) dispatch({ type: "success", families });
      })
      .catch((error) => {
        if (!cancelled) {
          const code = error instanceof FontCatalogRequestError
            ? error.code
            : "NETWORK_FAILURE";
          if (process.env.NODE_ENV !== "production") {
            // Log only the controlled code — never a URL, key or raw payload.
            console.warn(`[fonts] Catalog request failed (${code}).`);
          }
          dispatch({ type: "error", code });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [requestVersion]);

  return { ...state, retry };
}

/* ---------------------------------------------------------------- loader -- */

function faceKey(family: string, weight: string, style: string): string {
  return `${family}|${weight}|${style}`;
}

/**
 * Load one Google font face into the document.
 *
 * Uses the CSS2 endpoint (no API key involved — this is the public stylesheet
 * service, not the Developer API) and resolves once the face is genuinely
 * ready, so callers can re-measure text against real metrics (spec §14).
 */
export function ensureGoogleFontLoaded(
  family: string,
  weight: string | number = "400",
  style: "normal" | "italic" = "normal",
): Promise<void> {
  return browserGoogleFontLoader.ensureLoaded(family, weight, style);
}

export function isGoogleFontLoaded(family: string, weight: string | number = "400", style: "normal" | "italic" = "normal"): boolean {
  return browserGoogleFontLoader.isLoaded(family, weight, style);
}

/** Safe development diagnostic for call sites that intentionally recover. */
export function reportGoogleFontLoadFailure(error: unknown): void {
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[fonts] Browser face load failed (${googleFontLoadErrorCode(error)}).`);
  }
}

/** Re-render geometry consumers after a face is genuinely available. */
export function useGoogleFontMetricsRevision(families?: readonly string[]): number {
  const [revision, setRevision] = useState(0);
  const familyKey = (families || [])
    .map((family) => String(family || "").trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("\u0000");
  useEffect(() => {
    const wanted = new Set(familyKey ? familyKey.split("\u0000") : []);
    return subscribeGoogleFontMetrics((request) => {
      if (!wanted.size || wanted.has(request.family.toLowerCase())) {
        setRevision((current) => current + 1);
      }
    });
  }, [familyKey]);
  return revision;
}

/**
 * Load every face a design depends on — called once when the customizer opens
 * so existing text renders correctly without pulling the whole library.
 */
export function ensureDesignFontsLoaded(
  styles: Array<{ fontFamily?: string; fontWeight?: string | number; fontStyle?: string }>,
): Promise<void[]> {
  const unique = new Map<string, { family: string; weight: string; style: "normal" | "italic" }>();
  for (const style of styles) {
    const family = String(style?.fontFamily || "").trim();
    if (!family) continue;
    const weight = String(style?.fontWeight || "400");
    const fontStyle: GoogleFontStyle = style?.fontStyle === "italic" ? "italic" : "normal";
    unique.set(faceKey(family, weight, fontStyle), { family, weight, style: fontStyle });
  }
  return Promise.all([...unique.values()].map((entry) => ensureGoogleFontLoaded(entry.family, entry.weight, entry.style)));
}

/* ----------------------------------------------------------- recent fonts -- */

const RECENT_KEY = "husnalogy_customizer_recent_fonts";
const RECENT_LIMIT = 6;

export function readRecentFonts(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string").slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

export function rememberRecentFont(family: string): void {
  if (typeof window === "undefined" || !family) return;
  try {
    const next = [family, ...readRecentFonts().filter((item) => item !== family)].slice(0, RECENT_LIMIT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // A full/blocked localStorage must never break font selection.
  }
}

/* ------------------------------------------------------- selectable fonts -- */

/**
 * The families a given surface may offer.
 *
 * An EMPTY `allowedFonts` means "all Google Fonts" — the existing Husnalogy
 * template rule, preserved exactly (spec §10).
 */
export function useSelectableFamilies(allowedFonts?: string[]): CatalogState {
  const catalog = useFontCatalog();

  const families = useMemo(() => {
    const allowed = normalizeAllowedCustomerFonts(allowedFonts);
    if (!allowed.length) return catalog.families;
    const wanted = new Set(allowed.map((item) => item.trim().toLowerCase()));
    return catalog.families.filter((entry) => wanted.has(entry.family.toLowerCase()));
  }, [catalog.families, allowedFonts]);

  return {
    families,
    loading: catalog.loading,
    error: catalog.error,
    errorCode: catalog.errorCode,
    retry: catalog.retry,
  };
}

/**
 * Weights + italic availability for one family, straight from the catalog
 * (spec §13). Falls back to a minimal safe pair before the catalog arrives.
 */
export function useFamilyCapabilities(family: string | undefined, families: CatalogFamily[]) {
  return useMemo(() => {
    const entry = families.find((item) => item.family.toLowerCase() === String(family || "").trim().toLowerCase());
    return {
      weights: entry?.weights?.length ? entry.weights : ["400", "700"],
      hasItalic: entry ? entry.hasItalic : false,
      known: Boolean(entry),
    };
  }, [family, families]);
}

/** Lazily load preview faces for the rows currently visible in a dropdown. */
export function usePreviewFontLoader() {
  const requested = useRef(new Set<string>());

  return useCallback((family: string) => {
    if (!family || requested.current.has(family)) return;
    requested.current.add(family);
    // Preview only ever needs the regular cut.
    void ensureGoogleFontLoaded(family, "400", "normal").catch((error) => {
      requested.current.delete(family);
      reportGoogleFontLoadFailure(error);
    });
  }, []);
}
