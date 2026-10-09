#!/usr/bin/env node
/**
 * Restore a db-backup.mjs backup into an ISOLATED recovery database — never
 * production (lib/target.mjs refuses production refs, the .env.local project,
 * and any target not confirmed with RESTORE_CONFIRM_TARGET=<identity>).
 *
 *   node scripts/backup/db-restore.mjs --backup <folder> --target-env <file> [--mode data|full]
 *
 * The target env file gives RESTORE_DATABASE_URL (or STAGING_DATABASE_URL /
 * DATABASE_URL) and RESTORE_CONFIRM_TARGET.
 *
 * --mode data (default, the normal path):
 *   the target already has the schema from the versioned migrations
 *   (`npm run staging:migrate`-style: tables, RLS, grants, Storage buckets and
 *   policies). Its column inventory must match the backup's (schema drift is
 *   listed and refused). Then, in ONE transaction with triggers suspended
 *   (session_replication_role = replica, as Supabase's own restore guide
 *   does): the rows the migrations seeded are cleared, auth users/identities
 *   and every public table are loaded, sequences are reset.
 * --mode full (fallback when the migrations do not reproduce the source):
 *   the archive's own schema + data go into a target whose public schema has
 *   no tables. Storage buckets/policies then come from the migrations' storage
 *   statements (HUSNALOGY_DISASTER_RECOVERY.md).
 *
 * A target that already holds accounts, profiles or orders is refused unless
 * --replace-existing-data is given (it is replaced, inside the transaction).
 * Afterwards every table's row count is compared with the backup manifest.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { connection, runTool } from "./lib/pg-tools.mjs";
import { decryptFile, parseEncryptionKey, privateWorkDir, removeWorkDir, sha256File } from "./lib/crypto.mjs";
import { openDatabaseBackup } from "./lib/formats.mjs";
import { argValue, assertRestoreTarget, isMain, pickOne, readEnvFile } from "./lib/target.mjs";
import { countRows, schemaInventory } from "./db-backup.mjs";

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;
const qualified = (table) => table.split(".").map(quoteIdent).join(".");

/** The manifest of a database backup of any supported format (v2 needs the key). */
export function readDbManifest(backupDir, encryptionKey = null) {
  return openDatabaseBackup(backupDir, encryptionKey).manifest;
}

/** Verify every archive's checksum and return plaintext paths (decrypted into `workDir`). */
export async function openArchives(backupDir, manifest, encryptionKey, workDir) {
  const archives = {};
  for (const file of manifest.files) {
    const stored = join(backupDir, file.name);
    if (!existsSync(stored)) throw new Error(`backup file missing: ${file.name}`);
    if ((await sha256File(stored)) !== file.sha256) throw new Error(`checksum mismatch: ${file.name} was modified or corrupted`);
    let plain = stored;
    if (file.encrypted) {
      plain = join(workDir, file.archive);
      await decryptFile(stored, plain, encryptionKey);
    }
    if ((await sha256File(plain)) !== file.plainSha256) throw new Error(`checksum mismatch after decryption: ${file.archive}`);
    archives[file.archive] = plain;
  }
  return archives;
}

/** Columns the backup has that the target lacks, and the reverse. */
export function columnDrift(backupColumns, targetColumns) {
  const target = new Set(targetColumns);
  const backup = new Set(backupColumns);
  return { missingInTarget: backupColumns.filter((line) => !target.has(line)), extraInTarget: targetColumns.filter((line) => !backup.has(line)) };
}

