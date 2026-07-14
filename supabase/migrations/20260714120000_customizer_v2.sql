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
