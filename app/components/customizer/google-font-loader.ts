// Browser Google Font face loader.
//
// The Developer API catalog remains server-only. Browser faces use Google's
// public CSS2 endpoint and are loaded one exact family/weight/style at a time.
// A face is cached only after its stylesheet, FontFaceSet load, and final
// FontFaceSet check have all succeeded.

export type GoogleFontStyle = "normal" | "italic";

export type GoogleFontLoadErrorCode =
  | "STYLESHEET_LOAD_FAILED"
  | "FONT_FACE_LOAD_FAILED"
  | "FONT_FACE_NOT_CONFIRMED";

export class GoogleFontLoadError extends Error {
  constructor(readonly code: GoogleFontLoadErrorCode) {
    super(code);
    this.name = "GoogleFontLoadError";
  }
}

export type GoogleFontLoadRequest = {
  key: string;
  family: string;
  weight: string;
  style: GoogleFontStyle;
  href: string;
  descriptor: string;
  sampleText: string;
};

export type GoogleFontLoaderEnvironment = {
  available: () => boolean;
  loadStylesheet: (request: GoogleFontLoadRequest) => Promise<void>;
  loadFace: (request: GoogleFontLoadRequest) => Promise<unknown[]>;
  fontsReady: () => Promise<unknown>;
  checkFace: (request: GoogleFontLoadRequest) => boolean;
  notifyMetricsChanged: (request: GoogleFontLoadRequest) => void;
};

// These legacy families are supplied by the browser/operating system rather
// than Google Fonts. Sending them to the CSS2 endpoint creates a guaranteed
// failing request and can make an otherwise healthy design-font batch reject.
const BROWSER_SYSTEM_FONTS = new Set([
  "arial",
  "courier new",
  "georgia",
  "times new roman",
]);

export function isBrowserSystemFont(family: string): boolean {
  return BROWSER_SYSTEM_FONTS.has(String(family || "").trim().toLowerCase());
}

function normalizeWeight(weight: string | number): string {
  const candidate = String(weight || "400").trim();
  return /^\d{3}$/.test(candidate) ? candidate : "400";
}

function faceKey(family: string, weight: string, style: GoogleFontStyle): string {
  return `${family}|${weight}|${style}`;
}

