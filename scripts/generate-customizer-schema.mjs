import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const schemaPath = path.join(root, "supabase", "schema.sql");
const migrationNames = [
  "20260714120000_customizer_v2.sql",
  "20260714153000_customizer_v2_completion.sql",
  "20260714210000_customizer_v2_production_hardening.sql",
  "20260718120000_customizer_v2_customer_parity.sql",
  "20260719120000_customizer_v2_schema_consolidation.sql",
  "20260719180000_permanent_admin_asset_library.sql",
  "20260726120000_customizer_public_versioning.sql",
  "20260804120000_customizer_order_integrity.sql",
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8").replace(/^\uFEFF/, "").trim();
}

const fullSchema = fs.readFileSync(schemaPath, "utf8");
const coreStart = fullSchema.indexOf("-- Product customizer (Zazzle-style personalization)");
const coreEnd = fullSchema.indexOf("-- Homepage hero collection", coreStart);
if (coreStart < 0 || coreEnd < 0) throw new Error("Could not locate the core product customizer schema block.");
const coreCustomizer = fullSchema.slice(coreStart, coreEnd).trim();

const preamble = `/* ============================================================
   HUSNALOGY CUSTOMIZER V2 DATABASE
   ============================================================

   Application/document version: Husnalogy Customizer V2, schema v4,
   engine husnalogy-2.2.0.
   Generated: 2026-07-26.
   Latest included migration: 20260726120000_customizer_public_versioning.sql.

   SAFE USE
   - Fresh Supabase project: YES, after the Husnalogy core ecommerce schema.
   - Existing staging/production database: NO. Apply only the timestamped
     migrations that are missing after completing CUSTOMIZER_DATABASE.md.
   - This file intentionally contains no DROP TABLE, DROP SCHEMA, TRUNCATE, or
     unrestricted DELETE statement.

   AUTHORITATIVE TABLES
   - product_customizer_templates is the mutable customizer template/draft.
   - customizer_template_versions stores immutable published versions.
   - customizer_mockup_templates stores draft/published mockup versions through
     its status and version columns.
   The alternative names customizer_templates, customizer_template_drafts, and
   customizer_mockup_versions are not created because they would duplicate the
   existing production responsibilities.

   SECTION MAP
   01 Extensions and prerequisites
   02 Enum strategy (checked text values; no custom enums currently required)
   03 Core templates and mutable drafts
   04 Template versions
   05 Customer customizations
   06 Customer assets
   07 Elements and asset library
   08 Mockup system
   09 Render jobs and outputs
   10 Preflight
   11 Order design snapshots
   12 Feature flags
   13 Audit logs
   14 Functions and triggers
   15 Indexes and constraints
   16 Row Level Security and grants
   17 Storage buckets and policies
   18 Verification queries
*/

begin;

/* 01. EXTENSIONS AND PREREQUISITES ============================ */
create extension if not exists pgcrypto;

do $$
declare
  required_relation text;
begin
  foreach required_relation in array array[
    'public.products',
    'public.profiles',
    'public.cart_items',
    'public.orders',
    'public.customer_uploads'
  ] loop
    if to_regclass(required_relation) is null then
      raise exception 'Customizer prerequisite is missing: %', required_relation;
    end if;
  end loop;
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'Customizer prerequisite is missing: public.is_admin()';
  end if;
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'Customizer prerequisite is missing: public.set_updated_at()';
  end if;
end $$;

/* 02. ENUM TYPES ===============================================
   The deployed schema uses CHECK-constrained text for rolling-deploy
   compatibility. No PostgreSQL enum is required by the current application.
*/`;

