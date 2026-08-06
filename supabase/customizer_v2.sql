/* ============================================================
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
*/

/* 03 AND 05. CORE TEMPLATES, DRAFTS AND CUSTOMIZATIONS ===== */

-- Product customizer (Zazzle-style personalization)
-- Additive only. Does not modify or drop any existing table.
-- ============================================================================

create table if not exists public.product_customizer_templates (
  id uuid primary key default gen_random_uuid(),
  product_id text not null unique references public.products(id) on delete cascade,
  enabled boolean not null default false,
  version integer not null default 1,
  engine text not null default 'svg',
  canvas_width_px integer not null default 1500,
  canvas_height_px integer not null default 2100,
  card_width_in numeric(6,2) default 5,
  card_height_in numeric(6,2) default 7,
  dpi integer not null default 300,
  orientation text not null default 'portrait',
  default_page text not null default 'front',
  pages jsonb not null default '[]'::jsonb,
  fields jsonb not null default '[]'::jsonb,
  layers jsonb not null default '[]'::jsonb,
  safe_area jsonb not null default '{}'::jsonb,
  bleed jsonb not null default '{}'::jsonb,
  assets jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.product_customizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  product_id text references public.products(id) on delete set null,
  template_id uuid references public.product_customizer_templates(id) on delete set null,
  cart_item_id uuid references public.cart_items(id) on delete set null,
  order_id text references public.orders(id) on delete set null,
  template_version integer not null default 1,
  status text not null default 'draft' check (status in ('draft', 'in_cart', 'ordered', 'archived')),
  values jsonb not null default '{}'::jsonb,
  uploaded_files jsonb not null default '{}'::jsonb,
  selected_options jsonb not null default '{}'::jsonb,
  preview_images jsonb not null default '{}'::jsonb,
  render_data jsonb not null default '{}'::jsonb,
  print_files jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.product_customizer_templates enable row level security;
alter table public.product_customizations enable row level security;

-- Admins manage every template; customers may read enabled templates for
-- products that are active and not hidden.
drop policy if exists "customizer_templates_public_read_active" on public.product_customizer_templates;
create policy "customizer_templates_public_read_active" on public.product_customizer_templates
for select using (
  public.is_admin() or (
    enabled and exists (
      select 1 from public.products p
      where p.id = product_id and p.status = 'active' and p.visibility <> 'hidden'
    )
  )
);

drop policy if exists "customizer_templates_admin_manage" on public.product_customizer_templates;
create policy "customizer_templates_admin_manage" on public.product_customizer_templates
for all using (public.is_admin()) with check (public.is_admin());

-- Customers manage only their own customizations; admins read/manage all.
drop policy if exists "product_customizations_owner_manage" on public.product_customizations;
create policy "product_customizations_owner_manage" on public.product_customizations
for all using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "product_customizations_admin_manage" on public.product_customizations;
create policy "product_customizations_admin_manage" on public.product_customizations
for all using (public.is_admin()) with check (public.is_admin());

drop trigger if exists set_product_customizer_templates_updated_at on public.product_customizer_templates;
create trigger set_product_customizer_templates_updated_at
before update on public.product_customizer_templates
for each row execute function public.set_updated_at();

drop trigger if exists set_product_customizations_updated_at on public.product_customizations;
create trigger set_product_customizations_updated_at
before update on public.product_customizations
for each row execute function public.set_updated_at();

create index if not exists idx_customizer_templates_product_id on public.product_customizer_templates(product_id);
create index if not exists idx_product_customizations_user_id on public.product_customizations(user_id);
create index if not exists idx_product_customizations_product_id on public.product_customizations(product_id);
create index if not exists idx_product_customizations_order_id on public.product_customizations(order_id);
create index if not exists idx_product_customizations_status on public.product_customizations(status);

grant all on public.product_customizer_templates to service_role;
grant all on public.product_customizations to service_role;
grant select on public.product_customizer_templates to anon;
grant select, insert, update, delete on public.product_customizer_templates to authenticated;
grant select, insert, update, delete on public.product_customizations to authenticated;

-- ============================================================================

/* 04-11. TEMPLATE VERSIONS, ASSETS, RENDERING, PREFLIGHT, SNAPSHOTS AND MOCKUPS
+   Source migration: 20260714120000_customizer_v2.sql
   ============================================================ */
-- ============================================================================
-- Husnalogy Customizer V2 (spec §19–§25)
-- Additive only. Does not modify or drop any existing table.
--
-- Adds: immutable template versions, elements library (assets + categories),
-- customer asset library, render jobs + outputs, preflight results, permanent
-- order design snapshots, mockup templates, and admin canvas guides.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Template versioning: publishing creates an immutable snapshot row. Existing
-- saved designs, cart items, and orders keep pointing at their version.
-- ---------------------------------------------------------------------------

create table if not exists public.customizer_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.product_customizer_templates(id) on delete cascade,
  product_id text references public.products(id) on delete set null,
  version integer not null,
  schema_version integer not null default 2,
  engine_version text not null default 'husnalogy-2.0.0',
  -- Complete immutable CustomizerDocument snapshot: canvas, pages, fields,
  -- layers, assets, permissions, settings, option mappings, font dependencies.
  document jsonb not null default '{}'::jsonb,
  font_dependencies jsonb not null default '[]'::jsonb,
  published_by uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamp with time zone not null default now(),
  unique (template_id, version)
);

-- ---------------------------------------------------------------------------
-- Elements library (admin-curated decorative assets) + categories.
-- ---------------------------------------------------------------------------

