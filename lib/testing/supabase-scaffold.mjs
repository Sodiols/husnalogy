/**
 * The minimum Supabase scaffolding the Husnalogy schema and migrations assume
 * (anon/authenticated/service_role roles, auth.uid()/role()/jwt(), auth.users,
 * storage.buckets/objects) and the migration file order. Plain ESM so test
 * harnesses (pglite-supabase.ts, postgres-server.ts) and ops scripts
 * (scripts/staging/probe-schema.mjs) share one definition.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

export const SUPABASE_SCAFFOLD = `
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create or replace function auth.uid() returns uuid language sql stable as
  $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
create or replace function auth.role() returns text language sql stable as
  $f$ select nullif(current_setting('request.jwt.claim.role', true), '') $f$;
create or replace function auth.jwt() returns jsonb language sql stable as
  $f$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $f$;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;
grant usage on schema auth, storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects, storage.buckets to anon, authenticated, service_role;
`;

export function migrationFiles(root = process.cwd()) {
  const dir = join(root, "supabase/migrations");
  return readdirSync(dir)
    .filter((file) => /^\d{14}_.+\.sql$/.test(file))
    .sort()
    .map((file) => join(dir, file));
}