const storage = `/* 17. STORAGE BUCKETS AND POLICIES ============================ */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('product-mockups', 'product-mockups', true, 15728640, array['image/jpeg','image/png','image/webp','image/gif','image/avif']),
  ('customer-uploads', 'customer-uploads', false, 26214400, array['image/jpeg','image/png','image/webp','image/gif','application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'customizer_product_mockups_public_read') then
    create policy "customizer_product_mockups_public_read" on storage.objects
      for select using (bucket_id = 'product-mockups');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'customizer_product_mockups_admin_write') then
    create policy "customizer_product_mockups_admin_write" on storage.objects
      for all using (bucket_id = 'product-mockups' and public.is_admin())
      with check (bucket_id = 'product-mockups' and public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'customizer_customer_uploads_owner_read') then
    create policy "customizer_customer_uploads_owner_read" on storage.objects
      for select using (bucket_id = 'customer-uploads' and (split_part(name, '/', 1) = auth.uid()::text or public.is_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'customizer_customer_uploads_owner_insert') then
    create policy "customizer_customer_uploads_owner_insert" on storage.objects
      for insert with check (bucket_id = 'customer-uploads' and split_part(name, '/', 1) = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'customizer_customer_uploads_owner_update') then
    create policy "customizer_customer_uploads_owner_update" on storage.objects
      for update using (bucket_id = 'customer-uploads' and (split_part(name, '/', 1) = auth.uid()::text or public.is_admin()))
      with check (bucket_id = 'customer-uploads' and (split_part(name, '/', 1) = auth.uid()::text or public.is_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'customizer_customer_uploads_owner_delete') then
    create policy "customizer_customer_uploads_owner_delete" on storage.objects
      for delete using (bucket_id = 'customer-uploads' and (split_part(name, '/', 1) = auth.uid()::text or public.is_admin()));
  end if;
end $$;

-- customizer-elements and customizer-renders are private. Administrator asset
-- writes are policy-gated; protected APIs issue fresh signed URLs from saved
-- bucket/path metadata.`;

const verification = `/* 18. VERIFICATION QUERIES ===================================== */
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and (tablename like 'customizer_%' or tablename in ('product_customizer_templates','product_customizations','customer_asset_library','order_design_snapshots'))
order by tablename;

select schemaname, tablename, policyname, roles, cmd
from pg_policies
where (schemaname = 'public' and (tablename like 'customizer_%' or tablename in ('product_customizer_templates','product_customizations','customer_asset_library','order_design_snapshots')))
   or (schemaname = 'storage' and policyname like 'customizer_%')
order by schemaname, tablename, policyname;

commit;

-- Run scripts/validate_customizer_database.sql after installation for strict
-- column/index/RLS/policy/orphan validation.`;

const migrationBlocks = migrationNames.map((name, index) => {
  const labels = [
    "04-11. TEMPLATE VERSIONS, ASSETS, RENDERING, PREFLIGHT, SNAPSHOTS AND MOCKUPS",
    "08, 09, 12. MOCKUP SCENES, RENDER METADATA AND FEATURE FLAGS",
    "08, 09, 12, 14. PRODUCTION HARDENING FUNCTIONS AND CONSTRAINTS",
    "05, 12, 13. CUSTOMER PARITY STATE, FLAGS AND AUDIT LOGS",
    "14-16. UPDATED TIMESTAMPS, INDEXES, COMMENTS AND GRANTS",
    "07, 14-17. PERMANENT ADMIN ASSET LIBRARY, RLS AND PRIVATE STORAGE",
  ];
  return `/* ${labels[index]}\n+   Source migration: ${name}
   ============================================================ */\n${read(`supabase/migrations/${name}`)}`;
});

const output = [
  preamble,
  "/* 03 AND 05. CORE TEMPLATES, DRAFTS AND CUSTOMIZATIONS ===== */",
  coreCustomizer,
  ...migrationBlocks,
  storage,
  verification,
].join("\n\n");

fs.writeFileSync(path.join(root, "supabase", "customizer_v2.sql"), `${output}\n`);
console.log(`Generated supabase/customizer_v2.sql from ${migrationNames.length} additive migrations.`);