export async function restoreDatabase({
  backupDir,
  databaseUrl,
  confirm,
  encryptionKey = null,
  mode = "data",
  replaceExistingData = false,
  allowSchemaDrift = false,
  root = process.cwd(),
  log = (entry) => console.log(JSON.stringify(entry)),
}) {
  const startedAt = Date.now();
  const targetId = assertRestoreTarget({ databaseUrl, confirm, root });
  if (!["data", "full"].includes(mode)) throw new Error(`unknown --mode ${mode}`);
  const manifest = readDbManifest(backupDir, encryptionKey);
  log({ operation: "db-restore", target: targetId, mode, backupSnapshotAt: manifest.snapshotAt, backupSource: manifest.source?.id });

  const conn = connection(databaseUrl);
  const client = new pg.Client(conn.pgConfig);
  await client.connect();
  const workDir = privateWorkDir("husnalogy-restore-");
  try {
    const publicTables = Object.keys(manifest.tables).filter((table) => table.startsWith("public."));
    const authTables = Object.keys(manifest.tables).filter((table) => table.startsWith("auth."));
    const existingPublic = new Set((await client.query("select 'public.' || tablename as t from pg_tables where schemaname = 'public'")).rows.map((row) => row.t));
    const occupied = async () => {
      let rows = 0;
      for (const table of ["auth.users", "public.profiles", "public.orders"]) {
        if ((await client.query("select to_regclass($1) as t", [table])).rows[0].t) rows += Number((await client.query(`select count(*) as n from ${qualified(table)}`)).rows[0].n);
      }
      return rows;
    };

    let drift = null;
    if (mode === "data") {
      const missingTables = publicTables.filter((table) => !existingPublic.has(table));
      if (missingTables.length) throw new Error(`REFUSED: the target lacks ${missingTables.length} table(s) (${missingTables.slice(0, 5).join(", ")}…). Apply the versioned migrations to it first, or use --mode full.`);
      drift = columnDrift(manifest.schema.columns, (await schemaInventory(client)).columns);
      if ((drift.missingInTarget.length || drift.extraInTarget.length) && !allowSchemaDrift) {
        throw new Error(`REFUSED: schema drift between the backup and the target.\n  missing in target: ${drift.missingInTarget.slice(0, 10).join(", ") || "none"}\n  extra in target: ${drift.extraInTarget.slice(0, 10).join(", ") || "none"}\nApply the migrations that match the backup, or use --mode full.`);
      }
    } else if (existingPublic.size) {
      throw new Error(`REFUSED: --mode full needs a target whose public schema has no tables (it has ${existingPublic.size}).`);
    }
    const before = await occupied();
    if (before > 0 && !replaceExistingData) {
      throw new Error(`REFUSED: the target already holds ${before} account/profile/order row(s). Restore into an empty recovery project, or pass --replace-existing-data to replace them.`);
    }

    const archives = await openArchives(backupDir, manifest, encryptionKey, workDir);
    const steps = [];
    // Everything below runs as ONE transaction with triggers and FK checks
    // suspended: rows come back exactly as they were (including those guard
    // triggers normally refuse to change, such as finalized orders). In full
    // mode the order is schema → accounts → data → constraints, so foreign
    // keys to auth.users are validated only once the accounts exist.
    const section = async (name, args) => {
      const file = join(workDir, `${name}.sql`);
      await runTool("pg_restore", ["--no-owner", ...args, "--file", file]);
      return file;
    };
    const sqlFiles = [];
    if (mode === "full") sqlFiles.push(await section("public-pre-data", ["--section=pre-data", "--schema=public", archives["public.dump"]]));
    if (archives["auth.dump"]) sqlFiles.push(await section("auth-data", ["--data-only", archives["auth.dump"]]));
    sqlFiles.push(await section("public-data", ["--data-only", "--schema=public", archives["public.dump"]]));
    if (mode === "full") sqlFiles.push(await section("public-post-data", ["--section=post-data", "--schema=public", archives["public.dump"]]));
    const clearing = [
      ...(mode === "data" && publicTables.length ? [`truncate table ${publicTables.map(qualified).join(", ")} restart identity cascade;`] : []),
      ...[...authTables].reverse().map((table) => `delete from ${qualified(table)};`),
    ].join("\n");
    await runTool("psql", [
      ...conn.args, "-X", "--quiet", "-v", "ON_ERROR_STOP=1", "--single-transaction",
      "-c", "set session_replication_role = replica",
      ...(clearing ? ["-c", clearing] : []),
      ...sqlFiles.flatMap((file) => ["-f", file]),
    ], { env: conn.env });
    steps.push(`${mode === "full" ? "schema, data and constraints" : "data"} restored from ${sqlFiles.length} section(s) in one transaction`);
    await client.query("analyze");

    const restored = await countRows(client, Object.keys(manifest.tables));
    const mismatches = Object.entries(manifest.tables).filter(([table, expected]) => restored[table] !== expected).map(([table, expected]) => ({ table, expected, restored: restored[table] }));
    const after = await schemaInventory(client);
    const report = {
      status: mismatches.length ? "FAILED" : "restored",
      target: targetId,
      mode,
      backupSnapshotAt: manifest.snapshotAt,
      durationMs: Date.now() - startedAt,
      tables: Object.keys(restored).length,
      rows: Object.values(restored).reduce((sum, value) => sum + value, 0),
      mismatches,
      schemaDrift: drift,
      policyFingerprintMatches: after.policyFingerprint === manifest.schema.policyFingerprint,
      steps,
    };
    log(report);
    if (mismatches.length) throw new Error(`restore verification FAILED: ${mismatches.length} table(s) differ from the backup manifest`);
    return report;
  } finally {
    await client.end().catch(() => undefined);
    removeWorkDir(workDir);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const backupDir = argValue(argv, "--backup");
  const targetEnv = argValue(argv, "--target-env");
  if (!backupDir || !targetEnv) throw new Error("usage: db-restore.mjs --backup <folder> --target-env <file> [--mode data|full] [--replace-existing-data] [--allow-schema-drift]");
  const env = readEnvFile(targetEnv);
  const databaseUrl = pickOne([process.env, env], ["RESTORE_DATABASE_URL", "STAGING_DATABASE_URL", "DATABASE_URL"], "restore database");
  if (!databaseUrl) throw new Error(`BLOCKED: ${targetEnv} has no RESTORE_DATABASE_URL.`);
  await restoreDatabase({
    backupDir,
    databaseUrl,
    confirm: pickOne([process.env, env], ["RESTORE_CONFIRM_TARGET"]),
    encryptionKey: parseEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY),
    mode: argValue(argv, "--mode") || "data",
    replaceExistingData: argv.includes("--replace-existing-data"),
    allowSchemaDrift: argv.includes("--allow-schema-drift"),
  });
}

if (isMain("scripts/backup/db-restore.mjs")) {
  main().catch((error) => {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  });
}
