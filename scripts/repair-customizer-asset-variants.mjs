// Scan, and optionally repair, Customizer image variants that are missing,
// corrupt, or too small for their source — in the library (customizer_assets)
// and in customer uploads (customer_asset_library).
//
// The classic failure: a legacy editor variant generated at thumbnail size
// (480px for a 2400px+ original). It decodes perfectly, so a decodability check
// passes it, and the canvas stretches 480px across the artboard.
//
//   node scripts/repair-customizer-asset-variants.mjs                 # DRY RUN (default): report only
//   node scripts/repair-customizer-asset-variants.mjs --table library # one table
//   node scripts/repair-customizer-asset-variants.mjs --limit 100
//   node scripts/repair-customizer-asset-variants.mjs --apply         # repair, after a metadata backup
//
// Nothing is written without --apply. With it: the metadata of every record to
// be changed is backed up to .asset-repair-backups/ first; variants are
// regenerated from the ORIGINAL only, verified before upload and read back
// after; records change only after that; originals are never modified or
// deleted; old variant files are left in place. See scripts/lib/asset-variant-repair.mjs.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { formatSummary, runVariantRepair } from "./lib/asset-variant-repair.mjs";

function loadEnv() {
  let raw = "";
  try {
    raw = readFileSync(".env.local", "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment or .env.local.");
  process.exit(1);
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
if (apply && args.includes("--dry-run")) {
  console.error("Choose one: --dry-run (default) or --apply.");
  process.exit(1);
}
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const limit = Number(option("--limit")) || 100_000;
const tableOption = option("--table");
const tables = tableOption === "library" ? ["library"] : tableOption === "customer" ? ["customer"] : ["library", "customer"];

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.resolve(".asset-repair-backups");

console.log(`${apply ? "REPAIR MODE" : "DRY RUN — no changes will be written"} · ${new URL(url).host} · tables: ${tables.join(", ")}\n`);

const { summary, findings, backupPath } = await runVariantRepair({
  supabase,
  dryRun: !apply,
  tables,
  limit,
  log: (line) => console.log(line),
  writeBackup: (backup) => {
    mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `backup-${stamp}.json`);
    writeFileSync(file, JSON.stringify(backup, null, 2));
    return file;
  },
});

console.log(`\n${formatSummary(summary, !apply)}`);
mkdirSync(outDir, { recursive: true });
const reportFile = path.join(outDir, `report-${stamp}${apply ? "" : "-dry-run"}.json`);
writeFileSync(
  reportFile,
  JSON.stringify(
    {
      mode: apply ? "repair" : "dry-run",
      host: new URL(url).host,
      summary,
      backupPath,
      findings: findings.map(({ table, row, status, reason, editor, thumbnail, metadataInvalid, source }) => ({
        table,
        id: row.id,
        status,
        reason,
        source,
        editor,
        thumbnail,
        metadataInvalid,
      })),
    },
    null,
    2,
  ),
);
console.log(`\nReport: ${reportFile}`);
if (!apply && summary.repairable) console.log("Dry run only. Re-run with --apply to repair (a metadata backup is written first).");
if (summary.unrepairable) console.log(`${summary.unrepairable} asset(s) have no usable original and need manual recovery; their records were not changed.`);