create table if not exists public.customizer_asset_categories (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  slug text unique not null,
  description text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.customizer_assets (
  id uuid primary key default gen_random_uuid(),
  category_id text references public.customizer_asset_categories(id) on delete set null,
  title text not null,
  tags text[] not null default '{}',
  keywords text,
  bucket text not null default 'customizer-elements',
  path text not null,
  public_url text,
  mime_type text not null,
  file_size_bytes bigint not null default 0,
  width integer not null default 0,
  height integer not null default 0,
  -- Single-colour SVG/PNG elements customers may recolour.
  tintable boolean not null default false,
  default_color text,
  customer_available boolean not null default true,
  active boolean not null default true,
  archived boolean not null default false,
  checksum text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

-- ---------------------------------------------------------------------------
-- Customer asset library: reusable uploads across products (spec §15).
-- (customer_uploads remains for audit compatibility; this is the library.)
-- ---------------------------------------------------------------------------

create table if not exists public.customer_asset_library (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  bucket text not null default 'customer-uploads',
  path text not null,
  thumbnail_path text,
  editor_path text,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  width integer not null default 0,
  height integer not null default 0,
  checksum text,
  status text not null default 'ready' check (status in ('processing', 'ready', 'failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (user_id, path)
);

-- ---------------------------------------------------------------------------
-- Render jobs + outputs (spec §23). Jobs are idempotent via input_hash.
-- ---------------------------------------------------------------------------

create table if not exists public.customizer_render_jobs (
  id uuid primary key default gen_random_uuid(),
  customization_id uuid references public.product_customizations(id) on delete cascade,
  order_id text references public.orders(id) on delete set null,
  template_version_id uuid references public.customizer_template_versions(id) on delete set null,
  job_type text not null check (job_type in ('preview', 'thumbnail', 'print_png', 'print_pdf')),
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  attempt_count integer not null default 0,
  priority integer not null default 0,
  input_hash text not null,
  input_snapshot jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.customizer_render_outputs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.customizer_render_jobs(id) on delete cascade,
  customization_id uuid references public.product_customizations(id) on delete cascade,
  page_id text not null,
  format text not null check (format in ('png', 'pdf', 'svg')),
  bucket text not null default 'customizer-renders',
  path text not null,
  width_px integer not null default 0,
  height_px integer not null default 0,
  dpi integer not null default 0,
  file_size_bytes bigint not null default 0,
  checksum text,
  watermarked boolean not null default false,
  created_at timestamp with time zone not null default now()
);

-- ---------------------------------------------------------------------------
-- Preflight results (spec §24).
-- ---------------------------------------------------------------------------

create table if not exists public.customizer_preflight_results (
  id uuid primary key default gen_random_uuid(),
  customization_id uuid references public.product_customizations(id) on delete cascade,
  order_id text references public.orders(id) on delete set null,
  context text not null default 'save' check (context in ('save', 'cart', 'checkout', 'order', 'render', 'admin')),
  ok boolean not null default true,
  blocking boolean not null default false,
  issues jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone not null default now()
);

-- ---------------------------------------------------------------------------
-- Permanent order design snapshots (spec §22). Immutable after creation:
-- editing the product or template never changes an order's snapshot.
-- ---------------------------------------------------------------------------

create table if not exists public.order_design_snapshots (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete set null,
  customization_id uuid references public.product_customizations(id) on delete set null,
  product_id text,
  product_title text,
  product_sku text,
  quantity integer not null default 1,
  selected_options jsonb not null default '{}'::jsonb,
  pricing jsonb not null default '{}'::jsonb,
  template_id uuid,
  template_version integer not null default 1,
  template_version_id uuid references public.customizer_template_versions(id) on delete set null,
  -- Complete resolved snapshot: template document, customer values, editor
  -- state, resolved layers, asset references, fonts, canvas/dpi/bleed/safe.
  snapshot jsonb not null default '{}'::jsonb,
  preflight jsonb not null default '{}'::jsonb,
  preview_files jsonb not null default '{}'::jsonb,
  print_files jsonb not null default '{}'::jsonb,
  render_status text not null default 'pending' check (render_status in ('pending', 'queued', 'processing', 'completed', 'failed', 'archived')),
  integrity_hash text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

-- ---------------------------------------------------------------------------
-- Product mockup templates (spec §25).
-- ---------------------------------------------------------------------------

create table if not exists public.customizer_mockup_templates (
  id uuid primary key default gen_random_uuid(),
  product_id text references public.products(id) on delete cascade,
  name text not null,
  view text not null default 'front',
  -- Placement config: base image, artwork area, mask, perspective, overlays.
  config jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

-- ---------------------------------------------------------------------------
-- Admin canvas guides (spec §8).
-- ---------------------------------------------------------------------------

create table if not exists public.customizer_guides (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.product_customizer_templates(id) on delete cascade,
  page_id text not null,
  orientation text not null check (orientation in ('vertical', 'horizontal')),
  position numeric not null,
  created_at timestamp with time zone not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.customizer_template_versions enable row level security;
alter table public.customizer_asset_categories enable row level security;
alter table public.customizer_assets enable row level security;
alter table public.customer_asset_library enable row level security;
alter table public.customizer_render_jobs enable row level security;
alter table public.customizer_render_outputs enable row level security;
alter table public.customizer_preflight_results enable row level security;
alter table public.order_design_snapshots enable row level security;
alter table public.customizer_mockup_templates enable row level security;
alter table public.customizer_guides enable row level security;

-- Template versions: admins manage; customers read versions of enabled
-- templates on active products (needed to reopen saved designs).
drop policy if exists "customizer_template_versions_read" on public.customizer_template_versions;
create policy "customizer_template_versions_read" on public.customizer_template_versions
for select using (
  public.is_admin() or exists (
    select 1
    from public.product_customizer_templates t
    join public.products p on p.id = t.product_id
    where t.id = template_id and t.enabled and p.status = 'active' and p.visibility <> 'hidden'
  )
);

drop policy if exists "customizer_template_versions_admin_manage" on public.customizer_template_versions;
create policy "customizer_template_versions_admin_manage" on public.customizer_template_versions
for all using (public.is_admin()) with check (public.is_admin());

-- Asset categories: everyone reads active; admins manage.
drop policy if exists "customizer_asset_categories_read" on public.customizer_asset_categories;
create policy "customizer_asset_categories_read" on public.customizer_asset_categories
for select using (active or public.is_admin());

drop policy if exists "customizer_asset_categories_admin_manage" on public.customizer_asset_categories;
create policy "customizer_asset_categories_admin_manage" on public.customizer_asset_categories
for all using (public.is_admin()) with check (public.is_admin());

-- Elements: customers read active + customer-available; admins manage.
-- No broad authenticated write access (spec §20).
drop policy if exists "customizer_assets_read" on public.customizer_assets;
create policy "customizer_assets_read" on public.customizer_assets
for select using ((active and not archived and customer_available) or public.is_admin());

drop policy if exists "customizer_assets_admin_manage" on public.customizer_assets;
create policy "customizer_assets_admin_manage" on public.customizer_assets
for all using (public.is_admin()) with check (public.is_admin());

-- Customer library: owner only (+ admins).
drop policy if exists "customer_asset_library_owner" on public.customer_asset_library;
create policy "customer_asset_library_owner" on public.customer_asset_library
for all using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

-- Render jobs/outputs: owners may read jobs for their own customizations;
-- writes happen only through the service role (protected render endpoints).
drop policy if exists "customizer_render_jobs_owner_read" on public.customizer_render_jobs;
create policy "customizer_render_jobs_owner_read" on public.customizer_render_jobs
for select using (
  public.is_admin() or exists (
    select 1 from public.product_customizations c
    where c.id = customization_id and c.user_id = auth.uid()
  )
);

drop policy if exists "customizer_render_outputs_owner_read" on public.customizer_render_outputs;
create policy "customizer_render_outputs_owner_read" on public.customizer_render_outputs
for select using (
  public.is_admin() or exists (
    select 1 from public.product_customizations c
    where c.id = customization_id and c.user_id = auth.uid()
  )
);

drop policy if exists "customizer_preflight_results_owner_read" on public.customizer_preflight_results;
create policy "customizer_preflight_results_owner_read" on public.customizer_preflight_results
for select using (
  public.is_admin() or exists (
    select 1 from public.product_customizations c
    where c.id = customization_id and c.user_id = auth.uid()
  )
);

-- Order snapshots: production data — admins only (service role writes).
drop policy if exists "order_design_snapshots_admin" on public.order_design_snapshots;
create policy "order_design_snapshots_admin" on public.order_design_snapshots
for all using (public.is_admin()) with check (public.is_admin());

-- Mockup templates: everyone reads active; admins manage.
drop policy if exists "customizer_mockup_templates_read" on public.customizer_mockup_templates;
create policy "customizer_mockup_templates_read" on public.customizer_mockup_templates
for select using (active or public.is_admin());

drop policy if exists "customizer_mockup_templates_admin_manage" on public.customizer_mockup_templates;
create policy "customizer_mockup_templates_admin_manage" on public.customizer_mockup_templates
for all using (public.is_admin()) with check (public.is_admin());

-- Guides: admin-only editor furniture.
drop policy if exists "customizer_guides_admin_manage" on public.customizer_guides;
create policy "customizer_guides_admin_manage" on public.customizer_guides
for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

drop trigger if exists set_customizer_asset_categories_updated_at on public.customizer_asset_categories;
create trigger set_customizer_asset_categories_updated_at
before update on public.customizer_asset_categories
for each row execute function public.set_updated_at();

drop trigger if exists set_customizer_assets_updated_at on public.customizer_assets;
create trigger set_customizer_assets_updated_at
before update on public.customizer_assets
for each row execute function public.set_updated_at();

drop trigger if exists set_customer_asset_library_updated_at on public.customer_asset_library;
create trigger set_customer_asset_library_updated_at
before update on public.customer_asset_library
for each row execute function public.set_updated_at();

drop trigger if exists set_customizer_render_jobs_updated_at on public.customizer_render_jobs;
create trigger set_customizer_render_jobs_updated_at
before update on public.customizer_render_jobs
for each row execute function public.set_updated_at();

drop trigger if exists set_order_design_snapshots_updated_at on public.order_design_snapshots;
create trigger set_order_design_snapshots_updated_at
before update on public.order_design_snapshots
for each row execute function public.set_updated_at();

drop trigger if exists set_customizer_mockup_templates_updated_at on public.customizer_mockup_templates;
create trigger set_customizer_mockup_templates_updated_at
before update on public.customizer_mockup_templates
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists idx_ctv_template_id on public.customizer_template_versions(template_id);
create index if not exists idx_ctv_product_id on public.customizer_template_versions(product_id);
create index if not exists idx_customizer_assets_category on public.customizer_assets(category_id);
create index if not exists idx_customizer_assets_active on public.customizer_assets(active, customer_available) where not archived;
create index if not exists idx_customer_asset_library_user on public.customer_asset_library(user_id, created_at desc);
create index if not exists idx_render_jobs_customization on public.customizer_render_jobs(customization_id);
create index if not exists idx_render_jobs_status on public.customizer_render_jobs(status, priority desc, created_at);
create index if not exists idx_render_jobs_input_hash on public.customizer_render_jobs(input_hash, job_type);
create index if not exists idx_render_outputs_job on public.customizer_render_outputs(job_id);
create index if not exists idx_render_outputs_customization on public.customizer_render_outputs(customization_id);
create index if not exists idx_preflight_customization on public.customizer_preflight_results(customization_id, created_at desc);
create index if not exists idx_order_design_snapshots_order on public.order_design_snapshots(order_id);
create index if not exists idx_order_design_snapshots_customization on public.order_design_snapshots(customization_id);
create index if not exists idx_mockup_templates_product on public.customizer_mockup_templates(product_id);
create index if not exists idx_customizer_guides_template on public.customizer_guides(template_id, page_id);

-- ---------------------------------------------------------------------------
-- Grants (RLS gates row access; service role bypasses RLS)
-- ---------------------------------------------------------------------------

grant all on public.customizer_template_versions to service_role;
grant all on public.customizer_asset_categories to service_role;
grant all on public.customizer_assets to service_role;
grant all on public.customer_asset_library to service_role;
grant all on public.customizer_render_jobs to service_role;
grant all on public.customizer_render_outputs to service_role;
grant all on public.customizer_preflight_results to service_role;
grant all on public.order_design_snapshots to service_role;
grant all on public.customizer_mockup_templates to service_role;
grant all on public.customizer_guides to service_role;

grant select on public.customizer_template_versions to anon, authenticated;
grant select on public.customizer_asset_categories to anon, authenticated;
grant select on public.customizer_assets to anon, authenticated;
grant select, insert, update, delete on public.customer_asset_library to authenticated;
grant select on public.customizer_render_jobs to authenticated;
grant select on public.customizer_render_outputs to authenticated;
grant select on public.customizer_preflight_results to authenticated;
grant select on public.order_design_snapshots to authenticated;
grant select on public.customizer_mockup_templates to anon, authenticated;
grant select on public.customizer_guides to authenticated;
grant insert, update, delete on public.customizer_asset_categories to authenticated;
grant insert, update, delete on public.customizer_assets to authenticated;
grant insert, update, delete on public.customizer_template_versions to authenticated;
grant insert, update, delete on public.customizer_mockup_templates to authenticated;
grant insert, update, delete on public.customizer_guides to authenticated;

-- ---------------------------------------------------------------------------
-- Storage buckets
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('customizer-elements', 'customizer-elements', true, 10485760, array['image/svg+xml','image/jpeg','image/png','image/webp']),
  ('customizer-renders', 'customizer-renders', false, 104857600, array['image/png','application/pdf','image/svg+xml'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Render outputs are written and read exclusively through the service role
-- (signed URLs issued by protected endpoints). No storage policies for
-- authenticated users on customizer-renders. Elements bucket is public-read;
-- writes go through the admin API (service role).

/* 08, 09, 12. MOCKUP SCENES, RENDER METADATA AND FEATURE FLAGS
+   Source migration: 20260714153000_customizer_v2_completion.sql
   ============================================================ */
-- Customizer V2 completion: additive render metadata, mockup scene tables,
-- guide state, and staged product feature flags. This migration never deletes
-- customer customizations, order snapshots, or production files.

alter table public.customizer_render_jobs
  drop constraint if exists customizer_render_jobs_job_type_check;
alter table public.customizer_render_jobs
  add constraint customizer_render_jobs_job_type_check
  check (job_type in ('preview','admin_preview','thumbnail','cart_thumbnail','print_png','print_pdf','mockup'));

alter table public.customizer_render_outputs
  add column if not exists render_engine_version text,
  add column if not exists template_version integer,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.customizer_guides
  add column if not exists locked boolean not null default false,
  add column if not exists hidden boolean not null default false,
  add column if not exists customer_visible boolean not null default false,
  add column if not exists updated_at timestamp with time zone not null default now();

create table if not exists public.customizer_mockup_views (
  id uuid primary key default gen_random_uuid(),
  mockup_template_id uuid not null references public.customizer_mockup_templates(id) on delete cascade,
  name text not null,
  base_image_asset_id uuid references public.customizer_assets(id) on delete set null,
  base_image_url text,
  width integer not null default 1600 check (width > 0),
  height integer not null default 1200 check (height > 0),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.customizer_mockup_artwork_areas (
  id uuid primary key default gen_random_uuid(),
  mockup_view_id uuid not null references public.customizer_mockup_views(id) on delete cascade,
  source_page_id text not null,
  x numeric not null,
  y numeric not null,
  width numeric not null check (width > 0),
  height numeric not null check (height > 0),
  rotation numeric not null default 0,
  clip_path text,
  perspective_points jsonb,
  warp_type text not null default 'none' check (warp_type in ('none','perspective','cylinder')),
  opacity numeric not null default 1 check (opacity >= 0 and opacity <= 1),
  blend_mode text,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.customizer_mockup_overlays (
  id uuid primary key default gen_random_uuid(),
  mockup_view_id uuid not null references public.customizer_mockup_views(id) on delete cascade,
  asset_id uuid references public.customizer_assets(id) on delete set null,
  src text,
  overlay_type text not null check (overlay_type in ('shadow','highlight','texture','foreground')),
  opacity numeric not null default 1 check (opacity >= 0 and opacity <= 1),
  blend_mode text,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.customizer_feature_flags (
  id uuid primary key default gen_random_uuid(),
  product_id text references public.products(id) on delete cascade,
  flag text not null check (flag in (
    'customizer_v2',
    'customizer_v2_grids',
    'customizer_v2_groups',
    'customizer_v2_mockups',
    'customizer_v2_perspective_mockups',
    'customizer_v2_server_rendering',
    'customizer_v2_print_pdf',
    'customizer_v2_customer_layers',
    'customizer_v2_customer_multiselect',
    'customizer_v2_customer_grouping',
    'customizer_v2_qr_codes',
    'customizer_v2_customer_shapes',
    'customizer_v2_customer_lines',
    'customizer_v2_customer_frames',
    'customizer_v2_customer_grids',
    'customizer_v2_image_filters',
    'customizer_v2_product_preview_editing',
    'customizer_v2_split_view'
  )),
  enabled boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (product_id, flag)
);

create index if not exists idx_mockup_views_template on public.customizer_mockup_views(mockup_template_id, sort_order);
create index if not exists idx_mockup_artwork_areas_view on public.customizer_mockup_artwork_areas(mockup_view_id, sort_order);
create index if not exists idx_mockup_overlays_view on public.customizer_mockup_overlays(mockup_view_id, sort_order);
create index if not exists idx_customizer_feature_flags_product on public.customizer_feature_flags(product_id, flag) where enabled;
create index if not exists idx_render_outputs_checksum on public.customizer_render_outputs(checksum) where checksum is not null;

alter table public.customizer_mockup_views enable row level security;
alter table public.customizer_mockup_artwork_areas enable row level security;
alter table public.customizer_mockup_overlays enable row level security;
alter table public.customizer_feature_flags enable row level security;

drop policy if exists "customizer_mockup_views_public_read" on public.customizer_mockup_views;
create policy "customizer_mockup_views_public_read" on public.customizer_mockup_views for select using (
  exists (select 1 from public.customizer_mockup_templates template where template.id = mockup_template_id and template.active)
);
drop policy if exists "customizer_mockup_views_admin_manage" on public.customizer_mockup_views;
create policy "customizer_mockup_views_admin_manage" on public.customizer_mockup_views for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "customizer_mockup_artwork_areas_public_read" on public.customizer_mockup_artwork_areas;
create policy "customizer_mockup_artwork_areas_public_read" on public.customizer_mockup_artwork_areas for select using (
  exists (
    select 1 from public.customizer_mockup_views view_row
    join public.customizer_mockup_templates template on template.id = view_row.mockup_template_id
    where view_row.id = mockup_view_id and view_row.active and template.active
  )
);
drop policy if exists "customizer_mockup_artwork_areas_admin_manage" on public.customizer_mockup_artwork_areas;
create policy "customizer_mockup_artwork_areas_admin_manage" on public.customizer_mockup_artwork_areas for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "customizer_mockup_overlays_public_read" on public.customizer_mockup_overlays;
create policy "customizer_mockup_overlays_public_read" on public.customizer_mockup_overlays for select using (
  exists (
    select 1 from public.customizer_mockup_views view_row
    join public.customizer_mockup_templates template on template.id = view_row.mockup_template_id
    where view_row.id = mockup_view_id and view_row.active and template.active
  )
);
drop policy if exists "customizer_mockup_overlays_admin_manage" on public.customizer_mockup_overlays;
create policy "customizer_mockup_overlays_admin_manage" on public.customizer_mockup_overlays for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "customizer_feature_flags_read" on public.customizer_feature_flags;
create policy "customizer_feature_flags_read" on public.customizer_feature_flags for select using (true);
drop policy if exists "customizer_feature_flags_admin_manage" on public.customizer_feature_flags;
create policy "customizer_feature_flags_admin_manage" on public.customizer_feature_flags for all using (public.is_admin()) with check (public.is_admin());

grant select on public.customizer_mockup_views, public.customizer_mockup_artwork_areas, public.customizer_mockup_overlays, public.customizer_feature_flags to anon, authenticated;
grant all on public.customizer_mockup_views, public.customizer_mockup_artwork_areas, public.customizer_mockup_overlays, public.customizer_feature_flags to service_role;
grant insert, update, delete on public.customizer_mockup_views, public.customizer_mockup_artwork_areas, public.customizer_mockup_overlays, public.customizer_feature_flags to authenticated;

/* 08, 09, 12, 14. PRODUCTION HARDENING FUNCTIONS AND CONSTRAINTS
+   Source migration: 20260714210000_customizer_v2_production_hardening.sql
   ============================================================ */
-- Husnalogy Customizer V2 production hardening.
-- Additive/backward-compatible: existing customizations, order snapshots,
-- legacy mockup JSON, and files remain readable.

alter table public.product_customizations
  add column if not exists asset_references jsonb not null default '[]'::jsonb;

-- -------------------------------------------------------------------------
-- Normalized, versioned mockup scenes
-- -------------------------------------------------------------------------

alter table public.customizer_mockup_templates
  add column if not exists product_type text not null default 'flat-card',
  add column if not exists version integer not null default 1,
  add column if not exists status text not null default 'draft';

alter table public.customizer_mockup_templates drop constraint if exists customizer_mockup_templates_status_check;
alter table public.customizer_mockup_templates add constraint customizer_mockup_templates_status_check check (status in ('draft','published','archived'));
update public.customizer_mockup_templates set status = 'published' where active and status = 'draft';

alter table public.customizer_mockup_views
  add column if not exists requires_transparency boolean not null default false;

alter table public.customizer_mockup_artwork_areas
  add column if not exists visible boolean not null default true,
  add column if not exists locked boolean not null default false;
alter table public.customizer_mockup_artwork_areas drop constraint if exists customizer_mockup_artwork_areas_warp_type_check;
alter table public.customizer_mockup_artwork_areas add constraint customizer_mockup_artwork_areas_warp_type_check check (warp_type in ('none','perspective','cylinder','custom'));

alter table public.customizer_mockup_overlays
  add column if not exists visible boolean not null default true,
  add column if not exists locked boolean not null default false,
  add column if not exists updated_at timestamp with time zone not null default now();

create unique index if not exists uq_customizer_mockup_product_version on public.customizer_mockup_templates(product_id, version);
create unique index if not exists uq_customizer_mockup_product_draft on public.customizer_mockup_templates(product_id) where status = 'draft' and active;
create unique index if not exists uq_customizer_mockup_product_published on public.customizer_mockup_templates(product_id) where status = 'published' and active;

drop policy if exists "customizer_mockup_templates_read" on public.customizer_mockup_templates;
create policy "customizer_mockup_templates_read" on public.customizer_mockup_templates for select using ((active and status = 'published') or public.is_admin());
drop policy if exists "customizer_mockup_views_public_read" on public.customizer_mockup_views;
create policy "customizer_mockup_views_public_read" on public.customizer_mockup_views for select using (
  exists (select 1 from public.customizer_mockup_templates t where t.id = mockup_template_id and t.active and t.status = 'published')
);
drop policy if exists "customizer_mockup_artwork_areas_public_read" on public.customizer_mockup_artwork_areas;
create policy "customizer_mockup_artwork_areas_public_read" on public.customizer_mockup_artwork_areas for select using (
  exists (select 1 from public.customizer_mockup_views v join public.customizer_mockup_templates t on t.id = v.mockup_template_id where v.id = mockup_view_id and v.active and t.active and t.status = 'published')
);
drop policy if exists "customizer_mockup_overlays_public_read" on public.customizer_mockup_overlays;
create policy "customizer_mockup_overlays_public_read" on public.customizer_mockup_overlays for select using (
  exists (select 1 from public.customizer_mockup_views v join public.customizer_mockup_templates t on t.id = v.mockup_template_id where v.id = mockup_view_id and v.active and t.active and t.status = 'published')
);

create or replace function public.upsert_customizer_mockup(p_product_id text, p_payload jsonb, p_publish boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template_id uuid;
  v_view_id uuid;
  v_view jsonb;
  v_area jsonb;
  v_overlay jsonb;
  v_version integer;
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    raise exception 'administrator access required';
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'product not found';
  end if;

  select id into v_template_id from public.customizer_mockup_templates
    where product_id = p_product_id and status = 'draft' and active order by updated_at desc limit 1 for update;
  select coalesce(max(version), 0) + 1 into v_version from public.customizer_mockup_templates where product_id = p_product_id and status <> 'draft';

  if v_template_id is null then
    insert into public.customizer_mockup_templates(product_id, product_type, name, view, config, version, status, active)
    values (
      p_product_id,
      coalesce(nullif(p_payload->>'productType',''), 'flat-card'),
      coalesce(nullif(p_payload->>'name',''), 'Product mockup'),
      coalesce(p_payload#>>'{views,0,id}', 'front'),
      jsonb_build_object('width', coalesce((p_payload->>'width')::integer,1600), 'height', coalesce((p_payload->>'height')::integer,1200)),
      v_version,
      'draft',
      true
    ) returning id into v_template_id;
  else
    update public.customizer_mockup_templates set
      product_type = coalesce(nullif(p_payload->>'productType',''), product_type),
      name = coalesce(nullif(p_payload->>'name',''), name),
      view = coalesce(p_payload#>>'{views,0,id}', view),
      config = jsonb_build_object('width', coalesce((p_payload->>'width')::integer,1600), 'height', coalesce((p_payload->>'height')::integer,1200)),
      version = v_version,
      updated_at = now()
    where id = v_template_id;
  end if;

  delete from public.customizer_mockup_views where mockup_template_id = v_template_id;
  for v_view in select value from jsonb_array_elements(coalesce(p_payload->'views','[]'::jsonb)) loop
    insert into public.customizer_mockup_views(mockup_template_id,name,base_image_url,width,height,sort_order,active,requires_transparency)
    values (
      v_template_id,
      coalesce(nullif(v_view->>'name',''), 'Mockup view'),
      nullif(v_view->>'baseImageUrl',''),
      coalesce((v_view->>'width')::integer,(p_payload->>'width')::integer,1600),
      coalesce((v_view->>'height')::integer,(p_payload->>'height')::integer,1200),
      coalesce((v_view->>'sortOrder')::integer,0),
      true,
      coalesce((v_view->>'requiresTransparency')::boolean,false)
    ) returning id into v_view_id;

    for v_area in select value from jsonb_array_elements(coalesce(v_view->'artworkAreas','[]'::jsonb)) loop
      insert into public.customizer_mockup_artwork_areas(
        mockup_view_id,source_page_id,x,y,width,height,rotation,clip_path,perspective_points,warp_type,opacity,blend_mode,sort_order,visible,locked
      ) values (
        v_view_id,
        coalesce(nullif(v_area->>'sourcePageId',''),'front'),
        coalesce((v_area->>'x')::numeric,0), coalesce((v_area->>'y')::numeric,0),
        greatest(1,coalesce((v_area->>'width')::numeric,1)), greatest(1,coalesce((v_area->>'height')::numeric,1)),
        coalesce((v_area->>'rotation')::numeric,0), nullif(v_area->>'clipPath',''), v_area->'perspectivePoints',
        coalesce(nullif(v_area->>'warpType',''),'none'), coalesce((v_area->>'opacity')::numeric,1), nullif(v_area->>'blendMode',''),
        coalesce((v_area->>'sortOrder')::integer,0), coalesce((v_area->>'visible')::boolean,true), coalesce((v_area->>'locked')::boolean,false)
      );
    end loop;

    for v_overlay in select value from jsonb_array_elements(coalesce(v_view->'overlays','[]'::jsonb)) loop
      insert into public.customizer_mockup_overlays(mockup_view_id,src,overlay_type,opacity,blend_mode,sort_order,visible,locked)
      values (
        v_view_id, nullif(v_overlay->>'src',''), coalesce(nullif(v_overlay->>'type',''),'shadow'),
        coalesce((v_overlay->>'opacity')::numeric,1), nullif(v_overlay->>'blendMode',''), coalesce((v_overlay->>'sortOrder')::integer,0),
        coalesce((v_overlay->>'visible')::boolean,true), coalesce((v_overlay->>'locked')::boolean,false)
      );
    end loop;
  end loop;

  if p_publish then
    update public.customizer_mockup_templates set status = 'archived', active = false, updated_at = now()
      where product_id = p_product_id and status = 'published' and id <> v_template_id;
    update public.customizer_mockup_templates set status = 'published', active = true, version = v_version, updated_at = now() where id = v_template_id;
  end if;
  return v_template_id;
end;
$$;
revoke all on function public.upsert_customizer_mockup(text,jsonb,boolean) from public, anon;
grant execute on function public.upsert_customizer_mockup(text,jsonb,boolean) to authenticated, service_role;

-- -------------------------------------------------------------------------
-- Database-authoritative feature flags
-- -------------------------------------------------------------------------

alter table public.customizer_feature_flags drop constraint if exists customizer_feature_flags_flag_check;
alter table public.customizer_feature_flags drop constraint if exists customizer_feature_flags_product_id_flag_key;
alter table public.customizer_feature_flags drop constraint if exists customizer_feature_flags_scope_check;
alter table public.customizer_feature_flags drop constraint if exists customizer_feature_flags_rollout_check;
alter table public.customizer_feature_flags
  add column if not exists scope text not null default 'product',
  add column if not exists scope_key text,
  add column if not exists product_type text,
  add column if not exists environments text[] not null default array['development','preview','production','test'],
  add column if not exists rollout_percentage integer not null default 100,
  add column if not exists admin_only boolean not null default false,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.customizer_feature_flags set scope = case when product_id is null then 'global' else 'product' end where scope is null or scope = '';
update public.customizer_feature_flags set scope_key = case when scope = 'global' then '*' else coalesce(product_id, product_type, '*') end where scope_key is null or scope_key = '';
alter table public.customizer_feature_flags alter column scope_key set not null;
alter table public.customizer_feature_flags add constraint customizer_feature_flags_flag_check check (flag in (
  'customizer_v2',
  'customizer_v2_grids',
  'customizer_v2_groups',
  'customizer_v2_mockups',
  'customizer_v2_perspective_mockups',
  'customizer_v2_server_rendering',
  'customizer_v2_print_pdf',
  'customizer_v2_customer_layers',
  'customizer_v2_customer_multiselect',
  'customizer_v2_customer_grouping',
  'customizer_v2_qr_codes',
  'customizer_v2_customer_shapes',
  'customizer_v2_customer_lines',
  'customizer_v2_customer_frames',
  'customizer_v2_customer_grids',
  'customizer_v2_image_filters',
  'customizer_v2_product_preview_editing',
  'customizer_v2_split_view'
)) not valid;
do $$
begin
  alter table public.customizer_feature_flags
    validate constraint customizer_feature_flags_flag_check;
exception
  when check_violation then
    raise warning 'customizer_feature_flags contains legacy flag names; preserving those rows and leaving customizer_feature_flags_flag_check not valid';
end $$;
alter table public.customizer_feature_flags add constraint customizer_feature_flags_scope_check check (scope in ('global','product_type','product'));
alter table public.customizer_feature_flags add constraint customizer_feature_flags_rollout_check check (rollout_percentage between 0 and 100);
create unique index if not exists uq_customizer_feature_flag_scope on public.customizer_feature_flags(scope,scope_key,flag);

insert into public.customizer_feature_flags(product_id,flag,enabled,scope,scope_key,rollout_percentage)
values
  (null,'customizer_v2',true,'global','*',100),
  (null,'customizer_v2_grids',false,'global','*',100),
  (null,'customizer_v2_groups',false,'global','*',100),
  (null,'customizer_v2_mockups',false,'global','*',100),
  (null,'customizer_v2_perspective_mockups',false,'global','*',100),
  (null,'customizer_v2_server_rendering',false,'global','*',100),
  (null,'customizer_v2_print_pdf',false,'global','*',100)
on conflict (scope,scope_key,flag) do nothing;

drop policy if exists "customizer_feature_flags_read" on public.customizer_feature_flags;
drop policy if exists "customizer_feature_flags_admin_read" on public.customizer_feature_flags;
create policy "customizer_feature_flags_admin_read" on public.customizer_feature_flags for select using (public.is_admin());
revoke all on public.customizer_feature_flags from anon;
revoke select on public.customizer_feature_flags from authenticated;
grant select,insert,update,delete on public.customizer_feature_flags to authenticated;
grant all on public.customizer_feature_flags to service_role;

-- -------------------------------------------------------------------------
-- Lease-based render jobs, recovery, cancellation, and verified outputs
-- -------------------------------------------------------------------------

alter table public.customizer_render_jobs
  add column if not exists locked_by text,
  add column if not exists lock_token uuid,
  add column if not exists lock_expires_at timestamp with time zone,
  add column if not exists heartbeat_at timestamp with time zone,
  add column if not exists next_attempt_at timestamp with time zone,
  add column if not exists cancel_requested_at timestamp with time zone;
alter table public.customizer_render_jobs drop constraint if exists customizer_render_jobs_status_check;
alter table public.customizer_render_jobs add constraint customizer_render_jobs_status_check check (status in ('queued','retrying','processing','completed','failed','cancelled'));

alter table public.customizer_render_outputs
  add column if not exists order_id text references public.orders(id) on delete set null,
  add column if not exists mockup_version integer,
  add column if not exists output_type text,
  add column if not exists mime_type text,
  add column if not exists input_hash text,
  add column if not exists status text not null default 'ready',
  add column if not exists expires_at timestamp with time zone,
  add column if not exists verified_at timestamp with time zone;
alter table public.customizer_render_outputs drop constraint if exists customizer_render_outputs_format_check;
alter table public.customizer_render_outputs drop constraint if exists customizer_render_outputs_status_check;
alter table public.customizer_render_outputs add constraint customizer_render_outputs_format_check check (format in ('png','webp','pdf','svg'));
alter table public.customizer_render_outputs add constraint customizer_render_outputs_status_check check (status in ('writing','ready','invalid','expired'));

create index if not exists idx_render_jobs_lease on public.customizer_render_jobs(status,next_attempt_at,lock_expires_at,priority desc,created_at);
create index if not exists idx_render_outputs_input_hash on public.customizer_render_outputs(input_hash,output_type,status);

create or replace function public.claim_customizer_render_job(p_job_id uuid, p_worker_id text, p_lease_seconds integer default 120)
returns public.customizer_render_jobs
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.customizer_render_jobs;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  update public.customizer_render_jobs set
    status = 'processing', locked_by = left(p_worker_id,120), lock_token = gen_random_uuid(),
    lock_expires_at = now() + make_interval(secs => greatest(30,least(p_lease_seconds,900))),
    heartbeat_at = now(), started_at = coalesce(started_at,now()), updated_at = now()
  where id = p_job_id
    and cancel_requested_at is null
    and attempt_count < 3
    and (next_attempt_at is null or next_attempt_at <= now())
    and (status in ('queued','retrying','failed') or (status = 'processing' and lock_expires_at < now()))
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.recover_abandoned_customizer_render_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  update public.customizer_render_jobs set
    status = case when attempt_count >= 3 then 'failed' else 'retrying' end,
    error_code = 'WORKER_LEASE_EXPIRED', error_message = 'The render worker lease expired; the job was recovered.',
    locked_by = null, lock_token = null, lock_expires_at = null, next_attempt_at = case when attempt_count < 3 then now() else null end,
    updated_at = now()
  where status = 'processing' and lock_expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.claim_customizer_render_job(uuid,text,integer) from public,anon,authenticated;
revoke all on function public.recover_abandoned_customizer_render_jobs() from public,anon,authenticated;
grant execute on function public.claim_customizer_render_job(uuid,text,integer) to service_role;
grant execute on function public.recover_abandoned_customizer_render_jobs() to service_role;

-- Snapshot identity/design fields are immutable; only render lifecycle fields
-- may advance after order creation.
create or replace function public.protect_order_design_snapshot_identity()
returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - array['print_files','preview_files','render_status','updated_at'])
     is distinct from (to_jsonb(old) - array['print_files','preview_files','render_status','updated_at']) then
    raise exception 'order design snapshots are immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_order_design_snapshot_identity on public.order_design_snapshots;
create trigger protect_order_design_snapshot_identity before update on public.order_design_snapshots
for each row execute function public.protect_order_design_snapshot_identity();

update storage.buckets set allowed_mime_types = array['image/png','image/webp','application/pdf','image/svg+xml'] where id = 'customizer-renders';

/* 05, 12, 13. CUSTOMER PARITY STATE, FLAGS AND AUDIT LOGS
+   Source migration: 20260718120000_customizer_v2_customer_parity.sql
   ============================================================ */
-- Husnalogy Customizer V2 customer-editor parity.
-- Additive only: existing template snapshots, customizations, cart rows, orders,
-- render outputs, and storage objects are deliberately left untouched.

-- New publications default to the current document schema. Historical rows
-- retain their original schema_version and continue through the migration path.
alter table public.customizer_template_versions
  alter column schema_version set default 4;

-- Keep the JSON document used by the application as the single canonical
-- customer state. This constraint protects new writes without rewriting legacy
-- rows; layer visibility, customer locks, groups, filters and inserted objects
-- live inside render_data.editorState.
alter table public.product_customizations
  drop constraint if exists product_customizations_render_data_object_check;
alter table public.product_customizations
  add constraint product_customizations_render_data_object_check
  check (render_data is null or jsonb_typeof(render_data) = 'object') not valid;
create index if not exists idx_product_customizations_render_data_gin
  on public.product_customizations using gin (render_data jsonb_path_ops);

-- Database-authoritative staged rollout flags for the customer parity tools.
alter table public.customizer_feature_flags
  drop constraint if exists customizer_feature_flags_flag_check;
alter table public.customizer_feature_flags
  add constraint customizer_feature_flags_flag_check check (flag in (
    'customizer_v2',
    'customizer_v2_grids',
    'customizer_v2_groups',
    'customizer_v2_mockups',
    'customizer_v2_perspective_mockups',
    'customizer_v2_server_rendering',
    'customizer_v2_print_pdf',
    'customizer_v2_customer_layers',
    'customizer_v2_customer_multiselect',
    'customizer_v2_customer_grouping',
    'customizer_v2_qr_codes',
    'customizer_v2_customer_shapes',
    'customizer_v2_customer_lines',
    'customizer_v2_customer_frames',
    'customizer_v2_customer_grids',
    'customizer_v2_image_filters',
    'customizer_v2_product_preview_editing',
    'customizer_v2_split_view'
  )) not valid;
do $$
begin
  alter table public.customizer_feature_flags
    validate constraint customizer_feature_flags_flag_check;
exception
  when check_violation then
    raise warning 'customizer_feature_flags contains legacy flag names; preserving those rows and leaving customizer_feature_flags_flag_check not valid';
end $$;

insert into public.customizer_feature_flags(product_id,flag,enabled,scope,scope_key,rollout_percentage)
values
  (null,'customizer_v2_customer_layers',false,'global','*',100),
  (null,'customizer_v2_customer_multiselect',false,'global','*',100),
  (null,'customizer_v2_customer_grouping',false,'global','*',100),
  (null,'customizer_v2_qr_codes',false,'global','*',100),
  (null,'customizer_v2_customer_shapes',false,'global','*',100),
  (null,'customizer_v2_customer_lines',false,'global','*',100),
  (null,'customizer_v2_customer_frames',false,'global','*',100),
  (null,'customizer_v2_customer_grids',false,'global','*',100),
  (null,'customizer_v2_image_filters',false,'global','*',100),
  (null,'customizer_v2_product_preview_editing',false,'global','*',100),
  (null,'customizer_v2_split_view',false,'global','*',100)
on conflict (scope,scope_key,flag) do nothing;

-- Append-only customer/customizer audit trail. Details may include the editor
-- state schema, affected layer IDs and typed validation violations, but never
-- binary uploads or signed asset URLs.
create table if not exists public.customizer_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  customization_id uuid references public.product_customizations(id) on delete set null,
  product_id text references public.products(id) on delete set null,
  action text not null check (char_length(action) between 1 and 80),
  layer_ids text[] not null default '{}',
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_customizer_audit_logs_actor_created
  on public.customizer_audit_logs(actor_id, created_at desc);
create index if not exists idx_customizer_audit_logs_customization_created
  on public.customizer_audit_logs(customization_id, created_at desc);
create index if not exists idx_customizer_audit_logs_product_created
  on public.customizer_audit_logs(product_id, created_at desc);

alter table public.customizer_audit_logs enable row level security;
drop policy if exists "customizer_audit_logs_owner_read" on public.customizer_audit_logs;
create policy "customizer_audit_logs_owner_read" on public.customizer_audit_logs
  for select using (actor_id = auth.uid() or public.is_admin());
drop policy if exists "customizer_audit_logs_actor_insert" on public.customizer_audit_logs;
create policy "customizer_audit_logs_actor_insert" on public.customizer_audit_logs
  for insert with check (actor_id = auth.uid() or public.is_admin());

revoke all on public.customizer_audit_logs from anon;
grant select,insert on public.customizer_audit_logs to authenticated;
grant all on public.customizer_audit_logs to service_role;

/* 14-16. UPDATED TIMESTAMPS, INDEXES, COMMENTS AND GRANTS
+   Source migration: 20260719120000_customizer_v2_schema_consolidation.sql
   ============================================================ */
-- Husnalogy Customizer V2 schema consolidation and operational metadata.
-- Additive only. This migration does not delete or rewrite templates,
-- customizations, customer assets, carts, orders, snapshots, or render files.

-- Authoritative naming decisions:
--   product_customizer_templates = mutable product template/draft
--   customizer_template_versions = immutable published template versions
--   customizer_mockup_templates.status/version = draft and published mockup versions
-- Separate customizer_templates, customizer_template_drafts, and
-- customizer_mockup_versions tables are intentionally not created because they
-- would duplicate those responsibilities and split existing data.

alter table public.customizer_mockup_overlays
  add column if not exists updated_at timestamp with time zone not null default now();

-- Reassert the complete application feature-flag contract. Earlier revisions
-- of the hardening migration allowed only the original server-side flags and
-- could fail when customer-editor rollout flags were already present.
alter table public.customizer_feature_flags
  drop constraint if exists customizer_feature_flags_flag_check;
alter table public.customizer_feature_flags
  add constraint customizer_feature_flags_flag_check check (flag in (
    'customizer_v2',
    'customizer_v2_grids',
    'customizer_v2_groups',
    'customizer_v2_mockups',
    'customizer_v2_perspective_mockups',
    'customizer_v2_server_rendering',
    'customizer_v2_print_pdf',
    'customizer_v2_customer_layers',
    'customizer_v2_customer_multiselect',
    'customizer_v2_customer_grouping',
    'customizer_v2_qr_codes',
    'customizer_v2_customer_shapes',
    'customizer_v2_customer_lines',
    'customizer_v2_customer_frames',
    'customizer_v2_customer_grids',
    'customizer_v2_image_filters',
    'customizer_v2_product_preview_editing',
    'customizer_v2_split_view'
  )) not valid;
do $$
begin
  alter table public.customizer_feature_flags
    validate constraint customizer_feature_flags_flag_check;
exception
  when check_violation then
    raise warning 'customizer_feature_flags contains legacy flag names; preserving those rows and leaving customizer_feature_flags_flag_check not valid';
end $$;

drop trigger if exists set_customizer_guides_updated_at on public.customizer_guides;
create trigger set_customizer_guides_updated_at
before update on public.customizer_guides
for each row execute function public.set_updated_at();

drop trigger if exists set_customizer_mockup_views_updated_at on public.customizer_mockup_views;
create trigger set_customizer_mockup_views_updated_at
before update on public.customizer_mockup_views
for each row execute function public.set_updated_at();

drop trigger if exists set_customizer_mockup_artwork_areas_updated_at on public.customizer_mockup_artwork_areas;
create trigger set_customizer_mockup_artwork_areas_updated_at
before update on public.customizer_mockup_artwork_areas
for each row execute function public.set_updated_at();

drop trigger if exists set_customizer_mockup_overlays_updated_at on public.customizer_mockup_overlays;
create trigger set_customizer_mockup_overlays_updated_at
before update on public.customizer_mockup_overlays
for each row execute function public.set_updated_at();

drop trigger if exists set_customizer_feature_flags_updated_at on public.customizer_feature_flags;
create trigger set_customizer_feature_flags_updated_at
before update on public.customizer_feature_flags
for each row execute function public.set_updated_at();

create index if not exists idx_product_customizations_template_version
  on public.product_customizations(template_id, template_version);
create index if not exists idx_customizer_template_versions_publisher
  on public.customizer_template_versions(published_by) where published_by is not null;
create index if not exists idx_customizer_feature_flags_scope_lookup
  on public.customizer_feature_flags(flag, scope, scope_key, enabled);
create index if not exists idx_customizer_mockup_templates_status
  on public.customizer_mockup_templates(product_id, status, active, version desc);

comment on table public.product_customizer_templates is
  'Authoritative mutable Customizer template draft for one product. Published snapshots live in customizer_template_versions.';
comment on table public.product_customizations is
  'Customer-owned Customizer values and sanitized editor state; cart/order references retain the exact template version.';
comment on table public.customizer_template_versions is
  'Immutable published CustomizerDocument snapshots used by saved designs, rendering, and order snapshots.';
comment on table public.customer_asset_library is
  'Private reusable customer uploads. Object paths remain owner scoped and URLs are signed on demand.';
comment on table public.customizer_mockup_templates is
  'Versioned mockup root. The status column distinguishes mutable draft, published, and archived versions.';
comment on table public.customizer_render_jobs is
  'Lease-based render queue. Claim and recovery functions are executable only by the service role.';
comment on table public.customizer_render_outputs is
  'Verified private preview, mockup, PNG, PDF, or SVG output metadata; binary files live in Storage.';
comment on table public.order_design_snapshots is
  'Immutable order-time design identity and document snapshot. Only render lifecycle fields may advance.';
comment on table public.customizer_feature_flags is
  'Database-authoritative staged rollout flags resolved by product, product type, and global scope.';
comment on table public.customizer_audit_logs is
  'Append-only customer/admin Customizer audit metadata. Never store signed URLs or binary payloads.';

-- Reassert least-privilege grants for the tables added after the original V2
-- migration. RLS remains authoritative for anon/authenticated callers; the
-- service_role bypasses RLS by design and has no user-facing policy.
revoke all on public.customizer_audit_logs from anon;
grant select, insert on public.customizer_audit_logs to authenticated;
grant all on public.customizer_audit_logs to service_role;

grant select on public.customizer_mockup_views,
  public.customizer_mockup_artwork_areas,
  public.customizer_mockup_overlays to anon, authenticated;
grant all on public.customizer_mockup_views,
  public.customizer_mockup_artwork_areas,
  public.customizer_mockup_overlays,
  public.customizer_feature_flags to service_role;

/* 07, 14-17. PERMANENT ADMIN ASSET LIBRARY, RLS AND PRIVATE STORAGE
+   Source migration: 20260719180000_permanent_admin_asset_library.sql
   ============================================================ */
-- Permanent administrator asset library for Husnalogy Customizer V2.
-- Extends customizer_assets as the single authoritative admin asset table.

create table if not exists public.customizer_asset_folders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references public.customizer_asset_folders(id) on delete restrict,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (parent_id, name)
);

alter table public.customizer_assets
  add column if not exists original_filename text,
  add column if not exists asset_type text not null default 'element',
  add column if not exists thumbnail_path text,
  add column if not exists editor_path text,
  add column if not exists folder_id uuid references public.customizer_asset_folders(id) on delete set null,
  add column if not exists admin_available boolean not null default true,
  add column if not exists status text not null default 'ready',
  add column if not exists usage_count integer not null default 0;

update public.customizer_assets
set
  original_filename = coalesce(nullif(original_filename, ''), regexp_replace(path, '^.*/', '')),
  status = case when archived then 'archived' when active then 'ready' else 'failed' end,
  public_url = null
where original_filename is null or public_url is not null;

alter table public.customizer_assets
  alter column original_filename set not null;

alter table public.customizer_assets
  drop constraint if exists customizer_assets_asset_type_check;
alter table public.customizer_assets
  add constraint customizer_assets_asset_type_check check (asset_type in (
    'image', 'element', 'svg', 'frame', 'background', 'texture', 'mockup', 'overlay', 'other'
  )) not valid;
alter table public.customizer_assets
  validate constraint customizer_assets_asset_type_check;

alter table public.customizer_assets
  drop constraint if exists customizer_assets_status_check;
alter table public.customizer_assets
  add constraint customizer_assets_status_check check (status in ('processing', 'ready', 'failed', 'archived')) not valid;
alter table public.customizer_assets
  validate constraint customizer_assets_status_check;

alter table public.customizer_assets
  drop constraint if exists customizer_assets_usage_count_check;
alter table public.customizer_assets
  add constraint customizer_assets_usage_count_check check (usage_count >= 0) not valid;
alter table public.customizer_assets
  validate constraint customizer_assets_usage_count_check;

create index if not exists idx_customizer_assets_checksum on public.customizer_assets(checksum) where checksum is not null;
create index if not exists idx_customizer_assets_folder on public.customizer_assets(folder_id, created_at desc);
create index if not exists idx_customizer_assets_type_status on public.customizer_assets(asset_type, status, admin_available, created_at desc);
create index if not exists idx_customizer_asset_folders_parent on public.customizer_asset_folders(parent_id, name);

drop trigger if exists set_customizer_asset_folders_updated_at on public.customizer_asset_folders;
create trigger set_customizer_asset_folders_updated_at
before update on public.customizer_asset_folders
for each row execute function public.set_updated_at();

alter table public.customizer_asset_folders enable row level security;

drop policy if exists "customizer_asset_folders_admin_read" on public.customizer_asset_folders;
create policy "customizer_asset_folders_admin_read" on public.customizer_asset_folders
for select using (public.is_admin());

drop policy if exists "customizer_asset_folders_admin_manage" on public.customizer_asset_folders;
create policy "customizer_asset_folders_admin_manage" on public.customizer_asset_folders
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "customizer_assets_read" on public.customizer_assets;
create policy "customizer_assets_read" on public.customizer_assets
for select using (
  public.is_admin()
  or (
    status = 'ready'
    and active
    and not archived
    and customer_available
  )
);

grant all on public.customizer_asset_folders to service_role;
grant select, insert, update, delete on public.customizer_asset_folders to authenticated;

-- Return human-readable reference locations so deletion can be blocked with a
-- useful explanation. Signed URLs are intentionally never inspected or stored.
create or replace function public.customizer_asset_usage(p_asset_id uuid, p_path text default '')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  usage jsonb := '[]'::jsonb;
  needle text := p_asset_id::text;
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    raise exception 'administrator access required';
  end if;

  select usage || coalesce(jsonb_agg(jsonb_build_object('type', 'published_template', 'id', id, 'label', 'Published template v' || version)), '[]'::jsonb)
  into usage from public.customizer_template_versions
  where position(needle in document::text) > 0 or (p_path <> '' and position(p_path in document::text) > 0);

  select usage || coalesce(jsonb_agg(jsonb_build_object('type', 'template', 'id', id, 'label', 'Product template')), '[]'::jsonb)
  into usage from public.product_customizer_templates
  where enabled and (
    position(needle in coalesce(layers, '{}'::jsonb)::text) > 0
    or position(needle in coalesce(assets, '{}'::jsonb)::text) > 0
    or (p_path <> '' and (position(p_path in coalesce(layers, '{}'::jsonb)::text) > 0 or position(p_path in coalesce(assets, '{}'::jsonb)::text) > 0))
  );

  select usage || coalesce(jsonb_agg(jsonb_build_object('type', 'customer_customization', 'id', id, 'label', 'Saved customization (' || status || ')')), '[]'::jsonb)
  into usage from public.product_customizations
  where position(needle in concat_ws(' ', values::text, uploaded_files::text, asset_references::text, render_data::text, print_files::text)) > 0
     or (p_path <> '' and position(p_path in concat_ws(' ', values::text, uploaded_files::text, asset_references::text, render_data::text, print_files::text)) > 0);

  select usage || coalesce(jsonb_agg(jsonb_build_object('type', 'cart_item', 'id', id, 'label', 'Cart item')), '[]'::jsonb)
  into usage from public.cart_items
  where position(needle in metadata::text) > 0 or (p_path <> '' and position(p_path in metadata::text) > 0);

  select usage || coalesce(jsonb_agg(jsonb_build_object('type', 'order', 'id', id, 'label', 'Order ' || id)), '[]'::jsonb)
  into usage from public.orders
  where position(needle in concat_ws(' ', customization_details::text, uploaded_files::text, metadata::text)) > 0
     or (p_path <> '' and position(p_path in concat_ws(' ', customization_details::text, uploaded_files::text, metadata::text)) > 0);

  select usage || coalesce(jsonb_agg(jsonb_build_object('type', 'order_item', 'id', id, 'label', 'Order item')), '[]'::jsonb)
  into usage from public.order_items
  where position(needle in concat_ws(' ', customization_values::text, uploaded_files::text, preview_data::text, metadata::text)) > 0
     or (p_path <> '' and position(p_path in concat_ws(' ', customization_values::text, uploaded_files::text, preview_data::text, metadata::text)) > 0);

  select usage || coalesce(jsonb_agg(jsonb_build_object('type', 'order_snapshot', 'id', id, 'label', 'Order snapshot ' || order_id)), '[]'::jsonb)
  into usage from public.order_design_snapshots
  where position(needle in concat_ws(' ', snapshot::text, preview_files::text, print_files::text)) > 0
     or (p_path <> '' and position(p_path in concat_ws(' ', snapshot::text, preview_files::text, print_files::text)) > 0);

  select usage || coalesce(jsonb_agg(jsonb_build_object('type', 'production_print', 'id', id, 'label', 'Production render job')), '[]'::jsonb)
  into usage from public.customizer_render_jobs
  where position(needle in input_snapshot::text) > 0 or (p_path <> '' and position(p_path in input_snapshot::text) > 0);

  select usage || coalesce(jsonb_agg(jsonb_build_object('type', 'mockup_template', 'id', id, 'label', 'Mockup template ' || name)), '[]'::jsonb)
  into usage from public.customizer_mockup_templates
  where position(needle in config::text) > 0 or (p_path <> '' and position(p_path in config::text) > 0);

  select usage || coalesce(jsonb_agg(jsonb_build_object('type', 'mockup_view', 'id', id, 'label', 'Mockup base image')), '[]'::jsonb)
  into usage from public.customizer_mockup_views where base_image_asset_id = p_asset_id;

  select usage || coalesce(jsonb_agg(jsonb_build_object('type', 'mockup_overlay', 'id', id, 'label', 'Mockup overlay')), '[]'::jsonb)
  into usage from public.customizer_mockup_overlays where asset_id = p_asset_id;

  return usage;
end;
$$;

revoke all on function public.customizer_asset_usage(uuid, text) from public, anon, authenticated;
grant execute on function public.customizer_asset_usage(uuid, text) to service_role;

create or replace function public.prevent_used_customizer_asset_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if jsonb_array_length(public.customizer_asset_usage(old.id, old.path)) > 0 then
    raise exception 'customizer asset is still in use';
  end if;
  return old;
end;
$$;

drop trigger if exists prevent_used_customizer_asset_delete on public.customizer_assets;
create trigger prevent_used_customizer_asset_delete
before delete on public.customizer_assets
for each row execute function public.prevent_used_customizer_asset_delete();

-- Administrator assets are private. APIs persist only bucket/path metadata and
-- issue short-lived signed URLs whenever a library response is rendered.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('customizer-elements', 'customizer-elements', false, 26214400, array['image/svg+xml','image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "customizer_admin_assets_read" on storage.objects;
create policy "customizer_admin_assets_read" on storage.objects
for select using (bucket_id = 'customizer-elements' and public.is_admin());

drop policy if exists "customizer_admin_assets_insert" on storage.objects;
create policy "customizer_admin_assets_insert" on storage.objects
for insert with check (bucket_id = 'customizer-elements' and public.is_admin());

drop policy if exists "customizer_admin_assets_update" on storage.objects;
create policy "customizer_admin_assets_update" on storage.objects
for update using (bucket_id = 'customizer-elements' and public.is_admin())
with check (bucket_id = 'customizer-elements' and public.is_admin());

drop policy if exists "customizer_admin_assets_delete" on storage.objects;
create policy "customizer_admin_assets_delete" on storage.objects
for delete using (bucket_id = 'customizer-elements' and public.is_admin());

comment on table public.customizer_assets is
  'Authoritative permanent administrator asset library. Files are private Storage objects; URLs are signed on demand.';
comment on table public.customizer_asset_folders is
  'Administrator-managed folders for customizer_assets. This is organization metadata, not a duplicate asset store.';

/* undefined
+   Source migration: 20260726120000_customizer_public_versioning.sql
   ============================================================ */
-- Separate the immutable internal snapshot sequence (`version`) from the
-- administrator/customer-facing release identifier (`major_version`,
-- `minor_revision`). Existing snapshot IDs and foreign-key references remain
-- untouched.

alter table public.customizer_template_versions
  add column if not exists major_version integer,
  add column if not exists minor_revision integer;

-- Preserve every legacy snapshot. Older snapshots become the immutable
-- Version 1 history; the current snapshot becomes Version 2 as requested.
with ranked as (
  select
    id,
    row_number() over (partition by template_id order by version, created_at, id) - 1 as legacy_revision,
    count(*) over (partition by template_id) as snapshot_count
  from public.customizer_template_versions
  where major_version is null or minor_revision is null
)
update public.customizer_template_versions versions
set
  major_version = case when ranked.legacy_revision = ranked.snapshot_count - 1 then 2 else 1 end,
  minor_revision = case when ranked.legacy_revision = ranked.snapshot_count - 1 then 0 else ranked.legacy_revision end
from ranked
where versions.id = ranked.id;

alter table public.customizer_template_versions
  alter column major_version set default 2,
  alter column major_version set not null,
  alter column minor_revision set default 0,
  alter column minor_revision set not null;

alter table public.customizer_template_versions
  drop constraint if exists customizer_template_versions_major_version_check,
  add constraint customizer_template_versions_major_version_check check (major_version >= 1),
  drop constraint if exists customizer_template_versions_minor_revision_check,
  add constraint customizer_template_versions_minor_revision_check check (minor_revision >= 0);

create unique index if not exists uq_customizer_template_public_version
  on public.customizer_template_versions(template_id, major_version, minor_revision);

create or replace function public.publish_customizer_template_version(
  p_template_id uuid,
  p_product_id text,
  p_update_type text,
  p_schema_version integer,
  p_engine_version text,
  p_document jsonb,
  p_font_dependencies jsonb,
  p_published_by uuid default null,
  p_notes text default ''
)
returns public.customizer_template_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  latest public.customizer_template_versions;
  published public.customizer_template_versions;
  next_internal_version integer;
  next_major integer;
  next_revision integer;
begin
  if p_update_type not in ('minor', 'major') then
    raise exception 'Invalid customizer update type';
  end if;

  -- Serialize publications for this template, including its first publish.
  perform pg_advisory_xact_lock(hashtextextended(p_template_id::text, 0));

  select *
  into latest
  from public.customizer_template_versions
  where template_id = p_template_id
  order by version desc
  limit 1;

  select greatest(
    coalesce(max(version), 0),
    coalesce((select version from public.product_customizer_templates where id = p_template_id), 0)
  ) + 1
  into next_internal_version
  from public.customizer_template_versions
  where template_id = p_template_id;

  if latest.id is null then
    next_major := case when p_update_type = 'major' then 3 else 2 end;
    next_revision := case when p_update_type = 'minor' then 1 else 0 end;
  elsif p_update_type = 'major' then
    next_major := latest.major_version + 1;
    next_revision := 0;
  else
    next_major := latest.major_version;
    next_revision := latest.minor_revision + 1;
  end if;

  insert into public.customizer_template_versions (
    template_id, product_id, version, major_version, minor_revision,
    schema_version, engine_version, document, font_dependencies,
    published_by, notes
  ) values (
    p_template_id, p_product_id, next_internal_version, next_major, next_revision,
    p_schema_version, p_engine_version,
    jsonb_set(p_document, '{templateVersion}', to_jsonb(next_internal_version), true),
    p_font_dependencies, p_published_by, left(coalesce(p_notes, ''), 2000)
  )
  returning * into published;

  -- This is an internal snapshot reference only. Draft saves never change it.
  update public.product_customizer_templates
  set version = next_internal_version
  where id = p_template_id;

  return published;
end;
$$;

revoke all on function public.publish_customizer_template_version(uuid, text, text, integer, text, jsonb, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.publish_customizer_template_version(uuid, text, text, integer, text, jsonb, jsonb, uuid, text) to service_role;

create or replace function public.prevent_customizer_version_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Published customizer versions are immutable';
end;
$$;

drop trigger if exists prevent_customizer_version_mutation on public.customizer_template_versions;
create trigger prevent_customizer_version_mutation
before update or delete on public.customizer_template_versions
for each row execute function public.prevent_customizer_version_mutation();

/* 17. STORAGE BUCKETS AND POLICIES ============================ */
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
-- bucket/path metadata.

/* 18. VERIFICATION QUERIES ===================================== */
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
-- column/index/RLS/policy/orphan validation.
