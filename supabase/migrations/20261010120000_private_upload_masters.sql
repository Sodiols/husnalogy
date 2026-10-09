-- Upload masters are server-only (lib/uploads/master-original.ts).
--
-- Every raster upload keeps its exact bytes as a private MASTER beside the
-- sanitized ORIGINAL:
--   customer-uploads     <user>/<folder>/<stamp>-<name>/master.<ext>
--   customizer-elements  assets/<asset id>/master/<file name>
-- The application never signs a master for a browser, but the Storage read
-- policies still let a signed-in customer (own folder) or an administrator
-- (whole studio bucket) download one directly with the Supabase client. A
-- master can carry the camera/GPS metadata the original no longer has, so no
-- browser role may read, change or delete it. The Next.js server uses the
-- service role, which these policies do not restrict.
--
-- Additive and reversible: only the master condition is added to the existing
-- policies; every other permission is unchanged. Rollback at the end.

create or replace function public.is_private_upload_master(p_bucket text, p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_bucket = 'customer-uploads' and p_name ~ '/master\.[A-Za-z0-9]+$')
      or (p_bucket = 'customizer-elements' and p_name ~ '^assets/[^/]+/master/[^/]+$');
$$;

revoke all on function public.is_private_upload_master(text, text) from public;
grant execute on function public.is_private_upload_master(text, text) to anon, authenticated, service_role;

-- Customer uploads: unchanged rule, masters excluded.
drop policy if exists "customer_uploads_owner_read_storage" on storage.objects;
create policy "customer_uploads_owner_read_storage" on storage.objects
for select using (
  bucket_id = 'customer-uploads'
  and not public.is_private_upload_master(bucket_id, name)
  and (
    split_part(name, '/', 1) = auth.uid()::text
    or public.is_admin()
    or (
      public.is_designer()
      and exists (
        select 1 from public.customer_uploads cu
        where cu.path = storage.objects.name
          and cu.assigned_designer_id = auth.uid()
          and cu.user_id::text = split_part(storage.objects.name, '/', 1)
      )
    )
  )
);

-- Studio library: administrators keep full access except to masters.
drop policy if exists "customizer_admin_assets_read" on storage.objects;
create policy "customizer_admin_assets_read" on storage.objects
for select using (bucket_id = 'customizer-elements' and public.is_admin() and not public.is_private_upload_master(bucket_id, name));

drop policy if exists "customizer_admin_assets_insert" on storage.objects;
create policy "customizer_admin_assets_insert" on storage.objects
for insert with check (bucket_id = 'customizer-elements' and public.is_admin() and not public.is_private_upload_master(bucket_id, name));

drop policy if exists "customizer_admin_assets_update" on storage.objects;
create policy "customizer_admin_assets_update" on storage.objects
for update using (bucket_id = 'customizer-elements' and public.is_admin() and not public.is_private_upload_master(bucket_id, name))
with check (bucket_id = 'customizer-elements' and public.is_admin() and not public.is_private_upload_master(bucket_id, name));

drop policy if exists "customizer_admin_assets_delete" on storage.objects;
create policy "customizer_admin_assets_delete" on storage.objects
for delete using (bucket_id = 'customizer-elements' and public.is_admin() and not public.is_private_upload_master(bucket_id, name));

-- Rollback (restores the previous policies exactly):
--   drop policy if exists "customer_uploads_owner_read_storage" on storage.objects;
--   create policy "customer_uploads_owner_read_storage" on storage.objects for select using (
--     bucket_id = 'customer-uploads' and (split_part(name, '/', 1) = auth.uid()::text or public.is_admin()
--     or (public.is_designer() and exists (select 1 from public.customer_uploads cu where cu.path = storage.objects.name
--     and cu.assigned_designer_id = auth.uid() and cu.user_id::text = split_part(storage.objects.name, '/', 1)))));
--   drop policy if exists "customizer_admin_assets_read" on storage.objects;
--   create policy "customizer_admin_assets_read" on storage.objects for select using (bucket_id = 'customizer-elements' and public.is_admin());
--   drop policy if exists "customizer_admin_assets_insert" on storage.objects;
--   create policy "customizer_admin_assets_insert" on storage.objects for insert with check (bucket_id = 'customizer-elements' and public.is_admin());
--   drop policy if exists "customizer_admin_assets_update" on storage.objects;
--   create policy "customizer_admin_assets_update" on storage.objects for update using (bucket_id = 'customizer-elements' and public.is_admin())
--     with check (bucket_id = 'customizer-elements' and public.is_admin());
--   drop policy if exists "customizer_admin_assets_delete" on storage.objects;
--   create policy "customizer_admin_assets_delete" on storage.objects for delete using (bucket_id = 'customizer-elements' and public.is_admin());
--   drop function if exists public.is_private_upload_master(text, text);
