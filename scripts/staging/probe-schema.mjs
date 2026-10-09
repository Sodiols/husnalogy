#!/usr/bin/env node
/**
 * READ-ONLY schema drift probe for any Supabase project (production included):
 * are all repository migrations applied? Builds the EXPECTED schema locally
 * (PGlite + the Supabase scaffolding + schema.sql, hero_collections.sql and
 * every timestamped migration, in the documented order) and compares it with
 * what the project's PostgREST describes (OpenAPI with the service role) and
 * with its Storage bucket settings. It reads no rows and writes nothing.
 *
 *   node scripts/staging/probe-schema.mjs --env <file with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY>
 *
 * Exit code 2 when a table, column, RPC or bucket setting the code expects is
 * missing. It cannot see RLS policies, triggers or grants: those still need
 * the HOSTINGER_DEPLOYMENT.md §3 query in the SQL editor (or a database URL).
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_SCAFFOLD } from "../../lib/testing/supabase-scaffold.mjs";
import { migrationPlan } from "./apply-migrations.mjs";
import { parseEnvFile } from "./staging-env.mjs";
import { argValue, describeTarget, isMain, supabaseTargetId } from "../backup/lib/target.mjs";

export async function expectedSchema(root = process.cwd()) {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  try {
    await db.exec(SUPABASE_SCAFFOLD);
    for (const entry of migrationPlan(root)) await db.exec(readFileSync(entry.path, "utf8"));
    const tables = {};
    for (const row of (await db.query("select table_name, column_name from information_schema.columns where table_schema = 'public' order by 1, 2")).rows) {
      (tables[row.table_name] ||= []).push(row.column_name);
    }
    const rpcs = (await db.query(`select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prorettype <> 'trigger'::regtype and has_function_privilege('service_role', p.oid, 'execute')
        -- extension functions (pgcrypto…) live in Supabase's "extensions" schema, not public
        and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
      order by 1`)).rows.map((row) => row.proname);
    const buckets = (await db.query("select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id")).rows;
    return { tables, rpcs, buckets };
  } finally {
    await db.close();
  }
}

export async function actualSchema(url, serviceRoleKey) {
  const response = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/`, { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, Accept: "application/openapi+json" } });
  if (!response.ok) throw new Error(`PostgREST OpenAPI unavailable (${response.status})`);
  const spec = await response.json();
  const tables = {};
  for (const [name, definition] of Object.entries(spec.definitions || {})) tables[name] = Object.keys(definition.properties || {}).sort();
  const rpcs = Object.keys(spec.paths || {}).filter((path) => path.startsWith("/rpc/")).map((path) => path.slice(5)).sort();
  const { data, error } = await createClient(url, serviceRoleKey, { auth: { persistSession: false } }).storage.listBuckets();
  if (error) throw new Error(`listing buckets failed: ${error.message}`);
  const buckets = data.map((bucket) => ({ id: bucket.id, public: bucket.public, file_size_limit: bucket.file_size_limit ?? null, allowed_mime_types: bucket.allowed_mime_types ?? null }));
  return { tables, rpcs, buckets };
}

export function compareSchemas(expected, actual) {
  const missingTables = Object.keys(expected.tables).filter((table) => !actual.tables[table]);
  const missingColumns = [];
  for (const [table, columns] of Object.entries(expected.tables)) {
    if (!actual.tables[table]) continue;
    for (const column of columns) if (!actual.tables[table].includes(column)) missingColumns.push(`${table}.${column}`);
  }
  const extraTables = Object.keys(actual.tables).filter((table) => !expected.tables[table]);
  const missingRpcs = expected.rpcs.filter((rpc) => !actual.rpcs.includes(rpc));
  const bucketDiffs = [];
  for (const bucket of expected.buckets) {
    const live = actual.buckets.find((candidate) => candidate.id === bucket.id);
    if (!live) bucketDiffs.push(`${bucket.id}: missing`);
    else {
      if (Boolean(live.public) !== Boolean(bucket.public)) bucketDiffs.push(`${bucket.id}: public=${live.public}, expected ${bucket.public}`);
      if (Number(live.file_size_limit || 0) !== Number(bucket.file_size_limit || 0)) bucketDiffs.push(`${bucket.id}: size limit ${live.file_size_limit}, expected ${bucket.file_size_limit}`);
      const types = (list) => [...(list || [])].sort().join(",");
      if (types(live.allowed_mime_types) !== types(bucket.allowed_mime_types)) bucketDiffs.push(`${bucket.id}: allowed types [${types(live.allowed_mime_types)}], expected [${types(bucket.allowed_mime_types)}]`);
    }
  }
  return {
    ok: !missingTables.length && !missingColumns.length && !missingRpcs.length && !bucketDiffs.length,
    expected: { tables: Object.keys(expected.tables).length, rpcs: expected.rpcs.length, buckets: expected.buckets.length },
    missingTables,
    missingColumns,
    missingRpcs,
    bucketDiffs,
    extraTables,
  };
}

async function main() {
  const file = argValue(process.argv.slice(2), "--env");
  if (!file) throw new Error("usage: probe-schema.mjs --env <file>");
  const env = parseEnvFile(file);
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(`${file} needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY`);
  const target = describeTarget(supabaseTargetId(url));
  console.log(JSON.stringify({ operation: "schema-probe", target: target.id, kind: target.kind, readOnly: true }));
  const result = compareSchemas(await expectedSchema(), await actualSchema(url, key));
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 2;
}

if (isMain("scripts/staging/probe-schema.mjs")) {
  main().catch((error) => {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  });
}