function cssFamily(family: string): string {
  return family.replace(/["\\]/g, "\\$&");
}

function requestFor(
  family: string,
  weight: string | number = "400",
  style: GoogleFontStyle = "normal",
): GoogleFontLoadRequest {
  const normalizedFamily = String(family || "").trim();
  const normalizedWeight = normalizeWeight(weight);
  const italicAxis = style === "italic" ? "ital,wght@1," : "wght@";
  return {
    key: faceKey(normalizedFamily, normalizedWeight, style),
    family: normalizedFamily,
    weight: normalizedWeight,
    style,
    href:
      `https://fonts.googleapis.com/css2?family=${encodeURIComponent(normalizedFamily).replace(/%20/g, "+")}` +
      `:${italicAxis}${normalizedWeight}&display=swap`,
    descriptor: `${style} ${normalizedWeight} 16px "${cssFamily(normalizedFamily)}"`,
    sampleText: "Husnalogy",
  };
}

export function createGoogleFontLoader(environment: GoogleFontLoaderEnvironment) {
  const loadedFaces = new Set<string>();
  const loadingFaces = new Map<string, Promise<void>>();

  const ensureLoaded = (
    family: string,
    weight: string | number = "400",
    style: GoogleFontStyle = "normal",
  ): Promise<void> => {
    const request = requestFor(family, weight, style);
    if (!environment.available() || !request.family || isBrowserSystemFont(request.family)) {
      return Promise.resolve();
    }
    if (loadedFaces.has(request.key)) return Promise.resolve();

    const existing = loadingFaces.get(request.key);
    if (existing) return existing;

    const task = (async () => {
      try {
        await environment.loadStylesheet(request);
      } catch (error) {
        if (error instanceof GoogleFontLoadError) throw error;
        throw new GoogleFontLoadError("STYLESHEET_LOAD_FAILED");
      }

      let faces: unknown[];
      try {
        faces = await environment.loadFace(request);
        await environment.fontsReady();
      } catch {
        throw new GoogleFontLoadError("FONT_FACE_LOAD_FAILED");
      }

      if (!Array.isArray(faces) || faces.length === 0 || !environment.checkFace(request)) {
        throw new GoogleFontLoadError("FONT_FACE_NOT_CONFIRMED");
      }

      loadedFaces.add(request.key);
      environment.notifyMetricsChanged(request);
    })().finally(() => {
      loadingFaces.delete(request.key);
    });

    loadingFaces.set(request.key, task);
    return task;
  };

  return {
    ensureLoaded,
    isLoaded: (family: string, weight: string | number = "400", style: GoogleFontStyle = "normal") =>
      isBrowserSystemFont(family) || loadedFaces.has(requestFor(family, weight, style).key),
  };
}

const metricsListeners = new Set<(request: GoogleFontLoadRequest) => void>();

export function subscribeGoogleFontMetrics(listener: (request: GoogleFontLoadRequest) => void): () => void {
  metricsListeners.add(listener);
  return () => metricsListeners.delete(listener);
}

function notifyGoogleFontMetrics(request: GoogleFontLoadRequest): void {
  for (const listener of metricsListeners) listener(request);
}

const STYLESHEET_TIMEOUT_MS = 15_000;

function findStylesheet(key: string): HTMLLinkElement | null {
  return Array.from(document.querySelectorAll<HTMLLinkElement>("link[data-google-font]"))
    .find((link) => link.dataset.googleFont === key) || null;
}

function waitForStylesheet(request: GoogleFontLoadRequest): Promise<void> {
  const found = findStylesheet(request.key);
  if (found?.dataset.googleFontStatus === "loaded" || found?.sheet) {
    if (found) found.dataset.googleFontStatus = "loaded";
    return Promise.resolve();
  }
  if (found?.dataset.googleFontStatus === "failed") found.remove();

  const existing = found?.isConnected ? found : null;
  const link = existing || document.createElement("link");
  link.rel = "stylesheet";
  link.href = request.href;
  link.dataset.googleFont = request.key;
  link.dataset.googleFontStatus = "loading";

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      link.removeEventListener("load", onLoad);
      link.removeEventListener("error", onError);
      if (success) {
        link.dataset.googleFontStatus = "loaded";
        resolve();
      } else {
        link.dataset.googleFontStatus = "failed";
        link.remove();
        reject(new GoogleFontLoadError("STYLESHEET_LOAD_FAILED"));
      }
    };
    const onLoad = () => finish(true);
    const onError = () => finish(false);
    const timeout = window.setTimeout(() => finish(false), STYLESHEET_TIMEOUT_MS);

    link.addEventListener("load", onLoad, { once: true });
    link.addEventListener("error", onError, { once: true });
    if (!existing) document.head.appendChild(link);
  });
}

const browserEnvironment: GoogleFontLoaderEnvironment = {
  available: () => typeof window !== "undefined" && typeof document !== "undefined" && Boolean(document.fonts),
  loadStylesheet: waitForStylesheet,
  loadFace: (request) => document.fonts.load(request.descriptor, request.sampleText) as Promise<unknown[]>,
  fontsReady: () => Promise.resolve(document.fonts.ready),
  checkFace: (request) => document.fonts.check(request.descriptor, request.sampleText),
  notifyMetricsChanged: notifyGoogleFontMetrics,
};

export const browserGoogleFontLoader = createGoogleFontLoader(browserEnvironment);

export function googleFontLoadErrorCode(error: unknown): GoogleFontLoadErrorCode | "UNKNOWN_FONT_LOAD_FAILURE" {
  return error instanceof GoogleFontLoadError ? error.code : "UNKNOWN_FONT_LOAD_FAILURE";
}
