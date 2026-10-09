/**
 * Logical DATABASE backup (read-only on the source), format v2. Called by
 * run-backup.mjs after the source identity is proven (lib/source.mjs); there
 * is no standalone entry point that could skip that proof.
 *
 * Consistency guarantee (recovery-grade):
 *   - ONE repeatable-read transaction exports a snapshot (pg_export_snapshot);
 *     the row count of every table is read inside it, and BOTH pg_dump runs
 *     (application schemas; auth.users/identities data) use that snapshot.
 *     If the snapshot cannot be exported (e.g. a transaction-mode pooler),
 *     the backup FAILS as "consistency-unavailable" — two dumps taken at
 *     different moments would not be one point in time.
 *   - Each archive is then read back (pg_restore) and its rows are counted;
 *     every table must contain exactly the snapshot's row count, or the backup
 *     FAILS as "incomplete".
 *
 * Confidentiality: plaintext archives exist only in a private scratch folder
 * (lib/crypto.mjs privateWorkDir) and are removed; the backup folder receives
 *   public.dump.enc, auth.dump.enc   AES-256-GCM archives
 *   manifest.enc                     encrypted: row counts, schema/policy
 *                                    inventory, file checksums, source
 *   status.json                      plaintext, operational only: format,
 *                                    status, times, encrypted sizes/hashes
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync, existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { connection, pgBin, runTool, toolMajorVersion } from "./lib/pg-tools.mjs";
import { encryptFile, privateWorkDir, removeWorkDir, sha256, sha256File, writeEncryptedJson } from "./lib/crypto.mjs";

export const DB_BACKUP_FORMAT = "husnalogy-db-backup/2";
export const DB_BACKUP_FORMAT_V1 = "husnalogy-db-backup/1";
const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

export class BackupStageError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "BackupStageError";
    this.status = status; // "consistency-unavailable" | "incomplete" | "failed"
  }
}

/** Column and policy inventories of the public schema (drift detection on restore). */
export async function schemaInventory(client) {
  const columns = (await client.query(
    `select table_name || '.' || column_name || ':' || data_type || ':' || is_nullable as line
       from information_schema.columns where table_schema = 'public' order by table_name, column_name`,
  )).rows.map((row) => row.line);
  const policies = (await client.query(
    `select tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') as line
       from pg_policies where schemaname in ('public', 'storage') order by schemaname, tablename, policyname`,
  )).rows.map((row) => row.line);
  return { columns, policies, columnFingerprint: sha256(columns.join("\n")), policyFingerprint: sha256(policies.join("\n")) };
}

export async function listBackupTables(client) {
  const publicTables = (await client.query("select tablename from pg_tables where schemaname = 'public' order by tablename")).rows.map((row) => `public.${row.tablename}`);
  const authTables = [];
  for (const name of ["auth.users", "auth.identities"]) {
    if ((await client.query("select to_regclass($1) as t", [name])).rows[0].t) authTables.push(name);
  }
  const ops = Boolean((await client.query("select 1 from pg_namespace where nspname = 'husnalogy_ops'")).rows.length);
  return { publicTables, authTables, ops };
}

export async function countRows(client, tables) {
  const counts = {};
  for (const table of tables) {
    const [schema, name] = table.split(".");
    counts[table] = Number((await client.query(`select count(*)::bigint as n from ${quoteIdent(schema)}.${quoteIdent(name)}`)).rows[0].n);
  }
  return counts;
}

/** Every counted table must appear as a TABLE DATA entry of its archive. */
export async function archiveTableEntries(file) {
  const { stdout } = await runTool("pg_restore", ["--list", file]);
  const entries = new Set();
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/TABLE DATA (\S+) (\S+) /);
    if (match) entries.add(`${match[1]}.${match[2]}`);
  }
  return entries;
}

const IDENT = String.raw`(?:"(?:[^"]|"")*"|[^\s."]+)`;
const COPY_LINE = new RegExp(String.raw`^COPY (${IDENT})\.(${IDENT})[ (].*FROM stdin;$`);
const unquote = (part) => (part.startsWith('"') ? part.slice(1, -1).replace(/""/g, '"') : part);

/** "schema.table" of a pg_restore COPY line, else null. */
export function copyTarget(line) {
  const match = COPY_LINE.exec(line);
  return match ? `${unquote(match[1])}.${unquote(match[2])}` : null;
}

/**
 * Rows actually stored in an archive, per table: streams `pg_restore
 * --data-only` and counts the lines of every COPY block (COPY escapes
 * newlines inside values, so one line is one row).
 */
export function archiveRowCounts(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(pgBin("pg_restore"), ["--data-only", "--file", "-", file], { windowsHide: true });
    const counts = {};
    let current = null;
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      if (current) {
        if (line === "\\.") current = null;
        else counts[current] += 1;
        return;
      }
      const table = copyTarget(line);
      if (table) {
        current = table;
        counts[current] = 0;
      }
    });
    child.on("close", (code) => {
      if (code === 0) resolve(counts);
      else reject(new Error(`pg_restore could not read the archive back (exit ${code}): ${stderr.trim().split("\n").slice(-3).join(" ")}`));
    });
  });
}

