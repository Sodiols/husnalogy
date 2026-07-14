import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import opentype from "opentype.js";

const registryPath = join(process.cwd(), "lib", "customizer", "v2", "fonts.ts");
const layoutPath = join(process.cwd(), "app", "layout.tsx");
const registrySource = readFileSync(registryPath, "utf8");
const layoutSource = readFileSync(layoutPath, "utf8");
const required = [...registrySource.matchAll(/localFile\(\s*["']([^"']+)["']/g)].map((match) => match[1]);

const failures = [];
if (!required.length) failures.push("font registry: no local font faces are configured");
for (const relative of required) {
  const absolute = join(process.cwd(), "public", relative);
  if (!existsSync(absolute)) {
    failures.push(`${relative}: missing`);
    continue;
  }
  if (statSync(absolute).size < 1024) {
    failures.push(`${relative}: file is unexpectedly small`);
    continue;
  }
  try {
    const bytes = readFileSync(absolute);
    opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  } catch (error) {
    failures.push(`${relative}: cannot be parsed (${error instanceof Error ? error.message : String(error)})`);
  }
  const nextFontPath = `../public/${relative}`.replace(/\\/g, "/");
  if (!layoutSource.includes(nextFontPath)) {
    failures.push(`${relative}: missing from next/font/local configuration in app/layout.tsx`);
  }
}

if (failures.length) {
  console.error("FONT_FILE_MISSING: Customizer font validation failed:\n" + failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}

console.log(`Validated ${required.length} local customizer font files.`);
