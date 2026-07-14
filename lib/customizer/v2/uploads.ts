// Upload validation + SVG sanitization (spec §14, §15, §33). Server-only use.
//
// File types are verified by magic bytes, never by the browser-supplied MIME
// type. Uploaded SVGs are sanitized: scripts, event handlers, external
// references, and foreignObject content are rejected outright — a decorative
// element must never execute code or fetch remote resources.

export type SniffedImage =
  | { ok: true; mime: "image/jpeg" | "image/png" | "image/webp" | "image/svg+xml" }
  | { ok: false; error: string };

export function sniffImageType(buffer: Buffer, allowSvg = false): SniffedImage {
  if (buffer.length < 12) return { ok: false, error: "File is too small to be an image." };

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ok: true, mime: "image/jpeg" };
  if (buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return { ok: true, mime: "image/png" };
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { ok: true, mime: "image/webp" };
  }

  if (allowSvg) {
    const head = buffer.subarray(0, 2048).toString("utf8").trimStart();
    if (head.startsWith("<?xml") || head.startsWith("<svg") || /^<!--[\s\S]*?-->\s*<svg/i.test(head)) {
      if (/<svg[\s>]/i.test(head)) return { ok: true, mime: "image/svg+xml" };
    }
  }

  return { ok: false, error: "Unsupported file type. Use JPG, PNG, or WebP." };
}

const SVG_FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /<script[\s>]/i, reason: "scripts" },
  { pattern: /<foreignObject[\s>]/i, reason: "foreignObject content" },
  { pattern: /\son[a-z]+\s*=/i, reason: "event handlers" },
  { pattern: /javascript:/i, reason: "javascript: URLs" },
  { pattern: /<iframe[\s>]/i, reason: "iframes" },
  { pattern: /<embed[\s>]/i, reason: "embedded content" },
  { pattern: /<object[\s>]/i, reason: "embedded objects" },
  { pattern: /<animate\w*[\s>][^>]*attributeName\s*=\s*["']?href/i, reason: "animated href" },
];

// External references: href/xlink:href/url() pointing at protocols or hosts.
// Fragment ids (#gradient) and data:image/* URIs stay allowed.
const EXTERNAL_REF = /(?:href|xlink:href)\s*=\s*["'](?!#|data:image\/)/i;
const EXTERNAL_CSS_URL = /url\(\s*["']?(?!#|data:image\/)[a-z]+:/i;

export type SvgSanitizeResult = { ok: true; svg: string } | { ok: false; error: string };

export function sanitizeSvg(source: string): SvgSanitizeResult {
  let svg = String(source);

  // Strip comments, DOCTYPE, and processing instructions (XXE surface).
  svg = svg.replace(/<!--[\s\S]*?-->/g, "");
  if (/<!DOCTYPE/i.test(svg) || /<!ENTITY/i.test(svg)) {
    svg = svg.replace(/<!DOCTYPE[^>[]*(\[[^\]]*\])?>/gi, "");
    if (/<!ENTITY/i.test(svg)) return { ok: false, error: "SVG contains XML entities, which are not allowed." };
  }

  for (const { pattern, reason } of SVG_FORBIDDEN_PATTERNS) {
    if (pattern.test(svg)) return { ok: false, error: `SVG contains ${reason}, which are not allowed.` };
  }
  if (EXTERNAL_REF.test(svg)) {
    return { ok: false, error: "SVG references external resources, which are not allowed." };
  }
  if (EXTERNAL_CSS_URL.test(svg)) {
    return { ok: false, error: "SVG styles reference external URLs, which are not allowed." };
  }
  if (!/<svg[\s>]/i.test(svg)) return { ok: false, error: "File is not a valid SVG document." };

  return { ok: true, svg: svg.trim() };
}

// Whether a sanitized SVG is realistically single-colour (tintable): it uses
// at most one distinct fill colour besides none/currentColor.
export function detectTintable(svg: string): boolean {
  const fills = new Set<string>();
  const matches = svg.matchAll(/fill\s*[:=]\s*["']?(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)/g);
  for (const match of matches) {
    const value = match[1].toLowerCase();
    if (value === "none" || value === "transparent" || value === "currentcolor") continue;
    fills.add(value);
    if (fills.size > 1) return false;
  }
  return true;
}

export function safeFileName(name: string, fallback = "asset"): string {
  const parts = String(name || fallback).split(".");
  const ext = parts.length > 1 ? `.${parts.pop()!.toLowerCase().replace(/[^a-z0-9]/g, "")}` : "";
  const base = parts
    .join(".")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80);
  return `${base || fallback}${ext}`;
}
