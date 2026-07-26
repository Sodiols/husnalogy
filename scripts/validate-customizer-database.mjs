import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalPath = path.join(root, "supabase", "customizer_v2.sql");
const liveValidatorPath = path.join(root, "scripts", "validate_customizer_database.sql");
const canonical = readFileSync(canonicalPath, "utf8");
const liveValidator = readFileSync(liveValidatorPath, "utf8");

const requiredTables = [
  "product_customizer_templates",
  "product_customizations",
  "customizer_template_versions",
  "customizer_asset_categories",
  "customizer_assets",
  "customer_asset_library",
  "customizer_mockup_templates",
  "customizer_mockup_views",
  "customizer_mockup_artwork_areas",
  "customizer_mockup_overlays",
  "customizer_guides",
  "customizer_render_jobs",
  "customizer_render_outputs",
  "customizer_preflight_results",
  "order_design_snapshots",
  "customizer_feature_flags",
  "customizer_audit_logs",
  "customizer_asset_folders",
];

const requiredFragments = [
  "20260719120000_customizer_v2_schema_consolidation.sql",
  "20260719180000_permanent_admin_asset_library.sql",
  "enable row level security",
  "create policy",
  "customizer-elements",
  "customer-uploads",
  "customizer-renders",
];

const errors = [];
for (const table of requiredTables) {
  if (!new RegExp(`(?:create table if not exists|alter table)\\s+public\\.${table}\\b`, "i").test(canonical)) {
    errors.push(`canonical SQL does not define or extend public.${table}`);
  }
  if (!liveValidator.includes(`'${table}'`)) {
    errors.push(`live validator does not require public.${table}`);
  }
}

for (const fragment of requiredFragments) {
  if (!canonical.toLowerCase().includes(fragment.toLowerCase())) {
    errors.push(`canonical SQL is missing required fragment: ${fragment}`);
  }
}

if (!/'customizer-elements'\s*,\s*'customizer-elements'\s*,\s*false/i.test(canonical)) {
  errors.push("canonical SQL must finish with a private customizer-elements bucket");
}

const executableSql = canonical
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*--.*$/gm, "");
// The draft-save function intentionally replaces only the child views of one
// locked draft. Preserve that established transactional behavior while still
// rejecting unscoped data removal and schema-destructive operations.
const approvedDraftReplacement = "delete from public.customizer_mockup_views where mockup_template_id = v_template_id;";
const destructiveSurface = executableSql.replace(approvedDraftReplacement, "");
const destructive = destructiveSurface.match(/\b(?:drop\s+(?:table|schema)|truncate(?:\s+table)?|delete\s+from)\b/gi) || [];
if (destructive.length) {
  errors.push(`canonical SQL contains prohibited destructive statements: ${[...new Set(destructive)].join(", ")}`);
}

if (!/begin\s+transaction\s+read\s+only/i.test(liveValidator) || !/rollback\s*;/i.test(liveValidator)) {
  errors.push("live validator must run in an explicit read-only transaction and roll back");
}

if (errors.length) {
  console.error("Customizer database static validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Customizer database static validation passed (${requiredTables.length} tables).`);

const databaseUrl = process.env.CUSTOMIZER_DATABASE_URL || process.env.HUSNALOGY_DATABASE_URL;
if (!databaseUrl) {
  console.log("Live database validation skipped: set CUSTOMIZER_DATABASE_URL (preferred) or HUSNALOGY_DATABASE_URL to a local/staging PostgreSQL connection string.");
  process.exit(0);
}

const live = spawnSync(
  "psql",
  ["-X", "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--dbname", databaseUrl, "--file", liveValidatorPath],
  { cwd: root, encoding: "utf8", stdio: "inherit", shell: process.platform === "win32" },
);

if (live.error) {
  console.error(`Unable to start psql: ${live.error.message}`);
  process.exit(1);
}
process.exit(live.status ?? 1);
