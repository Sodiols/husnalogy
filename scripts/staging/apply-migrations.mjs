#!/usr/bin/env node
/**
 * Apply the Husnalogy schema and every migration to the STAGING database, in
 * the documented order (HOSTINGER_DEPLOYMENT.md §3):
 *
 *   supabase/schema.sql → supabase/migrations/hero_collections.sql →
 *   supabase/migrations/<14-digit timestamp>_*.sql in filename order
 *
 * Each file runs as ONE transaction (a multi-statement query is atomic in
 * PostgreSQL; files with their own BEGIN/COMMIT are rolled back on error), so
 * a failure never leaves a half-applied file. Applied files are recorded with
 * their SHA-256 in husnalogy_ops.applied_migrations; a re-run skips them and
 * REFUSES if an applied file's contents changed (history must not be rewritten).
 *
 *   node scripts/staging/apply-migrations.mjs            apply pending files
 *   node scripts/staging/apply-migrations.mjs --plan     list what would run
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { loadStagingEnv } from "./staging-env.mjs";

export function migrationPlan(root = process.cwd()) {
  const dir = join(root, "supabase/migrations");
  const timestamped = readdirSync(dir).filter((file) => /^\d{14}_.+\.sql$/.test(file)).sort();
  return [
    { name: "schema.sql", path: join(root, "supabase/schema.sql") },
    { name: "hero_collections.sql", path: join(dir, "hero_collections.sql") },
    ...timestamped.map((file) => ({ name: file, path: join(dir, file) })),
  ].map((entry) => {
    const sql = readFileSync(entry.path, "utf8");
    return { ...entry, sql, sha256: createHash("sha256").update(sql).digest("hex") };
  });
}

/**
 * Apply every pending entry of `plan` through `client` (a connected pg
 * client). Returns { applied, skipped, failed? }. Never leaves a file half done.
 */
export async function applyMigrations(client, plan, log = (entry) => console.log(JSON.stringify(entry))) {
  await client.query("create schema if not exists husnalogy_ops; create table if not exists husnalogy_ops.applied_migrations (name text primary key, sha256 text not null, applied_at timestamptz not null default now()); revoke all on schema husnalogy_ops from public;");
  const applied = new Map((await client.query("select name, sha256 from husnalogy_ops.applied_migrations")).rows.map((row) => [row.name, row.sha256]));
  const result = { applied: [], skipped: [], failed: null };
  for (const entry of plan) {
    const previous = applied.get(entry.name);
    if (previous) {
      if (previous !== entry.sha256) {
        throw new Error(`REFUSED: ${entry.name} was already applied with different contents (${previous.slice(0, 12)} → ${entry.sha256.slice(0, 12)}). Write a new forward migration instead of editing an applied one.`);
      }
      result.skipped.push(entry.name);
      log({ migration: entry.name, status: "already-applied" });
      continue;
    }
    const started = Date.now();
    try {
      await client.query(entry.sql);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      result.failed = { migration: entry.name, error: String(error?.message || error), detail: error?.detail, position: error?.position, where: error?.where };
      log({ ...result.failed, status: "FAILED" });
      return result;
    }
    await client.query("insert into husnalogy_ops.applied_migrations(name, sha256) values ($1, $2)", [entry.name, entry.sha256]);
    result.applied.push(entry.name);
    log({ migration: entry.name, status: "applied", ms: Date.now() - started });
  }
  return result;
}

async function main() {
  const { env, ref } = loadStagingEnv();
  const plan = migrationPlan();
  if (process.argv.includes("--plan")) {
    for (const entry of plan) console.log(`${entry.sha256.slice(0, 12)}  ${entry.name}`);
    return;
  }
  const client = new pg.Client({ connectionString: env.STAGING_DATABASE_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 300_000 });
  await client.connect();
  try {
    console.log(JSON.stringify({ project: ref, files: plan.length }));
    const result = await applyMigrations(client, plan);
    if (result.failed) {
      console.error(`Stopped at ${result.failed.migration}. Nothing from this file was applied (one transaction). Fix it forward, or rebuild the disposable staging database.`);
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({ status: "complete", project: ref, applied: result.applied.length, skipped: result.skipped.length }));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && process.argv[1].split("\\").join("/").endsWith("scripts/staging/apply-migrations.mjs")) {
  main().catch((error) => {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  });
}