export async function backupDatabase({ databaseUrl, outDir, encryptionKey, source, log = (entry) => console.log(JSON.stringify(entry)) }) {
  if (!encryptionKey) throw new BackupStageError("failed", "BACKUP_ENCRYPTION_KEY is required: backups are always encrypted.");
  const startedAt = new Date();
  if (existsSync(outDir) && readdirSync(outDir).length) throw new BackupStageError("failed", `REFUSED: ${outDir} is not empty. Use a new folder per backup.`);
  mkdirSync(outDir, { recursive: true });
  log({ operation: "db-backup", source: source.ref, environment: source.environment, readOnly: true });

  const conn = connection(databaseUrl);
  const client = new pg.Client({ ...conn.pgConfig, application_name: "husnalogy-backup" });
  // A connection killed mid-backup surfaces as the failing query's error;
  // the client's own 'error' event must not crash the process.
  client.on("error", () => undefined);
  await client.connect();
  const work = privateWorkDir("husnalogy-db-backup-");
  const files = [];
  try {
    const serverVersionNum = Number((await client.query("show server_version_num")).rows[0].server_version_num);
    const serverVersion = (await client.query("show server_version")).rows[0].server_version;
    const dumpTool = await toolMajorVersion("pg_dump");
    if (dumpTool.major < Math.floor(serverVersionNum / 10000)) {
      throw new BackupStageError("failed", `pg_dump ${dumpTool.major} is older than the server (${serverVersion}). Use client tools >= the server major version (HUSNALOGY_PG_BIN).`);
    }

    await client.query("begin isolation level repeatable read read only");
    let snapshot;
    try {
      snapshot = (await client.query("select pg_export_snapshot() as id")).rows[0].id;
    } catch (error) {
      throw new BackupStageError("consistency-unavailable", `CONSISTENCY UNAVAILABLE: the database snapshot could not be exported (${error.message}). Use the direct connection or the SESSION pooler (port 5432), not the transaction pooler. Nothing was recorded as a backup.`);
    }
    const snapshotAt = new Date((await client.query("select now() as t")).rows[0].t).toISOString();
    const { publicTables, authTables, ops } = await listBackupTables(client);
    const tables = await countRows(client, [...publicTables, ...authTables]);
    const inventory = await schemaInventory(client);
    const appliedMigrations = ops
      ? (await client.query("select name, sha256 from husnalogy_ops.applied_migrations order by name").catch(() => ({ rows: [] }))).rows
      : null;

    const archives = [
      { name: "public.dump", args: ["--format=custom", "--compress=6", "--schema=public", ...(ops ? ["--schema=husnalogy_ops"] : [])], tables: publicTables },
      ...(authTables.length ? [{ name: "auth.dump", args: ["--format=custom", "--compress=6", "--data-only", ...authTables.flatMap((table) => ["--table", table])], tables: authTables }] : []),
    ];
    for (const archive of archives) {
      const plainPath = join(work, archive.name);
      const dumpStarted = Date.now();
      try {
        await runTool("pg_dump", [...conn.args, ...archive.args, "--snapshot", snapshot, "--file", plainPath], { env: conn.env });
      } catch (error) {
        throw new BackupStageError("failed", `pg_dump failed for ${archive.name}: ${error.message}`);
      }
      const entries = await archiveTableEntries(plainPath);
      const missing = archive.tables.filter((table) => !entries.has(table));
      if (missing.length) throw new BackupStageError("incomplete", `${archive.name} lacks table data for ${missing.length} table(s)`);
      const stored = await archiveRowCounts(plainPath);
      const wrong = archive.tables.filter((table) => (stored[table] ?? 0) !== tables[table]);
      if (wrong.length) throw new BackupStageError("incomplete", `${archive.name} does not match the snapshot's row counts for ${wrong.length} table(s) (${wrong.slice(0, 3).join(", ")})`);
      const plainSha256 = await sha256File(plainPath);
      const finalName = `${archive.name}.enc`;
      await encryptFile(plainPath, join(outDir, finalName), encryptionKey);
      removeWorkDir(plainPath);
      const { size } = statSync(join(outDir, finalName));
      files.push({ name: finalName, archive: archive.name, bytes: size, sha256: await sha256File(join(outDir, finalName)), plainSha256, encrypted: true, tables: archive.tables.length, ms: Date.now() - dumpStarted });
    }
    await client.query("commit");

    const manifest = {
      format: DB_BACKUP_FORMAT,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      snapshotAt,
      consistency: "exported-snapshot+archive-row-counts-verified",
      consistentSnapshot: true,
      source: { id: source.ref, environment: source.environment },
      server: { version: serverVersion },
      tools: { pg_dump: dumpTool.text },
      tables,
      totals: { tables: Object.keys(tables).length, rows: Object.values(tables).reduce((sum, value) => sum + value, 0) },
      schema: inventory,
      appliedMigrations,
      files,
    };
    writeEncryptedJson(join(outDir, "manifest.enc"), manifest, encryptionKey);
    const status = {
      format: DB_BACKUP_FORMAT,
      status: "recovery-grade",
      finishedAt: manifest.finishedAt,
      snapshotAt,
      consistency: manifest.consistency,
      manifestSha256: await sha256File(join(outDir, "manifest.enc")),
      files: files.map((file) => ({ name: file.name, bytes: file.bytes, sha256: file.sha256 })),
    };
    writeFileSync(join(outDir, "status.json"), JSON.stringify(status, null, 2));
    log({ status: "recovery-grade", source: source.ref, snapshotAt, tables: manifest.totals.tables, encryptedBytes: files.reduce((sum, file) => sum + file.bytes, 0), ms: manifest.durationMs });
    return manifest;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error instanceof BackupStageError ? error : new BackupStageError("failed", String(error?.message || error));
  } finally {
    removeWorkDir(work);
    await client.end().catch(() => undefined);
  }
}
