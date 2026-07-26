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
