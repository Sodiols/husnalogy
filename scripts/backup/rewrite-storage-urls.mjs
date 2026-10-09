#!/usr/bin/env node
/**
 * After restoring into a NEW Supabase project: point stored absolute Storage
 * URLs (https://<old ref>.supabase.co/storage/v1/...) at the new project.
 * Catalogue rows (products.thumbnail / data, product images, mockups, hero
 * collections, site settings, cart and wishlist thumbnails…) store such URLs;
 * left alone they keep loading from the OLD project, which in a disaster may
 * be gone. Customer designs reference private files by bucket + path and need
 * no rewrite.
 *
 *   node scripts/backup/rewrite-storage-urls.mjs --target-env <file> --from <old project URL> [--apply] [--include-immutable]
 *
 * Dry run by default (counts per table.column). Writes only with --apply,
 * only to a guarded recovery target (lib/target.mjs), in one transaction.
 * Immutable history — orders, order items, published template versions — is
 * rewritten only with --include-immutable (triggers are suspended for that
 * transaction: the change is the host of a URL, not the record). Order design
 * snapshots and pinned production assets are NEVER rewritten: snapshots carry
 * an integrity hash and production files are addressed by bucket + path.
 */
import pg from "pg";
import { connection } from "./lib/pg-tools.mjs";
import { argValue, assertRestoreTarget, isMain, pickOne, readEnvFile } from "./lib/target.mjs";

export const NEVER_REWRITE = new Set(["order_design_snapshots", "order_production_assets", "customizer_audit_logs", "production_recovery_audit"]);
export const IMMUTABLE_HISTORY = new Set(["orders", "order_items", "customizer_template_versions", "order_requests"]);

const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;

export function storagePrefix(projectUrl) {
  return `${new URL(projectUrl).origin}/storage/v1/`;
}

export async function rewriteStorageUrls({ client, from, to, apply = false, includeImmutable = false }) {
  const oldPrefix = storagePrefix(from);
  const newPrefix = storagePrefix(to);
  if (oldPrefix === newPrefix) throw new Error("--from and the target are the same project; nothing to rewrite");
  const columns = (await client.query(
    `select table_name, column_name, data_type from information_schema.columns
      where table_schema = 'public' and data_type in ('text', 'jsonb', 'character varying')
      order by table_name, column_name`,
  )).rows.filter((column) => !NEVER_REWRITE.has(column.table_name) && (includeImmutable || !IMMUTABLE_HISTORY.has(column.table_name)));
  const plan = [];
  for (const column of columns) {
    const rows = Number((await client.query(`select count(*) as n from public.${quote(column.table_name)} where strpos(${quote(column.column_name)}::text, $1) > 0`, [oldPrefix])).rows[0].n);
    if (rows) plan.push({ table: column.table_name, column: column.column_name, type: column.data_type, rows });
  }
  const skipped = [];
  if (!includeImmutable) {
    for (const table of IMMUTABLE_HISTORY) {
      const cols = (await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 and data_type in ('text','jsonb','character varying')", [table])).rows;
      for (const { column_name } of cols) {
        const rows = Number((await client.query(`select count(*) as n from public.${quote(table)} where strpos(${quote(column_name)}::text, $1) > 0`, [oldPrefix])).rows[0].n);
        if (rows) skipped.push({ table, column: column_name, rows, reason: "immutable history (use --include-immutable)" });
      }
    }
  }
  if (apply && plan.length) {
    await client.query("begin");
    try {
      await client.query("set local session_replication_role = replica");
      for (const item of plan) {
        const cast = item.type === "jsonb" ? "::jsonb" : "";
        await client.query(`update public.${quote(item.table)} set ${quote(item.column)} = replace(${quote(item.column)}::text, $1, $2)${cast} where strpos(${quote(item.column)}::text, $1) > 0`, [oldPrefix, newPrefix]);
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
  return { applied: Boolean(apply), from: oldPrefix, to: newPrefix, columns: plan, rows: plan.reduce((sum, item) => sum + item.rows, 0), skipped };
}

async function main() {
  const argv = process.argv.slice(2);
  const targetEnv = argValue(argv, "--target-env");
  const from = argValue(argv, "--from");
  if (!targetEnv || !from) throw new Error("usage: rewrite-storage-urls.mjs --target-env <file> --from <old project URL> [--to <new project URL>] [--apply] [--include-immutable]");
  const env = readEnvFile(targetEnv);
  const databaseUrl = pickOne([process.env, env], ["RESTORE_DATABASE_URL", "STAGING_DATABASE_URL", "DATABASE_URL"], "restore database");
  const to = argValue(argv, "--to") || pickOne([process.env, env], ["RESTORE_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"], "restore Supabase URL");
  if (!databaseUrl || !to) throw new Error(`BLOCKED: ${targetEnv} needs RESTORE_DATABASE_URL and the new project's NEXT_PUBLIC_SUPABASE_URL.`);
  const target = assertRestoreTarget({ databaseUrl, supabaseUrl: to.includes("supabase.co") ? to : undefined, confirm: pickOne([process.env, env], ["RESTORE_CONFIRM_TARGET"]) });
  const client = new pg.Client(connection(databaseUrl).pgConfig);
  await client.connect();
  try {
    const result = await rewriteStorageUrls({ client, from, to, apply: argv.includes("--apply"), includeImmutable: argv.includes("--include-immutable") });
    console.log(JSON.stringify({ target, ...result }));
  } finally {
    await client.end();
  }
}

if (isMain("scripts/backup/rewrite-storage-urls.mjs")) {
  main().catch((error) => {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  });
}
