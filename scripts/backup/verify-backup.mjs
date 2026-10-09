#!/usr/bin/env node
/**
 * Verify a backup WITHOUT restoring it — an archive that merely exists is not
 * a backup. Works on format v2 and (read-only) v1. For a run folder
 * (database/ and/or storage/ inside it, or either folder on its own):
 *
 *   database  status recovery-grade; the encrypted manifest matches status.json
 *             and decrypts; every archive's ciphertext hash, decryption and
 *             plaintext hash; pg_restore can read it; every table has its
 *             TABLE DATA entry AND exactly the snapshot's row count; the
 *             critical Husnalogy tables are present.
 *   storage   status complete; the encrypted index matches status.json and
 *             decrypts; EVERY blob exists, decrypts and matches its sha256.
 *
 * The report names problems by bucket and object NUMBER, never by path.
 *
 *   node scripts/backup/verify-backup.mjs --backup <folder>
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEncryptionKey, privateWorkDir, removeWorkDir } from "./lib/crypto.mjs";
import { databaseBackupFormat, openDatabaseBackup, openStorageBackup, storageBackupFormat } from "./lib/formats.mjs";
import { argValue, isMain } from "./lib/target.mjs";
import { archiveRowCounts, archiveTableEntries } from "./db-backup.mjs";
import { openArchives } from "./db-restore.mjs";
import { readBlob } from "./storage-restore.mjs";

/** Tables Husnalogy cannot recover without. */
export const CRITICAL_TABLES = [
  "auth.users",
  "public.profiles",
  "public.customer_addresses",
  "public.products",
  "public.product_customizer_templates",
  "public.customizer_template_versions",
  "public.customizer_assets",
  "public.product_customizations",
  "public.customer_asset_library",
  "public.cart_items",
  "public.orders",
  "public.order_items",
  "public.order_design_snapshots",
  "public.order_production_assets",
  "public.customizer_render_outputs",
  "public.production_tasks",
];

const brief = (error) => String(error?.message || error).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>").slice(0, 200);

export async function verifyDatabaseBackup(dir, encryptionKey) {
  const problems = [];
  let opened = null;
  const work = privateWorkDir("husnalogy-verify-");
  try {
    opened = openDatabaseBackup(dir, encryptionKey);
    const { manifest } = opened;
    const archives = await openArchives(dir, manifest, encryptionKey, work);
    for (const [archive, path] of Object.entries(archives)) {
      const expected = Object.keys(manifest.tables).filter((table) => (archive === "auth.dump" ? table.startsWith("auth.") : table.startsWith("public.")));
      const entries = await archiveTableEntries(path);
      const missing = expected.filter((table) => !entries.has(table));
      if (missing.length) problems.push(`${archive} lacks table data for ${missing.length} table(s)`);
      const stored = await archiveRowCounts(path);
      const wrong = expected.filter((table) => (stored[table] ?? 0) !== manifest.tables[table]);
      if (wrong.length) problems.push(`${archive}: row counts differ from the snapshot for ${wrong.length} table(s)`);
    }
    for (const table of CRITICAL_TABLES) if (!(table in manifest.tables)) problems.push(`critical table ${table} is not in the backup`);
    if (opened.format === "v1" && !manifest.consistentSnapshot) problems.push("legacy v1 backup taken without an exported snapshot: not recovery-grade");
  } catch (error) {
    problems.push(brief(error));
  } finally {
    removeWorkDir(work);
  }
  return {
    ok: problems.length === 0,
    format: opened?.format ?? null,
    snapshotAt: opened?.manifest?.snapshotAt ?? null,
    consistency: opened?.status?.consistency ?? null,
    tables: opened ? Object.keys(opened.manifest.tables).length : 0,
    problems,
  };
}

export function verifyStorageBackup(dir, encryptionKey) {
  const problems = [];
  let checked = 0;
  let opened = null;
  try {
    opened = openStorageBackup(dir, encryptionKey);
    if (opened.manifest.status !== "complete" || opened.manifest.failures?.length) problems.push(`backup is ${opened.manifest.status} with ${opened.manifest.failures?.length || 0} failed object(s)`);
    opened.objects.forEach((object, index) => {
      try {
        readBlob(dir, object, encryptionKey);
        checked += 1;
      } catch (error) {
        problems.push(`object #${index} (${object.bucket}): ${/checksum|authenticate|Unsupported state/i.test(String(error?.message)) ? "content does not match (corrupted or wrong key)" : /ENOENT|no such file/i.test(String(error?.message)) ? "file missing" : "unreadable"}`);
      }
    });
  } catch (error) {
    problems.push(brief(error));
  }
  return { ok: problems.length === 0, format: opened?.format ?? null, objects: opened?.objects.length ?? 0, checked, problems: problems.slice(0, 50), problemCount: problems.length };
}

export async function verifyBackup(dir, encryptionKey = null) {
  const databaseDir = databaseBackupFormat(join(dir, "database")) ? join(dir, "database") : databaseBackupFormat(dir) ? dir : null;
  const storageDir = storageBackupFormat(join(dir, "storage")) ? join(dir, "storage") : storageBackupFormat(dir) ? dir : null;
  if (!databaseDir && !storageDir) throw new Error(`${dir} contains no database or Storage backup`);
  const result = {
    verifiedAt: new Date().toISOString(),
    database: databaseDir ? await verifyDatabaseBackup(databaseDir, encryptionKey) : null,
    storage: storageDir ? verifyStorageBackup(storageDir, encryptionKey) : null,
  };
  result.ok = (!result.database || result.database.ok) && (!result.storage || result.storage.ok);
  return result;
}

async function main() {
  const dir = argValue(process.argv.slice(2), "--backup");
  if (!dir || !existsSync(dir)) throw new Error("usage: verify-backup.mjs --backup <folder>");
  const result = await verifyBackup(dir, parseEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY));
  writeFileSync(join(dir, "verification.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}

if (isMain("scripts/backup/verify-backup.mjs")) {
  main().catch((error) => {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  });
}
