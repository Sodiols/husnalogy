// Customizer font architecture validation.
//
// The customizer no longer bundles font files: every selectable design font
// comes from the Google Fonts Developer API at runtime. This script therefore
// validates the ARCHITECTURE rather than a list of local TTFs, and stays
// completely deterministic — it never calls the Google API, so builds cannot
// become flaky because of an upstream outage (spec §35).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const failures = [];
const notes = [];

const read = (relative) => {
  const absolute = join(process.cwd(), relative);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : null;
};

/* 1. The Google Fonts modules must exist. --------------------------------- */

const REQUIRED_MODULES = [
  "lib/customizer/v2/google-fonts.ts",
  "lib/customizer/v2/server/google-fonts-catalog.ts",
  "lib/customizer/v2/server/google-font-files.ts",
  "app/api/customizer/fonts/route.ts",
  "app/components/customizer/GoogleFontSelector.tsx",
  "app/components/customizer/useGoogleFonts.ts",
];

for (const relative of REQUIRED_MODULES) {
  if (!read(relative)) failures.push(`${relative}: missing — the Google Fonts architecture is incomplete`);
}

/* 2. The old bundled customizer font registry must be gone. ---------------- */

if (read("lib/customizer/v2/fonts.ts")) {
  failures.push("lib/customizer/v2/fonts.ts: the old hardcoded font registry still exists");
}

if (existsSync(join(process.cwd(), "public", "fonts"))) {
  const leftover = readdirSync(join(process.cwd(), "public", "fonts")).filter((name) => /\.(ttf|otf|woff2?)$/i.test(name));
  if (leftover.length) {
    failures.push(`public/fonts: ${leftover.length} obsolete customizer font file(s) remain (${leftover.join(", ")})`);
  }
}

/* 3. No hardcoded six-font restriction may control the new system. --------- */

const OLD_REGISTRY_SYMBOLS = ["CUSTOMIZER_APPROVED_FONTS", "CUSTOMER_FONT_FAMILIES", "FONT_REGISTRY"];
const SOURCE_ROOTS = ["app", "lib"];

function walk(directory, results = []) {
  for (const entry of readdirSync(join(process.cwd(), directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      walk(relative, results);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      results.push(relative);
    }
  }
  return results;
}

const sourceFiles = SOURCE_ROOTS.flatMap((root) => walk(root));
for (const relative of sourceFiles) {
  const source = read(relative) || "";
  for (const symbol of OLD_REGISTRY_SYMBOLS) {
    // A comment explaining the removal is fine; a live reference is not.
    const live = source
      .split("\n")
      .filter((line) => line.includes(symbol) && !line.trim().startsWith("//") && !line.trim().startsWith("*"));
    if (live.length) {
      failures.push(`${relative}: still references the removed font registry symbol "${symbol}"`);
    }
  }
}

/* 4. The production renderer must resolve fonts dynamically. --------------- */

const renderSource = read("lib/customizer/v2/server/render.ts") || "";
if (!renderSource.includes("getFontCatalog")) {
  failures.push("server/render.ts: does not resolve fonts from the Google Fonts catalog");
}
if (!renderSource.includes("resolveFontsForStyles")) {
  failures.push("server/render.ts: does not resolve per-document font files");
}
if (renderSource.includes("getAllFontFilePaths")) {
  failures.push("server/render.ts: still loads every bundled font file into the renderer");
}
if (!/FONT_FILE_MISSING/.test(renderSource)) {
  failures.push("server/render.ts: no explicit failure path for an unobtainable production font");
}

/* 5. The API key must be server-only and never hardcoded. ------------------ */

for (const relative of sourceFiles) {
  const source = read(relative) || "";
  if (source.includes("NEXT_PUBLIC_GOOGLE_FONTS_API_KEY")) {
    failures.push(`${relative}: exposes the Google Fonts API key through a NEXT_PUBLIC variable`);
  }
  // A literal Google API key (AIza...) must never appear in source.
  if (/AIza[0-9A-Za-z_-]{20,}/.test(source)) {
    failures.push(`${relative}: contains what looks like a hardcoded Google API key`);
  }
}

const catalogSource = read("lib/customizer/v2/server/google-fonts-catalog.ts") || "";
if (!catalogSource.includes("process.env.GOOGLE_FONTS_API_KEY")) {
  failures.push("google-fonts-catalog.ts: does not read GOOGLE_FONTS_API_KEY from the server environment");
}

// The key must only ever be read on the server.
const clientKeyUsers = sourceFiles.filter((relative) => {
  const source = read(relative) || "";
  return source.includes("GOOGLE_FONTS_API_KEY") && source.includes('"use client"');
});
if (clientKeyUsers.length) {
  failures.push(`Google Fonts API key referenced in client component(s): ${clientKeyUsers.join(", ")}`);
}

/* 6. SSRF protection on the font downloader. ------------------------------- */

const filesSource = read("lib/customizer/v2/server/google-font-files.ts") || "";
if (!filesSource.includes("isTrustedFontUrl")) {
  failures.push("google-font-files.ts: no trusted-host guard on font downloads");
}
if (!filesSource.includes("fonts.gstatic.com")) {
  failures.push("google-font-files.ts: trusted font host allowlist is missing");
}

/* 7. The environment variable must be documented. -------------------------- */

const envExample = read(".env.example");
if (!envExample) {
  failures.push(".env.example: missing — GOOGLE_FONTS_API_KEY is undocumented");
} else if (!envExample.includes("GOOGLE_FONTS_API_KEY")) {
  failures.push(".env.example: does not document GOOGLE_FONTS_API_KEY");
}

/* 8. Website branding fonts must remain intact and separate. --------------- */

const brandDirectory = join(process.cwd(), "app", "brand-fonts");
if (!existsSync(brandDirectory)) {
  failures.push("app/brand-fonts: missing — the website's own typography files are gone");
} else {
  const brandFiles = readdirSync(brandDirectory).filter((name) => /\.ttf$/i.test(name));
  if (!brandFiles.length) failures.push("app/brand-fonts: contains no font files");
  const layoutSource = read("app/layout.tsx") || "";
  for (const name of brandFiles) {
    if (!layoutSource.includes(`./brand-fonts/${name}`)) {
      failures.push(`app/brand-fonts/${name}: not referenced by next/font/local in app/layout.tsx`);
    }
  }
  notes.push(`website branding: ${brandFiles.length} local font files wired to next/font/local`);
}

/* ------------------------------------------------------------------------- */

if (failures.length) {
  console.error("Customizer font architecture validation failed:\n" + failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}

console.log(
  [
    "Customizer font architecture validated (Google Fonts).",
    ...notes.map((note) => `  ${note}`),
    "  customizer fonts: served dynamically from the Google Fonts Developer API",
  ].join("\n"),
);
