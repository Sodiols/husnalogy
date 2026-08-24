// Server-only Google Font FILE resolver + cache.
//
// Downloads only the exact variants a render job needs (spec §16) and caches
// them on disk so repeated renders never re-download the same file (spec §17).
//
// SECURITY (spec §30): this module will only ever fetch a URL that came from
// the trusted, server-fetched Google Fonts catalog and that passes an explicit
// host allowlist. A client-supplied URL can never reach fetch() — callers pass
// family/weight/style, never a URL.

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  collectFontDependencies,
  type FontDependency,
  type GoogleFontFamily,
  type TextStyleLike,
} from "../google-fonts";

/** Only Google's own font CDN hosts may ever be fetched. */
const ALLOWED_FONT_HOSTS = new Set(["fonts.gstatic.com", "fonts.googleapis.com"]);

const MAX_FONT_BYTES = 12 * 1024 * 1024;

export class FontFetchError extends Error {
  code = "FONT_FILE_MISSING" as const;
  constructor(message: string) {
    super(message);
    this.name = "FontFetchError";
  }
}

/**
 * Hard SSRF guard. Rejects anything that is not an https URL on a Google font
 * host, so no redirect, catalog poisoning or crafted input can make the server
 * fetch an arbitrary address.
 */
export function isTrustedFontUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(String(url));
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return ALLOWED_FONT_HOSTS.has(parsed.hostname.toLowerCase());
}

function cacheDirectory(): string {
  return join(tmpdir(), "husnalogy-google-fonts");
}

/** Collision-proof cache key: family + variant + the exact source URL. */
export function fontCacheKey(dependency: Pick<FontDependency, "family" | "variantKey" | "url">): string {
  const digest = createHash("sha256")
    .update(`${dependency.family}|${dependency.variantKey}|${dependency.url}`)
    .digest("hex")
    .slice(0, 32);
  const safeFamily = dependency.family.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const extension = /\.otf(\?|$)/i.test(dependency.url) ? "otf" : "ttf";
  return `${safeFamily}-${dependency.variantKey}-${digest}.${extension}`;
}

// In-process buffer cache and in-flight map: two concurrent render jobs asking
// for the same variant share one download (spec §17).
const bufferCache = new Map<string, Buffer>();
const inflight = new Map<string, Promise<string>>();

async function downloadToCache(dependency: FontDependency, absolutePath: string): Promise<string> {
  if (!isTrustedFontUrl(dependency.url)) {
    throw new FontFetchError(`Refusing to fetch untrusted font URL for ${dependency.family}.`);
  }

  let response: Response;
  try {
    response = await fetch(dependency.url, { signal: AbortSignal.timeout(20_000), redirect: "error" });
  } catch (error) {
    throw new FontFetchError(
      `Could not download ${dependency.family} ${dependency.weight} ${dependency.style}: ${error instanceof Error ? error.message : "network error"}`,
    );
  }

  if (!response.ok) {
    throw new FontFetchError(
      `Could not download ${dependency.family} ${dependency.weight} ${dependency.style}: HTTP ${response.status}`,
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.byteLength) {
    throw new FontFetchError(`Downloaded an empty font file for ${dependency.family}.`);
  }
  if (bytes.byteLength > MAX_FONT_BYTES) {
    throw new FontFetchError(`Font file for ${dependency.family} is unexpectedly large.`);
  }

  await mkdir(cacheDirectory(), { recursive: true });
  // Write to a unique temp name then rename — an atomic swap, so a concurrent
  // reader never observes a half-written font file.
  const staging = `${absolutePath}.${process.pid}.${Math.random().toString(36).slice(2)}.part`;
  await writeFile(staging, bytes);
  await rename(staging, absolutePath);

  bufferCache.set(absolutePath, bytes);
  return absolutePath;
}

/** Absolute on-disk path for one dependency, downloading it if needed. */
export async function ensureFontFile(dependency: FontDependency): Promise<string> {
  const absolutePath = join(cacheDirectory(), fontCacheKey(dependency));

  if (bufferCache.has(absolutePath) && existsSync(absolutePath)) return absolutePath;
  if (existsSync(absolutePath)) return absolutePath;

  const pending = inflight.get(absolutePath);
  if (pending) return pending;

  const task = downloadToCache(dependency, absolutePath).finally(() => {
    inflight.delete(absolutePath);
  });
  inflight.set(absolutePath, task);
  return task;
}

export async function readFontBuffer(dependency: FontDependency): Promise<Buffer> {
  const absolutePath = await ensureFontFile(dependency);
  const cached = bufferCache.get(absolutePath);
  if (cached) return cached;
  const bytes = await readFile(absolutePath);
  bufferCache.set(absolutePath, bytes);
  return bytes;
}

export type ResolvedFontSet = {
  dependencies: FontDependency[];
  /** Absolute paths to hand to resvg. */
  filePaths: string[];
  /** Families the catalog does not know — production must fail on these. */
  missingFamilies: string[];
};

/**
 * Resolve and materialize exactly the font files a document needs.
 *
 * Never substitutes a different family: an unresolvable family is reported in
 * `missingFamilies` so the caller can fail the render loudly (spec §18).
 */
export async function resolveFontsForStyles(
  catalog: GoogleFontFamily[],
  styles: TextStyleLike[],
  options: { download?: boolean } = {},
): Promise<ResolvedFontSet> {
  const { dependencies, missingFamilies } = collectFontDependencies(catalog, styles);

  if (options.download === false) {
    return { dependencies, filePaths: [], missingFamilies };
  }

  const filePaths: string[] = [];
  for (const dependency of dependencies) {
    filePaths.push(await ensureFontFile(dependency));
  }
  return { dependencies, filePaths, missingFamilies };
}

/** Test helper — clears the in-process caches (not the disk cache). */
export function __resetFontFileCaches(): void {
  bufferCache.clear();
  inflight.clear();
}
