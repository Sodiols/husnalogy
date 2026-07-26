import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([".git", ".next", "node_modules", "playwright-report", "test-results"]);
const textExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".sql", ".md", ".css", ".scss"]);
const resolvableExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];

function normalize(value) {
  return value.split(path.sep).join("/");
}

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, files);
    else if (textExtensions.has(path.extname(entry.name).toLowerCase())) files.push(absolute);
  }
  return files;
}

function isCustomizerFile(relativePath) {
  const value = `/${relativePath.toLowerCase()}`;
  return value.includes("/customizer")
    || value.includes("/customizations")
    || value.includes("/design-builder/")
    || value.includes("/personalize/")
    || /\/(mockup-store|order-snapshots|render-jobs|save-validation|private-assets)\./.test(value)
    || /\/seed-customizer|\/validate-customizer/.test(value)
    || /customizer_v2.*\.sql$/.test(value)
    || /customizer.*\.spec\./.test(value);
}

function resolveImport(importer, specifier) {
  if (!specifier || (!specifier.startsWith(".") && !specifier.startsWith("@/"))) return null;
  const base = specifier.startsWith("@/")
    ? path.join(root, specifier.slice(2))
    : path.resolve(path.dirname(importer), specifier);
  const candidates = [base, ...resolvableExtensions.map((extension) => `${base}${extension}`), ...resolvableExtensions.map((extension) => path.join(base, `index${extension}`))];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

function category(relativePath) {
  if (/^app\/api\/.+\/route\.(ts|js)$/.test(relativePath)) return "Next API route";
  if (/^app\/.+\/(page|layout|loading|error|not-found)\.(tsx|ts|jsx|js)$/.test(relativePath)) return "Next route entry";
  if (relativePath.startsWith("supabase/migrations/")) return "database migration";
  if (relativePath.endsWith(".sql")) return "database SQL";
  if (/(__tests__|\.test\.|\.spec\.|^e2e\/)/.test(relativePath)) return "test";
  if (relativePath.startsWith("scripts/")) return "script";
  if (relativePath.startsWith("docs/") || relativePath.endsWith(".md")) return "documentation";
  if (relativePath.startsWith("app/admin/")) return "admin UI";
  if (relativePath.startsWith("app/components/")) return "customer/shared UI";
  if (relativePath.startsWith("lib/")) return "engine/service";
  return "support";
}

function isRuntimeEntrypoint(relativePath, packageJson) {
  if (/^app\/api\/.+\/route\.(ts|js)$/.test(relativePath)) return true;
  if (/^app\/.+\/(page|layout|loading|error|not-found)\.(tsx|ts|jsx|js)$/.test(relativePath)) return true;
  if (relativePath.startsWith("supabase/migrations/") || relativePath.startsWith("supabase/functions/")) return true;
  if (relativePath.startsWith("e2e/") || /(__tests__|\.test\.|\.spec\.)/.test(relativePath)) return true;
  if (["next.config.js", "next.config.mjs", "playwright.config.ts", "vitest.config.ts"].includes(relativePath)) return true;
  return Object.values(packageJson.scripts || {}).some((command) => String(command).includes(relativePath) || String(command).includes(path.basename(relativePath)));
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const allFiles = walk(root);
const relativeByAbsolute = new Map(allFiles.map((absolute) => [absolute, normalize(path.relative(root, absolute))]));
const contents = new Map(allFiles.map((absolute) => [absolute, fs.readFileSync(absolute, "utf8")]));
const inbound = new Map(allFiles.map((absolute) => [absolute, { static: new Set(), dynamic: new Set(), runtime: new Set() }]));
const outgoing = new Map(allFiles.map((absolute) => [absolute, new Set()]));
const importPattern = /(?:import\s*\(|require\s*\()\s*["']([^"']+)["']|(?:import|export)\s+(?:type\s+)?[^;"']*?\sfrom\s*["']([^"']+)["']|import\s*["']([^"']+)["']/g;

for (const [importer, source] of contents) {
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] || match[2] || match[3];
    const target = resolveImport(importer, specifier);
    if (!target || !inbound.has(target)) continue;
    const importerPath = relativeByAbsolute.get(importer);
    const kind = match[1] && source.slice(Math.max(0, match.index - 10), match.index + 10).includes("import(") ? "dynamic" : "static";
    inbound.get(target)[kind].add(importerPath);
    outgoing.get(importer).add(target);
  }
}

const customizerFiles = allFiles.filter((absolute) => isCustomizerFile(relativeByAbsolute.get(absolute))).sort((a, b) => relativeByAbsolute.get(a).localeCompare(relativeByAbsolute.get(b)));

// String/runtime references catch package commands, fetch route URLs, worker
// names, Supabase table names, and non-import configuration references.
for (const target of customizerFiles) {
  const relativePath = relativeByAbsolute.get(target);
  const withoutExtension = relativePath.replace(/\.[^.]+$/, "");
  const routePath = relativePath.startsWith("app/api/") ? `/${withoutExtension.replace(/^app\//, "").replace(/\/route$/, "")}` : "";
  const needles = [relativePath, withoutExtension, routePath].filter((needle) => needle.length >= 8);
  for (const [other, source] of contents) {
    if (other === target) continue;
    if (needles.some((needle) => source.includes(needle))) inbound.get(target).runtime.add(relativeByAbsolute.get(other));
  }
}

const lines = [
  "# Customizer Dependency Map",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  "This inventory covers static imports, dynamic `import()`/`require()` calls, Next.js route entry points, package scripts, tests, migrations, Supabase functions, worker/configuration strings, and route URL references. A zero-import file is not automatically unused: framework and deployment entry points are retained explicitly.",
  "",
  `Files audited: ${customizerFiles.length}`,
  "",
  "| File | Category | Static importers | Dynamic importers | Runtime/string references | Audit decision |",
  "| --- | --- | ---: | ---: | ---: | --- |",
];

const candidates = [];
for (const absolute of customizerFiles) {
  const relativePath = relativeByAbsolute.get(absolute);
  const references = inbound.get(absolute);
  const entrypoint = isRuntimeEntrypoint(relativePath, packageJson);
  const referenceCount = references.static.size + references.dynamic.size + references.runtime.size;
  const decision = entrypoint ? "KEEP: framework/script/test/migration entry point" : referenceCount ? "KEEP: referenced" : "REVIEW: no inbound reference found";
  if (!entrypoint && referenceCount === 0) candidates.push(relativePath);
  lines.push(`| \`${relativePath}\` | ${category(relativePath)} | ${references.static.size} | ${references.dynamic.size} | ${references.runtime.size} | ${decision} |`);
}

const customizerSet = new Set(customizerFiles);
const cycles = new Set();
const visiting = new Set();
const visited = new Set();
const stack = [];
function visit(file) {
  if (visiting.has(file)) {
    const start = stack.indexOf(file);
    const cycle = [...stack.slice(start), file].map((item) => relativeByAbsolute.get(item));
    const rotations = cycle.slice(0, -1).map((_, index) => {
      const body = [...cycle.slice(index, -1), ...cycle.slice(0, index)];
      return [...body, body[0]].join(" -> ");
    });
    cycles.add(rotations.sort()[0]);
    return;
  }
  if (visited.has(file)) return;
  visiting.add(file);
  stack.push(file);
  for (const target of outgoing.get(file) || []) if (customizerSet.has(target)) visit(target);
  stack.pop();
  visiting.delete(file);
  visited.add(file);
}
for (const file of customizerFiles) visit(file);

lines.push("", "## Files requiring manual review", "");
if (candidates.length) lines.push(...candidates.map((file) => `- \`${file}\``));
else lines.push("No non-entry customizer file lacks an inbound reference.");
lines.push(
  "",
  "## Circular dependency check",
  "",
  ...(cycles.size ? [...cycles].sort().map((cycle) => `- \`${cycle}\``) : ["No static or dynamic import cycle was found inside the Customizer file graph."]),
  "",
  "## Deletion rule",
  "",
  "A REVIEW result is only a lead. Before removal, inspect exports, framework conventions, dynamic routes, package/configuration references, tests, worker entry points, Supabase SQL/functions, stored document compatibility, and the replacement path. Record the final evidence in `CUSTOMIZER_CLEANUP_REPORT.md`.",
  "",
);

fs.writeFileSync(path.join(root, "CUSTOMIZER_DEPENDENCY_MAP.md"), `${lines.join("\n")}\n`);
console.log(`Audited ${customizerFiles.length} customizer-related files; ${candidates.length} require manual review; ${cycles.size} import cycles found.`);
