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
  flag text not null check (flag in ('customizer_v2_grids','customizer_v2_groups','customizer_v2_mockups','customizer_v2_server_rendering','customizer_v2_print_pdf')),
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
